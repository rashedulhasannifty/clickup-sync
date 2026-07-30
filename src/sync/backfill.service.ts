import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { TasksService } from '../tasks/tasks.service';
import { SyncCheckpointsRepository } from './sync-checkpoints.repository';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES, BACKFILL_TIME_ENTRY_PRIORITY } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { subtractDays } from '../common/utils/date-utils';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);
  constructor(
    private readonly clickup: ClickupClient,
    private readonly tasks: TasksService,
    private readonly checkpoints: SyncCheckpointsRepository,
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
  ) {}

  // `includeArchived` overrides the global setting for this run. It exists so
  // the recurring reconcile can force-skip the archived pass (an expensive
  // per-list scan — see ClickupClient.getAllTasksBySpace) while manual backfills
  // still pick up archived tasks. Undefined = fall back to the setting.
  async backfillSpace(
    spaceId: string,
    lookbackDays?: number,
    timeEntryLookbackDays?: number,
    includeArchived?: boolean,
  ) {
    const space = CLICKUP_SPACES.find((s) => s.id === spaceId);
    const days = lookbackDays ?? space?.backfillLookbackDays ?? 7;
    const teamId = this.settings.getTeamId();
    await this.checkpoints.markAttempt('clickup', 'space', spaceId);

    // Time-entry window (see below): when the caller passes an explicit
    // `timeEntryLookbackDays` (the recurring reconciliation sweep does — see
    // SyncScheduler), use it verbatim so the hourly sweep scans a *bounded*
    // window instead of re-draining the full per-space window every run.
    // Otherwise (manual backfills), the configured per-space lookback is a
    // *floor*: a short task-sync window must not shrink the time-entry window,
    // or entries logged earlier would never be picked up — but a longer explicit
    // window is respected. The time-entry upsert is idempotent so re-scanning is
    // safe.
    const endDate = Date.now();
    const teLookbackDays = timeEntryLookbackDays ?? Math.max(days, space?.backfillLookbackDays ?? days);
    const teStartDate = subtractDays(teLookbackDays).getTime();
    const queue = this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES);
    // Deprioritize bulk backfill time-entry jobs so they never head-of-line-block
    // live taskTimeTrackedUpdated webhook jobs on the shared queue. See
    // BACKFILL_TIME_ENTRY_PRIORITY for the (counter-intuitive) BullMQ semantics.
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BACKFILL_TIME_ENTRY_PRIORITY };

    // Stream the space and persist each page/list as it arrives. Accumulating a
    // multi-year archived pull in memory (tens of thousands of tasks, each with
    // full raw JSON) OOM-kills the worker; streaming keeps the live set bounded
    // and lets partial progress survive a restart. `seen` holds only task ids
    // (small) to avoid double-processing a task that appears in both the active
    // and archived passes.
    const seen = new Set<string>();
    const referencedParents = new Set<string>();
    let total = 0;
    let parents = 0;
    let subs = 0;
    const { truncated } = await this.clickup.streamAllTasksBySpace(
      spaceId,
      {
        teamId,
        dateUpdatedGt: subtractDays(days).getTime(),
        includeClosed: true,
        subtasks: true,
        includeArchived: includeArchived ?? this.settings.getIncludeArchived(),
      },
      async (batch) => {
        const fresh = batch.filter((t) => {
          const id = (t as { id?: string }).id;
          if (!id) return true;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (!fresh.length) return;

        const batchParents = fresh.filter((t) => !(t as { parent?: unknown }).parent);
        const batchSubs = fresh.filter((t) => !!(t as { parent?: unknown }).parent);
        await this.tasks.syncTasks(batchParents);
        await this.tasks.syncTasks(batchSubs);

        // Record referenced parents, but resolve missing ones ONCE after the
        // stream (below) — not per batch. A subtask's parent often lands in a
        // later list/page, so a per-batch lookup would fetch it individually
        // and then upsert it again when its own batch arrives; across 400+
        // lists that is a lot of redundant rate-limited /task calls.
        for (const t of batchSubs) {
          const p = (t as { parent?: string | null }).parent;
          if (p) referencedParents.add(p);
        }

        // Enqueue time-entry sync per task. The worker resolves all-workspace
        // members as the `assignee` filter, capturing tracked time regardless of
        // who logged it.
        for (const t of fresh) {
          const taskId = (t as { id?: string }).id;
          if (taskId) {
            await queue.add(JOBS.SYNC_TASK_TIME_ENTRIES, { taskId, startDate: teStartDate, endDate }, jobOpts);
          }
        }

        total += fresh.length;
        parents += batchParents.length;
        subs += batchSubs.length;
      },
    );

    // Resolve parents referenced by subtasks but never seen in the stream (their
    // own update fell outside the lookback window). Parents that DID appear in a
    // batch are already stored, so exclude them; syncMissingParents re-checks the
    // DB and fetches only those still absent, so parentTaskId never dangles.
    const missingParentIds = [...referencedParents].filter((id) => !seen.has(id));
    await this.tasks.syncMissingParents(missingParentIds);

    // The team-level tasks endpoint omits space.name — patch it from config
    if (space?.name) {
      await this.tasks.patchSpaceNames(spaceId, space.name);
    }

    await this.checkpoints.markSuccess('clickup', 'space', spaceId);
    if (truncated) {
      this.logger.warn(`Backfill of ${space?.name || spaceId} hit the task pagination cap — the result is incomplete and tasks beyond the cap were not synced`);
    }
    this.logger.log(`Backfilled ${total} tasks + enqueued ${total} time-entry jobs for ${space?.name || spaceId}`);
    return { total, parents, subtasks: subs, truncated };
  }
}

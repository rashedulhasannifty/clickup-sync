import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { ClickupNormalizer, NormalizedTimeEntry } from '../clickup/clickup-normalizer';
import { WorkspaceMembersService } from '../clickup/workspace-members.service';
import { TimeEntriesRepository } from './time-entries.repository';
import { CostCalculatorService } from './cost-calculator.service';
import { QueueService } from '../queues/queue.service';
import { TagAssigneeMapRepository } from './tag-assignee-map.repository';
import { TasksRepository } from '../tasks/tasks.repository';
import { TasksService } from '../tasks/tasks.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { ReplacementJobData } from './assignee-replacement.service';
import { ClickUpTimeEntry } from '../clickup/clickup.types';
import { resolveTimeEntriesWindow } from '../clickup/time-entries.util';
import { SettingsService } from '../settings/settings.service';

// ClickUp's GET /team/{team}/time_entries has NO pagination (no page/limit
// params — it returns the whole window in one response). The prune below treats
// the fetched set as the authoritative "what still exists" list, so if ClickUp
// ever truncates a response the missing ids would look deleted and get pruned —
// real data loss. A single task's window normally has a handful of entries, so a
// count at/above this bound is truncation-suspect: we skip the prune (keep local
// rows) and warn, trading a stale row for never deleting live data on a bad read.
const PRUNE_SAFETY_MAX_ENTRIES = 1000;

@Injectable()
export class TimeEntriesService {
  private readonly logger = new Logger(TimeEntriesService.name);
  constructor(
    private readonly clickup: ClickupClient,
    private readonly normalizer: ClickupNormalizer,
    private readonly repo: TimeEntriesRepository,
    private readonly costs: CostCalculatorService,
    private readonly queues: QueueService,
    private readonly members: WorkspaceMembersService,
    private readonly tagAssigneeMap: TagAssigneeMapRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly tasksService: TasksService,
    private readonly settings: SettingsService,
  ) {}

  async syncTaskTimeEntries(taskId: string, assigneeIds?: string[], startDate?: number, endDate?: number) {
    const teamId = this.settings.getTeamId();

    // Ensure the task row exists before upserting any time entries — otherwise
    // the FK on `clickup_time_entries.task_id → clickup_tasks.task_id` blows
    // up. This races/fails when:
    //   • A `taskTimeTrackedUpdated` webhook fires before the task has ever
    //     been synced (the event processor only enqueues the time-entry job,
    //     not a task job, for that event type).
    //   • The task lives in a ClickUp space not in `CLICKUP_SPACES`, so no
    //     scheduled backfill ever fetches it.
    //   • The task has been deleted from ClickUp (returns 404 on syncTask).
    // If it can't be resolved, do NOT attempt the time-entry upserts — they'd
    // all fail with `clickup_time_entries_task_id_fkey` and bleed a new
    // `failed` row per event. Skip and report 0; the job log row stays
    // `completed`.
    if (!(await this.ensureTaskExists(taskId))) {
      this.logger.warn(`Task ${taskId} unresolved after pre-sync — skipping time-entry sync to avoid FK violation`);
      return 0;
    }

    // ClickUp's /team/{team}/time_entries returns only the token owner's entries
    // unless `assignee` is supplied. When the caller does not know who logged
    // the time (backfills, manual reconciles), fall back to all workspace
    // members so we capture every user's tracked time on the task, including
    // time logged on tasks that have no assignees.
    const ids = assigneeIds && assigneeIds.length > 0 ? assigneeIds : await this.members.getMemberIds();
    // Resolve the window ONCE and reuse it for both the fetch and the prune so
    // the two can never drift (the prune must be scoped to exactly the slice
    // ClickUp was asked about — see pruneTaskEntriesOutsideSet below).
    const { startMs, endMs } = resolveTimeEntriesWindow({ startDate, endDate });
    const entries = await this.clickup.getTimeEntries(teamId, taskId, { assigneeIds: ids, startDate: startMs, endDate: endMs });

    // ClickUp's team `time_entries?task_id=X` rolls up subtask time: an entry's
    // own `task.id` can be a SUBTASK of the queried task, not the queried task
    // itself. We write each entry under its own task_id (NormalizedTimeEntry
    // .taskId = entry.task.id), so every distinct referenced task must exist or
    // the upsert hits `clickup_time_entries_task_id_fkey`. Self-heal each
    // foreign task once (a recently-untouched subtask won't be in any backfill
    // page); entries whose task can't be resolved are skipped below rather than
    // failing the whole job. The queried `taskId` is already ensured above.
    const resolvableTaskIds = new Set<string>([taskId]);
    const foreignTaskIds = [
      ...new Set(
        entries
          .map((e) => e.task?.id)
          .filter((id): id is string => !!id && id !== taskId),
      ),
    ];
    for (const fid of foreignTaskIds) {
      if (await this.ensureTaskExists(fid)) resolvableTaskIds.add(fid);
      else this.logger.warn(`Time entry references task ${fid} (likely a subtask of ${taskId}) not resolvable in ClickUp — its entries will be skipped`);
    }

    let count = 0;
    const upserted: { normalized: NormalizedTimeEntry; rawTags: string[] }[] = [];
    // One rate cache for the whole task so multiple intervals logged by the
    // same user on the same day resolve the effective rate once, not per entry.
    const rateCache = new Map();
    for (const entry of entries) {
      const normalized = this.normalizer.normalizeTimeEntry(entry);
      // A non-null task_id that we couldn't resolve would violate the FK. Skip
      // just that entry (the rest still sync). A null task_id is allowed by the
      // nullable `ON DELETE SET NULL` FK, so it never violates.
      if (normalized.taskId != null && !resolvableTaskIds.has(normalized.taskId)) {
        this.logger.warn(`Skipping time entry ${normalized.timeEntryId}: task ${normalized.taskId} unresolved (FK guard)`);
        continue;
      }
      const rawTags = extractEntryTagNames(entry);
      upserted.push({ normalized, rawTags });
      const cost = await this.costs.calculate(normalized.userId, normalized.startTime, normalized.durationHours, rateCache);
      await this.repo.upsert(normalized, cost);
      if (cost.status === 'NO_RATE_FOUND') this.logger.warn(`Missing rate for user ${normalized.userId} on time entry ${normalized.timeEntryId}`);
      count += 1;
    }

    // Delete-reconciliation. ClickUp emits no "time entry deleted" event, so a
    // taskTimeTrackedUpdated webhook (or a backfill) is our only signal that an
    // entry vanished. The freshly-fetched set is authoritative ONLY for the
    // slice we asked about — (these `ids`) ∩ (this [startMs,endMs] window) — so
    // we prune local rows in exactly that slice that ClickUp did not return.
    // Rows for other users, or outside the window, are out of scope and kept.
    // An empty fetch is a legitimate "all deleted" signal, not an error: a
    // failed fetch throws above and never reaches here.
    if (entries.length >= PRUNE_SAFETY_MAX_ENTRIES) {
      // Truncation-suspect read — do NOT prune, or we risk deleting live local
      // rows whose ids simply weren't in this (possibly partial) response.
      this.logger.warn(
        `Fetched ${entries.length} time entries for task ${taskId} (>= ${PRUNE_SAFETY_MAX_ENTRIES}); skipping delete-reconciliation to avoid pruning live rows on a possibly-truncated response`,
      );
    } else {
      const keepIds = upserted.map((u) => u.normalized.timeEntryId);
      const pruned = await this.repo.pruneTaskEntriesOutsideSet({ taskId, userIds: ids, startMs, endMs, keepIds });
      if (pruned > 0) this.logger.log(`Pruned ${pruned} time entr${pruned === 1 ? 'y' : 'ies'} deleted in ClickUp for task ${taskId}`);
    }

    // Tag-based assignee replacement. Triggered by the *time entry's own tags*
    // (e.g. an interval tagged "ahmad"), regardless of who logged it — that's
    // the convention ClickUp surfaces in the data and what the n8n workflow
    // relied on. (An earlier approach gated on the logger's user id, which
    // matched the wrong dimension and never fired on real data.)
    const activeMap = await this.tagAssigneeMap.findAllActive();
    if (activeMap.length > 0) {
      const activeTagNames = new Set(activeMap.map((m) => m.tagName.toLowerCase()));
      for (const { normalized, rawTags } of upserted) {
        if (rawTags.length === 0) continue;
        if (!rawTags.some((t) => activeTagNames.has(t))) continue;
        await this.queues.get(QUEUES.CLICKUP_ASSIGNEE_REPLACEMENT).add(
          JOBS.REPLACE_TIME_ENTRY_ASSIGNEES,
          {
            timeEntryId: normalized.timeEntryId,
            taskId: normalized.taskId ?? taskId,
            startMs: normalized.startTime?.getTime() ?? 0,
            endMs: normalized.endTime?.getTime() ?? 0,
            durationHours: normalized.durationHours,
            billable: normalized.billable,
            description: normalized.description ?? undefined,
            originalUserId: normalized.userId ?? '',
            tags: rawTags,
          } satisfies ReplacementJobData,
          // Deterministic jobId so the same time entry can't be processed by two
          // concurrent replacement jobs (which would each create a ClickUp entry
          // = duplicate). BullMQ keeps one job per id; the worker's own audit-row
          // check handles idempotency across time.
          { ...this.queues.defaultJobOptions(), jobId: `replace:${normalized.timeEntryId}` },
        );
      }
    }

    return count;
  }

  /**
   * Make sure a task row exists locally, self-healing from ClickUp if it
   * doesn't. Returns whether the task is present after the attempt. Tolerant of
   * a 404/unreachable task (logs and returns false) so callers can skip rather
   * than throw. Used both for the queried task and for any *other* task ids a
   * fetched entry references (subtask roll-ups).
   */
  private async ensureTaskExists(taskId: string): Promise<boolean> {
    if (await this.tasksRepo.exists(taskId)) return true;
    this.logger.log(`Task ${taskId} missing locally — fetching from ClickUp before time-entry sync`);
    try {
      await this.tasksService.syncTask(taskId);
    } catch (err: any) {
      this.logger.warn(`Could not pre-sync task ${taskId}: ${err?.message ?? err}`);
    }
    return this.tasksRepo.exists(taskId);
  }
}

function extractEntryTagNames(entry: ClickUpTimeEntry): string[] {
  const out: string[] = [];
  for (const t of entry.tags ?? []) {
    const name = t?.name?.trim().toLowerCase();
    if (name) out.push(name);
  }
  return out;
}

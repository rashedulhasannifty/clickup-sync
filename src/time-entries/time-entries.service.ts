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
  ) {}

  async syncTaskTimeEntries(taskId: string, assigneeIds?: string[], startDate?: number, endDate?: number) {
    const teamId = process.env.CLICKUP_TEAM_ID || '3450636';

    // Ensure the task row exists before upserting any time entries — otherwise
    // the FK on `clickup_time_entries.task_id → clickup_tasks.task_id` blows
    // up. This races/fails when:
    //   • A `taskTimeTrackedUpdated` webhook fires before the task has ever
    //     been synced (the event processor only enqueues the time-entry job,
    //     not a task job, for that event type).
    //   • The task lives in a ClickUp space not in `CLICKUP_SPACES`, so no
    //     scheduled backfill ever fetches it.
    //   • The task has been deleted from ClickUp (returns 404 on syncTask).
    if (!(await this.tasksRepo.exists(taskId))) {
      this.logger.log(`Task ${taskId} missing locally — fetching from ClickUp before time-entry sync`);
      try {
        await this.tasksService.syncTask(taskId);
      } catch (err: any) {
        this.logger.warn(`Could not pre-sync task ${taskId}: ${err?.message ?? err}`);
      }
      // Re-check after the self-heal attempt. If the task still isn't here
      // (ClickUp 404 / unreachable / unconfigured space), do NOT attempt the
      // time-entry upserts — they'll all fail with `clickup_time_entries_
      // task_id_fkey` and bleed a new `failed` row per webhook event. Skip
      // and report 0; the job log row will be `completed`.
      if (!(await this.tasksRepo.exists(taskId))) {
        this.logger.warn(`Task ${taskId} unresolved after pre-sync — skipping time-entry sync to avoid FK violation`);
        return 0;
      }
    }

    // ClickUp's /team/{team}/time_entries returns only the token owner's entries
    // unless `assignee` is supplied. When the caller does not know who logged
    // the time (backfills, manual reconciles), fall back to all workspace
    // members so we capture every user's tracked time on the task, including
    // time logged on tasks that have no assignees.
    const ids = assigneeIds && assigneeIds.length > 0 ? assigneeIds : await this.members.getMemberIds();
    const entries = await this.clickup.getTimeEntries(teamId, taskId, { assigneeIds: ids, startDate, endDate });
    let count = 0;
    const upserted: { normalized: NormalizedTimeEntry; rawTags: string[] }[] = [];
    for (const entry of entries) {
      const normalized = this.normalizer.normalizeTimeEntry(entry);
      const rawTags = extractEntryTagNames(entry);
      upserted.push({ normalized, rawTags });
      const cost = await this.costs.calculate(normalized.userId, normalized.startTime, normalized.durationHours);
      await this.repo.upsert(normalized, cost);
      if (cost.status === 'NO_RATE_FOUND') this.logger.warn(`Missing rate for user ${normalized.userId} on time entry ${normalized.timeEntryId}`);
      count += 1;
    }

    // Tag-based assignee replacement. Triggered by the *time entry's own tags*
    // (e.g. an interval tagged "ahmad"), regardless of who logged it — that's
    // the convention ClickUp surfaces in the data and what the n8n workflow
    // relied on. The previous `userId === CLICKUP_AGENCY_USER_ID` gate matched
    // the wrong dimension and never fired on real data.
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
          this.queues.defaultJobOptions(),
        );
      }
    }

    return count;
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

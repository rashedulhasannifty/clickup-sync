import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { ClickupNormalizer, NormalizedTimeEntry } from '../clickup/clickup-normalizer';
import { WorkspaceMembersService } from '../clickup/workspace-members.service';
import { TimeEntriesRepository } from './time-entries.repository';
import { CostCalculatorService } from './cost-calculator.service';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { ReplacementJobData } from './assignee-replacement.service';

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
  ) {}

  async syncTaskTimeEntries(taskId: string, assigneeIds?: string[], startDate?: number, endDate?: number) {
    const teamId = process.env.CLICKUP_TEAM_ID || '3450636';
    // ClickUp's /team/{team}/time_entries returns only the token owner's entries
    // unless `assignee` is supplied. When the caller does not know who logged
    // the time (backfills, manual reconciles), fall back to all workspace
    // members so we capture every user's tracked time on the task, including
    // time logged on tasks that have no assignees.
    const ids = assigneeIds && assigneeIds.length > 0 ? assigneeIds : await this.members.getMemberIds();
    const entries = await this.clickup.getTimeEntries(teamId, taskId, { assigneeIds: ids, startDate, endDate });
    let count = 0;
    const normalizedEntries: NormalizedTimeEntry[] = [];
    for (const entry of entries) {
      const normalized = this.normalizer.normalizeTimeEntry(entry);
      normalizedEntries.push(normalized);
      const cost = await this.costs.calculate(normalized.userId, normalized.startTime, normalized.durationHours);
      await this.repo.upsert(normalized, cost);
      if (cost.status === 'NO_RATE_FOUND') this.logger.warn(`Missing rate for user ${normalized.userId} on time entry ${normalized.timeEntryId}`);
      count += 1;
    }

    const agencyUserId = process.env.CLICKUP_AGENCY_USER_ID;
    if (agencyUserId) {
      for (const normalized of normalizedEntries) {
        if (normalized.userId === agencyUserId) {
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
            } satisfies ReplacementJobData,
            this.queues.defaultJobOptions(),
          );
        }
      }
    }

    return count;
  }
}

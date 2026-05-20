import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { TasksService } from '../tasks/tasks.service';
import { SyncCheckpointsRepository } from './sync-checkpoints.repository';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { subtractDays } from '../common/utils/date-utils';

@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);
  constructor(
    private readonly clickup: ClickupClient,
    private readonly tasks: TasksService,
    private readonly checkpoints: SyncCheckpointsRepository,
    private readonly queues: QueueService,
  ) {}

  async backfillSpace(spaceId: string, lookbackDays?: number) {
    const space = CLICKUP_SPACES.find((s) => s.id === spaceId);
    const days = lookbackDays ?? space?.backfillLookbackDays ?? 7;
    const teamId = process.env.CLICKUP_TEAM_ID || '3450636';
    await this.checkpoints.markAttempt('clickup', 'space', spaceId);

    const rawTasks = await this.clickup.getAllTasksBySpace(spaceId, {
      teamId,
      dateUpdatedGt: subtractDays(days).getTime(),
      includeClosed: true,
      subtasks: true,
    });

    const parentTasks = rawTasks.filter((t) => !t.parent);
    const subtasks = rawTasks.filter((t) => !!t.parent);
    await this.tasks.syncTasks(parentTasks);
    await this.tasks.syncTasks(subtasks);

    // The team-level tasks endpoint omits space.name — patch it from config
    if (space?.name) {
      await this.tasks.patchSpaceNames(spaceId, space.name);
    }

    // Enqueue time entry sync for every task that was backfilled.
    // Use the space's full lookback for the time-entry window — time entries are filtered by
    // their start time, so a short task-sync window (e.g. 1-day reconciliation) would miss
    // entries logged earlier in the week.  The upsert is idempotent so re-scanning is safe.
    const endDate = Date.now();
    const teLookbackDays = space?.backfillLookbackDays ?? days;
    const teStartDate = subtractDays(teLookbackDays).getTime();
    const queue = this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES);
    const jobOpts = this.queues.defaultJobOptions();
    for (const task of rawTasks) {
      const taskId = (task as { id?: string }).id;
      if (taskId) {
        // The time-entry worker resolves all-workspace-members as the
        // `assignee` filter when no specific assignee is provided, which
        // captures tracked time on tasks regardless of who logged it.
        await queue.add(JOBS.SYNC_TASK_TIME_ENTRIES, { taskId, startDate: teStartDate, endDate }, jobOpts);
      }
    }

    await this.checkpoints.markSuccess('clickup', 'space', spaceId);
    this.logger.log(`Backfilled ${rawTasks.length} tasks + enqueued ${rawTasks.length} time-entry jobs for ${space?.name || spaceId}`);
    return { total: rawTasks.length, parents: parentTasks.length, subtasks: subtasks.length };
  }
}

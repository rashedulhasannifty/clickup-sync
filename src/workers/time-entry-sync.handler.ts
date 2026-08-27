import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOBS } from '../queues/queue.constants';
import { TimeEntriesService } from '../time-entries/time-entries.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';

export interface TimeEntryJobData {
  taskId?: string;
  assigneeIds?: string[];
  startDate?: number;
  endDate?: number;
  spaceId?: string;
  pruneMode?: 'delete' | 'report';
}

/**
 * The actual work behind a time-entry job, shared by the LIVE and BULK
 * processors.
 *
 * The two processors exist only to bind different queues to different rate
 * limiters (see QUEUES.CLICKUP_TIME_ENTRIES_BULK). Their behaviour must stay
 * identical — a job must do the same thing whichever queue carried it — so the
 * logic lives here rather than being duplicated, where it would drift.
 *
 * Deliberately NOT a `@Processor`: this class binds to no queue. It follows the
 * same pattern as ListCatalogProcessor (see its header for why a second
 * `@Processor` on one queue creates a competing consumer).
 */
@Injectable()
export class TimeEntrySyncHandler {
  constructor(
    private readonly timeEntries: TimeEntriesService,
    private readonly jobLogs: JobLogsRepository,
  ) {}

  async handle(job: Job<TimeEntryJobData>, queueName: string) {
    if (job.name === JOBS.RECONCILE_TIME_ENTRIES_WINDOW) {
      const log = await this.jobLogs.started({
        jobId: job.id?.toString(), queueName, jobName: job.name,
        entityType: 'space', entityId: job.data.spaceId,
      });
      try {
        const result = await this.timeEntries.reconcileWindow(job.data.spaceId!, job.data.startDate!, job.data.endDate!);
        await this.jobLogs.finished(log.id, { timeEntriesSynced: result });
        return result;
      } catch (e) {
        await this.jobLogs.failed(log.id, e);
        throw e;
      }
    }

    const log = await this.jobLogs.started({
      jobId: job.id?.toString(), queueName, jobName: job.name,
      entityType: 'task', entityId: job.data.taskId,
    });
    try {
      // pruneMode defaults to 'delete' — only the rolling verification sweep
      // opts into 'report' while it is being observed against real data.
      const result = await this.timeEntries.syncTaskTimeEntries(
        job.data.taskId!,
        job.data.assigneeIds,
        job.data.startDate,
        job.data.endDate,
        job.data.pruneMode ?? 'delete',
      );
      await this.jobLogs.finished(log.id, { timeEntriesSynced: result });
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}

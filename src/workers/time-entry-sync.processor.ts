import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOBS, QUEUES, clickupWorkerOptions } from '../queues/queue.constants';
import { TimeEntriesService } from '../time-entries/time-entries.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { DeadLetterService } from '../jobs/dead-letter.service';

@Injectable()
@Processor(QUEUES.CLICKUP_TIME_ENTRIES, clickupWorkerOptions())
export class TimeEntrySyncProcessor extends WorkerHost {
  constructor(
    private readonly timeEntries: TimeEntriesService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
  ) { super(); }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(
    job: Job<{
      taskId?: string;
      assigneeIds?: string[];
      startDate?: number;
      endDate?: number;
      spaceId?: string;
      pruneMode?: 'delete' | 'report';
    }>,
  ) {
    if (job.name === JOBS.RECONCILE_TIME_ENTRIES_WINDOW) {
      const log = await this.jobLogs.started({ jobId: job.id?.toString(), queueName: QUEUES.CLICKUP_TIME_ENTRIES, jobName: job.name, entityType: 'space', entityId: job.data.spaceId });
      try {
        const result = await this.timeEntries.reconcileWindow(job.data.spaceId!, job.data.startDate!, job.data.endDate!);
        await this.jobLogs.finished(log.id, { timeEntriesSynced: result });
        return result;
      } catch (e) {
        await this.jobLogs.failed(log.id, e);
        throw e;
      }
    }

    const log = await this.jobLogs.started({ jobId: job.id?.toString(), queueName: QUEUES.CLICKUP_TIME_ENTRIES, jobName: job.name, entityType: 'task', entityId: job.data.taskId });
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

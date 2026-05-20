import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { TimeEntriesService } from '../time-entries/time-entries.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';

@Injectable()
@Processor(QUEUES.CLICKUP_TIME_ENTRIES)
export class TimeEntrySyncProcessor extends WorkerHost {
  constructor(private readonly timeEntries: TimeEntriesService, private readonly jobLogs: JobLogsRepository) { super(); }
  async process(job: Job<{ taskId: string; assigneeIds?: string[]; startDate?: number; endDate?: number }>) {
    const log = await this.jobLogs.started({ jobId: job.id?.toString(), queueName: QUEUES.CLICKUP_TIME_ENTRIES, jobName: job.name, entityType: 'task', entityId: job.data.taskId });
    try {
      const result = await this.timeEntries.syncTaskTimeEntries(job.data.taskId, job.data.assigneeIds, job.data.startDate, job.data.endDate);
      await this.jobLogs.finished(log.id, { timeEntriesSynced: result });
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}

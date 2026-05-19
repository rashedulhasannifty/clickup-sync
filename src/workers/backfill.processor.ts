import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { BackfillService } from '../sync/backfill.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';

@Injectable()
@Processor(QUEUES.CLICKUP_BACKFILLS)
export class BackfillProcessor extends WorkerHost {
  constructor(private readonly backfills: BackfillService, private readonly jobLogs: JobLogsRepository) { super(); }
  async process(job: Job<{ spaceId: string; lookbackDays?: number }>) {
    const log = await this.jobLogs.started({ jobId: job.id?.toString(), queueName: QUEUES.CLICKUP_BACKFILLS, jobName: job.name, entityType: 'space', entityId: job.data.spaceId });
    try {
      const result = await this.backfills.backfillSpace(job.data.spaceId, job.data.lookbackDays);
      await this.jobLogs.finished(log.id);
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}

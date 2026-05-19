import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { CostRecalculationService } from '../time-entries/cost-recalculation.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';

@Injectable()
@Processor(QUEUES.MAINTENANCE)
export class CostRecalcProcessor extends WorkerHost {
  constructor(
    private readonly recalc: CostRecalculationService,
    private readonly jobLogs: JobLogsRepository,
  ) {
    super();
  }

  async process(job: Job<{ assigneeId?: string }>) {
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.MAINTENANCE,
      jobName: job.name,
      entityType: 'assignee',
      entityId: job.data.assigneeId ?? '*',
    });
    try {
      const res = await this.recalc.recalculate({ assigneeId: job.data.assigneeId });
      await this.jobLogs.finished(log.id, { timeEntriesSynced: res.updated });
      return res;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}

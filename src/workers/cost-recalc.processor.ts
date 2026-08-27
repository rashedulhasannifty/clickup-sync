import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { CostRecalculationService } from '../time-entries/cost-recalculation.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { DeadLetterService } from '../jobs/dead-letter.service';

@Injectable()
@Processor(QUEUES.MAINTENANCE)
export class CostRecalcProcessor extends WorkerHost {
  constructor(
    private readonly recalc: CostRecalculationService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<{ assigneeId?: string; taskIds?: string[] }>) {
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.MAINTENANCE,
      jobName: job.name,
      // A chargeability toggle scopes by task, a rate change by assignee.
      entityType: job.data.taskIds?.length ? 'task' : 'assignee',
      entityId: job.data.taskIds?.length ? job.data.taskIds.join(',') : (job.data.assigneeId ?? '*'),
    });
    try {
      const res = await this.recalc.recalculate({ assigneeId: job.data.assigneeId, taskIds: job.data.taskIds });
      await this.jobLogs.finished(log.id, { timeEntriesSynced: res.updated });
      return res;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}

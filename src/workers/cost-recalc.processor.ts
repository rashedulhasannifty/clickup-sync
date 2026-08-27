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
    const taskIds = job.data.taskIds;
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.MAINTENANCE,
      jobName: job.name,
      // A chargeability toggle scopes by task, a rate change by assignee.
      entityType: taskIds?.length ? 'task' : 'assignee',
      // Only ever ONE id here. `entity_id` is indexed by
      // `idx_sync_job_logs_entity(entity_type, entity_id)` and a btree index
      // tuple caps out around 2704 bytes, so joining the whole list made this
      // insert throw for large batches — outside the try below, so the job
      // failed and dead-lettered after the PATCH had already committed the
      // flags and reported success. The first id also keeps the row joinable
      // by `TaskHistoryRepository.forTask`, which reads `entityType: 'task'`
      // rows as a single task id. The full list lives in `payload`.
      entityId: taskIds?.length ? taskIds[0] : (job.data.assigneeId ?? '*'),
      ...(taskIds?.length ? { payload: { taskIds } } : {}),
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

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES, clickupWorkerOptions } from '../queues/queue.constants';
import { BackfillService } from '../sync/backfill.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { DeadLetterService } from '../jobs/dead-letter.service';

@Injectable()
@Processor(QUEUES.CLICKUP_BACKFILLS, clickupWorkerOptions())
export class BackfillProcessor extends WorkerHost {
  constructor(
    private readonly backfills: BackfillService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
  ) { super(); }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<{ spaceId: string; lookbackDays?: number; timeEntryLookbackDays?: number }>) {
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.CLICKUP_BACKFILLS,
      jobName: job.name,
      entityType: 'space',
      entityId: job.data.spaceId,
      // Recorded so /reports/ops/sync-health can roll up the longest backfill
      // window per space for the Spaces page "up to Nd" badge.
      payload: job.data.lookbackDays != null ? { lookbackDays: job.data.lookbackDays } : undefined,
    });
    try {
      const result = await this.backfills.backfillSpace(job.data.spaceId, job.data.lookbackDays, job.data.timeEntryLookbackDays);
      // `tasksSynced` is used by /admin/backfill/active to compute progress bar
      // totals for the time-entry drain phase that follows. Without it the
      // dashboard can only show "X remaining" instead of "X / N done".
      await this.jobLogs.finished(log.id, { tasksSynced: result.total });
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}

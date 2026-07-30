import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JOBS, QUEUES, clickupWorkerOptions } from '../queues/queue.constants';
import { BackfillService } from '../sync/backfill.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { DeadLetterService } from '../jobs/dead-letter.service';
import { ListCatalogProcessor } from './list-catalog.processor';

type BackfillJobData = { spaceId: string; lookbackDays?: number; timeEntryLookbackDays?: number; includeArchived?: boolean };

@Injectable()
@Processor(QUEUES.CLICKUP_BACKFILLS, clickupWorkerOptions())
export class BackfillProcessor extends WorkerHost {
  constructor(
    private readonly backfills: BackfillService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
    // Handles JOBS.SYNC_LIST_CATALOG, which shares this queue (see
    // list-catalog.processor.ts for why that job is routed here by name
    // instead of via a second @Processor on CLICKUP_BACKFILLS).
    private readonly listCatalog: ListCatalogProcessor,
  ) { super(); }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<BackfillJobData>) {
    if (job.name === JOBS.SYNC_LIST_CATALOG) {
      return this.processListCatalogSync(job as Job<{ spaceId: string }>);
    }
    return this.processBackfill(job);
  }

  private async processBackfill(job: Job<BackfillJobData>) {
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
      const result = await this.backfills.backfillSpace(job.data.spaceId, job.data.lookbackDays, job.data.timeEntryLookbackDays, job.data.includeArchived);
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

  private async processListCatalogSync(job: Job<{ spaceId: string }>) {
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.CLICKUP_BACKFILLS,
      jobName: job.name,
      entityType: 'space',
      entityId: job.data.spaceId,
    });
    try {
      const result = await this.listCatalog.process(job);
      // No `tasksSynced` count here: that field feeds /admin/backfill/active's
      // task-count progress-bar denominator (it takes the largest tasksSynced
      // per space in-window). Writing the list count into it would corrupt
      // that denominator, so this log row is left without counts.
      await this.jobLogs.finished(log.id);
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}

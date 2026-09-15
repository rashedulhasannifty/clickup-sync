import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { DeadLetterService } from '../jobs/dead-letter.service';
import { XeroSyncService, type XeroSyncResult } from '../xero/xero-sync.service';
import { XeroTokenService } from '../xero/xero-token.service';
import { XeroReconnectRequiredError } from '../xero/xero-errors';
import type { XeroSyncJobData } from '../xero/xero-auth.service';

/**
 * Sole consumer of the xero-sync queue (one @Processor per queue; route by job
 * name). Concurrency 1: Xero allows 5 concurrent calls and 60/min per tenant, and
 * XeroClient's pacing only works when a single run is calling at a time.
 */
@Injectable()
@Processor(QUEUES.XERO_SYNC, { concurrency: 1 })
export class XeroSyncProcessor extends WorkerHost {
  constructor(
    private readonly sync: XeroSyncService,
    private readonly tokens: XeroTokenService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<XeroSyncJobData>) {
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.XERO_SYNC,
      jobName: job.name,
      entityType: 'xero',
      entityId: 'all',
      payload: job.data?.full ? { full: true } : undefined,
    });
    try {
      const result = await this.route(job);
      const stopped = (result as XeroSyncResult | undefined)?.stopped;
      if (stopped) await this.jobLogs.finished(log.id, {}, 'partial', `Xero run stopped early: ${stopped}`);
      else await this.jobLogs.finished(log.id);
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }

  private async route(job: Job<XeroSyncJobData>) {
    switch (job.name) {
      case JOBS.XERO_SYNC:
        return this.sync.runSync({ full: !!job.data?.full });
      case JOBS.XERO_RECONCILE_OPEN:
        return this.sync.reconcileOpen();
      case JOBS.XERO_TOKEN_KEEPALIVE:
        try {
          await this.tokens.getAccessToken({ force: true });
          return { keepalive: 'ok' };
        } catch (e) {
          // Already marked NEEDS_RECONNECT; retrying can't help.
          if (e instanceof XeroReconnectRequiredError) return { keepalive: 'needs_reconnect' };
          throw e;
        }
      default:
        throw new UnrecoverableError(`Unknown Xero job: ${job.name}`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { XeroConnectionRepository } from './xero-connection.repository';
import type { XeroSyncJobData } from './xero-auth.service';

/** Team-local time, like src/sync/sync.scheduler.ts. Containers run UTC. */
const DHAKA = 'Asia/Dhaka';

/**
 * Crons only enqueue. They fire only in the worker role, because ScheduleModule
 * loads there alone, so blue/green web instances never double-fire.
 */
@Injectable()
export class XeroScheduler {
  private readonly logger = new Logger(XeroScheduler.name);

  constructor(
    private readonly queues: QueueService,
    private readonly repo: XeroConnectionRepository,
  ) {}

  /** Minute 17 keeps it clear of the top-of-hour ClickUp jobs. Incremental and cheap. */
  @Cron('0 17 * * * *', { name: 'xero-sync-hourly', timeZone: DHAKA })
  hourlySync() {
    return this.enqueue(JOBS.XERO_SYNC, { entity: 'all' });
  }

  /** Inside the 00:00–09:00 closed-office window (office-hours-sync-schedule). */
  @Cron('0 0 2 * * *', { name: 'xero-reconcile-open', timeZone: DHAKA })
  nightlyReconcile() {
    return this.enqueue(JOBS.XERO_RECONCILE_OPEN, { entity: 'all' });
  }

  /** A refresh token expires after 60 days unused; this keeps it alive even if syncing stops. */
  @Cron('0 0 4 * * *', { name: 'xero-token-keepalive', timeZone: DHAKA })
  keepalive() {
    return this.enqueue(JOBS.XERO_TOKEN_KEEPALIVE, { entity: 'all' });
  }

  async enqueue(name: string, data: XeroSyncJobData): Promise<boolean> {
    const row = await this.repo.get();
    if (row?.status !== 'CONNECTED') return false;
    const queue = this.queues.get(QUEUES.XERO_SYNC);
    // Name-filtered busy check (see sync.scheduler.ts): jobId dedup can't work for crons.
    const live = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    if (live.some((j) => j?.name === name)) {
      this.logger.warn(`Skipping ${name}: the previous one is still in flight`);
      return false;
    }
    await queue.add(name, data, this.queues.defaultJobOptions());
    return true;
  }
}

import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

@Injectable()
export class SyncScheduler {
  constructor(private readonly queues: QueueService) {}

  // Recurring reconciliation: hourly, syncs tasks updated in the last day and
  // scans a bounded 7-day time-entry window (rather than re-draining the full
  // per-space window each run) — enough to recover time entries whose webhook
  // was missed within the last week. Manual backfills still use the full window.
  @Cron('0 0 * * * *')
  async reconcileRecentUpdates() {
    for (const space of CLICKUP_SPACES) {
      await this.queues.get(QUEUES.CLICKUP_BACKFILLS).add(
        JOBS.BACKFILL_CLICKUP_SPACE,
        { spaceId: space.id, lookbackDays: 1, timeEntryLookbackDays: 7 },
        this.queues.defaultJobOptions(),
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);
  constructor(private readonly queues: QueueService) {}

  // Recurring reconciliation: hourly, syncs tasks updated in the last day and
  // scans a bounded 7-day time-entry window (rather than re-draining the full
  // per-space window each run) — enough to recover time entries whose webhook
  // was missed within the last week. Manual backfills still use the full window.
  @Cron('0 0 * * * *')
  async reconcileRecentUpdates() {
    const queue = this.queues.get(QUEUES.CLICKUP_BACKFILLS);
    // Skip a space whose previous backfill hasn't drained yet — under ClickUp
    // slowness an hourly run that outpaces the drain would otherwise stack
    // duplicate per-space backfills (and their per-task time-entry fan-out).
    // jobId dedup can't help here: cron never re-adds an identical id, and a
    // stable id would be blocked forever by the kept completed job.
    const live = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    const busy = new Set(
      live
        .map((j) => (j.data as { spaceId?: string } | undefined)?.spaceId)
        .filter((v): v is string => typeof v === 'string'),
    );
    for (const space of CLICKUP_SPACES) {
      if (busy.has(space.id)) {
        this.logger.warn(`Skipping recurring reconcile for space ${space.id}: a backfill is still in flight`);
        continue;
      }
      await queue.add(
        JOBS.BACKFILL_CLICKUP_SPACE,
        { spaceId: space.id, lookbackDays: 1, timeEntryLookbackDays: 7 },
        this.queues.defaultJobOptions(),
      );
    }
  }
}

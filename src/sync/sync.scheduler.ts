import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);
  constructor(
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
  ) {}

  // Recurring reconciliation: every 12 hours, syncs tasks updated in the last
  // day and scans a bounded 7-day time-entry window (rather than re-draining the
  // full per-space window each run) — enough to recover time entries whose
  // webhook was missed within the last week. Manual backfills use the full
  // window. This is only a safety net for webhooks ClickUp never delivered;
  // real-time updates still arrive via webhooks.
  @Cron('0 0 */12 * * *')
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
      if (!this.settings.isSpaceEnabled(space.id)) {
        this.logger.log(`Skipping recurring reconcile for space ${space.id}: disabled in settings`);
        continue;
      }
      await queue.add(
        JOBS.BACKFILL_CLICKUP_SPACE,
        // includeArchived: false — the archived pass is an expensive per-list
        // scan (ClickUp's team endpoint can't paginate archived tasks). Running
        // it on every 12h reconcile across all spaces would add minutes of
        // sequential API calls and risk rate-limiting the webhook/time-entry
        // queues. Archiving fires no webhook anyway, so archived status can't be
        // real-time; it's refreshed on manual space backfills instead.
        { spaceId: space.id, lookbackDays: 1, timeEntryLookbackDays: 7, includeArchived: false },
        this.queues.defaultJobOptions(),
      );
    }
  }
}

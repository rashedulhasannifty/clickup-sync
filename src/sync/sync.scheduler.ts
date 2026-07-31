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
    // The CLICKUP_BACKFILLS queue is now shared with SYNC_LIST_CATALOG jobs
    // (Task 5), so filter by job name — otherwise a pending/retrying catalog
    // job would make its space look "busy" and silently skip this reconcile.
    const live = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    const busy = new Set(
      live
        .filter((j) => j.name === JOBS.BACKFILL_CLICKUP_SPACE)
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

  // Daily refresh of the list/folder catalog per space. Backfills already
  // trigger this opportunistically (see BackfillService.backfillSpace), but a
  // space can go a while between backfills/reconciles for lists that changed
  // out-of-band (renamed, moved to a different folder, archived) without any
  // task in that list being touched — this cron is the backstop.
  @Cron('0 0 3 * * *')
  async syncListCatalogs() {
    const queue = this.queues.get(QUEUES.CLICKUP_BACKFILLS);
    for (const space of CLICKUP_SPACES) {
      if (!this.settings.isSpaceEnabled(space.id)) {
        this.logger.log(`Skipping list-catalog sync for space ${space.id}: disabled in settings`);
        continue;
      }
      await queue.add(JOBS.SYNC_LIST_CATALOG, { spaceId: space.id }, this.queues.defaultJobOptions());
    }
  }

  // Staggered archived reconcile. The 12h reconcile deliberately skips the
  // archived per-list scan (too heavy across all spaces every run) and archiving
  // fires no webhook — so a task inside a just-completed (archived) sprint whose
  // final state changed after its list was archived never re-syncs until a
  // manual backfill. This runs the archived pass for exactly ONE enabled space
  // per day in rotation, so each space is refreshed over a cycle of a few days
  // with bounded per-run load on the small (1.9GB) host. (The daily list-catalog
  // cron already keeps list-level archived state fresh; this closes the
  // task-level content gap.)
  @Cron('0 0 4 * * *')
  async reconcileArchived() {
    const enabled = CLICKUP_SPACES.filter((s) => this.settings.isSpaceEnabled(s.id));
    if (!enabled.length) return;
    const space = enabled[this.rotationIndex(new Date(), enabled.length)];
    const queue = this.queues.get(QUEUES.CLICKUP_BACKFILLS);
    // Same overlap guard as reconcileRecentUpdates: only real backfills count as
    // "busy" (the shared queue also carries SYNC_LIST_CATALOG jobs).
    const live = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    const busy = live.some(
      (j) => j.name === JOBS.BACKFILL_CLICKUP_SPACE && (j.data as { spaceId?: string } | undefined)?.spaceId === space.id,
    );
    if (busy) {
      this.logger.warn(`Skipping archived reconcile for space ${space.id}: a backfill is still in flight`);
      return;
    }
    await queue.add(
      JOBS.BACKFILL_CLICKUP_SPACE,
      // includeArchived:true triggers the per-list archived scan. The lookback
      // (from the space's config, default 30) bounds the active pass;
      // timeEntryLookbackDays 7 bounds the time-entry fan-out this enqueues onto
      // the (throughput-bottlenecked) clickup-time-entries queue. Those backfill
      // time-entry jobs are already deprioritized so they never block live
      // webhooks; the one-space-per-day rotation gives them room to drain.
      { spaceId: space.id, lookbackDays: space.backfillLookbackDays ?? 30, timeEntryLookbackDays: 7, includeArchived: true },
      this.queues.defaultJobOptions(),
    );
    this.logger.log(`Archived reconcile enqueued for space ${space.id} (daily rotation)`);
  }

  /**
   * Deterministic day-based rotation: returns an index in [0, count) that
   * advances by one each calendar day (UTC) and wraps, so consecutive daily
   * runs cycle through all enabled spaces. Pure for testability.
   */
  rotationIndex(date: Date, count: number): number {
    if (count <= 0) return 0;
    const dayNumber = Math.floor(date.getTime() / 86_400_000);
    return ((dayNumber % count) + count) % count;
  }
}

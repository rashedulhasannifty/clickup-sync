import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { BACKFILL_TIME_ENTRY_PRIORITY, JOBS, QUEUES } from '../queues/queue.constants';
import { sliceReconcileWindow } from './reconcile-window.util';
import { subtractDays } from '../common/utils/date-utils';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { SettingsService } from '../settings/settings.service';
import { TimeEntriesRepository } from '../time-entries/time-entries.repository';

/** The team works Asia/Dhaka hours; crons that mean "2am" mean 2am there. */
const DHAKA = 'Asia/Dhaka';

@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);
  constructor(
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
    private readonly timeEntriesRepo: TimeEntriesRepository,
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
   * Deep time-entry BACKFILL — upsert-only. Recovers entries we never synced
   * and repairs edits, but it CANNOT detect a deletion: its delete-prune was
   * disabled after destroying live data (see WINDOW_PRUNE_ENABLED in
   * TimeEntriesService). Deletion detection lives in the per-task crons below.
   *
   * Both recurring sweeps above pass `timeEntryLookbackDays: 7`, and
   * `syncTaskTimeEntries` scopes its ClickUp fetch AND its delete-prune to that
   * same window. So once an entry's `start_time` passes 7 days it is never
   * re-read and never pruned: it freezes at whatever ClickUp last said. The
   * task row keeps refreshing (`time_spent` is re-fetched every backfill), so
   * the Tasks page and the Time Entries page silently drift apart. Observed on
   * prod: two AIT tasks over-reporting by 0.75h and 1.00h, each stale row's
   * `synced_at` pinned to the last daily run within 7 days of its `start_time`.
   *
   * ClickUp emits no "time entry deleted" event at all, and its
   * `taskTimeTrackedUpdated` frequently does not fire for manual edits, so
   * webhooks cannot be relied on to close this gap either.
   *
   * Cost control: this uses the windowed reconcile (one team-level call per
   * space × 30-day slice) rather than the per-task fan-out, runs ONE space per
   * day in the same rotation as `reconcileArchived`, and enqueues at
   * `BACKFILL_TIME_ENTRY_PRIORITY` so it can never head-of-line-block a live
   * webhook. At the 365-day default that is ~13 low-priority jobs per day.
   *
   * 02:00 UTC keeps it clear of the 03:00 list-catalog and 04:00 archived crons.
   */
  @Cron('0 0 2 * * *')
  async deepBackfillTimeEntries() {
    const enabled = CLICKUP_SPACES.filter((s) => this.settings.isSpaceEnabled(s.id));
    if (!enabled.length) return;
    // Offset by 1 so this never targets the same space as `reconcileArchived`
    // on the same day — that cron's per-list archived scan is the heaviest job
    // the worker runs, and stacking a 13-slice reconcile on top of it would
    // concentrate two days' work onto one space on a 1.9 GB host.
    const space = enabled[this.rotationIndex(new Date(), enabled.length, 1)];

    const queue = this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES);
    // Skip while a previous deep reconcile is still draining. These jobs are
    // deprioritized, so on a slow ClickUp day they can outlive a 24h gap; without
    // this guard each run would stack another full year of slices on top.
    const live = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    if (live.some((j) => j.name === JOBS.RECONCILE_TIME_ENTRIES_WINDOW)) {
      this.logger.warn('Skipping deep time-entry reconcile: a previous windowed reconcile is still in flight');
      return;
    }

    const lookbackDays = this.settings.getReconcileLookbackDays();
    const slices = sliceReconcileWindow(subtractDays(lookbackDays).getTime(), Date.now());
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BACKFILL_TIME_ENTRY_PRIORITY };

    for (const slice of slices) {
      await queue.add(JOBS.RECONCILE_TIME_ENTRIES_WINDOW, { spaceId: space.id, ...slice }, jobOpts);
    }
    this.logger.log(
      `Deep time-entry reconcile enqueued for space ${space.id}: ${slices.length} slice(s) over ${lookbackDays}d (daily rotation)`,
    );
  }

  /**
   * Deletion reconcile — the ONLY mechanism that notices a time entry deleted in
   * ClickUp, which emits no event for it.
   *
   * Runs the PER-TASK sync (`task_id`-scoped), whose prune is sound: a task_id
   * fetch returns that task's complete set, so anything we hold and ClickUp did
   * not return really is gone. The cheap space_id-scoped windowed path cannot be
   * used here — its response is incomplete and pruning off it deleted 429 live
   * entries on 2026-08-25.
   *
   * The candidate list is "tasks we hold entries for in the window", NOT tasks
   * ClickUp returns. A task whose entries were all deleted upstream would be
   * absent from any ClickUp-driven list, yet it is precisely the one to check.
   *
   * Cost is small because recent windows touch few tasks: ~186 tasks over 7 days
   * and ~650 over 30, versus 50k+ for a blanket sweep. At the 30 jobs/min
   * ClickUp limiter that is roughly 6 and 22 minutes.
   *
   * Schedule (Asia/Dhaka, so it really is 02:00 local — the containers run UTC,
   * where 02:00 Dhaka is 20:00 the PREVIOUS day; letting the cron library do the
   * conversion avoids hand-shifting both the hour and the weekday):
   *   Mon-Thu 02:00 → 7 days
   *   Fri     02:00 → 30 days
   *
   * 30 days is the deep pass because the team's working rule is that entries
   * older than 30 days are never edited or deleted. If that rule slips, an older
   * deletion goes unnoticed — widen the Friday window rather than adding a
   * nightly cost.
   */
  @Cron('0 0 2 * * 1-4', { name: 'reconcile-deletions-7d', timeZone: DHAKA })
  async reconcileDeletions7d() {
    await this.enqueueDeletionReconcile(7);
  }

  @Cron('0 0 2 * * 5', { name: 'reconcile-deletions-30d', timeZone: DHAKA })
  async reconcileDeletions30d() {
    await this.enqueueDeletionReconcile(30);
  }

  /**
   * Enqueues one per-task time-entry sync for every task holding an entry in the
   * last `lookbackDays`. Shared by both deletion-reconcile crons.
   */
  private async enqueueDeletionReconcile(lookbackDays: number): Promise<void> {
    const queue = this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES);
    const endDate = Date.now();
    const startDate = subtractDays(lookbackDays).getTime();

    const taskIds = await this.timeEntriesRepo.findTaskIdsWithEntriesInWindow(startDate, endDate);
    if (!taskIds.length) {
      this.logger.log(`Deletion reconcile (${lookbackDays}d): no tasks hold entries in the window — nothing to check`);
      return;
    }

    // Deprioritized so a long sweep can never head-of-line-block a live webhook.
    // The window is passed explicitly: syncTaskTimeEntries scopes BOTH its
    // ClickUp fetch and its prune to it, so a row outside the window is never at
    // risk from this run.
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BACKFILL_TIME_ENTRY_PRIORITY };
    for (const taskId of taskIds) {
      await queue.add(JOBS.SYNC_TASK_TIME_ENTRIES, { taskId, startDate, endDate }, jobOpts);
    }
    this.logger.log(
      `Deletion reconcile (${lookbackDays}d): enqueued ${taskIds.length} per-task sync(s) to detect entries deleted in ClickUp`,
    );
  }

  /**
   * Deterministic day-based rotation: returns an index in [0, count) that
   * advances by one each calendar day (UTC) and wraps, so consecutive daily
   * runs cycle through all enabled spaces. Pure for testability.
   *
   * `offset` staggers one rotation against another so two daily crons don't
   * land on the same space on the same day — see `deepReconcileTimeEntries`.
   * Defaults to 0, leaving every pre-existing caller's sequence unchanged.
   */
  rotationIndex(date: Date, count: number, offset = 0): number {
    if (count <= 0) return 0;
    const dayNumber = Math.floor(date.getTime() / 86_400_000) + offset;
    return ((dayNumber % count) + count) % count;
  }
}

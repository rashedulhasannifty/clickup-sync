import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { BULK_SWEEP_PRIORITY, JOBS, QUEUES } from '../queues/queue.constants';
import { sliceReconcileWindow } from './reconcile-window.util';
import { subtractDays } from '../common/utils/date-utils';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { SettingsService } from '../settings/settings.service';
import { TimeEntriesRepository } from '../time-entries/time-entries.repository';

/**
 * Every cron in this file is expressed in the team's local time.
 *
 * The containers run UTC, where Dhaka's 02:00 is 20:00 the PREVIOUS day — so a
 * schedule hand-shifted into UTC has to shift the hour AND the weekday, which is
 * exactly the kind of arithmetic that silently drifts. Letting the cron library
 * do the conversion means the expression reads the way the team thinks about it.
 *
 * This matters operationally, not just cosmetically: the office works
 * Mon-Fri 09:00-23:59 local, so 00:00-09:00 (and all of Sat/Sun) is the only
 * window where a heavy sweep cannot compete with live webhook traffic for
 * ClickUp's rate limit. Before this was applied uniformly, the two heaviest
 * jobs — the deep backfill (02:00 UTC) and the archived per-list scan
 * (04:00 UTC) — were actually firing at 08:00 and 10:00 Dhaka, i.e. right as
 * the office opened.
 */
const DHAKA = 'Asia/Dhaka';

/**
 * Oldest age at which a time entry may still be edited or deleted in ClickUp.
 *
 * This is a *team working rule*, not something ClickUp enforces: nobody touches
 * an entry more than 30 days old. Every deletion-detection guarantee below is
 * derived from it, so if the rule changes this constant must change with it.
 */
export const EDIT_HORIZON_DAYS = 30;

/**
 * Worst-case whole days that can pass between two consecutive deletion-reconcile
 * runs, used to size the window below. The cron is daily, so the nominal gap is
 * 1 — but a run can be lost to a deploy that restarts the worker across the
 * cron minute, to the worker being down for a night, or to a run that fails
 * outright. Three days is a deliberately pessimistic allowance for a stacked
 * run of those.
 *
 * Do NOT lower this to 1 "because the cron is daily". The nominal gap is not
 * the worst case, and the failure it protects against is invisible: a deletion
 * missed once is missed permanently, because the entry ages out of every
 * subsequent window.
 */
export const DELETION_RECONCILE_MAX_GAP_DAYS = 3;

/**
 * Lookback for the deletion reconcile, in days.
 *
 * INVARIANT: this must exceed `EDIT_HORIZON_DAYS + DELETION_RECONCILE_MAX_GAP_DAYS`.
 *
 * Why: an entry is only a candidate while its `start_time` is inside the window,
 * so the last run that can ever examine it is the last one before it ages out.
 * A deletion happening after that run is never detected — not late, never. The
 * previous schedule (7-day window Mon-Thu, 30-day window Fri) violated this: the
 * 30-day window ran on a 7-day period, so an entry's final examination could
 * fall as early as day 24, and anything deleted between then and day 30 was lost
 * silently. Deleting a 25-day-old entry — the exact case that surfaced this —
 * went undetected roughly six days out of seven.
 *
 * 45 satisfies the invariant with 12 days to spare, which also absorbs the team
 * rule slipping (an entry edited at 40 days is still caught). Measured cost on
 * production: 972 candidate tasks, ~32 minutes at the 30 jobs/min ClickUp
 * limiter, on a queue that is otherwise idle at 00:30 local.
 */
export const DELETION_RECONCILE_DAYS = 45;

/**
 * Tasks the rolling verification sweep re-checks each night.
 *
 * Sizing (production, 2026-08-27): 21,780 tasks hold at least one time entry.
 * At 3,500/night a full cycle completes every 7 nights. Each task costs one
 * task fetch plus one time-entries fetch, on two queues with independent
 * limiters, so wall-clock is ~3,500/30 ≈ 2 hours — comfortably inside the
 * 00:00-09:00 local window, and both queues are empty at 01:00.
 */
export const ROLLING_SWEEP_TASKS_PER_NIGHT = 3500;

/**
 * Padding applied either side of a task's known entry span when the rolling
 * sweep fetches it.
 *
 * NOT cosmetic. The window is derived from the `start_time` of rows we already
 * hold — the very rows the prune would judge — so a tight window reintroduces
 * the false-delete this codebase has already shipped once: if someone re-dates
 * an entry in ClickUp to outside the window, the fetch cannot return it, it is
 * absent from `keepIds`, and the stale local row (still inside the window) is
 * deleted while alive upstream.
 *
 * 60 days each side absorbs any realistic re-dating. It is nearly free:
 * measured on production, 21,763 of 21,780 tasks (99.92%) have all their
 * entries inside a 30-day span, and ClickUp's time-entries endpoint only splits
 * a request when the window exceeds a year — so the padded window is still a
 * single call for essentially every task.
 */
export const ROLLING_SWEEP_WINDOW_PAD_DAYS = 60;

/**
 * Whether the rolling sweep may DELETE rows ClickUp did not return, or only
 * report them.
 *
 * Deliberately `false` on introduction. The windowed prune passed review and
 * tests and still destroyed 429 live entries, and the only check that would
 * have caught it was observing its intended deletions against real data first.
 * While this is false the sweep still does its most valuable work — it
 * re-fetches and repairs every entry on a fixed cycle — and logs
 * `[prune-dry-run]` lines showing exactly what it would have removed.
 *
 * Flip to true only after those logs have been reviewed across a full cycle and
 * the reported deletions have been confirmed genuinely absent in ClickUp.
 */
export const ROLLING_SWEEP_PRUNE_ENABLED = false;

@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);
  constructor(
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
    private readonly timeEntriesRepo: TimeEntriesRepository,
  ) {}

  // Recurring reconciliation: every 6 hours (00:00 / 06:00 / 12:00 / 18:00
  // local), syncs tasks updated in the last day and scans a bounded 7-day
  // time-entry window (rather than re-draining the full per-space window each
  // run) — enough to recover time entries whose webhook was missed within the
  // last week. Manual backfills use the full window. This is only a safety net
  // for webhooks ClickUp never delivered; real-time updates still arrive via
  // webhooks.
  //
  // Two of the four daily runs land inside office hours by design: this is the
  // path that recovers a webhook ClickUp dropped, and waiting until midnight to
  // notice would leave the dashboard wrong for a full working day. It stays
  // affordable because `lookbackDays: 1` keeps the task fan-out small and the
  // time-entry jobs it produces are deprioritized.
  @Cron('0 0 */6 * * *', { name: 'reconcile-recent-updates', timeZone: DHAKA })
  async reconcileRecentUpdates() {
    const queue = this.queues.get(QUEUES.CLICKUP_BACKFILLS);
    // Skip a space whose previous backfill hasn't drained yet — under ClickUp
    // slowness a run that outpaces the drain would otherwise stack
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
        // it on every recurring reconcile across all spaces would add minutes of
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
  @Cron('0 0 3 * * *', { name: 'sync-list-catalogs', timeZone: DHAKA })
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

  // Staggered archived reconcile. The recurring reconcile deliberately skips the
  // archived per-list scan (too heavy across all spaces every run) and archiving
  // fires no webhook — so a task inside a just-completed (archived) sprint whose
  // final state changed after its list was archived never re-syncs until a
  // manual backfill. This runs the archived pass for exactly ONE enabled space
  // per day in rotation, so each space is refreshed over a cycle of a few days
  // with bounded per-run load on the small (1.9GB) host. (The daily list-catalog
  // cron already keeps list-level archived state fresh; this closes the
  // task-level content gap.)
  @Cron('0 0 4 * * *', { name: 'reconcile-archived', timeZone: DHAKA })
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
   * space × RECONCILE_WINDOW_SLICE_DAYS-day slice) rather than the per-task
   * fan-out, runs ONE space per day in the same rotation as `reconcileArchived`,
   * and enqueues at `BULK_SWEEP_PRIORITY` so it can never head-of-line-block a
   * live webhook. At the 7-day slice width and the 365-day default lookback that
   * is ~53 low-priority jobs per day.
   *
   * 02:00 local keeps it clear of the 00:30 deletion reconcile, the 03:00
   * list-catalog cron and the 04:00 archived cron — all inside the 00:00-09:00
   * window where the office is closed.
   */
  @Cron('0 0 2 * * *', { name: 'deep-backfill-time-entries', timeZone: DHAKA })
  async deepBackfillTimeEntries() {
    const enabled = CLICKUP_SPACES.filter((s) => this.settings.isSpaceEnabled(s.id));
    if (!enabled.length) return;
    // Offset by 1 so this never targets the same space as `reconcileArchived`
    // on the same day — that cron's per-list archived scan is the heaviest job
    // the worker runs, and stacking a full year of slices on top of it would
    // concentrate two days' work onto one space on a 1.9 GB host.
    //
    // Both crons now run in DHAKA, at 02:00 and 04:00 — 20:00 and 22:00 UTC of
    // the same (previous) UTC day. `rotationIndex` buckets by UTC day, so they
    // still compute the same day number and the offset still separates them.
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
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BULK_SWEEP_PRIORITY };

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
   * ONE cron, EVERY day, ONE window — deliberately, and not how this started.
   *
   * The first version split the work (7-day window Mon-Thu, 30-day window Fri)
   * to save API calls. That split was the bug: a 30-day window running on a
   * 7-day period means an entry's LAST possible examination is the final Friday
   * before it ages out, which can fall as early as day 24. Anything deleted
   * between then and day 30 is never seen again, because every later run's
   * window has already moved past it. A deletion missed once is missed forever.
   *
   * Running daily makes the period 1 day (worst case
   * DELETION_RECONCILE_MAX_GAP_DAYS), which the window comfortably clears. It
   * also removes the whole class of bug: with a single window there is no
   * second schedule whose coverage has to be reasoned about separately.
   *
   * The saving was never worth it. Measured on production: 972 candidate tasks
   * at 45 days, ~32 minutes at the 30 jobs/min ClickUp limiter, deprioritized,
   * at 00:30 local when the office is closed and every queue is empty. A blanket
   * sweep would be 50k+ tasks and ~28 hours — that is the cost this window
   * exists to avoid, and 32 minutes is nowhere near it.
   */
  @Cron('0 30 0 * * *', { name: 'reconcile-deletions', timeZone: DHAKA })
  async reconcileDeletions() {
    await this.enqueueDeletionReconcile(DELETION_RECONCILE_DAYS);
  }

  /**
   * Rolling verification sweep — removes the *age horizon* entirely.
   *
   * The cron above is only correct while the team's "nobody touches an entry
   * older than 30 days" rule holds. That is a human promise, not an invariant:
   * break it once and the deletion is never detected, because the entry has
   * aged out of every window that will ever run. This sweep exists so the
   * guarantee no longer depends on anyone keeping a promise.
   *
   * It walks EVERY task we hold entries for, least-recently-verified first, at
   * a fixed budget per night, wrapping forever. Ordering is by
   * `clickup_tasks.synced_at`, which this sweep itself bumps — so the rotation
   * is self-healing with no cursor to persist and no shard arithmetic, and a
   * missed night just leaves those tasks at the front of the next one.
   *
   * GUARANTEE — stated precisely, because the obvious wording is wrong:
   * every entry belonging to a **current workspace member** is re-fetched from
   * ClickUp at least every `ceil(tasks / ROLLING_SWEEP_TASKS_PER_NIGHT)` days,
   * at any age. Entries logged by a **departed** member are excluded: ClickUp's
   * `assignee=` filter only accepts current members, so those rows can neither
   * be re-fetched nor pruned. They are frozen, not verified — on production
   * that is ~22,383 hours across ~9,000 dormant tasks, and no schedule can fix
   * it (see the assignee-harvesting note in docs/OPERATIONS.md).
   *
   * Each task gets TWO jobs, on different queues with independent limiters (so
   * this costs no extra wall-clock):
   *   - `SYNC_CLICKUP_TASK`   — refreshes `time_spent`, which is what makes the
   *                             free `SUM(entries) == time_spent` cross-check
   *                             meaningful rather than comparing two stale
   *                             numbers.
   *   - `SYNC_TASK_TIME_ENTRIES` — re-fetches the entries themselves.
   *
   * 01:00 local sits between the 00:30 deletion reconcile and the 02:00 deep
   * backfill, inside the closed-office window.
   */
  @Cron('0 0 1 * * *', { name: 'rolling-verify-sweep', timeZone: DHAKA })
  async rollingVerifySweep(): Promise<void> {
    const candidates = await this.timeEntriesRepo.findStalestTasksWithEntries(ROLLING_SWEEP_TASKS_PER_NIGHT);
    if (!candidates.length) {
      this.logger.log('Rolling verify sweep: no tasks hold entries — nothing to verify');
      return;
    }

    const entriesQueue = this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES);
    const tasksQueue = this.queues.get(QUEUES.CLICKUP_TASKS);
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BULK_SWEEP_PRIORITY };
    const padMs = ROLLING_SWEEP_WINDOW_PAD_DAYS * 24 * 60 * 60 * 1000;
    const pruneMode = ROLLING_SWEEP_PRUNE_ENABLED ? 'delete' : 'report';

    for (const c of candidates) {
      await tasksQueue.add(JOBS.SYNC_CLICKUP_TASK, { taskId: c.taskId }, jobOpts);
      await entriesQueue.add(
        JOBS.SYNC_TASK_TIME_ENTRIES,
        {
          taskId: c.taskId,
          startDate: c.oldestStartMs - padMs,
          endDate: c.newestStartMs + padMs,
          pruneMode,
        },
        jobOpts,
      );
    }

    const total = await this.timeEntriesRepo.countTasksWithEntries();
    const cycleDays = Math.ceil(total / ROLLING_SWEEP_TASKS_PER_NIGHT);
    this.logger.log(
      `Rolling verify sweep: ${candidates.length} task(s) of ${total} (full cycle ≈ ${cycleDays} day(s), prune=${pruneMode})`,
    );
  }

  /**
   * Enqueues one per-task time-entry sync for every task holding an entry in the
   * last `lookbackDays`.
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
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BULK_SWEEP_PRIORITY };
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

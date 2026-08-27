import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { SyncTaskDto } from './dto/sync-task.dto';
import { BackfillDto } from './dto/backfill.dto';
import { BackfillReplacementDto } from './dto/backfill-replacement.dto';
import { SyncListsDto } from './dto/sync-lists.dto';
import { SettingsService } from '../settings/settings.service';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES, BULK_SWEEP_PRIORITY } from '../queues/queue.constants';
import { replacementJobId } from '../time-entries/assignee-replacement.service';
import { PrismaService } from '../database/prisma.service';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { TimeEntriesRepository } from '../time-entries/time-entries.repository';
import { TasksRepository } from '../tasks/tasks.repository';
import { subtractDays } from '../common/utils/date-utils';
import { sliceReconcileWindow } from '../sync/reconcile-window.util';

/** Redis key prefix (outside the `bull:` keyspace) for the per-space time-entry
 * backfill progress high-water mark. */
const PROGRESS_PEAK_PREFIX = 'progress:te-peak:';
/** Backstop expiry for a high-water mark. Longer than any realistic single
 * drain, so it self-cleans if a space is never observed idle (e.g. a
 * non-configured admin-override space the idle sweep doesn't iterate). */
const PROGRESS_PEAK_TTL_S = 48 * 60 * 60;

/** Default lookback when the caller doesn't specify one. */
const RECONCILE_WINDOW_DEFAULT_LOOKBACK_DAYS = 90;
/** Sane upper bound on the resolved lookback — an unbounded caller-supplied
 * value (e.g. a typo'd 100000) would fan out tens of thousands of jobs,
 * recreating the per-task pathology this endpoint exists to remove. */
const RECONCILE_WINDOW_MAX_LOOKBACK_DAYS = 400;

/** Manual sync/backfill/reconcile actions under `/admin`. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminSyncController {
  constructor(
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly tasksRepo: TasksRepository,
    private readonly timeEntriesRepo: TimeEntriesRepository,
  ) {}

  @Post('tasks/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually trigger a single ClickUp task sync' })
  syncTask(@Body() dto: SyncTaskDto) {
    this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.SYNC_CLICKUP_TASK, { taskId: dto.taskId }, this.queues.defaultJobOptions());
    return { queued: true, taskId: dto.taskId };
  }

  @Post('time-entries/sync-task')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enqueue a time-entry sync for a single task. Useful for clearing stuck FK-failed jobs after the task row is present.' })
  syncTaskTimeEntries(@Body() dto: SyncTaskDto) {
    this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES).add(
      JOBS.SYNC_TASK_TIME_ENTRIES,
      { taskId: dto.taskId },
      this.queues.defaultJobOptions(),
    );
    return { queued: true, taskId: dto.taskId, queue: QUEUES.CLICKUP_TIME_ENTRIES };
  }

  @Post('backfill')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trigger a space backfill' })
  async backfill(@Body() dto: BackfillDto) {
    const space = CLICKUP_SPACES.find((s) => s.id === dto.spaceId);
    if (!space && !dto.allowUnknownSpaces) throw new BadRequestException(`Unknown spaceId: ${dto.spaceId}. Valid: ${CLICKUP_SPACES.map((s) => s.id).join(', ')}. Pass allowUnknownSpaces: true to override.`);
    // The DTO only enforces the absolute 3650-day backstop; the effective cap is
    // the configurable Settings → Sync value, enforced here at request time.
    const cap = this.settings.getBackfillMaxLookbackDays();
    if (dto.lookbackDays != null && dto.lookbackDays > cap) {
      throw new BadRequestException(`lookbackDays ${dto.lookbackDays} exceeds the configured maximum ${cap}. Raise it in Settings → Sync.`);
    }
    const lookbackDays = dto.lookbackDays ?? space?.backfillLookbackDays ?? 30;
    const queue = this.queues.get(QUEUES.CLICKUP_BACKFILLS);
    // Refuse a duplicate while a backfill for this space is already in flight.
    // The frontend disables the button, but it relies on polled state with lag,
    // so "Sync all", a double-click, the recurring reconcile, or a direct API
    // call could otherwise stack a second backfill — and each one fans out a
    // per-task time-entry job for the whole space. Mirrors the overlap guard in
    // reconcileTasks / SyncScheduler.reconcileRecentUpdates.
    // CLICKUP_BACKFILLS is now shared with SYNC_LIST_CATALOG jobs (Task 5), so
    // filter by job name here too — otherwise a pending/retrying catalog job
    // for this space would make a genuinely-idle space report "already
    // running" and silently refuse a manual backfill.
    const live = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    const alreadyRunning = live.some(
      (j) => j.name === JOBS.BACKFILL_CLICKUP_SPACE && (j.data as { spaceId?: string } | undefined)?.spaceId === dto.spaceId,
    );
    if (alreadyRunning) {
      return { queued: false, alreadyRunning: true, spaceId: dto.spaceId };
    }
    await queue.add(JOBS.BACKFILL_CLICKUP_SPACE, { spaceId: dto.spaceId, lookbackDays }, this.queues.defaultJobOptions());
    return { queued: true, spaceId: dto.spaceId, lookbackDays };
  }

  @Post('lists/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually trigger a list/folder catalog sync for one space, or all configured spaces if spaceId is omitted' })
  async syncLists(@Body() dto: SyncListsDto) {
    const queue = this.queues.get(QUEUES.CLICKUP_BACKFILLS);
    const jobOpts = this.queues.defaultJobOptions();

    if (dto.spaceId) {
      const space = CLICKUP_SPACES.find((s) => s.id === dto.spaceId);
      if (!space) throw new BadRequestException(`Unknown spaceId: ${dto.spaceId}. Valid: ${CLICKUP_SPACES.map((s) => s.id).join(', ')}.`);
      await queue.add(JOBS.SYNC_LIST_CATALOG, { spaceId: dto.spaceId }, jobOpts);
      return { queued: 1 };
    }

    for (const space of CLICKUP_SPACES) {
      await queue.add(JOBS.SYNC_LIST_CATALOG, { spaceId: space.id }, jobOpts);
    }
    return { queued: CLICKUP_SPACES.length };
  }

  /**
   * Live per-space sync status, driven by BullMQ queue depth (which survives
   * page reloads, unlike the client's `useState` that used to track this).
   *
   * `phase`:
   *   - `fetching`     → backfill worker is still scanning ClickUp tasks (no
   *                      `total` known yet, render as indeterminate).
   *   - `time-entries` → backfill done; time-entry workers are draining N
   *                      per-task jobs in parallel. `total` is the most-recent
   *                      completed backfill's `tasks_synced`. `done = total -
   *                      remaining` (clamped ≥ 0 so webhook-driven drains
   *                      that outrun the original backfill don't display
   *                      negative progress).
   *
   * Webhook-driven time-entry jobs that happen to land in the same window
   * get attributed to the most recent backfill on that space — acceptable
   * noise for an admin progress bar. The lookback for that backfill is tied to
   * the age of the oldest still-queued job (with a 1-hour minimum), so a big
   * multi-hour drain keeps a stable `total` instead of collapsing `done` to 0.
   */
  @Get('backfill/active')
  @ApiOperation({ summary: 'Live per-space sync progress (queued + active jobs, with totals from the most recent backfill)' })
  async backfillActive() {
    const [backfillJobs, timeEntryJobs] = await Promise.all([
      this.queues.get(QUEUES.CLICKUP_BACKFILLS).getJobs(['active', 'waiting', 'delayed', 'prioritized']),
      this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES).getJobs(['active', 'waiting', 'delayed', 'prioritized']),
    ]);

    const fetchingSpaceIds = new Set<string>();
    for (const job of backfillJobs) {
      // CLICKUP_BACKFILLS also carries SYNC_LIST_CATALOG jobs (Task 5); only a
      // real backfill job means the space is "fetching" for this progress bar.
      if (job.name !== JOBS.BACKFILL_CLICKUP_SPACE) continue;
      const sid = (job.data as { spaceId?: string } | undefined)?.spaceId;
      if (sid) fetchingSpaceIds.add(sid);
    }

    const taskIds = [...new Set(
      timeEntryJobs
        .map((j) => (j.data as { taskId?: string } | undefined)?.taskId)
        .filter((v): v is string => typeof v === 'string'),
    )];
    const taskSpaceRows = taskIds.length > 0
      ? await this.prisma.clickupTask.findMany({
          where: { taskId: { in: taskIds } },
          select: { taskId: true, spaceId: true },
        })
      : [];
    const taskToSpace = new Map<string, string | null>(taskSpaceRows.map((r) => [r.taskId, r.spaceId]));
    const remainingBySpace = new Map<string, number>();
    for (const job of timeEntryJobs) {
      const taskId = (job.data as { taskId?: string } | undefined)?.taskId;
      if (!taskId) continue;
      const sid = taskToSpace.get(taskId);
      if (!sid) continue;
      remainingBySpace.set(sid, (remainingBySpace.get(sid) ?? 0) + 1);
    }

    const activeSpaceIds = new Set<string>([...fetchingSpaceIds, ...remainingBySpace.keys()]);
    // Spaces genuinely in a time-entry drain (queued jobs, backfill fetch done).
    const timeEntrySpaceIds = [...remainingBySpace.keys()].filter((id) => !fetchingSpaceIds.has(id));

    // Reset the high-water mark for every configured space with NO queued
    // time-entry jobs — genuinely between drains. Crucially this keys off
    // `remainingBySpace`, NOT the time-entries phase: a space that is mid-drain
    // AND fetching (e.g. the 12-hourly cron enqueues a fresh backfill while a big
    // backlog still drains) keeps its mark, so its total can't collapse. Runs on
    // every poll (including when nothing is active), so the next drain starts its
    // bar from zero instead of inheriting a stale peak.
    const redis = await this.queues.redis();
    const staleKeys = CLICKUP_SPACES.map((s) => s.id)
      .filter((id) => !remainingBySpace.has(id))
      .map((id) => `${PROGRESS_PEAK_PREFIX}${id}`);
    if (staleKeys.length) await redis.del(...staleKeys);

    if (activeSpaceIds.size === 0) return { spaces: [] };

    // Lookback floor for the completed-backfill query. A fixed 1-hour window was
    // wrong: a big archived backfill enqueues tens of thousands of rate-limited
    // (30/min) time-entry jobs that take MANY HOURS to drain. Once the backfill
    // is older than the window, `recentTotal` becomes 0, `total` falls back to
    // `remaining`, and `done = total - remaining` collapses to a permanent 0 —
    // the bar shows `0 / <shrinking queue depth>` for the whole drain.
    //
    // Instead, tie the floor to the age of the oldest still-queued job (minus
    // slack), so the backfill that ENQUEUED these jobs stays in range for as
    // long as they drain and `total` stays pinned to its `tasks_synced`. Keep a
    // 1-hour minimum for freshly-finished backfills. A newer completed backfill
    // still wins (orderBy desc); a long-quiescent space has no queued jobs so it
    // never reaches here, so widening the window can't misattribute.
    const oldestQueuedTs = timeEntryJobs.reduce(
      (min, j) => (typeof j.timestamp === 'number' && j.timestamp < min ? j.timestamp : min),
      Date.now(),
    );
    const backfillLookbackFloor = new Date(
      Math.min(oldestQueuedTs - 5 * 60 * 1000, Date.now() - 60 * 60 * 1000),
    );

    // Pull the most-recent completed backfill per active space — gives us the
    // `tasks_synced` total for the progress bar denominator.
    const recentBackfills = await this.prisma.syncJobLog.findMany({
      where: {
        queueName: QUEUES.CLICKUP_BACKFILLS,
        entityType: 'space',
        entityId: { in: [...activeSpaceIds] },
        status: 'completed',
        finishedAt: { gte: backfillLookbackFloor },
      },
      orderBy: { finishedAt: 'desc' },
      select: { entityId: true, tasksSynced: true, finishedAt: true },
    });
    // Seed the denominator with the LARGEST tasks_synced in the window, not the
    // most-recent. A small 12-hourly reconcile (lookbackDays:1) completing on top
    // of a big archived backfill would otherwise become "the recent backfill" and
    // shrink the total to a handful — the high-water mark below then preserves the
    // large seed even after the big backfill slides out of the lookback window.
    const recentTotalBySpace = new Map<string, number>();
    for (const row of recentBackfills) {
      if (!row.entityId || row.tasksSynced == null) continue;
      const prev = recentTotalBySpace.get(row.entityId) ?? 0;
      if (row.tasksSynced > prev) recentTotalBySpace.set(row.entityId, row.tasksSynced);
    }

    // Read the persisted per-space high-water mark of the time-entry backlog so
    // the progress denominator is stable and monotonic for the whole (multi-hour)
    // drain — surviving page reloads, both blue-green web instances, and small
    // reconciles. `total` = peak(remaining ever seen, largest backfill total);
    // `done` climbs as `remaining` falls. Stored in the shared Redis outside the
    // `bull:` keyspace (cleanup handled above; TTL is a backstop).
    const storedPeaksRaw = timeEntrySpaceIds.length
      ? await redis.mget(timeEntrySpaceIds.map((id) => `${PROGRESS_PEAK_PREFIX}${id}`))
      : [];
    const storedPeakBySpace = new Map<string, number>(
      timeEntrySpaceIds.map((id, i) => [id, Number(storedPeaksRaw[i]) || 0]),
    );

    const spaces = await Promise.all(
      [...activeSpaceIds].map(async (spaceId) => {
        const remaining = remainingBySpace.get(spaceId) ?? 0;
        if (fetchingSpaceIds.has(spaceId)) {
          return { spaceId, phase: 'fetching' as const, total: null, done: null, remaining };
        }
        const stored = storedPeakBySpace.get(spaceId) ?? 0;
        const seed = recentTotalBySpace.get(spaceId) ?? 0;
        const peak = Math.max(stored, remaining, seed);
        if (peak > stored) {
          await redis.set(`${PROGRESS_PEAK_PREFIX}${spaceId}`, peak, 'EX', PROGRESS_PEAK_TTL_S);
        }
        const total = peak > 0 ? peak : remaining;
        const done = Math.max(0, total - remaining);
        return { spaceId, phase: 'time-entries' as const, total, done, remaining };
      }),
    );

    return { spaces };
  }

  @Post('time-entries/backfill-replacement')
  @HttpCode(200)
  @ApiOperation({ summary: 'Queue replacement jobs for all historical time entries that carry a mapped tag and have not been replaced yet.' })
  async backfillReplacement(@Body() dto: BackfillReplacementDto) {
    const limit = Math.min(dto.limit ?? 500, 2000);
    const entries = await this.timeEntriesRepo.findUnreplacedTaggedEntries(limit);

    let queued = 0;
    for (const entry of entries) {
      // Empty `tags` rows are filtered at the SQL level, but the array could
      // still be all-null after lowercasing — guard just in case.
      if (!entry.tag_names || entry.tag_names.length === 0) continue;
      this.queues.get(QUEUES.CLICKUP_ASSIGNEE_REPLACEMENT).add(
        JOBS.REPLACE_TIME_ENTRY_ASSIGNEES,
        {
          timeEntryId: entry.time_entry_id,
          taskId: entry.task_id ?? '',
          startMs: entry.start_time?.getTime() ?? 0,
          endMs: entry.end_time?.getTime() ?? 0,
          durationHours: Number(entry.duration_hours),
          billable: entry.billable,
          description: entry.description ?? undefined,
          originalUserId: entry.user_id ?? '',
          tags: entry.tag_names,
        },
        // Same deterministic jobId as the webhook-driven enqueue so a backfill
        // and a live sync can't both spawn a replacement for the same entry.
        // Deprioritized: this sweep shares `clickup-assignee-replacement` with
        // live tag-driven replacements enqueued from a webhook sync.
        { ...this.queues.defaultJobOptions(), priority: BULK_SWEEP_PRIORITY, jobId: replacementJobId(entry.time_entry_id) },
      );
      queued += 1;
    }

    return { queued, scanned: entries.length, limit };
  }

  @Post('time-entries/sync-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enqueue time-entry sync jobs for every task in the database' })
  async syncAllTimeEntries(@Query('lookbackDays') lookbackDaysParam?: string) {
    const tasks = await this.tasksRepo.findAllIds();
    const endDate = Date.now();
    const queue = this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES);
    // One job per task across the WHOLE table (50k+ tasks). At the default
    // priority those sit in the FIFO `wait` list ahead of every live
    // taskTimeTrackedUpdated job enqueued afterwards — hours of real-time lag.
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BULK_SWEEP_PRIORITY };

    for (const { taskId, spaceId } of tasks) {
      const space = CLICKUP_SPACES.find((s) => s.id === spaceId);
      const days = lookbackDaysParam ? Number(lookbackDaysParam) : (space?.backfillLookbackDays ?? 90);
      const startDate = subtractDays(days).getTime();
      await queue.add(JOBS.SYNC_TASK_TIME_ENTRIES, { taskId, startDate, endDate }, jobOpts);
    }

    return { queued: tasks.length };
  }

  @Post('time-entries/reconcile-window')
  @HttpCode(200)
  @ApiOperation({ summary: 'Windowed time-entry reconcile: one job per configured space per date-slice (cheap alternative to the per-task sync-all).' })
  async reconcileTimeEntriesWindow(@Body() dto: { spaceId?: string; lookbackDays?: number }) {
    const spaces = dto.spaceId
      ? (() => {
          const hit = CLICKUP_SPACES.find((s) => s.id === dto.spaceId);
          if (!hit) throw new BadRequestException(`Unknown space ${dto.spaceId}`);
          return [hit];
        })()
      : CLICKUP_SPACES;

    const resolvedLookbackDays = dto.lookbackDays && dto.lookbackDays > 0 ? Math.round(dto.lookbackDays) : RECONCILE_WINDOW_DEFAULT_LOOKBACK_DAYS;
    const lookbackDays = Math.min(Math.max(resolvedLookbackDays, 1), RECONCILE_WINDOW_MAX_LOOKBACK_DAYS);
    // Shared with SyncScheduler.deepReconcileTimeEntries so the scheduled sweep
    // and this manual endpoint slice identically.
    const slices = sliceReconcileWindow(subtractDays(lookbackDays).getTime(), Date.now());

    const queue = this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES);
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BULK_SWEEP_PRIORITY };

    let queued = 0;
    for (const space of spaces) {
      for (const slice of slices) {
        await queue.add(
          JOBS.RECONCILE_TIME_ENTRIES_WINDOW,
          { spaceId: space.id, ...slice },
          jobOpts,
        );
        queued += 1;
      }
    }
    return { queued };
  }

  @Post('tasks/reconcile')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reconcile every stored task against ClickUp: detect whole-task deletes (soft-delete ghosts) and re-sync each task’s time entries' })
  async reconcileTasks(@Query('lookbackDays') lookbackDaysParam?: string) {
    // Refuse to start a second sweep while one is still draining: re-triggering
    // would enqueue another RECONCILE job per task (no dedup) and double the
    // queue depth. The caller can poll /admin/tasks/reconcile/active for status.
    const inFlight = await this.queues.get(QUEUES.CLICKUP_TASKS).getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    if (inFlight.some((j) => j.name === JOBS.RECONCILE_CLICKUP_TASK)) {
      return { queued: 0, alreadyRunning: true };
    }
    const tasks = await this.tasksRepo.findAllIds();
    const endDate = Date.now();
    const days = lookbackDaysParam ? Number(lookbackDaysParam) : 365;
    const startDate = subtractDays(days).getTime();
    const queue = this.queues.get(QUEUES.CLICKUP_TASKS);
    // Same head-of-line hazard as sync-all, on the tasks queue: the webhook path
    // enqueues SYNC_CLICKUP_TASK here, and would queue behind this whole sweep.
    const jobOpts = { ...this.queues.defaultJobOptions(), priority: BULK_SWEEP_PRIORITY };

    for (const { taskId } of tasks) {
      await queue.add(JOBS.RECONCILE_CLICKUP_TASK, { taskId, startDate, endDate }, jobOpts);
    }

    return { queued: tasks.length };
  }

  @Get('tasks/reconcile/active')
  @ApiOperation({ summary: 'Live progress for a running full-reconciliation sweep' })
  async reconcileActive() {
    const jobs = await this.queues.get(QUEUES.CLICKUP_TASKS).getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    // The clickup-tasks queue is shared with sync/delete jobs, so count only
    // reconcile jobs by name.
    const remaining = jobs.filter((j) => j.name === JOBS.RECONCILE_CLICKUP_TASK).length;
    if (remaining === 0) return { active: false, total: 0, done: 0, remaining: 0 };
    // Denominator ≈ jobs enqueued (one per non-deleted task). It drifts down as
    // the sweep soft-deletes 404'd tasks, so clamp done at 0.
    const total = await this.tasksRepo.countActive();
    const done = Math.max(0, total - remaining);
    return { active: true, total, done, remaining };
  }
}

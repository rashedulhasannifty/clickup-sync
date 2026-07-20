import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { SyncTaskDto } from './dto/sync-task.dto';
import { BackfillDto } from './dto/backfill.dto';
import { BackfillReplacementDto } from './dto/backfill-replacement.dto';
import { SettingsService } from '../settings/settings.service';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { replacementJobId } from '../time-entries/assignee-replacement.service';
import { PrismaService } from '../database/prisma.service';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { TimeEntriesRepository } from '../time-entries/time-entries.repository';
import { TasksRepository } from '../tasks/tasks.repository';
import { subtractDays } from '../common/utils/date-utils';

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
  backfill(@Body() dto: BackfillDto) {
    const space = CLICKUP_SPACES.find((s) => s.id === dto.spaceId);
    if (!space && !dto.allowUnknownSpaces) throw new BadRequestException(`Unknown spaceId: ${dto.spaceId}. Valid: ${CLICKUP_SPACES.map((s) => s.id).join(', ')}. Pass allowUnknownSpaces: true to override.`);
    // The DTO only enforces the absolute 3650-day backstop; the effective cap is
    // the configurable Settings → Sync value, enforced here at request time.
    const cap = this.settings.getBackfillMaxLookbackDays();
    if (dto.lookbackDays != null && dto.lookbackDays > cap) {
      throw new BadRequestException(`lookbackDays ${dto.lookbackDays} exceeds the configured maximum ${cap}. Raise it in Settings → Sync.`);
    }
    const lookbackDays = dto.lookbackDays ?? space?.backfillLookbackDays ?? 30;
    this.queues.get(QUEUES.CLICKUP_BACKFILLS).add(JOBS.BACKFILL_CLICKUP_SPACE, { spaceId: dto.spaceId, lookbackDays }, this.queues.defaultJobOptions());
    return { queued: true, spaceId: dto.spaceId, lookbackDays };
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
   * noise for an admin progress bar, and only inside a 1-hour lookback so a
   * long-quiescent space isn't misattributed.
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
    if (activeSpaceIds.size === 0) return { spaces: [] };

    // Pull the most-recent completed backfill per active space — gives us the
    // `tasks_synced` total for the progress bar denominator.
    const recentBackfills = await this.prisma.syncJobLog.findMany({
      where: {
        queueName: QUEUES.CLICKUP_BACKFILLS,
        entityType: 'space',
        entityId: { in: [...activeSpaceIds] },
        status: 'completed',
        finishedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      orderBy: { finishedAt: 'desc' },
      select: { entityId: true, tasksSynced: true, finishedAt: true },
    });
    const recentTotalBySpace = new Map<string, number>();
    for (const row of recentBackfills) {
      if (!row.entityId || recentTotalBySpace.has(row.entityId)) continue;
      if (row.tasksSynced != null) recentTotalBySpace.set(row.entityId, row.tasksSynced);
    }

    const spaces = [...activeSpaceIds].map((spaceId) => {
      const remaining = remainingBySpace.get(spaceId) ?? 0;
      if (fetchingSpaceIds.has(spaceId)) {
        return { spaceId, phase: 'fetching' as const, total: null, done: null, remaining };
      }
      // Fall back to `remaining` whenever the recent backfill is missing OR
      // recorded 0 tasks — otherwise progress would be 0/0 (NaN%) or done
      // would clamp to a permanent 0%.
      const recentTotal = recentTotalBySpace.get(spaceId) ?? 0;
      const total = recentTotal > 0 ? recentTotal : remaining;
      const done = Math.max(0, total - remaining);
      return { spaceId, phase: 'time-entries' as const, total, done, remaining };
    });

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
        { ...this.queues.defaultJobOptions(), jobId: replacementJobId(entry.time_entry_id) },
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
    const jobOpts = this.queues.defaultJobOptions();

    for (const { taskId, spaceId } of tasks) {
      const space = CLICKUP_SPACES.find((s) => s.id === spaceId);
      const days = lookbackDaysParam ? Number(lookbackDaysParam) : (space?.backfillLookbackDays ?? 90);
      const startDate = subtractDays(days).getTime();
      await queue.add(JOBS.SYNC_TASK_TIME_ENTRIES, { taskId, startDate, endDate }, jobOpts);
    }

    return { queued: tasks.length };
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
    const jobOpts = this.queues.defaultJobOptions();

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

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogRepository } from './audit-log.repository';
import { SyncTaskDto } from './dto/sync-task.dto';
import { BackfillDto } from './dto/backfill.dto';
import { BackfillReplacementDto } from './dto/backfill-replacement.dto';
import { CreateRateDto } from './dto/create-rate.dto';
import { UpdateRateDto } from './dto/update-rate.dto';
import { CreateTagAssigneeDto } from './dto/create-tag-assignee.dto';
import { UpdateTagAssigneeDto } from './dto/update-tag-assignee.dto';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { PrismaService } from '../database/prisma.service';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { DeadLetterRepository } from '../jobs/dead-letter.repository';
import { ClickupClient } from '../clickup/clickup.client';
import { ClickupWebhooksService } from '../clickup/clickup-webhooks.service';
import { WebhookEventsRepository } from '../webhooks/webhook-events.repository';
import { WebhookParserService } from '../webhooks/webhook-parser.service';
import { TimeEntriesRepository } from '../time-entries/time-entries.repository';
import { RatesRepository } from '../rates/rates.repository';
import { TagAssigneeMapRepository } from '../time-entries/tag-assignee-map.repository';
import { TasksRepository } from '../tasks/tasks.repository';
import { RatesService } from '../rates/rates.service';
import { subtractDays } from '../common/utils/date-utils';

function parseId(id: string): bigint {
  const n = BigInt(id);
  return n;
}

@ApiTags('admin')
@ApiSecurity('x-admin-key')
@UseGuards(AdminApiKeyGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly queues: QueueService,
    private readonly deadLetters: DeadLetterRepository,
    private readonly clickup: ClickupClient,
    private readonly webhooks: ClickupWebhooksService,
    private readonly timeEntriesRepo: TimeEntriesRepository,
    private readonly ratesRepo: RatesRepository,
    private readonly tagAssigneeRepo: TagAssigneeMapRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly ratesService: RatesService,
    private readonly webhookEvents: WebhookEventsRepository,
    private readonly webhookParser: WebhookParserService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogRepository,
  ) {}

  @Get('ping')
  @ApiOperation({ summary: 'Validate admin key' })
  ping() {
    return { ok: true };
  }

  @Get('workspace-members')
  @ApiOperation({ summary: 'List ClickUp workspace members' })
  async listWorkspaceMembers() {
    const teamId = process.env.CLICKUP_TEAM_ID ?? '';
    const members = await this.clickup.getTeamMembers(teamId);
    return members.map((m) => ({
      id: String(m.user.id),
      name: m.user.username ?? null,
      email: m.user.email ?? null,
    }));
  }

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

  @Post('webhooks/register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register NestJS webhook with ClickUp — idempotent, returns secret on first creation' })
  registerWebhook() {
    return this.webhooks.register();
  }

  @Post('webhooks/retry-failed')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-enqueue every webhook event with status=failed back onto the clickup-webhooks queue.' })
  async retryFailedWebhooks(@Query('limit') limitParam?: string) {
    const limit = Math.min(Number(limitParam) || 500, 2000);
    const failed = await this.webhookEvents.findFailed(limit);
    let requeued = 0;
    const queue = this.queues.get(QUEUES.CLICKUP_WEBHOOKS);
    for (const row of failed) {
      // Re-parse the raw payload so we pick up any parser improvements made
      // since the event was first received — and so we don't have to
      // shape-match what the worker expects in two places.
      const parsed = this.webhookParser.parse(row.rawPayload);
      await queue.add(JOBS.PROCESS_CLICKUP_EVENT, parsed, this.queues.defaultJobOptions());
      // Clear the failed marker so this attempt can be observed.
      await this.webhookEvents.markRequeued(row.fingerprint).catch(() => undefined);
      requeued += 1;
    }
    return { requeued, scanned: failed.length, limit };
  }

  @Get('dead-letters')
  @ApiOperation({ summary: 'List unresolved dead-letter jobs' })
  async listDeadLetters(@Query('limit') limit = 50, @Query('offset') offset = 0) {
    const safeLimit = Math.min(Number(limit) || 50, 200);
    const safeOffset = Number(offset) || 0;
    return this.deadLetters.findPending(safeLimit, safeOffset);
  }

  @Post('dead-letters/:id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-queue a dead-letter job back onto its original queue' })
  async retryDeadLetter(@Param('id') id: string) {
    const record = await this.deadLetters.findById(BigInt(id));
    if (!record) throw new NotFoundException(`Dead-letter job ${id} not found`);
    await this.queues.get(record.queueName).add(record.jobName, record.payload, this.queues.defaultJobOptions());
    await this.deadLetters.markRetried(BigInt(id));
    return { requeued: true, id, queueName: record.queueName, jobName: record.jobName };
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
        this.queues.defaultJobOptions(),
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

  // ── Rates CRUD ─────────────────────────────────────────────────────────────

  @Post('rates/recalculate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recalculate time-entry costs from current rates (optionally scoped to one assignee)' })
  recalculateCosts(@Query('assigneeId') assigneeId?: string) {
    this.queues
      .get(QUEUES.MAINTENANCE)
      .add(JOBS.RECALCULATE_COSTS, assigneeId ? { assigneeId } : {}, this.queues.defaultJobOptions());
    return { queued: true, scope: assigneeId ?? 'all' };
  }

  @Get('rates')
  @ApiOperation({ summary: 'List all assignee rates (paginated)' })
  listRates(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.ratesRepo.findAll(Number(page) || 1, Number(limit) || 50);
  }

  @Post('rates')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an assignee rate' })
  createRate(@Body() dto: CreateRateDto) {
    const validFrom = new Date(`${dto.validFrom.slice(0, 10)}T00:00:00.000Z`);
    const validTo = dto.validTo ? new Date(`${dto.validTo.slice(0, 10)}T00:00:00.000Z`) : null;
    return this.ratesService.create({ assigneeId: dto.assigneeId, assigneeName: dto.assigneeName, assigneeEmail: dto.assigneeEmail, currency: dto.currency ?? 'AUD', hourlyRateCents: dto.hourlyRateCents, validFrom, validTo });
  }

  @Patch('rates/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update an assignee rate' })
  updateRate(@Param('id') id: string, @Body() dto: UpdateRateDto) {
    const data: Parameters<RatesRepository['update']>[1] = {};
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.hourlyRateCents !== undefined) data.hourlyRateCents = dto.hourlyRateCents;
    if (dto.validFrom !== undefined) data.validFrom = new Date(`${dto.validFrom.slice(0, 10)}T00:00:00.000Z`);
    if ('validTo' in dto) data.validTo = dto.validTo ? new Date(`${dto.validTo!.slice(0, 10)}T00:00:00.000Z`) : null;
    return this.ratesService.update(parseId(id), data);
  }

  @Delete('rates/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an assignee rate' })
  deleteRate(@Param('id') id: string) {
    return this.ratesService.remove(parseId(id));
  }

  // ── Tag-Assignee Map CRUD ───────────────────────────────────────────────────

  @Get('tag-assignee-map')
  @ApiOperation({ summary: 'List all tag → assignee mappings' })
  listTagAssignee() {
    return this.tagAssigneeRepo.findAll();
  }

  @Post('tag-assignee-map')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a tag → assignee mapping' })
  createTagAssignee(@Body() dto: CreateTagAssigneeDto) {
    return this.tagAssigneeRepo.create({ tagName: dto.tagName, clickupUserId: dto.clickupUserId, clickupUserName: dto.clickupUserName, clickupEmail: dto.clickupEmail });
  }

  @Patch('tag-assignee-map/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a tag → assignee mapping' })
  updateTagAssignee(@Param('id') id: string, @Body() dto: UpdateTagAssigneeDto) {
    return this.tagAssigneeRepo.update(parseId(id), dto);
  }

  @Delete('tag-assignee-map/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a tag → assignee mapping' })
  deleteTagAssignee(@Param('id') id: string) {
    return this.tagAssigneeRepo.remove(parseId(id));
  }

  // ── Audit log viewer ───────────────────────────────────────────────────────

  @Get('audit-log')
  @ApiOperation({ summary: 'Paginated admin audit log (write actions only).' })
  async listAuditLog(
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
    @Query('actor') actor?: string,
    @Query('routePattern') routePattern?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLog.findMany({
      actor: actor?.trim() || undefined,
      routePattern: routePattern?.trim() || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });
  }
}

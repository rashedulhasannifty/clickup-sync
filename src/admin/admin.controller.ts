import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { SyncTaskDto } from './dto/sync-task.dto';
import { BackfillDto } from './dto/backfill.dto';
import { BackfillReplacementDto } from './dto/backfill-replacement.dto';
import { CreateRateDto } from './dto/create-rate.dto';
import { UpdateRateDto } from './dto/update-rate.dto';
import { CreateTagAssigneeDto } from './dto/create-tag-assignee.dto';
import { UpdateTagAssigneeDto } from './dto/update-tag-assignee.dto';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { DeadLetterRepository } from '../jobs/dead-letter.repository';
import { ClickupClient } from '../clickup/clickup.client';
import { ClickupWebhooksService } from '../clickup/clickup-webhooks.service';
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

  @Post('webhooks/register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register NestJS webhook with ClickUp — idempotent, returns secret on first creation' })
  registerWebhook() {
    return this.webhooks.register();
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
  @ApiOperation({ summary: 'Queue replacement jobs for all historical agency-user time entries not yet replaced' })
  async backfillReplacement(@Body() dto: BackfillReplacementDto) {
    const agencyUserId = process.env.CLICKUP_AGENCY_USER_ID;
    if (!agencyUserId) throw new BadRequestException('CLICKUP_AGENCY_USER_ID env var is not set');

    const limit = Math.min(dto.limit ?? 500, 2000);
    const entries = await this.timeEntriesRepo.findUnreplacedAgencyEntries(agencyUserId, limit);

    for (const entry of entries) {
      this.queues.get(QUEUES.CLICKUP_ASSIGNEE_REPLACEMENT).add(
        JOBS.REPLACE_TIME_ENTRY_ASSIGNEES,
        {
          timeEntryId: entry.timeEntryId,
          taskId: entry.taskId ?? '',
          startMs: entry.startTime?.getTime() ?? 0,
          endMs: entry.endTime?.getTime() ?? 0,
          durationHours: Number(entry.durationHours),
          billable: entry.billable,
          description: entry.description ?? undefined,
        },
        this.queues.defaultJobOptions(),
      );
    }

    return { queued: entries.length, agencyUserId, limit };
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
}

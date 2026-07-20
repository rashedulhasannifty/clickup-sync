import { Body, Controller, Delete, Get, HttpCode, Logger, Param, Patch, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles, CurrentUser } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { CreateRateDto } from './dto/create-rate.dto';
import { UpdateRateDto } from './dto/update-rate.dto';
import { UpdateExcludedAssigneesDto } from './dto/update-excluded-assignees.dto';
import { SettingsService } from '../settings/settings.service';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { RatesRepository } from '../rates/rates.repository';
import { RatesService } from '../rates/rates.service';
import { actorLabel, parseId } from './admin.util';

/** Assignee-rate CRUD + cost recalculation + excluded-from-costing list under `/admin`. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminRatesController {
  private readonly logger = new Logger(AdminRatesController.name);

  constructor(
    private readonly queues: QueueService,
    private readonly ratesRepo: RatesRepository,
    private readonly ratesService: RatesService,
    private readonly settings: SettingsService,
  ) {}

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
    return this.ratesService.create({ assigneeId: dto.assigneeId, assigneeName: dto.assigneeName, assigneeEmail: dto.assigneeEmail, currency: dto.currency ?? 'USD', hourlyRateCents: dto.hourlyRateCents, validFrom, validTo });
  }

  @Patch('rates/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update an assignee rate' })
  updateRate(@Param('id') id: string, @Body() dto: UpdateRateDto) {
    const data: Parameters<RatesRepository['update']>[1] = {};
    if (dto.assigneeName !== undefined) data.assigneeName = dto.assigneeName;
    if (dto.assigneeEmail !== undefined) data.assigneeEmail = dto.assigneeEmail;
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

  // ── Excluded-from-costing assignees ────────────────────────────────────────

  @Get('excluded-assignees')
  @ApiOperation({ summary: 'List assignees excluded from costing' })
  listExcludedAssignees() {
    return { assignees: this.settings.getPreferences().cost.excludedAssignees };
  }

  @Put('excluded-assignees')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace the whole excluded-from-costing assignee list; recalcs changed assignees' })
  async updateExcludedAssignees(@Body() dto: UpdateExcludedAssigneesDto, @CurrentUser() user: AuthPrincipal) {
    const prev = new Set(this.settings.getPreferences().cost.excludedAssignees.map((a) => a.id));
    const next = dto.assignees.map((a) => ({ id: a.id, name: a.name ?? null, email: a.email ?? null }));
    const nextIds = new Set(next.map((a) => a.id));

    await this.settings.update({ preferences: { cost: { excludedAssignees: next } } }, actorLabel(user));

    // Recalc anyone whose excluded-ness changed: added (now COST_EXCLUDED) and
    // removed (back to rate-based costing / NO_RATE_FOUND).
    const changed = new Set<string>();
    for (const id of nextIds) if (!prev.has(id)) changed.add(id);
    for (const id of prev) if (!nextIds.has(id)) changed.add(id);
    // Settings already persisted; a queue failure must not fail the request or
    // leave a floating rejection. Recalc can be re-run via the manual button.
    for (const id of changed) {
      try {
        await this.queues.get(QUEUES.MAINTENANCE).add(JOBS.RECALCULATE_COSTS, { assigneeId: id }, this.queues.defaultJobOptions());
      } catch (e) {
        this.logger.error(`Failed to enqueue cost recalculation for excluded-assignee change ${id}: ${(e as Error).message}`);
      }
    }

    return { assignees: next, recalculated: [...changed] };
  }
}

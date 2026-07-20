import { BadRequestException, Controller, Get, HttpCode, Param, Patch, Query, UseInterceptors, Body } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles, CurrentUser } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogRepository } from './audit-log.repository';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SearchRepository } from './search.repository';
import { TaskHistoryRepository } from './task-history.repository';
import { SettingsService } from '../settings/settings.service';
import { ClickupClient } from '../clickup/clickup.client';
import { actorLabel } from './admin.util';

/**
 * Core admin surface: connection settings, quick search, workspace members,
 * per-task history, and the audit-log viewer. Domain-specific admin actions
 * live in the sibling `Admin*Controller`s (sync, webhooks, dead-letters,
 * spikes, rates, budgets, tags) — all under the same `/admin` prefix.
 */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly clickup: ClickupClient,
    private readonly auditLog: AuditLogRepository,
    private readonly settings: SettingsService,
    private readonly searchRepo: SearchRepository,
    private readonly taskHistoryRepo: TaskHistoryRepository,
  ) {}

  @Get('ping')
  @ApiOperation({ summary: 'Validate admin key' })
  ping() {
    return { ok: true };
  }

  @Get('search')
  @ApiOperation({ summary: 'Quick search across tasks and assignees (command palette).' })
  search(@Query('q') q = '') {
    return this.searchRepo.search(q);
  }

  @Get('workspace-members')
  @ApiOperation({ summary: 'List ClickUp workspace members' })
  async listWorkspaceMembers() {
    const teamId = this.settings.getTeamId();
    const members = await this.clickup.getTeamMembers(teamId);
    return members.map((m) => ({
      id: String(m.user.id),
      name: m.user.username ?? null,
      email: m.user.email ?? null,
    }));
  }

  // ── ClickUp connection settings ─────────────────────────────────────────────

  @Get('settings')
  @ApiOperation({ summary: 'Get ClickUp connection settings (secrets masked)' })
  getSettings() {
    return this.settings.getMasked();
  }

  @Patch('settings')
  @Roles(Role.OWNER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Update ClickUp connection settings. Secrets are written only when supplied.' })
  updateSettings(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthPrincipal) {
    if ((dto.apiToken || dto.webhookSecret) && !this.settings.getMasked().encryptionEnabled) {
      throw new BadRequestException(
        'Cannot store secrets: APP_ENCRYPTION_KEY is not configured on the server. Set it (64 hex chars) and restart.',
      );
    }
    return this.settings.update(dto, actorLabel(user));
  }

  // ── Task history ───────────────────────────────────────────────────────────

  @Get('tasks/:taskId/history')
  @ApiOperation({ summary: 'Merged sync-job + status-event history for one task.' })
  taskHistory(@Param('taskId') taskId: string) {
    return this.taskHistoryRepo.forTask(taskId);
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

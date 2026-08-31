import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { SetTaskChargeableDto } from './dto/set-task-chargeable.dto';
import { SetAssigneeChargeableDto } from './dto/set-assignee-chargeable.dto';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { TasksRepository } from '../tasks/tasks.repository';
import { TaskAssigneeChargeabilityRepository } from '../tasks/task-assignee-chargeability.repository';
import { MAX_CHARGEABLE_TASK_IDS } from '../tasks/task-chargeability.constants';

/** Locally-owned task annotations under `/admin`. Today: chargeability. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminTasksController {
  constructor(
    private readonly queues: QueueService,
    private readonly tasksRepo: TasksRepository,
    private readonly rules: TaskAssigneeChargeabilityRepository,
  ) {}

  @Get('chargeability-rules')
  @ApiOperation({
    summary:
      "Every (task, assignee) chargeability rule, newest first, with the task it names and the tracked time it affects. The only aggregate view of rules — everywhere else you must already know which task to open. `userName` is best-effort (rules store only a ClickUp user id, so the name is borrowed from a time entry) and is null for a rule set before its assignee logged anything. To clear a rule, PATCH /admin/tasks/:taskId/assignee-chargeable with `chargeable: null` — that path is already audited and recalc-scoped, so there is deliberately no DELETE here.",
  })
  listChargeabilityRules(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    // Query strings are user input. Anything not a positive number — absent,
    // 'abc', '0', '-5' — falls back to the default rather than being clamped
    // into range, so a typo returns a normal page instead of a single row.
    // The 500 cap keeps the two joins below bounded.
    const l = Number(limit);
    const o = Number(offset);
    return this.rules.list({
      limit: Number.isFinite(l) && l > 0 ? Math.min(Math.floor(l), 500) : 50,
      offset: Number.isFinite(o) && o > 0 ? Math.floor(o) : 0,
    });
  }

  @Patch('tasks/chargeable')
  @HttpCode(200)
  @ApiOperation({ summary: "Mark tasks Chargeable or Non-chargeable. Non-chargeable time costs zero, so the affected tasks' entries are re-costed by a scoped recalculate-costs job. Idempotent: tasks already in the requested state are neither written nor recalculated." })
  async setChargeable(@Body() dto: SetTaskChargeableDto) {
    // Also guarded by the DTO; kept here so a direct service call can't bypass it.
    if (dto.taskIds.length > MAX_CHARGEABLE_TASK_IDS) {
      throw new BadRequestException(`At most ${MAX_CHARGEABLE_TASK_IDS} tasks per request`);
    }
    const { count } = await this.tasksRepo.setChargeable(dto.taskIds, dto.chargeable);
    // Nothing changed means no stored cost can have changed either.
    if (count > 0) {
      await this.queues
        .get(QUEUES.MAINTENANCE)
        .add(JOBS.RECALCULATE_COSTS, { taskIds: dto.taskIds }, this.queues.defaultJobOptions());
    }
    return { updated: count, requested: dto.taskIds.length, queued: count > 0 };
  }

  @Patch('tasks/:taskId/assignee-chargeable')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Mark one assignee's time on one task Chargeable or Non-chargeable. `chargeable: null` clears the rule and falls back to the task flag. Re-costs only that assignee's entries on that task, via a recalculate-costs job scoped to both. Idempotent on cost: a rule already in the requested state is not recalculated (its `setBy`/note are still refreshed to record the calling user).",
  })
  async setAssigneeChargeable(
    @Param('taskId') taskId: string,
    @Body() dto: SetAssigneeChargeableDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    const { changed } =
      dto.chargeable === null
        ? await this.rules.clearRule(taskId, dto.userId)
        : await this.rules.setRule({
            taskId,
            userId: dto.userId,
            chargeable: dto.chargeable,
            // 'machine' for the shared admin-API-key principal, which has no email.
            setBy: user.email ?? user.userId,
            // Pass through unchanged: undefined means "leave the stored note alone",
            // null means "clear it" — coercing an omitted note to null would wipe it.
            note: dto.note,
          });
    // Nothing changed means no stored cost can have changed either.
    if (changed) {
      // Both scopes: `CostRecalculationService.recalculate` ANDs assigneeId and
      // taskIds, so this re-costs exactly this assignee's entries on this task.
      await this.queues
        .get(QUEUES.MAINTENANCE)
        .add(JOBS.RECALCULATE_COSTS, { assigneeId: dto.userId, taskIds: [taskId] }, this.queues.defaultJobOptions());
    }
    return { changed, queued: changed };
  }
}

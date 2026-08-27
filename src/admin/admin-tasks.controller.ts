import { BadRequestException, Body, Controller, HttpCode, Patch, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { SetTaskChargeableDto } from './dto/set-task-chargeable.dto';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { TasksRepository } from '../tasks/tasks.repository';
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
  ) {}

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
}

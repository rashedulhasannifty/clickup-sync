import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AccessScope, canEditChargeability, isUnrestricted } from './access-scope';

/**
 * All-or-nothing gate for chargeability writes. One id the caller may not edit
 * (or that doesn't exist) rejects the whole request, and the error names no ids —
 * it must not become an existence oracle for other teams' tasks.
 */
@Injectable()
export class ChargeabilityAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertTasks(scope: AccessScope, taskIds: string[]): Promise<void> {
    if (isUnrestricted(scope)) {
      if (!scope.canEdit) throw new ForbiddenException('Not allowed to change chargeability');
      return;
    }
    const rows = await this.prisma.clickupTask.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, scopeClientOptionId: true },
    });
    const ok = rows.length === new Set(taskIds).size && rows.every((r) => canEditChargeability(scope, r.scopeClientOptionId));
    if (!ok) throw new ForbiddenException('Not allowed to change chargeability for one or more items');
  }

  async assertEntries(scope: AccessScope, timeEntryIds: string[]): Promise<void> {
    if (isUnrestricted(scope)) {
      if (!scope.canEdit) throw new ForbiddenException('Not allowed to change chargeability');
      return;
    }
    const rows = await this.prisma.clickupTimeEntry.findMany({
      where: { timeEntryId: { in: timeEntryIds } },
      select: { timeEntryId: true, task: { select: { scopeClientOptionId: true } } },
    });
    const ok =
      rows.length === new Set(timeEntryIds).size && rows.every((r) => canEditChargeability(scope, r.task?.scopeClientOptionId ?? null));
    if (!ok) throw new ForbiddenException('Not allowed to change chargeability for one or more items');
  }
}

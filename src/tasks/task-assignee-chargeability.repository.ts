import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ruleKey } from '../time-entries/chargeability';

/**
 * The `(task, assignee)` chargeability rules — a local annotation, never
 * touched by any ClickUp sync path.
 */
@Injectable()
export class TaskAssigneeChargeabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rules for a batch of tasks, as a Map keyed `taskId|userId`. Every cost
   * write path calls this once per batch rather than once per entry.
   */
  async findForTasks(taskIds: string[]): Promise<Map<string, boolean>> {
    // An empty `in` list would scan the table for nothing.
    if (taskIds.length === 0) return new Map();
    const rows = await this.prisma.taskAssigneeChargeability.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, userId: true, chargeable: true },
    });
    return new Map(rows.map((r) => [ruleKey(r.taskId, r.userId), r.chargeable]));
  }

  findForTask(taskId: string) {
    return this.prisma.taskAssigneeChargeability.findMany({
      where: { taskId },
      select: { userId: true, chargeable: true },
    });
  }

  async findOne(taskId: string, userId: string): Promise<boolean | null> {
    const row = await this.prisma.taskAssigneeChargeability.findUnique({
      where: { taskId_userId: { taskId, userId } },
      select: { chargeable: true },
    });
    return row?.chargeable ?? null;
  }

  /**
   * Upsert a rule. Reports whether anything actually changed so the caller can
   * skip a pointless recalculation — same contract as
   * `TasksRepository.setChargeable`.
   */
  async setRule(input: {
    taskId: string;
    userId: string;
    chargeable: boolean;
    setBy?: string | null;
    note?: string | null;
  }): Promise<{ changed: boolean }> {
    const existing = await this.prisma.taskAssigneeChargeability.findUnique({
      where: { taskId_userId: { taskId: input.taskId, userId: input.userId } },
      select: { chargeable: true },
    });
    if (existing?.chargeable === input.chargeable) return { changed: false };
    await this.prisma.taskAssigneeChargeability.upsert({
      where: { taskId_userId: { taskId: input.taskId, userId: input.userId } },
      create: {
        taskId: input.taskId,
        userId: input.userId,
        chargeable: input.chargeable,
        setBy: input.setBy ?? null,
        note: input.note ?? null,
      },
      update: {
        chargeable: input.chargeable,
        setBy: input.setBy ?? null,
        note: input.note ?? null,
      },
    });
    return { changed: true };
  }

  /** Remove a rule. Idempotent: clearing an absent rule changes nothing. */
  async clearRule(taskId: string, userId: string): Promise<{ changed: boolean }> {
    const { count } = await this.prisma.taskAssigneeChargeability.deleteMany({ where: { taskId, userId } });
    return { changed: count > 0 };
  }
}

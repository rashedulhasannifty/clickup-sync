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
   * Upsert a rule. Reports whether the chargeable value actually changed so the
   * caller can skip a pointless recalculation — same contract as
   * `TasksRepository.setChargeable`. Note-only edits persist but report
   * `changed: false`. Only fields explicitly provided (not undefined) are updated;
   * passing null is explicit (to clear), while omitting a field leaves the stored
   * value alone.
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
      select: { chargeable: true, setBy: true, note: true },
    });

    // Determine what changed
    const chargeabilityChanged = existing?.chargeable !== input.chargeable;
    const noteProvided = input.note !== undefined;
    const setByProvided = input.setBy !== undefined;

    // If nothing changed, return early without writing
    if (!chargeabilityChanged && !noteProvided && !setByProvided) {
      return { changed: false };
    }

    // Build update payload: only include fields that were explicitly provided.
    // This prevents unconditional overwrites from blanking existing values.
    const updatePayload: {
      chargeable: boolean;
      setBy?: string | null;
      note?: string | null;
    } = {
      chargeable: input.chargeable,
    };
    if (noteProvided) updatePayload.note = input.note;
    if (setByProvided) updatePayload.setBy = input.setBy;

    await this.prisma.taskAssigneeChargeability.upsert({
      where: { taskId_userId: { taskId: input.taskId, userId: input.userId } },
      create: {
        taskId: input.taskId,
        userId: input.userId,
        chargeable: input.chargeable,
        setBy: input.setBy ?? null,
        note: input.note ?? null,
      },
      update: updatePayload,
    });

    // Report whether chargeability changed; note-only edits are not "changes" for
    // cost-recalculation purposes.
    return { changed: chargeabilityChanged };
  }

  /** Remove a rule. Idempotent: clearing an absent rule changes nothing. */
  async clearRule(taskId: string, userId: string): Promise<{ changed: boolean }> {
    const { count } = await this.prisma.taskAssigneeChargeability.deleteMany({ where: { taskId, userId } });
    return { changed: count > 0 };
  }
}

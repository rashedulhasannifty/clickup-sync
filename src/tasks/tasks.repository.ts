import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NormalizedTask } from '../clickup/clickup-normalizer';

@Injectable()
export class TasksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(task: NormalizedTask) {
    // `shared` is built from NormalizedTask alone, which deliberately carries
    // no local annotations (see the "Local annotations" block in
    // schema.prisma). Do NOT switch this to writing every column: user-set
    // flags like `isChargeable` would revert on each task's next resync, with
    // no error anywhere. `tasks.repository.spec.ts` enforces this.
    const shared = { ...task, raw: task.raw as Prisma.InputJsonValue, isDeleted: false };
    const update: Prisma.ClickupTaskUpdateInput = { ...shared, deletedAt: null, syncCount: { increment: 1 } };
    // The single-task fetch (GET /task/{id}, used by webhooks and manual sync)
    // returns space.id but no space.name, so the normalizer yields spaceName=null.
    // That path has no patchSpaceNames follow-up (unlike backfill), so an
    // unconditional overwrite would blank a name a prior backfill already
    // resolved — splitting the space into a named + null bucket in reports.
    // On UPDATE, keep the existing value when the incoming space fields are null.
    if (task.spaceName == null) delete (update as Record<string, unknown>).spaceName;
    if (task.spaceId == null) delete (update as Record<string, unknown>).spaceId;
    // Same rationale for the rich description: only the single-task fetch
    // (GET /task/{id}) reliably returns `markdown_description`; the bulk team
    // endpoint used by backfill/reconcile may omit it, yielding null. Don't let
    // a backfill pass blank a value the webhook path already captured. The plain
    // `description` is present on both, so it stays an unconditional overwrite.
    if (task.markdownDescription == null) delete (update as Record<string, unknown>).markdownDescription;
    return this.prisma.$transaction(async (tx) => {
      // DERIVED access key (see schema): own option id, else the parent's. Sync owns
      // this column — it is NOT a local annotation, so writing it here is correct.
      let scopeClientOptionId = task.clientOptionId;
      if (!scopeClientOptionId && task.parentTaskId) {
        const parent = await tx.clickupTask.findUnique({
          where: { taskId: task.parentTaskId },
          select: { scopeClientOptionId: true },
        });
        scopeClientOptionId = parent?.scopeClientOptionId ?? null;
      }
      const row = await tx.clickupTask.upsert({
        where: { taskId: task.taskId },
        create: { ...shared, scopeClientOptionId, syncCount: 1 },
        update: { ...update, scopeClientOptionId },
      });
      // Descendants without their own client follow this task's scope — the WHOLE
      // subtree, not just direct children. A single-level cascade left grandchildren
      // pointing at the previous client indefinitely: `syncTask` upserts only the one
      // task it fetched, and changing a task in ClickUp does not bump its descendants'
      // `date_updated`, so no later webhook or backfill pass would ever correct them.
      // That failed OPEN — the losing team kept seeing the row.
      //
      // Recursion stops at any descendant that has its own `client_option_id`: that
      // task is its own scope root, and its subtree belongs to it, not to us.
      // `UNION` (not `UNION ALL`) dedupes against rows already produced, so a cyclic
      // parent chain from bad upstream data terminates instead of spinning.
      //
      // This runs for EVERY upsert (whole-space reconciles on a 1.9 GB host), so the
      // final predicate keeps it to rows that actually differ — an unchanged parent
      // walks its subtree and writes nothing. `IS DISTINCT FROM` is null-safe in both
      // directions, which is what the old Prisma `OR`/`not` pair was working around.
      await tx.$executeRaw`
        WITH RECURSIVE subtree AS (
          SELECT task_id
          FROM clickup_tasks
          WHERE parent_task_id = ${task.taskId} AND client_option_id IS NULL
          UNION
          SELECT c.task_id
          FROM clickup_tasks c
          JOIN subtree s ON c.parent_task_id = s.task_id
          WHERE c.client_option_id IS NULL
        )
        UPDATE clickup_tasks t
        SET scope_client_option_id = ${scopeClientOptionId}
        FROM subtree s
        WHERE t.task_id = s.task_id
          AND t.scope_client_option_id IS DISTINCT FROM ${scopeClientOptionId}
      `;
      return row;
    });
  }

  softDelete(taskId: string) {
    return this.prisma.clickupTask.upsert({
      where: { taskId },
      create: { taskId, taskName: 'Unknown Task', isDeleted: true, deletedAt: new Date() },
      update: { isDeleted: true, deletedAt: new Date(), syncedAt: new Date(), syncCount: { increment: 1 } },
    });
  }

  patchSpaceNames(spaceId: string, spaceName: string) {
    return this.prisma.clickupTask.updateMany({
      where: { spaceId, spaceName: null },
      data: { spaceName },
    });
  }

  async exists(taskId: string): Promise<boolean> {
    const row = await this.prisma.clickupTask.findUnique({ where: { taskId }, select: { taskId: true } });
    return row !== null;
  }

  findAllIds(spaceId?: string): Promise<{ taskId: string; spaceId: string | null }[]> {
    return this.prisma.clickupTask.findMany({
      where: { isDeleted: false, ...(spaceId ? { spaceId } : {}) },
      select: { taskId: true, spaceId: true },
    });
  }

  /** Count of non-deleted tasks — the reconciliation-progress denominator. */
  countActive(): Promise<number> {
    return this.prisma.clickupTask.count({ where: { isDeleted: false } });
  }

  async findMissingParentIds(parentIds: string[]): Promise<string[]> {
    if (!parentIds.length) return [];
    const rows = await this.prisma.clickupTask.findMany({ where: { taskId: { in: parentIds } }, select: { taskId: true } });
    const existing = new Set(rows.map((r) => r.taskId));
    return parentIds.filter((id) => !existing.has(id));
  }

  /**
   * Set the locally-owned chargeability flag. Only rows whose value actually
   * changes are counted, so the caller can skip a pointless recalculation —
   * and the returned count is what the UI reports back to the user.
   */
  setChargeable(taskIds: string[], chargeable: boolean) {
    return this.prisma.clickupTask.updateMany({
      where: { taskId: { in: taskIds }, isChargeable: !chargeable },
      data: { isChargeable: chargeable },
    });
  }
}

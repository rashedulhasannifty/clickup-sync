import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NormalizedTask } from '../clickup/clickup-normalizer';

@Injectable()
export class TasksRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(task: NormalizedTask) {
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
    return this.prisma.clickupTask.upsert({
      where: { taskId: task.taskId },
      create: { ...shared, syncCount: 1 },
      update,
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
}

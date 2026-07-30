import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type ListCatalogRow = {
  listId: string; name: string;
  folderId: string | null; folderName: string | null;
  spaceId: string | null; spaceName: string | null;
  archived: boolean; startDate: Date | null; dueDate: Date | null;
};

type MinimalTaskList = {
  listId: string | null; listName: string | null;
  folderId: string | null; folderName: string | null;
  spaceId: string | null; spaceName: string | null;
};

@Injectable()
export class ListsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMany(rows: ListCatalogRow[]): Promise<number> {
    if (!rows.length) return 0;
    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.clickupList.upsert({
          where: { listId: r.listId },
          create: { ...r, syncedAt: new Date() },
          update: { ...r, syncedAt: new Date() },
        }),
      ),
    );
    return rows.length;
  }

  async upsertMinimalFromTasks(tasks: MinimalTaskList[]): Promise<number> {
    const byId = new Map<string, MinimalTaskList>();
    for (const t of tasks) if (t.listId) byId.set(t.listId, t);
    if (!byId.size) return 0;
    await this.prisma.$transaction(
      [...byId.values()].map((t) => {
        const fields = {
          name: t.listName ?? 'Unknown List',
          folderId: t.folderId, folderName: t.folderName,
          spaceId: t.spaceId, spaceName: t.spaceName,
        };
        return this.prisma.clickupList.upsert({
          where: { listId: t.listId! },
          create: { listId: t.listId!, ...fields },
          update: fields, // deliberately omits archived/startDate/dueDate
        });
      }),
    );
    return byId.size;
  }
}

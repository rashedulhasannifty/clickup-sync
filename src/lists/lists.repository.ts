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
      rows.map((r) => {
        const update: Record<string, unknown> = { ...r, syncedAt: new Date() };
        // Folder/space names are also populated opportunistically by
        // upsertMinimalFromTasks (and later task-derived paths). If this
        // authoritative row's folder/space fields are null, an unconditional
        // overwrite would blank a value a prior write already resolved.
        // Mirrors tasks.repository.ts's guard for spaceId/spaceName. `name`,
        // `archived`, `startDate`, `dueDate` remain always-written: they are
        // authoritative here and null is a legitimate value for the dates.
        if (r.folderId == null) delete update.folderId;
        if (r.folderName == null) delete update.folderName;
        if (r.spaceId == null) delete update.spaceId;
        if (r.spaceName == null) delete update.spaceName;
        return this.prisma.clickupList.upsert({
          where: { listId: r.listId },
          create: { ...r, syncedAt: new Date() },
          update,
        });
      }),
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
        // Single-task fetches (webhooks, manual sync) commonly carry space/folder
        // id without name — see tasks.repository.ts's identical guard. An
        // unconditional overwrite here would blank a name upsertMany already
        // resolved, so keep the existing value when the incoming field is null.
        const update: Record<string, unknown> = { ...fields };
        if (t.folderId == null) delete update.folderId;
        if (t.folderName == null) delete update.folderName;
        if (t.spaceId == null) delete update.spaceId;
        if (t.spaceName == null) delete update.spaceName;
        return this.prisma.clickupList.upsert({
          where: { listId: t.listId! },
          create: { listId: t.listId!, ...fields },
          update, // deliberately omits archived/startDate/dueDate too
        });
      }),
    );
    return byId.size;
  }
}

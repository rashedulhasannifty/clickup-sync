import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { ListsRepository } from './lists.repository';

@Injectable()
export class ListCatalogService {
  private readonly logger = new Logger(ListCatalogService.name);
  constructor(private readonly clickup: ClickupClient, private readonly repo: ListsRepository) {}

  async syncSpace(spaceId: string): Promise<{ synced: number }> {
    const cat = await this.clickup.getSpaceListCatalog(spaceId);
    const rows = cat.map((e) => ({
      listId: e.id, name: e.name,
      folderId: e.folderId, folderName: e.folderName,
      spaceId: e.spaceId, spaceName: e.spaceName,
      archived: e.archived, startDate: e.startDate, dueDate: e.dueDate,
    }));
    const synced = await this.repo.upsertMany(rows);
    this.logger.log(`Synced ${synced} list(s) into catalog for space ${spaceId}`);
    return { synced };
  }
}

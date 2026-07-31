import { ListCatalogService } from '../src/lists/list-catalog.service';

describe('ListCatalogService', () => {
  it('maps catalog entries to repo rows and upserts them', async () => {
    const clickup = { getSpaceListCatalog: jest.fn().mockResolvedValue([
      { id: 'l1', name: 'Sprint 1', folderId: 'f1', folderName: 'X Sprint', spaceId: 's1', spaceName: 'X', archived: true, startDate: new Date('2026-07-01'), dueDate: null },
    ]) } as any;
    const repo = { upsertMany: jest.fn().mockResolvedValue(1) } as any;
    const svc = new ListCatalogService(clickup, repo);
    const res = await svc.syncSpace('s1');
    expect(clickup.getSpaceListCatalog).toHaveBeenCalledWith('s1');
    expect(repo.upsertMany).toHaveBeenCalledWith([expect.objectContaining({ listId: 'l1', archived: true })]);
    expect(res).toEqual({ synced: 1 });
  });
});

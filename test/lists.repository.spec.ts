import { ListsRepository } from '../src/lists/lists.repository';

function makePrisma() {
  return {
    clickupList: { upsert: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;
}

describe('ListsRepository', () => {
  it('upsertMany writes archived + dates keyed by list_id', async () => {
    const prisma = makePrisma();
    const repo = new ListsRepository(prisma);
    await repo.upsertMany([{ listId: 'l1', name: 'Sprint 1', folderId: 'f1', folderName: 'X Sprint', spaceId: 's1', spaceName: 'X', archived: true, startDate: new Date('2026-07-01'), dueDate: new Date('2026-07-07') }]);
    expect(prisma.clickupList.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { listId: 'l1' },
      create: expect.objectContaining({ listId: 'l1', archived: true }),
      update: expect.objectContaining({ archived: true, name: 'Sprint 1' }),
    }));
  });

  it('upsertMany omits null folder/space fields from update so a prior resolved value survives', async () => {
    const prisma = makePrisma();
    const repo = new ListsRepository(prisma);
    await repo.upsertMany([{ listId: 'l1', name: 'Sprint 1', folderId: null, folderName: null, spaceId: null, spaceName: null, archived: true, startDate: new Date('2026-07-01'), dueDate: null }]);
    const arg = prisma.clickupList.upsert.mock.calls[0][0];
    expect(arg.update).not.toHaveProperty('folderId');
    expect(arg.update).not.toHaveProperty('folderName');
    expect(arg.update).not.toHaveProperty('spaceId');
    expect(arg.update).not.toHaveProperty('spaceName');
    expect(arg.update).toHaveProperty('archived', true);
    expect(arg.update).toHaveProperty('startDate');
  });

  it('upsertMinimalFromTasks dedupes by listId and never sets archived/dates', async () => {
    const prisma = makePrisma();
    const repo = new ListsRepository(prisma);
    await repo.upsertMinimalFromTasks([
      { listId: 'l1', listName: 'Sprint 1', folderId: 'f1', folderName: 'X', spaceId: 's1', spaceName: 'X' },
      { listId: 'l1', listName: 'Sprint 1', folderId: 'f1', folderName: 'X', spaceId: 's1', spaceName: 'X' },
      { listId: null, listName: null, folderId: null, folderName: null, spaceId: null, spaceName: null },
    ]);
    expect(prisma.clickupList.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.clickupList.upsert.mock.calls[0][0];
    expect(arg.update).not.toHaveProperty('archived');
    expect(arg.update).not.toHaveProperty('startDate');
  });

  it('upsertMinimalFromTasks omits null folder/space fields from update so a prior resolved value survives', async () => {
    // Single-task fetches (webhooks, manual sync) commonly carry space/folder id
    // without name. An unconditional overwrite would blank a name a prior
    // authoritative catalog sync (upsertMany) already resolved.
    const prisma = makePrisma();
    const repo = new ListsRepository(prisma);
    await repo.upsertMinimalFromTasks([
      { listId: 'l1', listName: 'Sprint 1', folderId: null, folderName: null, spaceId: null, spaceName: null },
    ]);
    const arg = prisma.clickupList.upsert.mock.calls[0][0];
    expect(arg.update).not.toHaveProperty('folderId');
    expect(arg.update).not.toHaveProperty('folderName');
    expect(arg.update).not.toHaveProperty('spaceId');
    expect(arg.update).not.toHaveProperty('spaceName');
    expect(arg.update).toHaveProperty('name', 'Sprint 1');
    // create still carries the (null) values so a brand-new row isn't missing columns
    expect(arg.create).toHaveProperty('folderId', null);
    expect(arg.create).toHaveProperty('spaceName', null);
  });
});

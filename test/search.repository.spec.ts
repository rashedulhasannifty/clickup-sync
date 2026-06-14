import { SearchRepository } from '../src/admin/search.repository';

describe('SearchRepository.search', () => {
  it('returns empty arrays for short queries without hitting the db', async () => {
    const prisma = { clickupTask: { findMany: jest.fn() }, assigneeRate: { findMany: jest.fn() } } as any;
    const repo = new SearchRepository(prisma);
    const out = await repo.search('a');
    expect(out).toEqual({ tasks: [], assignees: [] });
    expect(prisma.clickupTask.findMany).not.toHaveBeenCalled();
  });

  it('queries tasks by name and dedupes assignees from rates', async () => {
    const clickupTask = {
      findMany: jest.fn().mockResolvedValue([
        { taskId: 't1', taskName: 'Landing page', status: 'open', client: 'Acme' },
      ]),
    };
    const assigneeRate = {
      findMany: jest.fn().mockResolvedValue([
        { assigneeId: 'u1', assigneeName: 'Ada', assigneeEmail: 'ada@x.co' },
        { assigneeId: 'u1', assigneeName: 'Ada', assigneeEmail: 'ada@x.co' },
        { assigneeId: 'u2', assigneeName: 'Bo', assigneeEmail: null },
      ]),
    };
    const repo = new SearchRepository({ clickupTask, assigneeRate } as any);

    const out2 = await repo.search('ad');

    expect(clickupTask.findMany).toHaveBeenCalled();
    expect(out2.tasks).toEqual([{ taskId: 't1', taskName: 'Landing page', status: 'open', client: 'Acme' }]);
    expect(out2.assignees).toEqual([
      { userId: 'u1', name: 'Ada', email: 'ada@x.co' },
      { userId: 'u2', name: 'Bo', email: null },
    ]);
  });
});

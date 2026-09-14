import { buildTaskWhere } from '../src/reports/task-filter.util';

describe('buildTaskWhere', () => {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;

  it('defaults: hides deleted tasks and applies from/to to updated_date', async () => {
    const where = await buildTaskWhere(prisma, { from: '2026-09-01', to: '2026-09-14' });
    expect(where.isDeleted).toBe(false);
    expect(where.updatedDate).toEqual({ gte: new Date('2026-09-01'), lte: new Date('2026-09-14') });
  });

  it('dateWindow:false drops the updated_date window', async () => {
    const where = await buildTaskWhere(prisma, { from: '2026-09-01', to: '2026-09-14' }, { dateWindow: false });
    expect(where.updatedDate).toBeUndefined();
  });

  it('excludeDeleted:false keeps soft-deleted tasks', async () => {
    const where = await buildTaskWhere(prisma, {}, { excludeDeleted: false });
    expect(where.isDeleted).toBeUndefined();
  });

  it('archived: undefined hides archived (existing Tasks-page behavior), include adds no clause', async () => {
    expect((await buildTaskWhere(prisma, {})).archived).toBe(false);
    expect((await buildTaskWhere(prisma, { archived: 'include' })).archived).toBeUndefined();
  });

  it('assigneeNames and search both land on AND without colliding', async () => {
    const where = await buildTaskWhere(prisma, { assigneeNames: 'Sam,Ria', search: 'checkout' });
    expect(Array.isArray(where.AND)).toBe(true);
    expect((where.AND as unknown[]).length).toBe(2);
  });
});

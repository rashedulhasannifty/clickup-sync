import { CostRecalculationService } from './cost-recalculation.service';

function makeDeps(entries: any[]) {
  const findMany = jest.fn().mockResolvedValue(entries);
  const update = jest.fn().mockResolvedValue({});
  const prisma = { clickupTimeEntry: { findMany, update } } as any;
  const calculate = jest.fn().mockResolvedValue({
    rateId: 9n, currency: 'AUD', hourlyRateCents: 10000n, costCents: 20000n, status: 'COST_CALCULATED',
  });
  const costs = { calculate } as any;
  return { svc: new CostRecalculationService(prisma, costs), prisma, findMany, update, calculate };
}

const ENTRY = { timeEntryId: 'te-1', userId: 'u1', startTime: new Date('2024-06-15T00:00:00Z'), durationHours: { toNumber: () => 2 } };

describe('CostRecalculationService', () => {
  it('scopes the query to one assignee when assigneeId is given', async () => {
    const { svc, findMany } = makeDeps([ENTRY]);
    await svc.recalculate({ assigneeId: 'u1' });
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });

  it('scans all entries when assigneeId is omitted', async () => {
    const { svc, findMany } = makeDeps([ENTRY]);
    await svc.recalculate({});
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });

  it('recomputes each entry and writes the cost fields back', async () => {
    const { svc, update, calculate } = makeDeps([ENTRY]);
    const res = await svc.recalculate({ assigneeId: 'u1' });

    expect(calculate).toHaveBeenCalledWith('u1', ENTRY.startTime, 2);
    expect(update).toHaveBeenCalledWith({
      where: { timeEntryId: 'te-1' },
      data: { rateId: 9n, currency: 'AUD', hourlyRateCents: 10000n, costCents: 20000n, status: 'COST_CALCULATED' },
    });
    expect(res).toEqual({ scanned: 1, updated: 1 });
  });

  it('is idempotent — a second run issues the same update', async () => {
    const { svc, update } = makeDeps([ENTRY]);
    await svc.recalculate({ assigneeId: 'u1' });
    await svc.recalculate({ assigneeId: 'u1' });
    expect(update.mock.calls[0]).toEqual(update.mock.calls[1]);
  });
});

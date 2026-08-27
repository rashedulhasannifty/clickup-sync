import { CostRecalculationService } from './cost-recalculation.service';

function makeSettings(cost: Partial<{ autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due' }> = {}) {
  return { getPreferences: () => ({ cost: { autoRecalcOnRateChange: true, rateMatching: 'start', ...cost } }) } as any;
}

function makeDeps(entries: any[]) {
  const findMany = jest.fn().mockResolvedValue(entries);
  const update = jest.fn().mockResolvedValue({});
  const prisma = { clickupTimeEntry: { findMany, update } } as any;
  const calculate = jest.fn().mockResolvedValue({
    rateId: 9n, currency: 'AUD', hourlyRateCents: 10000n, costCents: 20000n, status: 'COST_CALCULATED',
  });
  const costs = { calculate } as any;
  const settings = makeSettings();
  return { svc: new CostRecalculationService(prisma, costs, settings), prisma, findMany, update, calculate };
}

const ENTRY = { timeEntryId: 'te-1', userId: 'u1', startTime: new Date('2024-06-15T00:00:00Z'), durationHours: { toNumber: () => 2 }, task: null };

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

    expect(calculate).toHaveBeenCalledWith('u1', ENTRY.startTime, 2, expect.any(Map), { chargeable: true, dueDate: null });
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

  it('shares ONE rate cache across all entries in a run (so the DB is not hit per entry)', async () => {
    const ENTRY2 = { timeEntryId: 'te-2', userId: 'u1', startTime: new Date('2024-06-15T08:00:00Z'), durationHours: { toNumber: () => 1 } };
    const { svc, calculate } = makeDeps([ENTRY, ENTRY2]);

    await svc.recalculate({});

    const cacheArgs = calculate.mock.calls.map((c) => c[3]);
    expect(cacheArgs[0]).toBeInstanceOf(Map);
    expect(cacheArgs[1]).toBe(cacheArgs[0]); // same instance threaded through
  });

  it('selects entries with a stable cursor order for batching', async () => {
    const { svc, findMany } = makeDeps([ENTRY]);
    await svc.recalculate({});
    const call = findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ timeEntryId: 'asc' });
    expect(typeof call.take).toBe('number');
  });

  it('scopes the scan to the given tasks', async () => {
    const { svc, findMany } = makeDeps([]);

    await svc.recalculate({ taskIds: ['t1', 't2'] });

    expect(findMany.mock.calls[0][0].where).toEqual({ taskId: { in: ['t1', 't2'] } });
  });

  it("passes each entry's task chargeability to the calculator", async () => {
    const { svc, calculate } = makeDeps([{ ...ENTRY, task: { dueDate: null, isChargeable: false } }]);

    await svc.recalculate({});

    expect(calculate.mock.calls[0][4]).toEqual({ chargeable: false, dueDate: null });
  });

  it('treats an entry with no task as chargeable', async () => {
    const { svc, calculate } = makeDeps([{ ...ENTRY, task: null }]);

    await svc.recalculate({});

    expect(calculate.mock.calls[0][4]).toEqual({ chargeable: true, dueDate: null });
  });
});

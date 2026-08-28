import { CostRecalculationService } from './cost-recalculation.service';

function makeSettings(cost: Partial<{ autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due' }> = {}) {
  return { getPreferences: () => ({ cost: { autoRecalcOnRateChange: true, rateMatching: 'start', ...cost } }) } as any;
}

function makeDeps(entries: any[], rules: Map<string, boolean> = new Map()) {
  const findMany = jest.fn().mockResolvedValue(entries);
  const update = jest.fn().mockResolvedValue({});
  const prisma = { clickupTimeEntry: { findMany, update } } as any;
  // Mirrors the real CostCalculatorService: `isChargeable` reflects the
  // `chargeable` opt it was called with, so tests can assert on the resolved
  // stack rather than a value hardcoded independent of the input. This
  // mirrors `const isChargeable = opts?.chargeable !== false;` in
  // cost-calculator.service.ts — keep the two in sync.
  const calculate = jest.fn().mockImplementation(
    (_userId: unknown, _startTime: unknown, _hours: unknown, _cache: unknown, opts?: { chargeable?: boolean }) =>
      Promise.resolve({
        rateId: 9n, currency: 'AUD', hourlyRateCents: 10000n, costCents: 20000n, status: 'COST_CALCULATED',
        isChargeable: opts?.chargeable !== false,
      }),
  );
  const costs = { calculate } as any;
  const settings = makeSettings();
  const findForTasks = jest.fn().mockResolvedValue(rules);
  const rulesRepo = { findForTasks } as any;
  return { svc: new CostRecalculationService(prisma, costs, settings, rulesRepo), prisma, findMany, update, calculate, findForTasks };
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
      data: { rateId: 9n, currency: 'AUD', hourlyRateCents: 10000n, costCents: 20000n, status: 'COST_CALCULATED', isChargeable: true },
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

  it('resolves the (task, assignee) rule over the task flag when re-costing', async () => {
    // Task is chargeable; the rule says this assignee's time on it is not.
    // This is the one fixture where the OLD derivation (task flag only) and
    // the NEW derivation (through the rule) disagree — task=true, rule=false
    // — so it is the only one of these tests that can actually catch a
    // regression back to `e.task?.isChargeable ?? true`.
    const entry = {
      timeEntryId: 'te1', userId: 'u1', startTime: new Date('2026-01-05'),
      durationHours: { toNumber: () => 2 }, chargeableOverride: null,
      task: { dueDate: null, isChargeable: true },
      taskId: 't1',
    };
    const { svc, calculate, update } = makeDeps([entry], new Map([['t1|u1', false]]));

    await svc.recalculate({ taskIds: ['t1'] });

    expect(calculate.mock.calls[0][4]).toMatchObject({ chargeable: false });
    expect(update.mock.calls[0][0].data).toMatchObject({ isChargeable: false });
  });

  it('lets a per-entry override beat the rule', async () => {
    const entry = {
      timeEntryId: 'te1', userId: 'u1', startTime: new Date('2026-01-05'),
      durationHours: { toNumber: () => 2 }, chargeableOverride: true,
      task: { dueDate: null, isChargeable: false },
      taskId: 't1',
    };
    const { svc, calculate } = makeDeps([entry], new Map([['t1|u1', false]]));

    await svc.recalculate({ taskIds: ['t1'] });

    expect(calculate.mock.calls[0][4]).toMatchObject({ chargeable: true });
  });

  it('writes the resolved is_chargeable onto the row', async () => {
    const entry = {
      timeEntryId: 'te1', userId: 'u1', startTime: new Date('2026-01-05'),
      durationHours: { toNumber: () => 2 }, chargeableOverride: null,
      task: { dueDate: null, isChargeable: false }, taskId: 't1',
    };
    const { svc, update } = makeDeps([entry], new Map());

    await svc.recalculate({ taskIds: ['t1'] });

    expect(update.mock.calls[0][0].data).toMatchObject({ isChargeable: false });
  });
});

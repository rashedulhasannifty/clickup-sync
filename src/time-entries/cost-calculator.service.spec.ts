import { CostCalculatorService } from './cost-calculator.service';

function makePrisma(rate: unknown) {
  const findFirst = jest.fn().mockResolvedValue(rate);
  return { prisma: { assigneeRate: { findFirst } } as any, findFirst };
}

function makeSettings(
  cost: Partial<{ autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due' }> = {},
  excludedIds: string[] = [],
) {
  return {
    getPreferences: () => ({ cost: { autoRecalcOnRateChange: true, rateMatching: 'start', excludedAssignees: [], ...cost } }),
    getExcludedAssigneeIds: () => new Set(excludedIds),
  } as any;
}

describe('CostCalculatorService', () => {
  it('queries rates with an INCLUSIVE valid_to (closed-closed [from, to])', async () => {
    const { prisma, findFirst } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings());

    await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2);

    const where = findFirst.mock.calls[0][0].where;
    const validToClause = where.OR.find((c: any) => c.validTo && 'gte' in c.validTo) ?? where.OR[1];
    expect(validToClause.validTo.gte).toBeInstanceOf(Date);
    expect(validToClause.validTo.gt).toBeUndefined();
    expect(where.validFrom.lte).toBeInstanceOf(Date);
  });

  // Boundary tests that pin the closed-closed semantic. Without these, a
  // future refactor could silently revert to closed-open and lose every
  // edge-day entry (Dec 31 → Jan 1 cutover is the canonical risk).
  it('passes the entry-date midnight as the comparison value (so a Dec 31 entry matches validTo=Dec 31)', async () => {
    const { prisma, findFirst } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings());

    await svc.calculate('user-1', new Date('2024-12-31T18:30:00.000Z'), 1);

    const where = findFirst.mock.calls[0][0].where;
    const gteClause = where.OR.find((c: any) => c.validTo?.gte);
    expect(gteClause.validTo.gte.toISOString()).toBe('2024-12-31T00:00:00.000Z');
    expect(where.validFrom.lte.toISOString()).toBe('2024-12-31T00:00:00.000Z');
  });

  it('returns NO_RATE_FOUND when no effective rate exists', async () => {
    const { prisma } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings());

    const r = await svc.calculate('user-1', new Date('2024-06-15T00:00:00.000Z'), 5);

    expect(r.status).toBe('NO_RATE_FOUND');
    expect(r.costCents).toBe(0n);
    expect(r.rateId).toBeNull();
  });

  it('computes cost = round(hourlyRateCents * durationHours)', async () => {
    const { prisma } = makePrisma({ rateId: 7n, currency: 'AUD', hourlyRateCents: 15000n });
    const svc = new CostCalculatorService(prisma, makeSettings());

    const r = await svc.calculate('user-1', new Date('2024-06-15T00:00:00.000Z'), 2.5);

    expect(r.status).toBe('COST_CALCULATED');
    expect(r.hourlyRateCents).toBe(15000n);
    expect(r.costCents).toBe(37500n);
    expect(r.rateId).toBe(7n);
  });

  it('reuses a supplied cache so a repeated (user, date) lookup hits the DB only once', async () => {
    const { prisma, findFirst } = makePrisma({ rateId: 7n, currency: 'AUD', hourlyRateCents: 15000n });
    const svc = new CostCalculatorService(prisma, makeSettings());
    const cache = new Map();

    // Same user, same calendar day, different durations.
    const a = await svc.calculate('user-1', new Date('2024-06-15T09:00:00.000Z'), 2, cache);
    const b = await svc.calculate('user-1', new Date('2024-06-15T17:00:00.000Z'), 3, cache);

    expect(findFirst).toHaveBeenCalledTimes(1); // cached on the second call
    expect(a.costCents).toBe(30000n); // 15000 * 2
    expect(b.costCents).toBe(45000n); // 15000 * 3, still uses the cached rate
  });

  it('caches NO_RATE results too (negative caching)', async () => {
    const { prisma, findFirst } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings());
    const cache = new Map();

    await svc.calculate('user-1', new Date('2024-06-15T09:00:00.000Z'), 2, cache);
    const r = await svc.calculate('user-1', new Date('2024-06-15T17:00:00.000Z'), 3, cache);

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('NO_RATE_FOUND');
  });

  it('returns NO_RATE_FOUND when userId or startTime is null', async () => {
    const { prisma, findFirst } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings());

    const r = await svc.calculate(null, null, 3);

    expect(r.status).toBe('NO_RATE_FOUND');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('uses the task due date to select the rate when rateMatching is "due"', async () => {
    const { prisma, findFirst } = makePrisma({ rateId: 7n, currency: 'USD', hourlyRateCents: 10000n });
    const svc = new CostCalculatorService(prisma, makeSettings({ rateMatching: 'due' }));
    await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2, undefined, { dueDate: new Date('2024-03-01T12:00:00.000Z') });
    const where = findFirst.mock.calls[0][0].where;
    expect(where.validFrom.lte.toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });

  it('falls back to startTime for rate selection when rateMatching is "due" but dueDate is null', async () => {
    const { prisma, findFirst } = makePrisma({ rateId: 7n, currency: 'USD', hourlyRateCents: 10000n });
    const svc = new CostCalculatorService(prisma, makeSettings({ rateMatching: 'due' }));
    await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2, undefined, { dueDate: null });
    const where = findFirst.mock.calls[0][0].where;
    expect(where.validFrom.lte.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });

  it('returns COST_EXCLUDED with zero cost when the assignee is excluded', async () => {
    const { prisma, findFirst } = makePrisma({ rateId: 7n, currency: 'USD', hourlyRateCents: 15000n });
    const svc = new CostCalculatorService(prisma, makeSettings({}, ['user-1']));

    const r = await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2);

    expect(r.status).toBe('COST_EXCLUDED');
    expect(r.costCents).toBe(0n);
    expect(r.rateId).toBeNull();
    expect(findFirst).not.toHaveBeenCalled(); // short-circuits before the rate lookup
  });
});

describe('non-chargeable work', () => {
  const RATE = { rateId: 7n, currency: 'USD', hourlyRateCents: 6500n };
  const WHEN = new Date('2026-03-02T09:00:00.000Z');

  it('costs zero but keeps the resolved rate, so notional cost stays recoverable', async () => {
    const { prisma } = makePrisma(RATE);
    const svc = new CostCalculatorService(prisma, makeSettings());

    const res = await svc.calculate('u1', WHEN, 2, undefined, { chargeable: false });

    expect(res.costCents).toBe(0n);
    expect(res.status).toBe('NOT_CHARGEABLE');
    expect(res.rateId).toBe(7n);
    expect(res.hourlyRateCents).toBe(6500n);
  });

  it('reports NOT_CHARGEABLE rather than NO_RATE_FOUND when no rate exists', async () => {
    const { prisma } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings());

    const res = await svc.calculate('u1', WHEN, 2, undefined, { chargeable: false });

    expect(res.status).toBe('NOT_CHARGEABLE');
    expect(res.costCents).toBe(0n);
  });

  it('lets an excluded assignee win over chargeability', async () => {
    const { prisma } = makePrisma(RATE);
    const svc = new CostCalculatorService(prisma, makeSettings({}, ['u1']));

    const res = await svc.calculate('u1', WHEN, 2, undefined, { chargeable: false });

    expect(res.status).toBe('COST_EXCLUDED');
  });

  it('costs chargeable work normally', async () => {
    const { prisma } = makePrisma(RATE);
    const svc = new CostCalculatorService(prisma, makeSettings());

    const res = await svc.calculate('u1', WHEN, 2, undefined, { chargeable: true });

    expect(res.costCents).toBe(13000n);
    expect(res.status).toBe('COST_CALCULATED');
  });
});

describe('isChargeable in the returned cost', () => {
  it('is true by default so a caller that passes no opts writes the column default', async () => {
    const { prisma } = makePrisma({ rateId: 1n, currency: 'USD', hourlyRateCents: 10000n });
    const res = await new CostCalculatorService(prisma, makeSettings()).calculate('u1', new Date('2026-01-05'), 2);
    expect(res.isChargeable).toBe(true);
    expect(res.status).toBe('COST_CALCULATED');
  });

  it('is false when the resolved answer is non-chargeable', async () => {
    const { prisma } = makePrisma({ rateId: 1n, currency: 'USD', hourlyRateCents: 10000n });
    const res = await new CostCalculatorService(prisma, makeSettings())
      .calculate('u1', new Date('2026-01-05'), 2, undefined, { chargeable: false });
    expect(res).toMatchObject({ isChargeable: false, costCents: 0n, status: 'NOT_CHARGEABLE' });
  });

  // Costing exclusion and billability are orthogonal: an excluded assignee's
  // time on a non-chargeable task is BOTH excluded and non-chargeable. Forcing
  // one of them would make the calculator disagree with the migration's
  // backfill, which reads the task flag for every row.
  it('still reports chargeability for a globally excluded assignee', async () => {
    const { prisma } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings({}, ['u1']));

    const excludedOnChargeableTask = await svc.calculate('u1', new Date('2026-01-05'), 2);
    expect(excludedOnChargeableTask).toMatchObject({ status: 'COST_EXCLUDED', isChargeable: true });

    const excludedOnNonChargeableTask = await svc.calculate('u1', new Date('2026-01-05'), 2, undefined, { chargeable: false });
    expect(excludedOnNonChargeableTask).toMatchObject({ status: 'COST_EXCLUDED', isChargeable: false });
  });

  it('reports chargeability even when there is no user or start time', async () => {
    const { prisma } = makePrisma(null);
    const res = await new CostCalculatorService(prisma, makeSettings())
      .calculate(null, null, 2, undefined, { chargeable: false });
    expect(res).toMatchObject({ status: 'NO_RATE_FOUND', isChargeable: false });
  });
});

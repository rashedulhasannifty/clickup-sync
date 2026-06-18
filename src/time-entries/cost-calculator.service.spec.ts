import { CostCalculatorService } from './cost-calculator.service';

function makePrisma(rate: unknown) {
  const findFirst = jest.fn().mockResolvedValue(rate);
  return { prisma: { assigneeRate: { findFirst } } as any, findFirst };
}

function makeSettings(
  cost: Partial<{ autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due'; nonBillableZero: boolean }> = {},
  excludedIds: string[] = [],
) {
  return {
    getPreferences: () => ({ cost: { autoRecalcOnRateChange: true, rateMatching: 'start', nonBillableZero: false, excludedAssignees: [], ...cost } }),
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

  it('returns zero cost (not NO_RATE_FOUND) for a non-billable entry when nonBillableZero is on', async () => {
    const { prisma, findFirst } = makePrisma({ rateId: 7n, currency: 'USD', hourlyRateCents: 15000n });
    const svc = new CostCalculatorService(prisma, makeSettings({ nonBillableZero: true }));
    const r = await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2, undefined, { billable: false });
    expect(r.status).toBe('COST_CALCULATED');
    expect(r.costCents).toBe(0n);
    expect(r.rateId).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('still costs a billable entry normally when nonBillableZero is on', async () => {
    const { prisma } = makePrisma({ rateId: 7n, currency: 'USD', hourlyRateCents: 10000n });
    const svc = new CostCalculatorService(prisma, makeSettings({ nonBillableZero: true }));
    const r = await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2, undefined, { billable: true });
    expect(r.status).toBe('COST_CALCULATED');
    expect(r.costCents).toBe(20000n);
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

  it('exclusion wins over nonBillableZero and over an existing rate', async () => {
    const { prisma } = makePrisma({ rateId: 7n, currency: 'USD', hourlyRateCents: 15000n });
    const svc = new CostCalculatorService(prisma, makeSettings({ nonBillableZero: true }, ['user-1']));

    const r = await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2, undefined, { billable: true });

    expect(r.status).toBe('COST_EXCLUDED');
    expect(r.costCents).toBe(0n);
  });
});

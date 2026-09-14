import {
  foldEntryGroups, inRangeBecause, parseWorkSort, rowChargeable, sortRows, sumTotals,
  type EntryBucket, type EntryGroupRow, type ResolvedRow,
} from './work.assemble';

const g = (over: Partial<EntryGroupRow>): EntryGroupRow => ({
  taskId: 't1', userId: 'u1', userName: 'Rashedul', status: 'COST_CALCULATED', currency: 'USD',
  isChargeable: true, count: 1, hours: 1, costCents: 5000, lastStart: new Date('2026-09-10T10:00:00Z'),
  ...over,
});

const bucket = (over: Partial<EntryBucket>): EntryBucket => ({
  entryCount: 1, hours: 1, chargeableHours: 1, nonChargeableCount: 0, costCents: 0,
  missingRateCount: 0, excludedCount: 0, lastActivity: null, currency: 'USD', loggers: new Map(),
  ...over,
});

describe('foldEntryGroups', () => {
  it('sums per task, keeps missing-rate cost out of the total, counts excluded', () => {
    const m = foldEntryGroups([
      g({ hours: 2, costCents: 10000 }),
      g({ userId: 'u2', userName: 'Sayem', hours: 1.5, isChargeable: false, costCents: 0, status: 'NOT_CHARGEABLE' }),
      g({ userId: 'u3', status: 'NO_RATE_FOUND', hours: 3, costCents: 999 }),
      g({ userId: 'u4', status: 'COST_EXCLUDED', hours: 1, costCents: 0 }),
    ], '__none__');
    const b = m.get('t1')!;
    expect(b.entryCount).toBe(4);
    expect(b.hours).toBe(7.5);
    expect(b.chargeableHours).toBe(6);
    expect(b.nonChargeableCount).toBe(1);
    expect(b.costCents).toBe(10000);
    expect(b.missingRateCount).toBe(1);
    expect(b.excludedCount).toBe(1);
    expect([...b.loggers.keys()].sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('keys task-less entries under the sentinel', () => {
    const m = foldEntryGroups([g({ taskId: null })], '__none__');
    expect(m.has('__none__')).toBe(true);
  });

  it('keeps the latest start as lastActivity', () => {
    const m = foldEntryGroups([
      g({ lastStart: new Date('2026-09-02T00:00:00Z') }),
      g({ userId: 'u2', lastStart: new Date('2026-09-09T00:00:00Z') }),
    ], '__none__');
    expect(m.get('t1')!.lastActivity).toEqual(new Date('2026-09-09T00:00:00Z'));
  });
});

describe('rowChargeable', () => {
  it('entries source: all chargeable -> yes, none -> no, mixed -> partial', () => {
    expect(rowChargeable(bucket({ entryCount: 3, nonChargeableCount: 0 }), undefined)).toEqual({ chargeable: 'yes', source: 'entries' });
    expect(rowChargeable(bucket({ entryCount: 3, nonChargeableCount: 3 }), undefined)).toEqual({ chargeable: 'no', source: 'entries' });
    expect(rowChargeable(bucket({ entryCount: 3, nonChargeableCount: 1 }), undefined)).toEqual({ chargeable: 'partial', source: 'entries' });
  });

  it('task source follows the Tasks page: flag, disagreeing rule, overridden entries', () => {
    const t = { taskChargeable: true, rules: [] as boolean[], entryCount: 0, nonChargeableCount: 0 };
    expect(rowChargeable(undefined, t)).toEqual({ chargeable: 'yes', source: 'task' });
    expect(rowChargeable(undefined, { ...t, taskChargeable: false })).toEqual({ chargeable: 'no', source: 'task' });
    expect(rowChargeable(undefined, { ...t, rules: [false] })).toEqual({ chargeable: 'partial', source: 'task' });
    // Every (out-of-range) entry overridden against the flag: partial, as on the Tasks page.
    expect(rowChargeable(undefined, { ...t, entryCount: 2, nonChargeableCount: 2 })).toEqual({ chargeable: 'partial', source: 'task' });
  });

  it('refuses to guess when a no-entry row has no task inputs', () => {
    expect(() => rowChargeable(undefined, undefined)).toThrow(/task inputs required/);
  });
});

describe('inRangeBecause', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-14T23:59:59Z');
  const c = { taskId: 't1', taskName: 'x', updatedDate: new Date('2026-09-05T00:00:00Z'), isDeleted: false, isChargeable: true };
  it('updated / logged / both', () => {
    expect(inRangeBecause(c, undefined, from, to)).toBe('updated');
    expect(inRangeBecause({ ...c, updatedDate: new Date('2026-08-01T00:00:00Z') }, bucket({}), from, to)).toBe('logged');
    expect(inRangeBecause(c, bucket({}), from, to)).toBe('both');
  });
  it('a deleted task never counts as updated', () => {
    expect(inRangeBecause({ ...c, isDeleted: true }, bucket({}), from, to)).toBe('logged');
  });
});

describe('sortRows / parseWorkSort / sumTotals', () => {
  const row = (taskId: string, hours: number, name: string): ResolvedRow => ({
    taskId, taskName: name, updatedDate: null, isDeleted: false, isChargeable: true,
    bucket: hours ? bucket({ hours, entryCount: 1, costCents: hours * 100, chargeableHours: hours }) : undefined,
    inRangeBecause: hours ? 'logged' : 'updated',
  });

  it('logged desc with a stable taskId tie-break', () => {
    const out = sortRows([row('b', 2, 'B'), row('a', 2, 'A'), row('c', 5, 'C'), row('d', 0, 'D')], 'logged', 'desc');
    expect(out.map((r) => r.taskId)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('name asc is case-insensitive', () => {
    const out = sortRows([row('1', 1, 'beta'), row('2', 1, 'Alpha')], 'name', 'asc');
    expect(out.map((r) => r.taskName)).toEqual(['Alpha', 'beta']);
  });

  it('unknown sort falls back to logged', () => {
    expect(parseWorkSort('bogus')).toBe('logged');
    expect(parseWorkSort('cost')).toBe('cost');
  });

  it('totals sum every row given (no-entry rows count as tasks with 0h)', () => {
    const t = sumTotals([row('a', 2, 'A'), row('b', 0, 'B'), row('c', 3, 'C')]);
    expect(t).toEqual({ tasks: 3, entries: 2, hours: 5, chargeableHours: 5, costCents: 500, missingRateCount: 0 });
  });
});

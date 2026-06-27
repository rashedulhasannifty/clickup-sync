import {
  assembleTimesheet,
  dhakaDate,
  eachDate,
  type TimesheetAggRow,
} from './timesheet.assemble';

describe('dhakaDate', () => {
  it('buckets a late-UTC instant into the next Dhaka calendar day', () => {
    // 2026-06-22T20:00:00Z is 2026-06-23 02:00 in Dhaka (UTC+6).
    expect(dhakaDate(new Date('2026-06-22T20:00:00Z'))).toBe('2026-06-23');
  });
  it('keeps a midday-UTC instant on the same Dhaka day', () => {
    expect(dhakaDate(new Date('2026-06-22T06:00:00Z'))).toBe('2026-06-22');
  });
});

describe('eachDate', () => {
  it('returns an inclusive ascending range', () => {
    expect(eachDate('2026-06-22', '2026-06-25')).toEqual([
      '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25',
    ]);
  });
  it('returns a single day when from === to', () => {
    expect(eachDate('2026-06-22', '2026-06-22')).toEqual(['2026-06-22']);
  });
});

describe('assembleTimesheet', () => {
  // Range: Mon 2026-06-22 .. Sun 2026-06-28.
  // Entries on Mon (two tasks), Fri (one task), Sat (one task). Sun empty.
  const rows: TimesheetAggRow[] = [
    { day: '2026-06-22', taskId: 'A', taskName: 'Alpha', hours: 2,   validCostCents: 8000,  entryCount: 1, missingRateCount: 0 },
    { day: '2026-06-22', taskId: 'B', taskName: 'Beta',  hours: 1.5, validCostCents: 0,     entryCount: 1, missingRateCount: 1 },
    { day: '2026-06-26', taskId: 'A', taskName: 'Alpha', hours: 3,   validCostCents: 12000, entryCount: 1, missingRateCount: 0 },
    { day: '2026-06-27', taskId: 'C', taskName: 'Gamma', hours: 4,   validCostCents: 16000, entryCount: 1, missingRateCount: 0 },
  ];
  const ts = assembleTimesheet(rows, '2026-06-22', '2026-06-28');

  it('includes every weekday in range, zero-filled, plus the worked Saturday', () => {
    const dates = ts.days.map((d) => d.date);
    // Mon..Fri (22-26) always present; Sat 27 present because it has entries;
    // Sun 28 absent (empty weekend).
    expect(dates).toEqual([
      '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27',
    ]);
  });

  it('marks weekends and zero-fills empty weekdays', () => {
    const tue = ts.days.find((d) => d.date === '2026-06-23')!;
    expect(tue.weekday).toBe('Tue');
    expect(tue.isWeekend).toBe(false);
    expect(tue.tasks).toEqual([]);
    expect(tue.subtotalHours).toBe(0);
    const sat = ts.days.find((d) => d.date === '2026-06-27')!;
    expect(sat.isWeekend).toBe(true);
  });

  it('sums per-task hours and cost and orders tasks by name', () => {
    const mon = ts.days.find((d) => d.date === '2026-06-22')!;
    expect(mon.tasks.map((t) => t.taskId)).toEqual(['A', 'B']);
    expect(mon.tasks[0]).toMatchObject({ taskId: 'A', hours: 2, costAud: 80 });
    expect(mon.subtotalHours).toBe(3.5);
  });

  it('renders cost as null (not $0) when a task has only missing-rate entries', () => {
    const mon = ts.days.find((d) => d.date === '2026-06-22')!;
    const beta = mon.tasks.find((t) => t.taskId === 'B')!;
    expect(beta.costAud).toBeNull();
    expect(beta.missingRateCount).toBe(1);
    // Day still has a valid-cost task (Alpha), so the day subtotal is a number.
    expect(mon.subtotalCostAud).toBe(80);
    expect(mon.missingRateCount).toBe(1);
  });

  it('computes grand totals across worked days', () => {
    expect(ts.totalHours).toBe(10.5);   // 2 + 1.5 + 3 + 4
    expect(ts.totalCostAud).toBe(360);  // 80 + 0(valid for Beta) + 120 + 160
    expect(ts.missingRateCount).toBe(1);
  });
});

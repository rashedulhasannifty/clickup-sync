import {
  dhakaTodayParts,
  monthBounds,
  countBusinessDays,
  forecastRunRate,
  forecastTrailing,
  deriveBudgetStatus,
} from '../src/budgets/budget-forecast';

describe('budget-forecast helpers', () => {
  describe('dhakaTodayParts', () => {
    it('rolls a late-UTC instant into the next Dhaka day', () => {
      // 2026-06-14T20:00:00Z = 2026-06-15T02:00 Dhaka
      expect(dhakaTodayParts(new Date('2026-06-14T20:00:00Z'))).toEqual({ year: 2026, month0: 5, day: 15 });
    });
    it('rolls across a year boundary', () => {
      // 2026-12-31T20:00:00Z = 2027-01-01T02:00 Dhaka
      expect(dhakaTodayParts(new Date('2026-12-31T20:00:00Z'))).toEqual({ year: 2027, month0: 0, day: 1 });
    });
  });

  describe('monthBounds', () => {
    it('returns first and last day of the month', () => {
      const b = monthBounds(2026, 1); // Feb 2026 (month0=1)
      expect(b.start).toBe('2026-02-01');
      expect(b.end).toBe('2026-02-28');
      expect(b.daysInMonth).toBe(28);
    });
    it('handles leap year February', () => {
      const b = monthBounds(2024, 1); // Feb 2024, leap year
      expect(b.daysInMonth).toBe(29);
      expect(b.end).toBe('2024-02-29');
    });
  });

  describe('countBusinessDays', () => {
    it('counts Mon-Fri inclusive', () => {
      // 2026-06-01 is a Monday; 2026-06-05 Friday => 5 business days
      expect(countBusinessDays('2026-06-01', '2026-06-05')).toBe(5);
      // include the weekend 06-06 (Sat), 06-07 (Sun) => still 5
      expect(countBusinessDays('2026-06-01', '2026-06-07')).toBe(5);
    });
    it('returns 0 when end is before start', () => {
      expect(countBusinessDays('2026-06-05', '2026-06-01')).toBe(0);
    });
    it('counts business days across a full month', () => {
      // June 2026: 22 weekdays
      expect(countBusinessDays('2026-06-01', '2026-06-30')).toBe(22);
    });
  });

  describe('forecastRunRate', () => {
    it('projects current pace to month end', () => {
      // 4000 cents over 10 business days elapsed, 22 business days in month => 8800
      expect(forecastRunRate(4000, 10, 22)).toBe(8800);
    });
    it('guards divide-by-zero (no business days elapsed yet)', () => {
      expect(forecastRunRate(0, 0, 22)).toBe(0);
      expect(forecastRunRate(500, 0, 22)).toBe(500);
    });
  });

  describe('forecastTrailing', () => {
    it('adds 7-day avg daily spend over remaining calendar days', () => {
      // last7 total 7000 => avg 1000/day; 5 remaining days => 5000 + mtd 3000 = 8000
      expect(forecastTrailing(3000, 7000, 5)).toBe(8000);
    });
    it('equals MTD when no remaining days (past/last day)', () => {
      expect(forecastTrailing(3000, 7000, 0)).toBe(3000);
    });
  });

  describe('deriveBudgetStatus', () => {
    const budget = 10000;
    it('over when actual >= budget', () => {
      expect(deriveBudgetStatus(10000, 12000, budget)).toBe('over');
    });
    it('projected-over when forecast >= budget but actual < budget', () => {
      expect(deriveBudgetStatus(5000, 11000, budget)).toBe('projected-over');
    });
    it('near when forecast >= 85% and not over', () => {
      expect(deriveBudgetStatus(5000, 8600, budget)).toBe('near');
    });
    it('under otherwise', () => {
      expect(deriveBudgetStatus(2000, 4000, budget)).toBe('under');
    });
    it('no-budget when budget is null/zero', () => {
      expect(deriveBudgetStatus(2000, 4000, null)).toBe('no-budget');
      expect(deriveBudgetStatus(2000, 4000, 0)).toBe('no-budget');
    });
    it('treats the 85% and 100% thresholds as inclusive (>=)', () => {
      expect(deriveBudgetStatus(5000, 8500, 10000)).toBe('near');        // exactly 85%
      expect(deriveBudgetStatus(5000, 8499, 10000)).toBe('under');       // just under 85%
      expect(deriveBudgetStatus(5000, 10000, 10000)).toBe('projected-over'); // forecast == budget
    });
  });
});

/**
 * Pure, framework-free budget math. Dhaka is a fixed UTC+6 offset (no DST),
 * so every "Dhaka day" is computed by shifting the instant +6h and reading the
 * UTC calendar parts. Keeping this dependency-free makes the forecast/boundary
 * logic unit-testable without a DB. Mirrored on the frontend in
 * apps/web/src/lib/budget-status.ts — keep the thresholds in sync.
 */

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export interface DateParts { year: number; month0: number; day: number }

/** Calendar parts of `now` in Dhaka local time. */
export function dhakaTodayParts(now: Date): DateParts {
  const d = new Date(now.getTime() + DHAKA_OFFSET_MS);
  return { year: d.getUTCFullYear(), month0: d.getUTCMonth(), day: d.getUTCDate() };
}

function iso(year: number, month0: number, day: number): string {
  const mm = String(month0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export interface MonthBounds { start: string; end: string; daysInMonth: number }

/** First/last YYYY-MM-DD of the given month (month0 = 0..11). */
export function monthBounds(year: number, month0: number): MonthBounds {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return { start: iso(year, month0, 1), end: iso(year, month0, daysInMonth), daysInMonth };
}

/** Inclusive Mon–Fri count between two YYYY-MM-DD strings. 0 if end < start. */
export function countBusinessDays(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  if (end.getTime() < start.getTime()) return 0;
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    const dow = new Date(t).getUTCDay(); // 0=Sun..6=Sat
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

/** mtd / elapsed * total. Guards elapsed==0 by returning mtd (no projection yet). */
export function forecastRunRate(mtdCents: number, businessDaysElapsed: number, businessDaysInMonth: number): number {
  if (businessDaysElapsed <= 0) return Math.round(mtdCents);
  return Math.round((mtdCents / businessDaysElapsed) * businessDaysInMonth);
}

/** mtd + (last7Total/7) * remainingCalendarDays. */
export function forecastTrailing(mtdCents: number, last7TotalCents: number, remainingCalendarDays: number): number {
  if (remainingCalendarDays <= 0) return Math.round(mtdCents);
  return Math.round(mtdCents + (last7TotalCents / 7) * remainingCalendarDays);
}

export type BudgetStatus = 'over' | 'projected-over' | 'near' | 'under' | 'no-budget';

export const NEAR_THRESHOLD = 0.85;

/** Status from actual + forecast vs budget. budget null/0 => no-budget. */
export function deriveBudgetStatus(actualCents: number, forecastCents: number, budgetCents: number | null): BudgetStatus {
  if (!budgetCents || budgetCents <= 0) return 'no-budget';
  if (actualCents >= budgetCents) return 'over';
  if (forecastCents >= budgetCents) return 'projected-over';
  if (forecastCents >= budgetCents * NEAR_THRESHOLD) return 'near';
  return 'under';
}

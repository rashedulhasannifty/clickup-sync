import {
  DHAKA_OFFSET_MS,
  dhakaTodayParts,
  type DateParts,
} from '../budgets/budget-forecast';

/**
 * Pure Dhaka-calendar helpers for the People module. Dates are `YYYY-MM-DD`
 * strings (lexicographic order == chronological order); instants are `Date`s.
 * Dhaka is a fixed UTC+6 (no DST). `dhakaTodayParts` / `countBusinessDays` /
 * `monthBounds` come from budget-forecast and are reused, not re-implemented.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatParts(p: DateParts): string {
  return `${p.year}-${String(p.month0 + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The Dhaka calendar date of an instant. */
export function dhakaDateOf(instant: Date): string {
  return formatParts(dhakaTodayParts(instant));
}

/** Minutes since local midnight in Dhaka (fractional: seconds count). */
export function dhakaMinutesOfDay(instant: Date): number {
  const msOfDay =
    (((instant.getTime() + DHAKA_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return msOfDay / 60_000;
}

/** The instant at `minutes` past local midnight on the Dhaka date `iso`. */
export function dhakaInstant(iso: string, minutes: number): Date {
  return new Date(
    Date.parse(`${iso}T00:00:00.000Z`) - DHAKA_OFFSET_MS + minutes * 60_000,
  );
}

/** `@db.Date` columns come back as UTC-midnight Dates; this reads the stored calendar date. */
export function dateColumnToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inverse of `dateColumnToIso`, for writes to `@db.Date` columns. */
export function isoToDateColumn(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Whole calendar days from `a` to `b` (negative when b < a). */
export function diffDays(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) /
      DAY_MS,
  );
}

export function isBusinessDay(iso: string): boolean {
  const dow = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** Every Mon-Fri date in [from, to], oldest first. Empty when to < from. */
export function businessDaysIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1))
    if (isBusinessDay(d)) out.push(d);
  return out;
}

/** Office holidays: Dhaka date → name. Only Mon-Fri dates change anything. */
export type Holidays = ReadonlyMap<string, string>;

export const NO_HOLIDAYS: Holidays = new Map();

/** A day the office expects people in: Mon-Fri and not a holiday. */
export function isWorkingDay(iso: string, holidays: Holidays): boolean {
  return isBusinessDay(iso) && !holidays.has(iso);
}

/** Every working day in [from, to], oldest first. Empty when to < from. */
export function workingDaysIn(
  from: string,
  to: string,
  holidays: Holidays,
): string[] {
  return businessDaysIn(from, to).filter((d) => !holidays.has(d));
}

export function countWorkingDays(
  from: string,
  to: string,
  holidays: Holidays,
): number {
  return workingDaysIn(from, to, holidays).length;
}

export interface DateRange {
  from: string;
  to: string;
}

/** Intersection of two inclusive ranges, or null when they do not overlap. */
export function intersect(a: DateRange, b: DateRange): DateRange | null {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return from <= to ? { from, to } : null;
}

/** `YYYY-MM` of a date string. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The `n` calendar months ending with the month of `todayIso`, oldest first, as { year, month0 }. */
export function lastMonths(
  todayIso: string,
  n: number,
): { year: number; month0: number }[] {
  const year = Number(todayIso.slice(0, 4));
  const month0 = Number(todayIso.slice(5, 7)) - 1;
  const out: { year: number; month0: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = year * 12 + month0 - i;
    out.push({ year: Math.floor(idx / 12), month0: idx % 12 });
  }
  return out;
}

/** Whole months from `join` to `end` (a month counts once its day-of-month is reached). Never negative. */
export function tenureMonths(join: string, end: string): number {
  const jy = Number(join.slice(0, 4));
  const jm = Number(join.slice(5, 7));
  const jd = Number(join.slice(8, 10));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  const ed = Number(end.slice(8, 10));
  let months = (ey - jy) * 12 + (em - jm);
  if (ed < jd) months -= 1;
  return Math.max(0, months);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-03-26` → `26 Mar 2026`, for messages. */
export function formatDay(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

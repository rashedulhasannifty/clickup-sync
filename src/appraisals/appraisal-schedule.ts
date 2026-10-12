import { addDays } from '../people/people-dates';
import type { EmployeeStatusValue } from '../people/people.types';
import type { AppraisalTypeValue } from './appraisals.types';

/**
 * When appraisals fall due, counted from each employee's join date. Pure: no
 * I/O and no clock. Dates are `YYYY-MM-DD` strings.
 *
 * - CONFIRMATION: due 6 months after joining; reviews join date -> the day
 *   before the due date.
 * - HALF_YEARLY: due every 6 months after joining, starting at 12 months (the
 *   6-month mark is the confirmation).
 * - YEARLY: due on every join anniversary.
 *
 * Every milestone is `join + n months` computed from the join date, never by
 * chaining from the previous (possibly clamped) milestone: joined 29 Feb 2024
 * -> 28 Feb 2025, 28 Feb 2026, 28 Feb 2027, 29 Feb 2028. A review period runs
 * from the previous milestone (also computed from the join date; the join date
 * itself for the first one) to the day before the due date, so consecutive
 * periods neither overlap nor leave a gap even when the day clamps.
 */

/** `iso` plus `n` calendar months, the day clamped to the target month's length (31 Aug + 6 -> 28/29 Feb). */
export function addMonthsClamped(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4));
  const m0 = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const idx = y * 12 + m0 + n;
  const ny = Math.floor(idx / 12);
  const nm0 = idx - ny * 12;
  const lastDay = new Date(Date.UTC(ny, nm0 + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(ny).padStart(4, '0')}-${String(nm0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Months between milestones of a type. */
const STEP: Record<AppraisalTypeValue, number> = {
  CONFIRMATION: 6,
  HALF_YEARLY: 6,
  YEARLY: 12,
};
/** The first milestone index `k` (due at `k x STEP` months): half-yearly starts at 12 months. */
const FIRST_K: Record<AppraisalTypeValue, number> = {
  CONFIRMATION: 1,
  HALF_YEARLY: 2,
  YEARLY: 1,
};
/** Confirmation happens once. */
const LAST_K: Record<AppraisalTypeValue, number> = {
  CONFIRMATION: 1,
  HALF_YEARLY: Number.POSITIVE_INFINITY,
  YEARLY: Number.POSITIVE_INFINITY,
};

const milestoneAt = (join: string, type: AppraisalTypeValue, k: number) =>
  addMonthsClamped(join, k * STEP[type]);

/** The milestone index to start scanning from so that the result is on or after `from`. */
function startK(join: string, type: AppraisalTypeValue, from: string): number {
  const first = FIRST_K[type];
  if (from <= join) return first;
  const months =
    (Number(from.slice(0, 4)) - Number(join.slice(0, 4))) * 12 +
    (Number(from.slice(5, 7)) - Number(join.slice(5, 7)));
  // One step early: clamping can pull a milestone back into the window.
  return Math.max(first, Math.floor(months / STEP[type]) - 1);
}

/** The due dates of `type` for someone who joined on `join`, within [from, to], oldest first. */
export function milestones(
  join: string,
  type: AppraisalTypeValue,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  if (to < from) return out;
  for (let k = startK(join, type, from); k <= LAST_K[type]; k++) {
    const due = milestoneAt(join, type, k);
    if (due > to) break;
    if (due >= from) out.push(due);
  }
  return out;
}

export interface ReviewPeriod {
  periodStart: string;
  periodEnd: string;
}

/**
 * The period an appraisal due on `dueDate` reviews: from the previous
 * milestone (the join date for the first one) to the day before `dueDate`.
 * A date that is not one of this type's milestones (hand-picked) reviews the
 * `STEP` months before it. Never starts before the join date.
 */
export function reviewPeriod(
  join: string,
  type: AppraisalTypeValue,
  dueDate: string,
): ReviewPeriod {
  let start: string | null = null;
  for (let k = FIRST_K[type]; k <= LAST_K[type]; k++) {
    const due = milestoneAt(join, type, k);
    if (due > dueDate) break;
    if (due === dueDate) {
      start = addMonthsClamped(join, (k - 1) * STEP[type]);
      break;
    }
  }
  start ??= addMonthsClamped(dueDate, -STEP[type]);
  if (start < join) start = join;
  return { periodStart: start, periodEnd: addDays(dueDate, -1) };
}

/** The latest due date of `type` on or before `date`, or null when none has come yet. */
export function latestMilestoneOnOrBefore(
  join: string,
  type: AppraisalTypeValue,
  date: string,
): string | null {
  const all = milestones(join, type, join, date);
  return all.length > 0 ? all[all.length - 1] : null;
}

export interface DueAppraisal extends ReviewPeriod {
  type: AppraisalTypeValue;
  dueDate: string;
}

/** The latest milestone of `type` in [from, to] with its review period, or null when none falls in it. */
export function dueInWindow(
  join: string,
  type: AppraisalTypeValue,
  from: string,
  to: string,
): DueAppraisal | null {
  const all = milestones(join, type, from, to);
  if (all.length === 0) return null;
  const dueDate = all[all.length - 1];
  return { type, dueDate, ...reviewPeriod(join, type, dueDate) };
}

/** The appraisal of `type` due on or before `date` (latest), with its review period; null when none yet. */
export function dueOnOrBefore(
  join: string,
  type: AppraisalTypeValue,
  date: string,
): DueAppraisal | null {
  const dueDate = latestMilestoneOnOrBefore(join, type, date);
  return dueDate
    ? { type, dueDate, ...reviewPeriod(join, type, dueDate) }
    : null;
}

export interface ScheduleEmployee {
  joinDate: string;
  status: EmployeeStatusValue;
}

/**
 * Whether an employee is in scope for a `type` cycle at all: never once
 * exited, and a confirmation only while still on probation.
 */
export function inScope(
  e: Pick<ScheduleEmployee, 'status'>,
  type: AppraisalTypeValue,
): boolean {
  if (e.status === 'EXITED') return false;
  return type !== 'CONFIRMATION' || e.status === 'PROBATION';
}

/**
 * The employees due a `type` appraisal in [from, to], each with the latest
 * such milestone in the window. Shared by the due preview and the default
 * JOIN_DATE launch, so the two can never disagree. Order is preserved.
 */
export function dueBetween<T extends ScheduleEmployee>(
  employees: T[],
  type: AppraisalTypeValue,
  from: string,
  to: string,
): { employee: T; due: DueAppraisal }[] {
  const out: { employee: T; due: DueAppraisal }[] = [];
  for (const employee of employees) {
    if (!inScope(employee, type)) continue;
    const due = dueInWindow(employee.joinDate, type, from, to);
    if (due) out.push({ employee, due });
  }
  return out;
}

export interface NextAppraisal extends DueAppraisal {
  /** The due date is before `today` (only a probation employee's confirmation can be). */
  overdue: boolean;
}

/**
 * What an employee is due next, earliest first.
 *
 * - EXITED: nothing.
 * - PROBATION: the confirmation, even once its date has passed (flagged
 *   `overdue`): it is still owed and does not roll forward.
 * - Anyone else: the next half-yearly and the next yearly on or after
 *   `today`. They coincide on join anniversaries (12, 24, ... months); the
 *   yearly is listed first then, because on an anniversary it is the yearly
 *   review that falls due.
 */
export function nextDue(
  joinDate: string,
  status: EmployeeStatusValue,
  today: string,
): NextAppraisal[] {
  if (status === 'EXITED') return [];
  if (status === 'PROBATION') {
    const dueDate = milestoneAt(joinDate, 'CONFIRMATION', 1);
    return [
      {
        type: 'CONFIRMATION',
        dueDate,
        ...reviewPeriod(joinDate, 'CONFIRMATION', dueDate),
        overdue: dueDate < today,
      },
    ];
  }
  const out: NextAppraisal[] = [];
  // Far enough ahead to always hold the next yearly milestone (a future join date included).
  const horizon = addMonthsClamped(joinDate > today ? joinDate : today, 13);
  for (const type of ['YEARLY', 'HALF_YEARLY'] as const) {
    const [dueDate] = milestones(joinDate, type, today, horizon);
    if (dueDate)
      out.push({
        type,
        dueDate,
        ...reviewPeriod(joinDate, type, dueDate),
        overdue: false,
      });
  }
  // Stable: on a tie YEARLY (pushed first) stays first.
  return out.sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0,
  );
}

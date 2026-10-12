import { addDays, diffDays } from '../people/people-dates';
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

// --- Overdue, upcoming and "already appraised" (0033) ----------------------

/** How far after a due window "coming up" looks: due within this many days after the window end. */
export const UPCOMING_DAYS = 60;
/**
 * Half-yearly and yearly reviews count as overdue only for due dates within
 * this many months before today. People confirmed in bulk before overdue
 * tracking existed would otherwise all show as years overdue.
 */
export const OVERDUE_LOOKBACK_MONTHS = 12;

/** An appraisal the employee already has (any cycle, any status), as the schedule sees it. */
export interface AppraisalOnRecord {
  type: AppraisalTypeValue;
  /** Join-date appraisals: the due date (possibly adjusted by hand). Null for calendar cycles. */
  dueDate: string | null;
  /** The end of the period it reviews (its own, else its cycle's). */
  periodEnd: string;
}

/** The milestone of `type` nearest `date` (a tie goes to the earlier one), or null when `type` has none near it. */
export function nearestMilestone(
  join: string,
  type: AppraisalTypeValue,
  date: string,
): string | null {
  const span = STEP[type];
  const near = milestones(
    join,
    type,
    addMonthsClamped(date, -span),
    addMonthsClamped(date, span),
  );
  let best: string | null = null;
  for (const m of near) {
    if (
      best === null ||
      Math.abs(diffDays(m, date)) < Math.abs(diffDays(best, date))
    )
      best = m;
  }
  return best;
}

const coverKey = (type: AppraisalTypeValue, date: string) => `${type}|${date}`;

/**
 * The milestones an employee's existing appraisals stand for, as
 * `TYPE|YYYY-MM-DD` keys. An appraisal covers the milestone of its type
 * nearest its due date, so one whose due date was adjusted by a few days (or
 * hand-picked) still counts for the milestone it was launched for. On a join
 * anniversary the half-yearly and yearly milestones coincide: an appraisal of
 * either type covers both, so nobody is appraised twice for the same date.
 */
export function coveredMilestones(
  join: string,
  records: readonly AppraisalOnRecord[],
): Set<string> {
  const out = new Set<string>();
  for (const r of records) {
    if (!r.dueDate) continue;
    out.add(coverKey(r.type, r.dueDate));
    const m = nearestMilestone(join, r.type, r.dueDate);
    if (!m) continue;
    out.add(coverKey(r.type, m));
    if (r.type === 'YEARLY') out.add(coverKey('HALF_YEARLY', m));
    if (r.type === 'HALF_YEARLY' && milestones(join, 'YEARLY', m, m).length > 0)
      out.add(coverKey('YEARLY', m));
  }
  return out;
}

/** Whether the `type` milestone on `date` already has an appraisal. */
export function isCovered(
  covered: ReadonlySet<string>,
  type: AppraisalTypeValue,
  date: string,
): boolean {
  return covered.has(coverKey(type, date));
}

/**
 * The date the employee's latest appraisal of `type` stands for: its covered
 * milestone (or due date), or for a calendar-cycle appraisal the end of the
 * period it reviewed. Overdue only looks at due dates after it.
 */
export function lastAppraisedOn(
  join: string,
  type: AppraisalTypeValue,
  records: readonly AppraisalOnRecord[],
): string | null {
  let last: string | null = null;
  for (const r of records) {
    if (r.type !== type) continue;
    const at = r.dueDate
      ? [
          r.dueDate,
          nearestMilestone(join, type, r.dueDate) ?? r.dueDate,
        ].sort()[1]
      : r.periodEnd;
    if (last === null || at > last) last = at;
  }
  return last;
}

export interface OverdueEmployee extends ScheduleEmployee {
  /** `YYYY-MM-DD`, or null when never confirmed (or not recorded). */
  confirmationDate: string | null;
  appraisals: readonly AppraisalOnRecord[];
}

/**
 * The appraisal of `type` an employee missed before `before`, or null.
 *
 * - Only the latest milestone before `before` counts: if it is covered (or
 *   not after the last appraisal of the type), the employee is not overdue,
 *   even when an older one was missed; the latest stands in for them.
 * - CONFIRMATION: only while on PROBATION, however long ago (it is still owed).
 * - HALF_YEARLY / YEARLY: never while on PROBATION, never before the
 *   confirmation date, and only within `OVERDUE_LOOKBACK_MONTHS` before `today`.
 * - Never once EXITED.
 */
export function overdueFor(
  e: OverdueEmployee,
  type: AppraisalTypeValue,
  before: string,
  today: string,
): DueAppraisal | null {
  if (e.status === 'EXITED') return null;
  const all = milestones(e.joinDate, type, e.joinDate, addDays(before, -1));
  const latest = all[all.length - 1];
  if (!latest) return null;
  if (isCovered(coveredMilestones(e.joinDate, e.appraisals), type, latest))
    return null;
  const last = lastAppraisedOn(e.joinDate, type, e.appraisals);
  if (last !== null && latest <= last) return null;
  if (type === 'CONFIRMATION') {
    if (e.status !== 'PROBATION') return null;
  } else {
    if (e.status === 'PROBATION') return null;
    if (e.confirmationDate && latest < e.confirmationDate) return null;
    if (latest < addMonthsClamped(today, -OVERDUE_LOOKBACK_MONTHS)) return null;
  }
  return { type, dueDate: latest, ...reviewPeriod(e.joinDate, type, latest) };
}

/** How late (due before today) or early (due after today) an appraisal launched today is. */
export function lateness(
  dueDate: string,
  today: string,
): { daysLate: number | null; daysEarly: number | null } {
  const d = diffDays(dueDate, today);
  return d >= 0
    ? { daysLate: d, daysEarly: null }
    : { daysLate: null, daysEarly: -d };
}

export type DueGroup = 'due' | 'overdue' | 'upcoming';

export interface ClassifiedDue extends DueAppraisal {
  group: DueGroup;
  daysLate: number | null;
  daysEarly: number | null;
}

export interface DueWindow {
  from: string;
  to: string;
  /** Dhaka date; `daysLate`/`daysEarly` and the overdue lookback count from it. */
  today: string;
}

/**
 * Where one employee stands for a `type` cycle due in [from, to], or null
 * when they are none of these. At most one answer, in this priority:
 *
 * - `due`: the latest milestone in the window, unless already appraised.
 * - `overdue`: `overdueFor` with the window start as the cut-off.
 * - `upcoming`: the first milestone in (to, to + UPCOMING_DAYS], unless
 *   already appraised.
 *
 * Scope (exited, confirmation only on probation) is the caller's job.
 */
export function classifyDue(
  e: OverdueEmployee,
  type: AppraisalTypeValue,
  w: DueWindow,
): ClassifiedDue | null {
  const covered = coveredMilestones(e.joinDate, e.appraisals);
  const make = (group: DueGroup, dueDate: string): ClassifiedDue => ({
    group,
    type,
    dueDate,
    ...reviewPeriod(e.joinDate, type, dueDate),
    ...lateness(dueDate, w.today),
  });
  const inWindow = milestones(e.joinDate, type, w.from, w.to);
  const latest = inWindow[inWindow.length - 1];
  if (latest && !isCovered(covered, type, latest)) return make('due', latest);
  const missed = overdueFor(e, type, w.from, w.today);
  if (missed) return make('overdue', missed.dueDate);
  const [next] = milestones(
    e.joinDate,
    type,
    addDays(w.to, 1),
    addDays(w.to, UPCOMING_DAYS),
  );
  if (next && !isCovered(covered, type, next)) return make('upcoming', next);
  return null;
}

export interface DueGroups<T> {
  due: { employee: T; due: ClassifiedDue }[];
  overdue: { employee: T; due: ClassifiedDue }[];
  upcoming: { employee: T; due: ClassifiedDue }[];
}

/**
 * Everyone in scope for a `type` cycle due in the window, grouped. Shared by
 * the due preview and the default JOIN_DATE launch (which takes `due` and
 * `overdue`), so the two can never disagree. Order is preserved.
 */
export function selectDue<T extends OverdueEmployee>(
  employees: T[],
  type: AppraisalTypeValue,
  w: DueWindow,
): DueGroups<T> {
  const out: DueGroups<T> = { due: [], overdue: [], upcoming: [] };
  for (const employee of employees) {
    if (!inScope(employee, type)) continue;
    const due = classifyDue(employee, type, w);
    if (due) out[due.group].push({ employee, due });
  }
  return out;
}

/**
 * Everything an employee is overdue for as of `today`, oldest first: the
 * confirmation while on probation, else the half-yearly and the yearly. On a
 * join anniversary both regular types fall due the same day; only the yearly
 * is listed then.
 */
export function overdueAppraisals(
  e: OverdueEmployee,
  today: string,
): ClassifiedDue[] {
  if (e.status === 'EXITED') return [];
  const types: AppraisalTypeValue[] =
    e.status === 'PROBATION' ? ['CONFIRMATION'] : ['YEARLY', 'HALF_YEARLY'];
  const out: ClassifiedDue[] = [];
  for (const type of types) {
    const d = overdueFor(e, type, today, today);
    if (!d) continue;
    if (out.some((o) => o.dueDate === d.dueDate)) continue;
    out.push({ ...d, group: 'overdue', ...lateness(d.dueDate, today) });
  }
  return out.sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0,
  );
}

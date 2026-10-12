import { addDays, diffDays } from '../people/people-dates';
import type { EmployeeStatusValue } from '../people/people.types';
import type {
  AppraisalTypeValue,
  RegularAppraisalType,
} from './appraisals.types';

/**
 * When appraisals fall due. Pure: no I/O and no clock. Dates are `YYYY-MM-DD`
 * strings.
 *
 * The company lifecycle (0034): Intern -> Probation (6 months) ->
 * Confirmation -> a yearly appraisal every year. The regular types are
 * counted from the **anchor**: the probation start date, or the join date
 * when none is stored (everyone before 0034 was backfilled to it). An
 * intern's internship months are never part of a regular review.
 *
 * - CONFIRMATION: due 6 months after the anchor; reviews anchor -> the day
 *   before the due date.
 * - HALF_YEARLY: due every 6 months after the anchor, starting at 12 months
 *   (the 6-month mark is the confirmation).
 * - YEARLY: due on every anniversary of the anchor.
 * - INTERNSHIP: interns only, due on the expected internship end (join + 3
 *   months when not set); reviews the join date (or, after an extension, the
 *   previous end date) -> the day before the due date.
 *
 * Every regular milestone is `anchor + n months` computed from the anchor,
 * never by chaining from the previous (possibly clamped) milestone: anchored
 * 29 Feb 2024 -> 28 Feb 2025, 28 Feb 2026, 28 Feb 2027, 29 Feb 2028. A review
 * period runs from the previous milestone (also computed from the anchor; the
 * anchor itself for the first one) to the day before the due date, so
 * consecutive periods neither overlap nor leave a gap even when the day
 * clamps. In the functions below that take a date string, `join` is that
 * anchor.
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
const STEP: Record<RegularAppraisalType, number> = {
  CONFIRMATION: 6,
  HALF_YEARLY: 6,
  YEARLY: 12,
};
/** The first milestone index `k` (due at `k x STEP` months): half-yearly starts at 12 months. */
const FIRST_K: Record<RegularAppraisalType, number> = {
  CONFIRMATION: 1,
  HALF_YEARLY: 2,
  YEARLY: 1,
};
/** Confirmation happens once. */
const LAST_K: Record<RegularAppraisalType, number> = {
  CONFIRMATION: 1,
  HALF_YEARLY: Number.POSITIVE_INFINITY,
  YEARLY: Number.POSITIVE_INFINITY,
};

const milestoneAt = (join: string, type: RegularAppraisalType, k: number) =>
  addMonthsClamped(join, k * STEP[type]);

/** The milestone index to start scanning from so that the result is on or after `from`. */
function startK(
  join: string,
  type: RegularAppraisalType,
  from: string,
): number {
  const first = FIRST_K[type];
  if (from <= join) return first;
  const months =
    (Number(from.slice(0, 4)) - Number(join.slice(0, 4))) * 12 +
    (Number(from.slice(5, 7)) - Number(join.slice(5, 7)));
  // One step early: clamping can pull a milestone back into the window.
  return Math.max(first, Math.floor(months / STEP[type]) - 1);
}

/** The due dates of `type` for someone anchored on `join`, within [from, to], oldest first. */
export function milestones(
  join: string,
  type: RegularAppraisalType,
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
 * milestone (the anchor for the first one) to the day before `dueDate`.
 * A date that is not one of this type's milestones (hand-picked) reviews the
 * `STEP` months before it. Never starts before the anchor.
 */
export function reviewPeriod(
  join: string,
  type: RegularAppraisalType,
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
  type: RegularAppraisalType,
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
  type: RegularAppraisalType,
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
  type: RegularAppraisalType,
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
  /** The regular schedule's anchor. Null or absent = the join date. */
  probationStartDate?: string | null;
  /** INTERN: the expected internship end. Null or absent = join + 3 months. */
  internshipEndDate?: string | null;
  /**
   * INTERN, after an extension: the end date before the latest extension
   * (the latest INTERNSHIP_EXTENDED event's `fromValue`), where the current
   * internship term starts. Null or absent = no extension yet.
   */
  internshipTermStart?: string | null;
}

/** The regular schedule's anchor: the probation start date, else the join date. */
export const anchorOf = (
  e: Pick<ScheduleEmployee, 'joinDate' | 'probationStartDate'>,
): string => e.probationStartDate ?? e.joinDate;

// --- The internship review (0034) -------------------------------------------

/** An internship lasts this many months unless an end date is set. */
export const INTERNSHIP_DEFAULT_MONTHS = 3;

/** The internship end when none is set: join + 3 months (clamped, never minus a day). */
export const defaultInternshipEnd = (joinDate: string): string =>
  addMonthsClamped(joinDate, INTERNSHIP_DEFAULT_MONTHS);

/** When the internship review falls due: the expected internship end. */
export const internshipDueDate = (
  e: Pick<ScheduleEmployee, 'joinDate' | 'internshipEndDate'>,
): string => e.internshipEndDate ?? defaultInternshipEnd(e.joinDate);

/**
 * The internship review: due on the internship end, reviewing the join date
 * (after an extension, the previous end date) to the day before it.
 */
export function internshipReview(e: ScheduleEmployee): DueAppraisal {
  const dueDate = internshipDueDate(e);
  const periodEnd = addDays(dueDate, -1);
  let periodStart =
    e.internshipTermStart && e.internshipTermStart > e.joinDate
      ? e.internshipTermStart
      : e.joinDate;
  if (periodStart > periodEnd) periodStart = periodEnd;
  return { type: 'INTERNSHIP', dueDate, periodStart, periodEnd };
}

/**
 * The current internship term already has an internship review (any cycle,
 * any status): one whose due date is after the term's start. Before any
 * extension every internship review counts. After one, only a review due
 * after the previous end date does, so an adjusted due date on the current
 * term's review never looks like an old one.
 */
export function internshipCovered(
  e: Pick<ScheduleEmployee, 'internshipTermStart'>,
  records: readonly AppraisalOnRecord[],
): boolean {
  const termStart = e.internshipTermStart ?? null;
  return records.some(
    (r) =>
      r.type === 'INTERNSHIP' &&
      (termStart === null || (r.dueDate !== null && r.dueDate > termStart)),
  );
}

/**
 * Whether an employee is in scope for a `type` cycle at all: never once
 * exited; an intern only for the internship review, which is for interns
 * only; a confirmation only while on probation.
 */
export function inScope(
  e: Pick<ScheduleEmployee, 'status'>,
  type: AppraisalTypeValue,
): boolean {
  if (e.status === 'EXITED') return false;
  if (type === 'INTERNSHIP') return e.status === 'INTERN';
  if (e.status === 'INTERN') return false;
  return type !== 'CONFIRMATION' || e.status === 'PROBATION';
}

/**
 * The latest `type` due date on or before `date` with its review period
 * (an explicit launch pick's fallback); null when none has come yet.
 */
export function dueOnOrBeforeFor(
  e: ScheduleEmployee,
  type: AppraisalTypeValue,
  date: string,
): DueAppraisal | null {
  if (type === 'INTERNSHIP') {
    const review = internshipReview(e);
    return review.dueDate <= date ? review : null;
  }
  return dueOnOrBefore(anchorOf(e), type, date);
}

/** The first `type` due date (for "not due yet, first due on ..."), or null when there is none within a year. */
export function firstDueFor(
  e: ScheduleEmployee,
  type: AppraisalTypeValue,
): string | null {
  if (type === 'INTERNSHIP') return internshipDueDate(e);
  const anchor = anchorOf(e);
  const [first] = milestones(
    anchor,
    type,
    anchor,
    addMonthsClamped(anchor, 12),
  );
  return first ?? null;
}

/**
 * The employees due a `type` appraisal in [from, to], each with the latest
 * such milestone in the window. Order is preserved.
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
    let due: DueAppraisal | null;
    if (type === 'INTERNSHIP') {
      const review = internshipReview(employee);
      due = review.dueDate >= from && review.dueDate <= to ? review : null;
    } else {
      due = dueInWindow(anchorOf(employee), type, from, to);
    }
    if (due) out.push({ employee, due });
  }
  return out;
}

export interface NextAppraisal extends DueAppraisal {
  /** The due date is before `today` (only an intern's internship review or a probation employee's confirmation can be). */
  overdue: boolean;
}

/**
 * What an employee is due next, earliest first.
 *
 * - EXITED: nothing.
 * - INTERN: the internship review, even once its date has passed (flagged
 *   `overdue`): it is still owed and does not roll forward.
 * - PROBATION: the confirmation, likewise.
 * - Anyone else: the next half-yearly and the next yearly on or after
 *   `today`, counted from the anchor. They coincide on anniversaries (12, 24,
 *   ... months); the yearly is listed first then, because on an anniversary
 *   it is the yearly review that falls due.
 */
export function nextDue(e: ScheduleEmployee, today: string): NextAppraisal[] {
  const { status } = e;
  if (status === 'EXITED') return [];
  if (status === 'INTERN') {
    const review = internshipReview(e);
    return [{ ...review, overdue: review.dueDate < today }];
  }
  const anchor = anchorOf(e);
  if (status === 'PROBATION') {
    const dueDate = milestoneAt(anchor, 'CONFIRMATION', 1);
    return [
      {
        type: 'CONFIRMATION',
        dueDate,
        ...reviewPeriod(anchor, 'CONFIRMATION', dueDate),
        overdue: dueDate < today,
      },
    ];
  }
  const out: NextAppraisal[] = [];
  // Far enough ahead to always hold the next yearly milestone (a future anchor included).
  const horizon = addMonthsClamped(anchor > today ? anchor : today, 13);
  for (const type of ['YEARLY', 'HALF_YEARLY'] as const) {
    const [dueDate] = milestones(anchor, type, today, horizon);
    if (dueDate)
      out.push({
        type,
        dueDate,
        ...reviewPeriod(anchor, type, dueDate),
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
  type: RegularAppraisalType,
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
 * The regular milestones an employee's existing appraisals stand for, as
 * `TYPE|YYYY-MM-DD` keys (`join` is the anchor). An appraisal covers the
 * milestone of its type nearest its due date, so one whose due date was
 * adjusted by a few days (or hand-picked) still counts for the milestone it
 * was launched for. On an anniversary the half-yearly and yearly milestones
 * coincide: an appraisal of either type covers both, so nobody is appraised
 * twice for the same date. Internship reviews are covered per term
 * (`internshipCovered`), not here.
 */
export function coveredMilestones(
  join: string,
  records: readonly AppraisalOnRecord[],
): Set<string> {
  const out = new Set<string>();
  for (const r of records) {
    if (!r.dueDate || r.type === 'INTERNSHIP') continue;
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
 * Whether the employee's `type` due date `dueDate` already has an appraisal
 * (any cycle): the regular milestone is covered, or for INTERNSHIP the
 * current term already has an internship review.
 */
export function isDueCovered(
  e: OverdueEmployee,
  type: AppraisalTypeValue,
  dueDate: string,
): boolean {
  if (type === 'INTERNSHIP') return internshipCovered(e, e.appraisals);
  return isCovered(coveredMilestones(anchorOf(e), e.appraisals), type, dueDate);
}

/**
 * Whether moving an appraisal's due date to `dueDate` would land on a due
 * date another appraisal of the employee (`others`) already stands for.
 * Regular types: the milestone nearest `dueDate` is covered. INTERNSHIP:
 * another internship review has exactly that due date.
 */
export function dueDateTaken(
  e: ScheduleEmployee,
  type: AppraisalTypeValue,
  dueDate: string,
  others: readonly AppraisalOnRecord[],
): string | null {
  if (type === 'INTERNSHIP')
    return others.some((r) => r.type === 'INTERNSHIP' && r.dueDate === dueDate)
      ? dueDate
      : null;
  const anchor = anchorOf(e);
  const milestone = nearestMilestone(anchor, type, dueDate) ?? dueDate;
  return isCovered(coveredMilestones(anchor, others), type, milestone)
    ? milestone
    : null;
}

/**
 * The date the employee's latest appraisal of `type` stands for: its covered
 * milestone (or due date), or for a calendar-cycle appraisal the end of the
 * period it reviewed. Overdue only looks at due dates after it.
 */
export function lastAppraisedOn(
  join: string,
  type: RegularAppraisalType,
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
 * - INTERNSHIP: only while an INTERN, however long ago (it is still owed),
 *   unless the current term already has an internship review.
 * - Regular types count from the anchor. Only the latest milestone before
 *   `before` counts: if it is covered (or not after the last appraisal of the
 *   type), the employee is not overdue, even when an older one was missed;
 *   the latest stands in for them.
 * - CONFIRMATION: only while on PROBATION, however long ago (it is still owed).
 * - HALF_YEARLY / YEARLY: never while an INTERN or on PROBATION, never before
 *   the confirmation date, and only within `OVERDUE_LOOKBACK_MONTHS` before
 *   `today`.
 * - Never once EXITED.
 */
export function overdueFor(
  e: OverdueEmployee,
  type: AppraisalTypeValue,
  before: string,
  today: string,
): DueAppraisal | null {
  if (e.status === 'EXITED') return null;
  if (type === 'INTERNSHIP') {
    if (e.status !== 'INTERN') return null;
    const review = internshipReview(e);
    if (review.dueDate >= before) return null;
    return internshipCovered(e, e.appraisals) ? null : review;
  }
  if (e.status === 'INTERN') return null;
  const anchor = anchorOf(e);
  const all = milestones(anchor, type, anchor, addDays(before, -1));
  const latest = all[all.length - 1];
  if (!latest) return null;
  if (isCovered(coveredMilestones(anchor, e.appraisals), type, latest))
    return null;
  const last = lastAppraisedOn(anchor, type, e.appraisals);
  if (last !== null && latest <= last) return null;
  if (type === 'CONFIRMATION') {
    if (e.status !== 'PROBATION') return null;
  } else {
    if (e.status === 'PROBATION') return null;
    if (e.confirmationDate && latest < e.confirmationDate) return null;
    if (latest < addMonthsClamped(today, -OVERDUE_LOOKBACK_MONTHS)) return null;
  }
  return { type, dueDate: latest, ...reviewPeriod(anchor, type, latest) };
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
 * INTERNSHIP has one milestone, the internship end, and "already appraised"
 * means the current term has an internship review. Scope (exited, interns,
 * confirmation only on probation) is the caller's job.
 */
export function classifyDue(
  e: OverdueEmployee,
  type: AppraisalTypeValue,
  w: DueWindow,
): ClassifiedDue | null {
  const classified = (group: DueGroup, due: DueAppraisal): ClassifiedDue => ({
    group,
    ...due,
    ...lateness(due.dueDate, w.today),
  });
  if (type === 'INTERNSHIP') {
    if (internshipCovered(e, e.appraisals)) return null;
    const review = internshipReview(e);
    const d = review.dueDate;
    if (d >= w.from && d <= w.to) return classified('due', review);
    if (d < w.from) {
      const missed = overdueFor(e, type, w.from, w.today);
      return missed ? classified('overdue', missed) : null;
    }
    if (d <= addDays(w.to, UPCOMING_DAYS))
      return classified('upcoming', review);
    return null;
  }
  const anchor = anchorOf(e);
  const covered = coveredMilestones(anchor, e.appraisals);
  const make = (group: DueGroup, dueDate: string): ClassifiedDue =>
    classified(group, {
      type,
      dueDate,
      ...reviewPeriod(anchor, type, dueDate),
    });
  const inWindow = milestones(anchor, type, w.from, w.to);
  const latest = inWindow[inWindow.length - 1];
  if (latest && !isCovered(covered, type, latest)) return make('due', latest);
  const missed = overdueFor(e, type, w.from, w.today);
  if (missed) return make('overdue', missed.dueDate);
  const [next] = milestones(
    anchor,
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
 * internship review while an intern, the confirmation while on probation,
 * else the half-yearly and the yearly. On an anniversary both regular types
 * fall due the same day; only the yearly is listed then.
 */
export function overdueAppraisals(
  e: OverdueEmployee,
  today: string,
): ClassifiedDue[] {
  if (e.status === 'EXITED') return [];
  const types: AppraisalTypeValue[] =
    e.status === 'INTERN'
      ? ['INTERNSHIP']
      : e.status === 'PROBATION'
        ? ['CONFIRMATION']
        : ['YEARLY', 'HALF_YEARLY'];
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

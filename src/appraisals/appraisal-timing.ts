import { diffDays, tenureMonths } from '../people/people-dates';
import type {
  AppraisalActionValue,
  AppraisalEffectiveDateValue,
  AppraisalTiming,
  ApprovalDecisionValue,
  EffectiveDateView,
  ScoringModeValue,
} from './appraisals.types';

/**
 * When an appraisal happened relative to when it was due, and from when its
 * outcome takes effect (migration 0033). Pure: no I/O and no clock; dates are
 * `YYYY-MM-DD` strings (Dhaka).
 *
 * The schedule anchor never moves: due dates always come from the join date,
 * so an early or late appraisal never shifts the next due date. Timing is
 * only a label on this one appraisal.
 */

/** Signed off within this many days either side of the due date counts as on time. */
export const TIMING_GRACE_DAYS = 3;

/**
 * - Signed off: ON_TIME within +-`TIMING_GRACE_DAYS` of the due date
 *   (`days` = the signed offset, -3..3), else EARLY / LATE (`days` > 0).
 * - Open: OPEN_OVERDUE once today is more than the grace past the due date
 *   (`days` since due), else OPEN (`days` until due; -3..-1 means past due
 *   but still within the grace).
 * - No due date (calendar cycles): null.
 */
export function appraisalTiming(
  dueDate: string | null,
  signedOn: string | null,
  today: string,
): AppraisalTiming | null {
  if (!dueDate) return null;
  if (signedOn) {
    const d = diffDays(dueDate, signedOn);
    if (Math.abs(d) <= TIMING_GRACE_DAYS) return { status: 'ON_TIME', days: d };
    return d > 0 ? { status: 'LATE', days: d } : { status: 'EARLY', days: -d };
  }
  const late = diffDays(dueDate, today);
  if (late > TIMING_GRACE_DAYS) return { status: 'OPEN_OVERDUE', days: late };
  return { status: 'OPEN', days: -late };
}

/** Signing off on `approvalDate` would be LATE (the same rule as the timing label). */
export const isLate = (dueDate: string | null, approvalDate: string): boolean =>
  appraisalTiming(dueDate, approvalDate, approvalDate)?.status === 'LATE';

/**
 * The mode used when none was chosen: the due date when the appraisal is
 * late (so a late outcome is backdated to when it was owed), otherwise the
 * approval date. Legacy KPI_BLEND cycles have no approval step to choose in
 * and always use the approval date.
 */
export function defaultEffectiveMode(
  scoringMode: ScoringModeValue,
  dueDate: string | null,
  approvalDate: string,
): AppraisalEffectiveDateValue {
  return scoringMode === 'FORM_100' && isLate(dueDate, approvalDate)
    ? 'DUE_DATE'
    : 'APPROVAL_DATE';
}

export interface EffectiveDateInput {
  scoringMode: ScoringModeValue;
  /** Stored choice; null = the default. */
  mode: AppraisalEffectiveDateValue | null;
  /** CUSTOM only. */
  customDate: string | null;
  dueDate: string | null;
  periodStart: string;
  /** The sign-off date (today, before sign-off). */
  approvalDate: string;
}

export type EffectiveDateResult =
  | { ok: true; mode: AppraisalEffectiveDateValue; date: string }
  | { ok: false; error: string };

/** Why a chosen effective date cannot be used (null when it can). */
export function effectiveDateError(
  i: Pick<
    EffectiveDateInput,
    'mode' | 'customDate' | 'dueDate' | 'periodStart'
  >,
): string | null {
  if (i.mode === 'DUE_DATE' && !i.dueDate)
    return 'This appraisal has no due date to backdate to';
  if (i.mode === 'CUSTOM') {
    if (!i.customDate) return 'Choose the date the outcome takes effect from';
    if (i.customDate < i.periodStart)
      return 'The effective date cannot be before the review period starts';
  }
  return null;
}

/** The mode and date an outcome takes effect from. */
export function resolveEffectiveDate(
  i: EffectiveDateInput,
): EffectiveDateResult {
  const error = effectiveDateError(i);
  if (error) return { ok: false, error };
  const mode =
    i.mode ?? defaultEffectiveMode(i.scoringMode, i.dueDate, i.approvalDate);
  const date =
    mode === 'DUE_DATE'
      ? (i.dueDate as string)
      : mode === 'CUSTOM'
        ? (i.customDate as string)
        : i.approvalDate;
  return { ok: true, mode, date };
}

/**
 * Whole months of salary arrears an approved, backdated increment implies:
 * from the effective date to the approval date. Information only; no money
 * is computed. Zero when nothing is backdated or no increment was approved.
 */
export function arrearsMonths(a: {
  decision: ApprovalDecisionValue | null;
  actions: readonly AppraisalActionValue[];
  effectiveDate: string;
  approvalDate: string;
}): number {
  if (a.decision !== 'APPROVED' || !a.actions.includes('INCREMENT')) return 0;
  if (a.effectiveDate >= a.approvalDate) return 0;
  return tenureMonths(a.effectiveDate, a.approvalDate);
}

/** The effective-date block of a view: the frozen one after sign-off, else a preview as if signed off today. */
export function effectiveDateView(
  i: EffectiveDateInput & {
    decision: ApprovalDecisionValue | null;
    actions: readonly AppraisalActionValue[];
    /** Signed off: the stored mode and date win. */
    frozen: { mode: AppraisalEffectiveDateValue; date: string } | null;
  },
): EffectiveDateView | null {
  const r = i.frozen
    ? { ok: true as const, ...i.frozen }
    : resolveEffectiveDate(i);
  if (!r.ok) return null;
  return {
    mode: r.mode,
    date: r.date,
    defaulted: !i.frozen && i.mode === null,
    backdated: r.date < i.approvalDate,
    arrearsMonths: arrearsMonths({
      decision: i.decision,
      actions: i.actions,
      effectiveDate: r.date,
      approvalDate: i.approvalDate,
    }),
  };
}

export interface DateEdit {
  joinDate: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
}

/**
 * Validates an appraisal's adjusted dates (the merged result of a partial
 * edit). The review period runs start <= end, never starts before the join
 * date, ends no later than the due date (a period reviews the time before
 * the appraisal falls due) and spans at most about two years, like a cycle.
 * The due date itself is free (early or late), but never before joining.
 */
export function dateEditError(d: DateEdit): string | null {
  if (d.periodStart > d.periodEnd)
    return 'The review period must start on or before it ends';
  if (d.periodStart < d.joinDate)
    return 'The review period cannot start before the employee joined';
  if (diffDays(d.periodStart, d.periodEnd) > 800)
    return 'A review period cannot span more than about two years';
  if (d.dueDate !== null) {
    if (d.dueDate < d.joinDate)
      return 'The due date cannot be before the employee joined';
    if (d.periodEnd > d.dueDate)
      return 'The review period must end on or before the due date';
  }
  return null;
}

import { countBusinessDays } from '../budgets/budget-forecast';
import {
  BAND_ON_TRACK_MIN,
  BAND_WATCH_MIN,
  KPI_TARGETS,
  LATE_AFTER_MINUTES,
  WORKING_DAY_HOURS,
} from './people.constants';
import {
  businessDaysIn,
  dhakaMinutesOfDay,
  intersect,
  type DateRange,
} from './people-dates';
import type { Band, KpiResult, Kpis, OverallScore, ScoredKpi } from './people.types';

/**
 * Pure KPI maths for the employee summary and directory. No I/O, no clock:
 * everything arrives as plain data so each branch is unit-testable. Dates are
 * `YYYY-MM-DD` Dhaka calendar dates.
 */

export interface LeaveSpan {
  /** Inclusive. */
  startDate: string;
  endDate: string;
  /** Days taken; may be fractional (0.5) for a half day. */
  days: number;
}

export interface KpiInput {
  period: DateRange;
  employment: { joinDate: string; exitDate: string | null };
  /** `clickupUserId` is set. Without it the three ClickUp KPIs are `not-linked`. */
  clickupLinked: boolean;
  /** Tracked time per Dhaka day. Rows outside the period are ignored. */
  hours: { date: string; hours: number; chargeableHours: number }[];
  /** Tasks the employee is assigned to that have a due date and were closed (Dhaka dates). */
  deliveries: { closedOn: string; dueOn: string }[];
  attendance: { date: string; firstIn: Date | null }[];
  /** APPROVED leave only; the caller filters. Every leave type reduces availability. */
  approvedLeave: LeaveSpan[];
}

export interface KpiComputation {
  kpis: Kpis;
  overall: OverallScore;
  hours: { clickup: number; chargeable: number; available: number };
}

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function bandOf(score: number | null): Band {
  if (score === null) return 'no-data';
  if (score >= BAND_ON_TRACK_MIN) return 'on-track';
  if (score >= BAND_WATCH_MIN) return 'watch';
  return 'at-risk';
}

/** min(value / target, 1) * 100, unrounded. */
export function rawScore(value: number, target: number): number {
  return Math.min(value / target, 1) * 100;
}

/** On time = first entry at or before 09:30 Dhaka. */
export function isOnTimeArrival(firstIn: Date): boolean {
  return dhakaMinutesOfDay(firstIn) <= LATE_AFTER_MINUTES;
}

/** The part of the period the person was employed. null when they never overlapped. */
export function employmentWindow(
  period: DateRange,
  employment: { joinDate: string; exitDate: string | null },
): DateRange | null {
  return intersect(period, {
    from: employment.joinDate,
    to: employment.exitDate ?? period.to,
  });
}

/**
 * Business days in the window covered by approved leave, counting half days
 * fractionally. A leave of `days` over a span with N business days takes
 * `days / N` of each of them; where spans overlap the larger share wins, so
 * double-booked leave is never subtracted twice.
 */
export function leaveBusinessDays(
  window: DateRange,
  leaves: LeaveSpan[],
): number {
  const share = new Map<string, number>();
  for (const l of leaves) {
    const span = countBusinessDays(l.startDate, l.endDate);
    if (span === 0) continue;
    const perDay = Math.min(1, l.days / span);
    const clipped = intersect(window, { from: l.startDate, to: l.endDate });
    if (!clipped) continue;
    for (const d of businessDaysIn(clipped.from, clipped.to)) {
      share.set(d, Math.max(share.get(d) ?? 0, perDay));
    }
  }
  let total = 0;
  for (const v of share.values()) total += v;
  return total;
}

/** Business days in the period, within employment, minus approved leave. 0 when never employed in the period. */
export function availableBusinessDays(
  input: Pick<KpiInput, 'period' | 'employment' | 'approvedLeave'>,
): number {
  const window = employmentWindow(input.period, input.employment);
  if (!window) return 0;
  const days = countBusinessDays(window.from, window.to);
  return Math.max(0, days - leaveBusinessDays(window, input.approvedLeave));
}

function kpi(
  numerator: number,
  denominator: number,
  target: number,
  reason?: 'not-linked' | 'no-data',
): KpiResult {
  if (reason || denominator <= 0) {
    return {
      value: null,
      target,
      numerator: reason === 'not-linked' ? 0 : round(numerator, 2),
      denominator: reason === 'not-linked' ? 0 : round(denominator, 2),
      score: null,
      status: 'no-data',
      reason: reason ?? 'no-data',
    };
  }
  const value = (numerator / denominator) * 100;
  const score = rawScore(value, target);
  return {
    value: round(value, 1),
    target,
    numerator: round(numerator, 2),
    denominator: round(denominator, 2),
    score: Math.round(score),
    status: bandOf(score),
  };
}

export function computeKpis(input: KpiInput): KpiComputation {
  const { period } = input;
  const inPeriod = (d: string) => d >= period.from && d <= period.to;

  const availableDays = availableBusinessDays(input);
  const availableHours = availableDays * WORKING_DAY_HOURS;

  let clickupHours = 0;
  let chargeableHours = 0;
  for (const h of input.hours) {
    if (!inPeriod(h.date)) continue;
    clickupHours += h.hours;
    chargeableHours += h.chargeableHours;
  }

  let dueTasks = 0;
  let onTimeTasks = 0;
  for (const t of input.deliveries) {
    if (!inPeriod(t.closedOn)) continue;
    dueTasks++;
    if (t.closedOn <= t.dueOn) onTimeTasks++;
  }

  let arrivals = 0;
  let onTimeArrivals = 0;
  for (const a of input.attendance) {
    if (!inPeriod(a.date) || !a.firstIn) continue;
    arrivals++;
    if (isOnTimeArrival(a.firstIn)) onTimeArrivals++;
  }

  const linked = input.clickupLinked;
  const kpis: Kpis = {
    utilisation: linked
      ? kpi(clickupHours, availableHours, KPI_TARGETS.utilisation)
      : kpi(0, 0, KPI_TARGETS.utilisation, 'not-linked'),
    chargeable: linked
      ? kpi(chargeableHours, clickupHours, KPI_TARGETS.chargeable)
      : kpi(0, 0, KPI_TARGETS.chargeable, 'not-linked'),
    onTimeDelivery: linked
      ? kpi(onTimeTasks, dueTasks, KPI_TARGETS.onTimeDelivery)
      : kpi(0, 0, KPI_TARGETS.onTimeDelivery, 'not-linked'),
    punctuality: kpi(onTimeArrivals, arrivals, KPI_TARGETS.punctuality),
  };

  return {
    kpis,
    overall: overallOf(kpis),
    hours: {
      clickup: round(clickupHours, 2),
      chargeable: round(chargeableHours, 2),
      available: round(availableHours, 1),
    },
  };
}

/** Equal-weighted mean of the non-null KPI scores, rounded. Scores are rederived from the 1-dp KPI values, not from the already-rounded per-KPI scores. */
export function overallOf(kpis: Kpis): OverallScore {
  const keys: ScoredKpi[] = ['utilisation', 'chargeable', 'onTimeDelivery', 'punctuality'];
  const scores: number[] = [];
  const basedOn: ScoredKpi[] = [];
  for (const key of keys) {
    const k = kpis[key];
    if (k.value === null) continue;
    scores.push(rawScore(k.value, k.target));
    basedOn.push(key);
  }
  // Only "not linked" makes a score partial. A KPI that is null for lack of
  // data (no tasks with a due date this period) is a real, complete answer.
  const partial = keys.some((key) => kpis[key].reason === 'not-linked');
  if (scores.length === 0) return { score: null, band: 'no-data', partial, basedOn };
  const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { score, band: bandOf(score), partial, basedOn };
}

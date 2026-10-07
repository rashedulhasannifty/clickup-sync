import { countBusinessDays } from "../budgets/budget-forecast";
import { LEAVE_ENTITLEMENT, STRIP_BUSINESS_DAYS } from "./people.constants";
import {
  addDays,
  intersect,
  isBusinessDay,
  type DateRange,
} from "./people-dates";
import { isOnTimeArrival, type LeaveSpan } from "./kpi-math";
import type {
  AttendanceDayState,
  AttendanceDayView,
  LeaveBalance,
  LeaveTypeValue,
  TodayState,
} from "./people.types";

/**
 * Pure attendance classification: the 30-day strip, today's state, and the
 * leave balance. Leave only counts once APPROVED; the callers pass approved
 * leave in, so a PENDING request never turns an absence into leave.
 */

export interface AttendanceRow {
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
  minutesInOffice: number | null;
}

export interface TypedLeave extends LeaveSpan {
  type: LeaveTypeValue;
}

/** The strip state a given approved leave type shows as. */
export function leaveStateOf(
  type: LeaveTypeValue,
): "sick" | "casual" | "leave" {
  if (type === "SICK") return "sick";
  if (type === "CASUAL") return "casual";
  return "leave";
}

export function leaveCovering(
  date: string,
  leaves: TypedLeave[],
): TypedLeave | undefined {
  return leaves.find((l) => l.startDate <= date && date <= l.endDate);
}

/**
 * State of one business day. A first-in beats leave (they came in); leave beats
 * absence; a day with nothing recorded is `absent` only once it is over. Today
 * with no row is `future` ("not closed yet"): attendance for the current day
 * arrives with the next sync, so calling it absent would accuse everyone every
 * morning.
 */
export function classifyDay(args: {
  date: string;
  today: string;
  row: AttendanceRow | undefined;
  leaves: TypedLeave[];
}): AttendanceDayState {
  const { date, today, row, leaves } = args;
  if (date > today) return "future";
  if (row?.firstIn) return isOnTimeArrival(row.firstIn) ? "on-time" : "late";
  const leave = leaveCovering(date, leaves);
  if (leave) return leaveStateOf(leave.type);
  return date === today ? "future" : "absent";
}

/**
 * The last `STRIP_BUSINESS_DAYS` business days up to and including `today`,
 * limited to days within employment (a new joiner has a shorter strip). Oldest first.
 */
export function buildAttendanceStrip(args: {
  today: string;
  employment: { joinDate: string; exitDate: string | null };
  rows: AttendanceRow[];
  leaves: TypedLeave[];
  limit?: number;
}): AttendanceDayView[] {
  const limit = args.limit ?? STRIP_BUSINESS_DAYS;
  const latest =
    args.employment.exitDate && args.employment.exitDate < args.today
      ? args.employment.exitDate
      : args.today;
  const days: string[] = [];
  for (
    let d = latest;
    days.length < limit && d >= args.employment.joinDate;
    d = addDays(d, -1)
  ) {
    if (isBusinessDay(d)) days.push(d);
  }
  days.reverse();
  const byDate = new Map(args.rows.map((r) => [r.date, r]));
  return days.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      state: classifyDay({ date, today: args.today, row, leaves: args.leaves }),
      firstIn: row?.firstIn ? row.firstIn.toISOString() : null,
      lastOut: row?.lastOut ? row.lastOut.toISOString() : null,
      minutesInOffice: row?.minutesInOffice ?? null,
    };
  });
}

/**
 * Today's state for the directory and door log. `non-working` covers weekends
 * and anyone outside their employment today. No row and no leave is `not-in`
 * (neutral — see `classifyDay`).
 */
export function classifyToday(args: {
  today: string;
  employment: { joinDate: string; exitDate: string | null };
  row: AttendanceRow | undefined;
  leaves: TypedLeave[];
}): TodayState {
  const { today, employment, row, leaves } = args;
  if (!isBusinessDay(today)) return "non-working";
  if (
    today < employment.joinDate ||
    (employment.exitDate !== null && today > employment.exitDate)
  )
    return "non-working";
  if (row?.firstIn) return isOnTimeArrival(row.firstIn) ? "on-time" : "late";
  if (leaveCovering(today, leaves)) return "leave";
  return "not-in";
}

/** Whole minutes between first-in and last-out, or null when either is missing. */
export function minutesBetween(
  firstIn: Date | null,
  lastOut: Date | null,
): number | null {
  if (!firstIn || !lastOut) return null;
  const mins = Math.round((lastOut.getTime() - firstIn.getTime()) / 60_000);
  return mins >= 0 ? mins : null;
}

/**
 * Approved days used in `year`, by bucket. A leave of `days` over a span of N
 * business days spreads `days / N` over each, so a leave that straddles New
 * Year is split between the two years rather than counted wholly in one.
 */
export function computeLeaveBalance(
  year: number,
  approved: TypedLeave[],
): LeaveBalance {
  const yearRange: DateRange = { from: `${year}-01-01`, to: `${year}-12-31` };
  const used = { casual: 0, sick: 0, other: 0 };
  for (const l of approved) {
    const clipped = intersect(yearRange, { from: l.startDate, to: l.endDate });
    if (!clipped) continue;
    const span = countBusinessDays(l.startDate, l.endDate);
    if (span === 0) continue;
    const inYear = countBusinessDays(clipped.from, clipped.to);
    const days = (Math.min(l.days, span) / span) * inYear;
    if (l.type === "CASUAL") used.casual += days;
    else if (l.type === "SICK") used.sick += days;
    else used.other += days;
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    year,
    casual: { used: r(used.casual), entitlement: LEAVE_ENTITLEMENT.casual },
    sick: { used: r(used.sick), entitlement: LEAVE_ENTITLEMENT.sick },
    other: { used: r(used.other) },
  };
}

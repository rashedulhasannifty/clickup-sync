import type {
  AttendanceDayState,
  Band,
  EmployeeStatusValue,
  EmploymentEventTypeValue,
  KpiResult,
  LeaveStatusValue,
  LeaveTypeValue,
  ManualEventType,
  TodayState,
} from '../api/people';

/**
 * Pure display helpers for the People pages. Kept out of the `.tsx` component
 * files because the fast-refresh lint rule forbids exporting non-components
 * from them.
 *
 * The office runs on Dhaka time (UTC+6, no DST), so every clock time is
 * formatted with `timeZone: 'Asia/Dhaka'` rather than the browser's zone, and
 * date-only `YYYY-MM-DD` strings are formatted as UTC so they never slip a day.
 */

export type PillTone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple';

const DHAKA = 'Asia/Dhaka';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DHAKA });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: DHAKA });

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Today's calendar date in Dhaka, `YYYY-MM-DD`. */
export function dhakaToday(now: Date = new Date()): string {
  return ymdFmt.format(now);
}

/** `12 Mar 2022` from a `YYYY-MM-DD` date. */
export function formatDate(ymd: string | null | undefined): string {
  return ymd ? dateFmt.format(ymdToUtc(ymd)) : '—';
}

/** `12 Mar` from a `YYYY-MM-DD` date. */
export function formatShortDate(ymd: string): string {
  return shortDateFmt.format(ymdToUtc(ymd));
}

/** `Mon` from a `YYYY-MM-DD` date. */
export function formatWeekday(ymd: string): string {
  return weekdayFmt.format(ymdToUtc(ymd));
}

/** `Mar 26` from a `YYYY-MM` month. */
export function formatMonth(ym: string): string {
  return monthFmt.format(ymdToUtc(`${ym}-01`));
}

/** `09:04` in Dhaka time from an ISO timestamp; an em dash when missing. */
export function formatClock(iso: string | null | undefined): string {
  return iso ? timeFmt.format(new Date(iso)) : '—';
}

/** `1 day` / `2.5 days`. */
export function formatDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** `5h 12m` from minutes; an em dash when null. */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** `4y 7m` / `5y` / `8m` / `<1m` from whole months. */
export function formatTenure(months: number): string {
  if (months < 1) return '<1m';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}m`;
  return m === 0 ? `${y}y` : `${y}y ${m}m`;
}

/** `132.5h`. */
export function formatHours(h: number): string {
  return `${(Math.round(h * 10) / 10).toLocaleString('en-US')}h`;
}

export function formatPct(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// --- tones & labels --------------------------------------------------------

export const BAND_LABEL: Record<Band, string> = {
  'on-track': 'On track',
  watch: 'Watch',
  'at-risk': 'At risk',
  'no-data': 'No data',
};

export function bandTone(band: Band): PillTone {
  switch (band) {
    case 'on-track': return 'green';
    case 'watch': return 'amber';
    case 'at-risk': return 'red';
    default: return 'gray';
  }
}

/** The solid hue for a bar / number of a band (reads in both themes). */
export function bandColor(band: Band): string {
  switch (band) {
    case 'on-track': return 'var(--green)';
    case 'watch': return 'var(--amber)';
    case 'at-risk': return 'var(--red)';
    default: return 'var(--text-faint)';
  }
}

export const STATUS_LABEL: Record<EmployeeStatusValue, string> = {
  PROBATION: 'Probation',
  ACTIVE: 'Active',
  NOTICE: 'Notice period',
  EXITED: 'Exited',
};

export function statusTone(s: EmployeeStatusValue): PillTone {
  switch (s) {
    case 'ACTIVE': return 'green';
    case 'PROBATION': return 'blue';
    case 'NOTICE': return 'amber';
    default: return 'gray';
  }
}

export const TODAY_LABEL: Record<TodayState, string> = {
  'on-time': 'On time',
  late: 'Late',
  leave: 'On leave',
  'not-in': 'Not in',
  'non-working': 'Day off',
};

export function todayTone(s: TodayState): PillTone {
  switch (s) {
    case 'on-time': return 'green';
    case 'late': return 'amber';
    case 'leave': return 'purple';
    case 'not-in': return 'red';
    default: return 'gray';
  }
}

export const LEAVE_TYPE_LABEL: Record<LeaveTypeValue, string> = {
  SICK: 'Sick',
  CASUAL: 'Casual',
  ANNUAL: 'Annual',
  UNPAID: 'Unpaid',
  OTHER: 'Other',
};

export function leaveTypeTone(t: LeaveTypeValue): PillTone {
  switch (t) {
    case 'SICK': return 'purple';
    case 'CASUAL': return 'blue';
    default: return 'gray';
  }
}

export const LEAVE_STATUS_LABEL: Record<LeaveStatusValue, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export function leaveStatusTone(s: LeaveStatusValue): PillTone {
  switch (s) {
    case 'APPROVED': return 'green';
    case 'PENDING': return 'amber';
    case 'REJECTED': return 'red';
    default: return 'gray';
  }
}

export const EVENT_LABEL: Record<EmploymentEventTypeValue, string> = {
  JOINED: 'Joined',
  CONFIRMED: 'Confirmed (probation passed)',
  PROMOTED: 'Promoted',
  DESIGNATION_CHANGED: 'Designation changed',
  TRANSFERRED: 'Transferred',
  NOTICE_GIVEN: 'Notice given',
  EXITED: 'Exited',
  NOTE: 'Note',
  INCREMENT: 'Salary increment',
};

/** Order shown in the "Add event" picker. `JOINED`, `NOTICE_GIVEN` and `EXITED` are not hand-addable. */
export const MANUAL_EVENT_TYPES: ManualEventType[] = [
  'CONFIRMED',
  'PROMOTED',
  'DESIGNATION_CHANGED',
  'TRANSFERRED',
  'NOTE',
];

/** Cell colours for the 30-business-day attendance strip. */
export const STRIP_STATE: Record<AttendanceDayState, { label: string; color: string }> = {
  'on-time': { label: 'On time', color: 'var(--green)' },
  late: { label: 'Late', color: 'var(--amber)' },
  sick: { label: 'Sick leave', color: 'var(--pill-purple-text)' },
  casual: { label: 'Casual leave', color: 'var(--blue)' },
  leave: { label: 'Other leave', color: 'var(--text-faint)' },
  absent: { label: 'Absent', color: 'var(--red)' },
  future: { label: 'Upcoming', color: 'var(--border)' },
};

/** What a KPI tile says in place of a number when `value` is null. */
export function kpiEmptyText(k: KpiResult): string {
  return k.reason === 'not-linked' ? 'Not linked to ClickUp' : 'No data';
}

export function kpiEmptyHint(k: KpiResult): string {
  return k.reason === 'not-linked'
    ? 'Link a ClickUp user id to this employee to compute this.'
    : 'Nothing recorded in this period yet.';
}

/** Heading for a timeline row, e.g. "Promoted → Senior Developer". */
export function eventTitle(e: {
  type: EmploymentEventTypeValue;
  toLabel: string | null;
  fromLabel: string | null;
}): string {
  switch (e.type) {
    case 'PROMOTED':
      return e.toLabel ? `Promoted → ${e.toLabel}` : 'Promoted';
    case 'DESIGNATION_CHANGED':
      return e.toLabel ? `Designation changed → ${e.toLabel}` : 'Designation changed';
    case 'TRANSFERRED':
      return e.toLabel ? `Moved to ${e.toLabel}` : 'Transferred';
    case 'JOINED':
      return e.toLabel ? `Joined as ${e.toLabel}` : 'Joined';
    case 'INCREMENT':
      return e.fromLabel && e.toLabel
        ? `Salary increment: BDT ${Number(e.fromLabel).toLocaleString('en-US')} → ${Number(e.toLabel).toLocaleString('en-US')}`
        : 'Salary increment';
    default:
      return EVENT_LABEL[e.type];
  }
}

/** Short sentence for what an event does to the record, shown in the Add event modal. */
export const EVENT_EFFECT: Record<ManualEventType, string> = {
  CONFIRMED: 'Sets the confirmation date and moves the employee to Active.',
  PROMOTED: 'Changes the employee’s designation.',
  DESIGNATION_CHANGED: 'Changes the employee’s designation.',
  TRANSFERRED: 'Moves the employee to another team.',
  NOTE: 'Adds a note to the timeline. Nothing else changes.',
};

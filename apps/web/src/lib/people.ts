import type {
  AttendanceCoverage,
  AttendanceDayState,
  Band,
  EmployeeProfile,
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
  INTERN: 'Intern',
  PROBATION: 'Probation',
  ACTIVE: 'Active',
  NOTICE: 'Notice period',
  EXITED: 'Exited',
};

export function statusTone(s: EmployeeStatusValue): PillTone {
  switch (s) {
    case 'ACTIVE': return 'green';
    case 'PROBATION': return 'blue';
    case 'INTERN': return 'purple';
    case 'NOTICE': return 'amber';
    default: return 'gray';
  }
}

export const TODAY_LABEL: Record<TodayState, string> = {
  'on-time': 'On time',
  late: 'Late',
  present: 'In',
  weekend: 'Off-day work',
  leave: 'On leave',
  'not-in': 'Not in',
  'non-working': 'Day off',
};

export function todayTone(s: TodayState): PillTone {
  switch (s) {
    case 'on-time': return 'green';
    case 'late': return 'amber';
    case 'present': return 'green';
    case 'weekend': return 'blue';
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
  PROBATION_STARTED: 'Moved to probation',
  INTERNSHIP_EXTENDED: 'Internship extended',
  JOINED_AS_INTERN: 'Joined as intern',
};

/** Order shown in the "Add event" picker. `JOINED`, `NOTICE_GIVEN` and `EXITED` are not hand-addable. */
export const MANUAL_EVENT_TYPES: ManualEventType[] = [
  'PROBATION_STARTED',
  'INTERNSHIP_EXTENDED',
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
  present: { label: 'In (punctuality not tracked)', color: 'var(--green)' },
  weekend: { label: 'Off-day work', color: 'var(--blue)' },
  // Hatched: the office was closed, which is neither a good nor a bad day.
  holiday: { label: 'Holiday', color: 'repeating-linear-gradient(135deg, var(--border-strong) 0 2px, var(--surface-alt) 2px 5px)' },
  sick: { label: 'Sick leave', color: 'var(--pill-purple-text)' },
  casual: { label: 'Casual leave', color: 'var(--blue)' },
  leave: { label: 'Other leave', color: 'var(--text-faint)' },
  absent: { label: 'Absent', color: 'var(--red)' },
  future: { label: 'Upcoming', color: 'var(--border)' },
};

/** What a KPI tile says in place of a number when `value` is null. */
export function kpiEmptyText(k: KpiResult): string {
  if (k.reason === 'not-linked') return 'Not linked to ClickUp';
  if (k.reason === 'not-tracked') return 'Not tracked';
  return 'No data';
}

export function kpiEmptyHint(k: KpiResult): string {
  if (k.reason === 'not-linked') return 'Link a ClickUp user id to this employee to compute this.';
  if (k.reason === 'not-tracked') return 'This employee’s shift does not track punctuality (irregular hours).';
  return 'Nothing recorded in this period yet.';
}

/** `HH:MM` from minutes after midnight. */
export function formatTimeOfDay(minutes: number): string {
  const n = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** Minutes after midnight from `HH:MM`; null when it is not a valid time. */
export function parseTimeOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/** `1 Jul – 12 Oct` (adds the year when the span crosses one). */
export function formatDateSpan(from: string, to: string): string {
  if (from === to) return formatDate(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${formatShortDate(from)} – ${formatShortDate(to)}` : `${formatDate(from)} – ${formatDate(to)}`;
}

const SOURCE_LABEL: Record<AttendanceCoverage['source'], string> = {
  dummy: 'Simulated',
  'stellar-csv': 'Stellar HRM import',
  'stellar-api': 'Stellar HRM',
};

/**
 * Where the attendance on screen comes from, newest source first:
 * "Stellar HRM import, 1 Jul – 12 Oct · Simulated, 1 Jan – 30 Jun". Null with no data.
 */
export function coverageText(coverage: AttendanceCoverage[] | undefined): string | null {
  if (!coverage || coverage.length === 0) return null;
  return coverage.map((c) => (c.source === 'dummy' ? 'Simulated' : `${SOURCE_LABEL[c.source]}, ${formatDateSpan(c.from, c.to)}`)).join(' · ');
}

/** Short source label of one day's row. */
export function rowSourceLabel(source: AttendanceCoverage['source'] | null): string | null {
  return source ? SOURCE_LABEL[source] : null;
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
    case 'JOINED_AS_INTERN':
      return e.toLabel ? `Joined as intern (${e.toLabel})` : 'Joined as intern';
    case 'INTERNSHIP_EXTENDED':
      return e.toLabel && /^\d{4}-\d{2}-\d{2}$/.test(e.toLabel)
        ? `Internship extended to ${formatDate(e.toLabel)}`
        : 'Internship extended';
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
  PROBATION_STARTED:
    'Moves the intern to Probation from this date. The confirmation falls due 6 months later, and yearly appraisals count from it.',
  INTERNSHIP_EXTENDED: 'Moves the internship end. A new internship review falls due on the new date.',
};

/**
 * Which hand-added events make sense for an employee's status (the server enforces the same):
 * the two internship events only for an intern, and an intern is never confirmed directly.
 */
export function eventAllowed(type: ManualEventType, status: EmployeeStatusValue): boolean {
  if (type === 'PROBATION_STARTED' || type === 'INTERNSHIP_EXTENDED') return status === 'INTERN';
  if (type === 'CONFIRMED') return status !== 'INTERN';
  return true;
}

/** Statuses counted as currently employed (headcount). */
export const EMPLOYED_STATUSES: EmployeeStatusValue[] = ['INTERN', 'PROBATION', 'ACTIVE'];

/**
 * The lifecycle stage in one line: "Intern since 1 Jan 2026 · internship ends 31 Mar 2026",
 * "Probation since 1 Apr 2026 · confirmation due 1 Oct 2026", "Permanent since 1 Oct 2026".
 * Null on notice or exited (their own chips say so).
 */
export function lifecycleText(
  e: Pick<EmployeeProfile, 'status' | 'joinDate' | 'probationStartDate' | 'internshipEndDate' | 'confirmationDate' | 'upcomingAppraisals'>,
): string | null {
  switch (e.status) {
    case 'INTERN':
      return `Intern since ${formatDate(e.joinDate)}${e.internshipEndDate ? ` · internship ends ${formatDate(e.internshipEndDate)}` : ''}`;
    case 'PROBATION': {
      const confirmation = e.upcomingAppraisals.find((a) => a.type === 'CONFIRMATION');
      return `Probation since ${formatDate(e.probationStartDate ?? e.joinDate)}${confirmation ? ` · confirmation due ${formatDate(confirmation.dueDate)}` : ''}`;
    }
    case 'ACTIVE':
      return e.confirmationDate ? `Permanent since ${formatDate(e.confirmationDate)}` : 'Permanent';
    default:
      return null;
  }
}

/**
 * Response shapes for `/api/people/*`. The frontend mirrors these by hand, so
 * they are explicit: dates are `YYYY-MM-DD` strings (Dhaka calendar dates),
 * timestamps are ISO-8601 strings, every number is a plain JS number (no
 * BigInt/Decimal), and nullable means "not known" not "zero".
 */

import type { NextAppraisal } from '../appraisals/appraisal-schedule';
import type { AttendanceSourceLabel } from './attendance-source';

export type EmployeeStatusValue =
  | 'INTERN'
  | 'PROBATION'
  | 'ACTIVE'
  | 'NOTICE'
  | 'EXITED';
export type EmploymentEventTypeValue =
  | 'JOINED'
  | 'CONFIRMED'
  | 'PROMOTED'
  | 'DESIGNATION_CHANGED'
  | 'TRANSFERRED'
  | 'NOTICE_GIVEN'
  | 'EXITED'
  | 'NOTE'
  /** Salary increment: fromValue/toValue are the old/new gross salary (whole taka), notes the percent. */
  | 'INCREMENT'
  /** An intern moved to probation: the effective date is the probation start. */
  | 'PROBATION_STARTED'
  /** fromValue/toValue: the old/new internship end date (`YYYY-MM-DD`). */
  | 'INTERNSHIP_EXTENDED';
export type LeaveTypeValue = 'SICK' | 'CASUAL' | 'ANNUAL' | 'UNPAID' | 'OTHER';
export type LeaveStatusValue =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/** Where attendance rows came from: the source of the latest row ('dummy' | 'stellar-csv' | 'stellar-api'), else the configured provider ('none', 'stellar', ...). */
export type AttendanceSource = 'dummy' | 'none' | (string & {});

/** The date span each source's rows cover, newest first: "Stellar HRM import, 1 Jul - 12 Oct". */
export interface AttendanceCoverage {
  source: AttendanceSourceLabel;
  from: string;
  to: string;
  rows: number;
}

/** KPI score band. Also used as a KPI's own `status` (derived from that KPI's score). */
export type Band = 'on-track' | 'watch' | 'at-risk' | 'no-data';

export interface EmployeeLinks {
  /** `clickupUserId` is set, so ClickUp KPIs can be computed. */
  clickup: boolean;
  /** A login account is linked. */
  user: boolean;
}

export interface EmployeeProfile {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  designation: string;
  grade: string | null;
  department: string | null;
  teamId: string | null;
  teamName: string | null;
  managerId: string | null;
  managerName: string | null;
  joinDate: string;
  /**
   * When probation started: the anchor of the confirmation, yearly and
   * half-yearly schedule. The join date when not stored. Null for an intern
   * who has not started probation yet.
   */
  probationStartDate: string | null;
  /**
   * The expected internship end (the internship review's due date). For an
   * INTERN it is never null (join + 3 months when not stored); otherwise the
   * stored value, if any.
   */
  internshipEndDate: string | null;
  confirmationDate: string | null;
  exitDate: string | null;
  status: EmployeeStatusValue;
  /** Whole months from joinDate to exitDate (or today). */
  tenureMonths: number;
  clickupUserId: string | null;
  userId: string | null;
  linked: EmployeeLinks;
  /** Stellar HRM User ID (the office door system); attendance imports match on it. */
  attendanceId: string | null;
  /** Working shift; null = the 09:30 office default. */
  shiftId: string | null;
  shiftName: string | null;
  /** Company within the group the employee works for. */
  concernName: string | null;
  academicQualification: string | null;
  /** Experience before joining, in whole months; total experience = this + tenure. */
  experienceBeforeJoiningMonths: number | null;
  /** Whole taka (BDT). Sensitive: Owner/Admin only, never logged. */
  startingSalary: number | null;
  /** Present gross salary, whole taka (BDT). Moves with INCREMENT events. Sensitive. */
  grossSalary: number | null;
  /**
   * The next appraisal, counted from the probation start date (the
   * internship end for an intern). The oldest overdue one first
   * (`overdueAppraisals` in `src/appraisals/appraisal-schedule.ts`: a missed
   * due date with no appraisal in any cycle, flagged `overdue`); else
   * `nextDue`: the internship review for an intern, the confirmation while on
   * probation, else the earlier of the next half-yearly and the next yearly.
   * Null once exited.
   */
  nextAppraisal: NextAppraisal | null;
  /** Everything `nextDue` lists, earliest first (both the half-yearly and the yearly once confirmed). */
  upcomingAppraisals: NextAppraisal[];
}

/** State of an employee today, as shown in the directory and the door log. */
export type TodayState =
  | 'on-time'
  | 'late'
  /** In, on a shift that does not track punctuality: neither on time nor late. */
  | 'present'
  /** Punched in on a Saturday/Sunday: extra work, never late or expected. */
  | 'weekend'
  | 'leave'
  | 'not-in'
  | 'non-working';

export interface DirectoryRow extends EmployeeProfile {
  today: TodayState;
  /** 90-day overall score (0-100), null when no KPI has data. */
  score: number | null;
  band: Band;
  /** See `OverallScore.partial`. */
  partial: boolean;
  /** Joining checklist progress (resolved = done or N/A); null when no checklist was started. */
  onboarding: { resolved: number; total: number } | null;
}

/** `not-tracked`: the employee's shift does not track punctuality (irregular hours). */
export type KpiReason = 'not-linked' | 'no-data' | 'not-tracked';

export interface KpiResult {
  /** Percentage, 1 decimal (e.g. 78.4). null when it cannot be computed; see `reason`. */
  value: number | null;
  /** Target as a percentage. */
  target: number;
  /** Utilisation/Chargeable: hours. On-time delivery: tasks. Punctuality: days. */
  numerator: number;
  denominator: number;
  /** min(value / target, 1) * 100, rounded to a whole number. null when value is null. */
  score: number | null;
  /** Band of this KPI's own score. */
  status: Band;
  reason?: KpiReason;
}

export interface Kpis {
  utilisation: KpiResult;
  chargeable: KpiResult;
  onTimeDelivery: KpiResult;
  punctuality: KpiResult;
}

export type ScoredKpi = keyof Kpis;

export interface OverallScore {
  /** Equal-weighted mean of the non-null KPI scores, rounded; null when there are none. */
  score: number | null;
  band: Band;
  /**
   * True when the employee is not linked to ClickUp, so the ClickUp KPIs are
   * missing and the score rests on attendance alone. The UI must label it
   * "Partial" rather than present it as a full score.
   */
  partial: boolean;
  /** The KPIs that actually contributed to `score`. */
  basedOn: ScoredKpi[];
}

export interface TrendPoint {
  /** Calendar month, `YYYY-MM`. The current month covers up to today only. */
  month: string;
  /** Overall SCORE (0-100); the four KPI fields are the KPI VALUES (percentages). null when no data. */
  overall: number | null;
  utilisation: number | null;
  chargeable: number | null;
  onTimeDelivery: number | null;
  punctuality: number | null;
}

export type AttendanceDayState =
  | 'on-time'
  | 'late'
  /** Came in; the shift does not track punctuality. */
  | 'present'
  /** Punches on a weekend: extra work. Only listed when there are punches. */
  | 'weekend'
  | 'absent'
  | 'sick'
  | 'casual'
  | 'leave'
  | 'future';

/** Door-system detail of one day; null/false/zero where the provider does not report it. */
export interface AttendanceDetail {
  /** In/out sessions; null when unknown (simulated data). */
  sessions: number | null;
  /** Summed session time, minutes; null when unknown. */
  workedMinutes: number | null;
  /** The last session has an in but no out. */
  missingOut: boolean;
  note: string | null;
  /** Where the row came from; null when there is no row. */
  source: AttendanceSourceLabel | null;
}

export interface AttendanceDayView extends AttendanceDetail {
  date: string;
  state: AttendanceDayState;
  firstIn: string | null;
  lastOut: string | null;
  minutesInOffice: number | null;
}

export interface LeaveBalance {
  /** Calendar year of "today" in Dhaka. */
  year: number;
  casual: { used: number; entitlement: number };
  sick: { used: number; entitlement: number };
  /** Approved annual, unpaid and other leave. No entitlement tracked. */
  other: { used: number };
}

export interface EmploymentEventView {
  id: string;
  type: EmploymentEventTypeValue;
  effectiveDate: string;
  fromValue: string | null;
  toValue: string | null;
  /** Display text for from/to: team names for TRANSFERRED, otherwise the raw values. */
  fromLabel: string | null;
  toLabel: string | null;
  notes: string | null;
  /** Actor's name (or email); null for a machine credential or a deleted user. */
  createdByName: string | null;
  createdAt: string;
}

export interface SummaryHours {
  /** Tracked ClickUp hours in the period. */
  clickup: number;
  chargeable: number;
  /** Business days in period within employment, minus approved leave, times 8. */
  available: number;
}

export interface EmployeeSummary {
  employee: EmployeeProfile;
  period: { from: string; to: string };
  kpis: Kpis;
  overall: OverallScore;
  /** Last 6 calendar months, oldest first. */
  trend: TrendPoint[];
  /** Up to the last 30 business days within employment, oldest first. */
  attendance: AttendanceDayView[];
  leaveBalance: LeaveBalance;
  /** Newest first. */
  events: EmploymentEventView[];
  attendanceSource: AttendanceSource;
  hours: SummaryHours;
}

export interface TodayRow extends AttendanceDetail {
  employeeId: string;
  fullName: string;
  designation: string;
  teamName: string | null;
  state: TodayState;
  firstIn: string | null;
  lastOut: string | null;
  minutesInOffice: number | null;
  /** Has a first-in but no last-out yet. */
  inOffice: boolean;
}

export interface TodayCounts {
  /** Employees expected today (active, within employment, business day). */
  total: number;
  inOffice: number;
  late: number;
  onLeave: number;
  /** No attendance and no leave recorded (yet) today. */
  notIn: number;
  pendingRequests: number;
}

export interface TodayAttendance {
  date: string;
  /** Mon-Fri. On a weekend `rows` is empty and every count is 0. */
  workingDay: boolean;
  attendanceSource: AttendanceSource;
  coverage: AttendanceCoverage[];
  counts: TodayCounts;
  rows: TodayRow[];
}

export interface LeaveRecordView {
  id: string;
  employeeId: string;
  employeeName: string;
  type: LeaveTypeValue;
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveStatusValue;
  reason: string | null;
  source: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ImportFromUsersResult {
  created: number;
  /** Existing employees without a login that were linked to a user with the same email. */
  linked: number;
}

export interface SyncEnqueued {
  queued: true;
  jobId: string | null;
  lookbackDays: number;
}

/** Summary of one `sync-attendance` run. */
export interface AttendanceSyncResult {
  source: string;
  from: string;
  to: string;
  employees: number;
  attendanceRows: number;
  leavesCreated: number;
  leavesUpdated: number;
  /** Provider leave rows left alone because a person already decided them. */
  leavesPreserved: number;
}

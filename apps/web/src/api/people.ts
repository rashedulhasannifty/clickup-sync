import { apiClient } from './client';

/**
 * Mirrors `src/people/people.types.ts` and the request DTOs in
 * `src/people/dto/*` by hand. Dates are `YYYY-MM-DD` Dhaka calendar dates,
 * timestamps are ISO-8601, and `null` means "not known" — never zero.
 *
 * Row shapes are `type` aliases (not interfaces) so they satisfy DataTable's
 * `{ [key: string]: unknown }` constraint.
 */

export type EmployeeStatusValue = 'INTERN' | 'PROBATION' | 'ACTIVE' | 'NOTICE' | 'EXITED';
/** What a new employee can start as; NOTICE and EXITED come from the offboarding flow. */
export type StartingStatus = 'INTERN' | 'PROBATION' | 'ACTIVE';
export type EmploymentEventTypeValue =
  | 'JOINED'
  | 'CONFIRMED'
  | 'PROMOTED'
  | 'DESIGNATION_CHANGED'
  | 'TRANSFERRED'
  | 'NOTICE_GIVEN'
  | 'EXITED'
  | 'NOTE'
  /** Written by an approved appraisal: from/to are the old/new gross salary (whole taka), notes the percent. */
  | 'INCREMENT'
  /** An intern moved to probation: the effective date is the probation start. */
  | 'PROBATION_STARTED'
  /** from/to: the old/new internship end date (YYYY-MM-DD). */
  | 'INTERNSHIP_EXTENDED';
/**
 * `JOINED` is written by creating the employee; `NOTICE_GIVEN` and `EXITED` by the offboarding
 * flow; `INCREMENT` by an approved appraisal. None of them can be added by hand.
 */
export type ManualEventType = Exclude<EmploymentEventTypeValue, 'JOINED' | 'NOTICE_GIVEN' | 'EXITED' | 'INCREMENT'>;
export type LeaveTypeValue = 'SICK' | 'CASUAL' | 'ANNUAL' | 'UNPAID' | 'OTHER';
export type LeaveStatusValue = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** Where attendance rows came from: 'dummy' | 'stellar-csv' | 'stellar-api', else the configured provider ('none', 'stellar'). */
export type AttendanceSource = string;
/** `attendance_days.source` of one row. */
export type AttendanceRowSource = 'dummy' | 'stellar-csv' | 'stellar-api';

export type Band = 'on-track' | 'watch' | 'at-risk' | 'no-data';
/** `present`: in, on a shift that does not track punctuality. `weekend`: punched in on Sat/Sun (extra work). */
export type TodayState = 'on-time' | 'late' | 'present' | 'weekend' | 'leave' | 'not-in' | 'non-working';
/** `not-tracked`: the employee's shift does not track punctuality. */
export type KpiReason = 'not-linked' | 'no-data' | 'not-tracked';

export type EmployeeLinks = {
  /** `clickupUserId` is set, so ClickUp KPIs can be computed. */
  clickup: boolean;
  /** A login account is linked. */
  user: boolean;
};

/** Mirrors `NextAppraisal` in `src/appraisals/appraisal-schedule.ts`. */
export type NextAppraisal = {
  type: 'HALF_YEARLY' | 'CONFIRMATION' | 'YEARLY' | 'INTERNSHIP';
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  /** The due date has passed (only an intern's internship review or a probation employee's confirmation can be). */
  overdue: boolean;
};

export type EmployeeProfile = {
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
  /** When probation started: the anchor of the confirmation and yearly schedule. Null for an intern. */
  probationStartDate: string | null;
  /** The expected internship end; never null for an intern (join + 3 months by default). */
  internshipEndDate: string | null;
  confirmationDate: string | null;
  exitDate: string | null;
  status: EmployeeStatusValue;
  /** Whole months from joinDate to exitDate (or today). */
  tenureMonths: number;
  clickupUserId: string | null;
  userId: string | null;
  linked: EmployeeLinks;
  /** Stellar HRM User ID (the office door system); imports match on it. */
  attendanceId: string | null;
  /** Working shift; null = the 09:30 office default. */
  shiftId: string | null;
  shiftName: string | null;
  /** Company within the group (the appraisal form's concern name). */
  concernName: string | null;
  academicQualification: string | null;
  /** Months of experience before joining; total = this + tenure. */
  experienceBeforeJoiningMonths: number | null;
  /** Whole taka. Sensitive. */
  startingSalary: number | null;
  /** Present gross salary, whole taka; an approved appraisal increment moves it. Sensitive. */
  grossSalary: number | null;
  /** The next appraisal, counted from the probation start: the internship review for an intern, the confirmation while on probation, else the earlier of the next half-yearly and yearly. Null once exited. */
  nextAppraisal: NextAppraisal | null;
  /** Earliest first: both the next half-yearly and the next yearly once confirmed. */
  upcomingAppraisals: NextAppraisal[];
};

export type DirectoryRow = EmployeeProfile & {
  today: TodayState;
  /** 90-day overall score (0-100), null when no KPI has data. */
  score: number | null;
  band: Band;
  /** Not linked to ClickUp: the score rests on attendance alone. Show it as "Partial". */
  partial: boolean;
  /** Joining checklist progress (resolved = done or N/A); null when no checklist was started. */
  onboarding: { resolved: number; total: number } | null;
};

export type KpiResult = {
  /** Percentage, 1 decimal. null when it cannot be computed; see `reason`. */
  value: number | null;
  /** Target as a percentage. */
  target: number;
  /** Utilisation/Chargeable: hours. On-time delivery: tasks. Punctuality: days. */
  numerator: number;
  denominator: number;
  score: number | null;
  status: Band;
  reason?: KpiReason;
};

export type Kpis = {
  utilisation: KpiResult;
  chargeable: KpiResult;
  onTimeDelivery: KpiResult;
  punctuality: KpiResult;
};

export type ScoredKpi = keyof Kpis;

export type OverallScore = {
  score: number | null;
  band: Band;
  /** Not linked to ClickUp: the score rests on attendance alone. Show it as "Partial". */
  partial: boolean;
  /** The KPIs that contributed to `score`. */
  basedOn: ScoredKpi[];
};

export type TrendPoint = {
  /** Calendar month, `YYYY-MM`. */
  month: string;
  /** Overall SCORE (0-100); the four KPI fields are KPI VALUES (percentages). */
  overall: number | null;
  utilisation: number | null;
  chargeable: number | null;
  onTimeDelivery: number | null;
  punctuality: number | null;
};

export type AttendanceDayState =
  | 'on-time'
  | 'late'
  | 'present'
  | 'weekend'
  | 'absent'
  | 'sick'
  | 'casual'
  | 'leave'
  | 'future';

/** Door-system detail of a day; null/false where the source does not report it (simulated data). */
export type AttendanceDetail = {
  sessions: number | null;
  /** Summed session time, minutes. */
  workedMinutes: number | null;
  /** The last session has an in but no out. */
  missingOut: boolean;
  note: string | null;
  /** null when there is no row for the day. */
  source: AttendanceRowSource | null;
};

export type AttendanceDayView = AttendanceDetail & {
  date: string;
  state: AttendanceDayState;
  firstIn: string | null;
  lastOut: string | null;
  minutesInOffice: number | null;
};

export type AttendanceCoverage = { source: AttendanceRowSource; from: string; to: string; rows: number };

export type LeaveBalance = {
  year: number;
  casual: { used: number; entitlement: number };
  sick: { used: number; entitlement: number };
  /** Approved annual, unpaid and other leave. No entitlement tracked. */
  other: { used: number };
};

export type EmploymentEventView = {
  id: string;
  type: EmploymentEventTypeValue;
  effectiveDate: string;
  fromValue: string | null;
  toValue: string | null;
  /** Display text for from/to: team names for TRANSFERRED, otherwise the raw values. */
  fromLabel: string | null;
  toLabel: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type SummaryHours = {
  clickup: number;
  chargeable: number;
  available: number;
};

export type EmployeeSummary = {
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
};

export type TodayRow = AttendanceDetail & {
  employeeId: string;
  fullName: string;
  designation: string;
  teamName: string | null;
  state: TodayState;
  firstIn: string | null;
  lastOut: string | null;
  minutesInOffice: number | null;
  /** Has a first-in and the last session has no out yet. */
  inOffice: boolean;
};

export type TodayCounts = {
  total: number;
  inOffice: number;
  late: number;
  onLeave: number;
  notIn: number;
  pendingRequests: number;
};

export type TodayAttendance = {
  date: string;
  /** Mon-Fri. On a weekend `rows` is empty and every count is 0. */
  workingDay: boolean;
  attendanceSource: AttendanceSource;
  /** Date span of each source's rows, newest first. */
  coverage: AttendanceCoverage[];
  counts: TodayCounts;
  rows: TodayRow[];
};

export type LeaveRecordView = {
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
};

export type ImportFromUsersResult = {
  created: number;
  /** Existing employees without a login linked to a user with the same email. */
  linked: number;
};

export type SyncEnqueued = { queued: true; jobId: string | null; lookbackDays: number };

// --- request bodies -------------------------------------------------------

export type EmployeeListParams = {
  search?: string;
  status?: EmployeeStatusValue;
  teamId?: string;
};

export type CreateEmployeeBody = {
  fullName: string;
  email: string;
  employeeCode?: string;
  designation: string;
  grade?: string;
  department?: string;
  teamId?: string;
  managerId?: string;
  joinDate: string;
  /** Default PROBATION. */
  status?: StartingStatus;
  /** PROBATION/ACTIVE: default the join date. */
  probationStartDate?: string;
  /** INTERN: default join + 3 months. */
  internshipEndDate?: string;
  clickupUserId?: string;
  attendanceId?: string;
  shiftId?: string;
  concernName?: string;
  academicQualification?: string;
  experienceBeforeJoiningMonths?: number;
  startingSalary?: number;
  grossSalary?: number;
};

/** For the nullable fields `null` clears the value and omitting leaves it alone. */
export type UpdateEmployeeBody = {
  fullName?: string;
  email?: string;
  employeeCode?: string | null;
  designation?: string;
  grade?: string | null;
  department?: string | null;
  teamId?: string | null;
  managerId?: string | null;
  joinDate?: string;
  /** Not for an intern; null resets it to the join date. */
  probationStartDate?: string | null;
  /** Intern only; null resets it to join + 3 months. */
  internshipEndDate?: string | null;
  clickupUserId?: string | null;
  attendanceId?: string | null;
  shiftId?: string | null;
  concernName?: string | null;
  academicQualification?: string | null;
  experienceBeforeJoiningMonths?: number | null;
  startingSalary?: number | null;
  grossSalary?: number | null;
};

export type AddEventBody = {
  type: ManualEventType;
  effectiveDate: string;
  fromValue?: string;
  /** New designation (PROMOTED, DESIGNATION_CHANGED), team id (TRANSFERRED) or the new internship end (INTERNSHIP_EXTENDED). */
  toValue?: string;
  notes?: string;
};

export type LeaveListParams = {
  status?: LeaveStatusValue;
  from?: string;
  to?: string;
  employeeId?: string;
};

// --- shifts and Stellar HRM imports ------------------------------------------

export type ShiftView = {
  id: string;
  name: string;
  /** Minutes after Dhaka midnight. */
  startMinutes: number;
  endMinutes: number;
  graceMinutes: number;
  trackPunctuality: boolean;
  /** `HH:MM` */
  start: string;
  end: string;
  lengthHours: number;
  assignedCount: number;
};

export type ShiftBody = {
  name: string;
  startMinutes: number;
  endMinutes: number;
  graceMinutes?: number;
  trackPunctuality?: boolean;
};

export type ShiftSuggestion = {
  employeeId: string;
  fullName: string;
  currentShiftId: string | null;
  medianFirstIn: number;
  sampleDays: number;
  spreadMinutes: number;
  irregular: boolean;
  proposedShiftId: string;
  proposedShiftName: string;
  distanceMinutes: number;
  changes: boolean;
};

export type ShiftSuggestions = { period: { from: string; to: string }; suggestions: ShiftSuggestion[] };

export type UnmatchedStellarUser = { attendanceId: string; name: string; department: string | null; count: number };

export type AttendanceImportResult = {
  kind: 'attendance';
  dryRun: boolean;
  file: { rowsRead: number; ignoredRows: number; invalidRows: number };
  range: { from: string; to: string } | null;
  matched: {
    attendanceId: string;
    employeeId: string;
    fullName: string;
    stellarName: string;
    department: string | null;
    days: number;
    presentDays: number;
    noPunchDays: number;
    weekendDays: number;
    outsideEmployment: number;
    replacedDummy: number;
    replacedCsv: number;
    keptApi: number;
    dummyLeavesDeleted: number;
  }[];
  unmatched: UnmatchedStellarUser[];
  totals: {
    rowsToWrite: number;
    replacedDummy: number;
    replacedCsv: number;
    keptApi: number;
    dummyLeavesDeleted: number;
    outsideEmployment: number;
    weekendDays: number;
    unmatchedIds: number;
  };
  applied: { deleted: number; inserted: number; leavesDeleted: number } | null;
};

export type StellarLeaveFlag = {
  attendanceId: string | null;
  name: string;
  date: string | null;
  rawType: string;
  reason: 'weekend' | 'unknown-type' | 'unknown-status' | 'bad-date' | 'no-user-id';
};

export type LeaveImportResult = {
  kind: 'leaves';
  dryRun: boolean;
  file: { rowsRead: number };
  range: { from: string; to: string } | null;
  matched: {
    attendanceId: string;
    employeeId: string;
    fullName: string;
    stellarName: string;
    records: {
      type: LeaveTypeValue;
      rawType: string;
      startDate: string;
      endDate: string;
      days: number;
      status: LeaveStatusValue;
      description: string | null;
    }[];
    approvedDays: number;
    rejectedDays: number;
    outsideEmployment: number;
    replacedStellar: number;
    dummyLeavesDeleted: number;
  }[];
  unmatched: UnmatchedStellarUser[];
  skipped: StellarLeaveFlag[];
  warnings: StellarLeaveFlag[];
  totals: {
    records: number;
    approvedDays: number;
    rejectedDays: number;
    replacedStellar: number;
    dummyLeavesDeleted: number;
    outsideEmployment: number;
    skippedRows: number;
    unmatchedIds: number;
  };
  applied: { deleted: number; inserted: number } | null;
};

export type StellarExportKind = 'attendance' | 'leaves';

/** Which Stellar HRM export a file is, from its header line (mirrors `detectStellarExport`). */
export async function detectStellarExport(file: File): Promise<StellarExportKind | null> {
  const head = (await file.slice(0, 4096).text()).replace(/^\uFEFF/, '');
  const header = head.split(/\r?\n/)[0].toLowerCase();
  if (header.includes('in time') && header.includes('out time')) return 'attendance';
  if (header.includes('leave type')) return 'leaves';
  return null;
}

/** Axios drops the JSON default header for FormData and lets the browser add the multipart boundary. */
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

function csvForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export const peopleApi = {
  employees: (params: EmployeeListParams) =>
    apiClient.get<DirectoryRow[]>('/people/employees', { params }).then((r) => r.data),
  employee: (id: string) => apiClient.get<EmployeeProfile>(`/people/employees/${id}`).then((r) => r.data),
  create: (body: CreateEmployeeBody) =>
    apiClient.post<EmployeeProfile>('/people/employees', body).then((r) => r.data),
  importFromUsers: () =>
    apiClient.post<ImportFromUsersResult>('/people/employees/import-from-users').then((r) => r.data),
  update: (id: string, body: UpdateEmployeeBody) =>
    apiClient.patch<EmployeeProfile>(`/people/employees/${id}`, body).then((r) => r.data),
  summary: (id: string, params?: { from?: string; to?: string }) =>
    apiClient.get<EmployeeSummary>(`/people/employees/${id}/summary`, { params }).then((r) => r.data),
  events: (id: string) =>
    apiClient.get<EmploymentEventView[]>(`/people/employees/${id}/events`).then((r) => r.data),
  addEvent: (id: string, body: AddEventBody) =>
    apiClient.post<EmploymentEventView>(`/people/employees/${id}/events`, body).then((r) => r.data),

  today: () => apiClient.get<TodayAttendance>('/people/attendance/today').then((r) => r.data),
  syncAttendance: (lookbackDays?: number) =>
    apiClient.post<SyncEnqueued>('/people/attendance/sync', lookbackDays ? { lookbackDays } : {}).then((r) => r.data),
  leaves: (params: LeaveListParams) =>
    apiClient.get<LeaveRecordView[]>('/people/leaves', { params }).then((r) => r.data),
  decideLeave: (id: string, status: 'APPROVED' | 'REJECTED') =>
    apiClient.patch<LeaveRecordView>(`/people/leaves/${id}`, { status }).then((r) => r.data),

  importStellarAttendance: (file: File, dryRun: boolean) =>
    apiClient
      .post<AttendanceImportResult>('/people/attendance/import/stellar', csvForm(file), {
        ...MULTIPART,
        params: { dryRun: String(dryRun) },
      })
      .then((r) => r.data),
  importStellarLeaves: (file: File, dryRun: boolean) =>
    apiClient
      .post<LeaveImportResult>('/people/attendance/import/stellar-leaves', csvForm(file), {
        ...MULTIPART,
        params: { dryRun: String(dryRun) },
      })
      .then((r) => r.data),

  shifts: () => apiClient.get<ShiftView[]>('/people/shifts').then((r) => r.data),
  createShift: (body: ShiftBody) => apiClient.post<ShiftView>('/people/shifts', body).then((r) => r.data),
  updateShift: (id: string, body: Partial<ShiftBody>) =>
    apiClient.patch<ShiftView>(`/people/shifts/${id}`, body).then((r) => r.data),
  deleteShift: (id: string) => apiClient.delete(`/people/shifts/${id}`).then(() => undefined),
  shiftSuggestions: () => apiClient.get<ShiftSuggestions>('/people/shifts/suggestions').then((r) => r.data),
  assignShifts: (assignments: { employeeId: string; shiftId: string | null }[]) =>
    apiClient.post<{ updated: number }>('/people/shifts/assign', { assignments }).then((r) => r.data),
};

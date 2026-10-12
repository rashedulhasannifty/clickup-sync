import { apiClient } from './client';

/**
 * Mirrors `src/people/people.types.ts` and the request DTOs in
 * `src/people/dto/*` by hand. Dates are `YYYY-MM-DD` Dhaka calendar dates,
 * timestamps are ISO-8601, and `null` means "not known" — never zero.
 *
 * Row shapes are `type` aliases (not interfaces) so they satisfy DataTable's
 * `{ [key: string]: unknown }` constraint.
 */

export type EmployeeStatusValue = 'PROBATION' | 'ACTIVE' | 'NOTICE' | 'EXITED';
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
  | 'INCREMENT';
/**
 * `JOINED` is written by creating the employee; `NOTICE_GIVEN` and `EXITED` by the offboarding
 * flow; `INCREMENT` by an approved appraisal. None of them can be added by hand.
 */
export type ManualEventType = Exclude<EmploymentEventTypeValue, 'JOINED' | 'NOTICE_GIVEN' | 'EXITED' | 'INCREMENT'>;
export type LeaveTypeValue = 'SICK' | 'CASUAL' | 'ANNUAL' | 'UNPAID' | 'OTHER';
export type LeaveStatusValue = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** Where attendance rows came from: 'dummy' | 'none' | a real provider's name. */
export type AttendanceSource = string;

export type Band = 'on-track' | 'watch' | 'at-risk' | 'no-data';
export type TodayState = 'on-time' | 'late' | 'leave' | 'not-in' | 'non-working';
export type KpiReason = 'not-linked' | 'no-data';

export type EmployeeLinks = {
  /** `clickupUserId` is set, so ClickUp KPIs can be computed. */
  clickup: boolean;
  /** A login account is linked. */
  user: boolean;
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
  confirmationDate: string | null;
  exitDate: string | null;
  status: EmployeeStatusValue;
  /** Whole months from joinDate to exitDate (or today). */
  tenureMonths: number;
  clickupUserId: string | null;
  userId: string | null;
  linked: EmployeeLinks;
  /** Company within the group (the appraisal form's concern name). */
  concernName: string | null;
  academicQualification: string | null;
  /** Months of experience before joining; total = this + tenure. */
  experienceBeforeJoiningMonths: number | null;
  /** Whole taka. Sensitive. */
  startingSalary: number | null;
  /** Present gross salary, whole taka; an approved appraisal increment moves it. Sensitive. */
  grossSalary: number | null;
};

export type DirectoryRow = EmployeeProfile & {
  today: TodayState;
  /** 90-day overall score (0-100), null when no KPI has data. */
  score: number | null;
  band: Band;
  /** Not linked to ClickUp: the score rests on attendance alone. Show it as "Partial". */
  partial: boolean;
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

export type AttendanceDayState = 'on-time' | 'late' | 'absent' | 'sick' | 'casual' | 'leave' | 'future';

export type AttendanceDayView = {
  date: string;
  state: AttendanceDayState;
  firstIn: string | null;
  lastOut: string | null;
  minutesInOffice: number | null;
};

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

export type TodayRow = {
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
  clickupUserId?: string;
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
  clickupUserId?: string | null;
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
  /** New designation (PROMOTED, DESIGNATION_CHANGED) or team id (TRANSFERRED). */
  toValue?: string;
  notes?: string;
};

export type LeaveListParams = {
  status?: LeaveStatusValue;
  from?: string;
  to?: string;
  employeeId?: string;
};

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
};

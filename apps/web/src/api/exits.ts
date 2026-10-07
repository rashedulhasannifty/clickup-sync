import { apiClient } from './client';

/**
 * Mirrors `src/exits/exits.types.ts` and the request DTOs in `src/exits/dto/exit.dto.ts` by hand.
 * Dates are `YYYY-MM-DD` Dhaka calendar dates, timestamps are ISO-8601, null means "not recorded".
 * Row shapes are `type` aliases so they satisfy DataTable's `{ [key: string]: unknown }` constraint.
 */

export type ExitStatusValue = 'NOTICE' | 'INTERVIEW' | 'CLEARANCE' | 'COMPLETED' | 'CANCELLED';
export type ExitTypeValue = 'RESIGNATION' | 'TERMINATION' | 'CONTRACT_END' | 'OTHER';
export type ExitInterviewReasonValue =
  | 'CAREER_GROWTH'
  | 'COMPENSATION'
  | 'MANAGEMENT'
  | 'WORK_LIFE_BALANCE'
  | 'RELOCATION'
  | 'STUDIES'
  | 'OTHER';
export type ExitAnswerValue = 'YES' | 'MAYBE' | 'NO';
export type LetterKind = 'experience' | 'release';
export type ExitListFilter = 'active' | ExitStatusValue;

export type ClearanceItemView = {
  id: string;
  label: string;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
  note: string | null;
};

export type ExitInterviewView = {
  primaryReason: ExitInterviewReasonValue | null;
  ratings: {
    role: number | null;
    teamLead: number | null;
    compensation: number | null;
    growth: number | null;
    environment: number | null;
  };
  couldHaveDone: string | null;
  wouldRecommend: ExitAnswerValue | null;
  wouldRejoin: ExitAnswerValue | null;
  notes: string | null;
  conductedByName: string | null;
  conductedAt: string;
};

export type ExitDocumentView = {
  id: string;
  docType: string;
  fileName: string;
  contentType: string;
  version: number;
  createdAt: string;
};

export type ExitAllowed = {
  edit: boolean;
  advance: boolean;
  complete: boolean;
  cancel: boolean;
  letters: boolean;
};

export type ExitView = {
  id: string;
  employee: {
    id: string;
    fullName: string;
    employeeCode: string | null;
    designation: string;
    department: string | null;
    teamName: string | null;
    joinDate: string;
    status: 'PROBATION' | 'ACTIVE' | 'NOTICE' | 'EXITED';
    hasLogin: boolean;
  };
  type: ExitTypeValue;
  status: ExitStatusValue;
  noticeDate: string;
  lastWorkingDay: string;
  reason: string | null;
  interview: ExitInterviewView | null;
  clearance: { items: ClearanceItemView[]; done: number; total: number };
  documents: ExitDocumentView[];
  allowed: ExitAllowed;
  overrideNote: string | null;
  loginDisabled: boolean;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
  createdAt: string;
};

export type EmployeeExitResponse = { exit: ExitView | null };

export type ExitListRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  designation: string;
  teamName: string | null;
  type: ExitTypeValue;
  status: ExitStatusValue;
  noticeDate: string;
  lastWorkingDay: string;
  clearanceDone: number;
  clearanceTotal: number;
  createdAt: string;
};

export type StartExitBody = {
  type: ExitTypeValue;
  noticeDate: string;
  lastWorkingDay: string;
  reason?: string;
};

export type UpdateExitBody = {
  type?: ExitTypeValue;
  noticeDate?: string;
  lastWorkingDay?: string;
  /** `null` clears the reason. */
  reason?: string | null;
};

export type InterviewBody = {
  primaryReason?: ExitInterviewReasonValue;
  ratingRole?: number;
  ratingTeamLead?: number;
  ratingCompensation?: number;
  ratingGrowth?: number;
  ratingEnvironment?: number;
  couldHaveDone?: string;
  wouldRecommend?: ExitAnswerValue;
  wouldRejoin?: ExitAnswerValue;
  notes?: string;
};

export type ClearanceItemPatch = { done?: boolean; label?: string; note?: string | null };
export type CompleteExitBody = { disableLogin?: boolean; overrideNote?: string };

export const EXIT_TYPE_LABEL: Record<ExitTypeValue, string> = {
  RESIGNATION: 'Resignation',
  TERMINATION: 'Termination',
  CONTRACT_END: 'Contract end',
  OTHER: 'Other',
};

export const EXIT_STATUS_LABEL: Record<ExitStatusValue, string> = {
  NOTICE: 'Notice period',
  INTERVIEW: 'Exit interview',
  CLEARANCE: 'Clearance',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const EXIT_STATUS_TONE: Record<ExitStatusValue, 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'purple'> = {
  NOTICE: 'amber',
  INTERVIEW: 'blue',
  CLEARANCE: 'purple',
  COMPLETED: 'green',
  CANCELLED: 'gray',
};

export const INTERVIEW_REASON_LABEL: Record<ExitInterviewReasonValue, string> = {
  CAREER_GROWTH: 'Career growth',
  COMPENSATION: 'Compensation',
  MANAGEMENT: 'Management',
  WORK_LIFE_BALANCE: 'Work-life balance',
  RELOCATION: 'Relocation',
  STUDIES: 'Studies',
  OTHER: 'Other',
};

const base = (id: string) => `/people/exits/${encodeURIComponent(id)}`;

export const exitsApi = {
  forEmployee: (employeeId: string) =>
    apiClient.get<EmployeeExitResponse>(`/people/employees/${encodeURIComponent(employeeId)}/exit`).then((r) => r.data),
  list: (status?: ExitListFilter) =>
    apiClient.get<ExitListRow[]>('/people/exits', { params: status ? { status } : undefined }).then((r) => r.data),
  start: (employeeId: string, body: StartExitBody) =>
    apiClient.post<ExitView>(`/people/employees/${encodeURIComponent(employeeId)}/exit`, body).then((r) => r.data),
  update: (id: string, body: UpdateExitBody) => apiClient.patch<ExitView>(base(id), body).then((r) => r.data),
  saveInterview: (id: string, body: InterviewBody) =>
    apiClient.put<ExitView>(`${base(id)}/interview`, body).then((r) => r.data),
  addItem: (id: string, label: string) =>
    apiClient.post<ExitView>(`${base(id)}/clearance-items`, { label }).then((r) => r.data),
  updateItem: (id: string, itemId: string, body: ClearanceItemPatch) =>
    apiClient.patch<ExitView>(`${base(id)}/clearance-items/${encodeURIComponent(itemId)}`, body).then((r) => r.data),
  removeItem: (id: string, itemId: string) =>
    apiClient.delete<ExitView>(`${base(id)}/clearance-items/${encodeURIComponent(itemId)}`).then((r) => r.data),
  generateLetter: (id: string, kind: LetterKind) =>
    apiClient.post<ExitDocumentView>(`${base(id)}/letters/${kind}`).then((r) => r.data),
  advance: (id: string) => apiClient.post<ExitView>(`${base(id)}/advance`).then((r) => r.data),
  complete: (id: string, body: CompleteExitBody) =>
    apiClient.post<ExitView>(`${base(id)}/complete`, body).then((r) => r.data),
  cancel: (id: string, note: string) => apiClient.post<ExitView>(`${base(id)}/cancel`, { note }).then((r) => r.data),
};

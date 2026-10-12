import { apiClient } from './client';
import type { AppraisalAction, AppraisalType, FormGrade } from './appraisals';
import type { EmployeeStatusValue, EmploymentEventView } from './people';

/**
 * Mirrors `src/people/past-records/past-records.types.ts` and its DTOs by hand.
 * Past records are an employee's history from before the system: ordinary
 * employment events with source PAST_RECORD, and past (paper) appraisals. A
 * record id is `event:<id>` or `appraisal:<id>`.
 */

/** One row as the server reads it. Every field is loose text (or a number); the server checks it. */
export type PastRecordRow = {
  /** The sheet's own row number, so errors point at the right line. */
  row: number;
  /** Email or employee code. */
  employee?: string;
  record?: string;
  date?: string | number;
  from?: string | number;
  to?: string | number;
  amount?: string | number;
  grade?: string;
  marks?: string | number;
  appraisalType?: string;
  actions?: string;
  dueDate?: string | number;
  outcome?: string;
  notes?: string;
};

/** The per-employee editor's body: one record, no employee. */
export type PastRecordBody = Omit<PastRecordRow, 'row' | 'employee'> & {
  /** Appraisal: an employee document (the scanned form); null unlinks. */
  documentId?: string | null;
};

export type RowError = { row: number; field: string; message: string };

export type SummarySide = {
  status: EmployeeStatusValue;
  designation: string;
  teamId: string | null;
  teamName: string | null;
  /** Whole taka. Sensitive. */
  grossSalary: number | null;
  joinDate: string;
  probationStartDate: string | null;
  confirmationDate: string | null;
  nextAppraisal: { type: AppraisalType; dueDate: string; overdue: boolean } | null;
  overdue: { type: AppraisalType; dueDate: string }[];
};

export type PastRecordsEmployeeSummary = {
  employeeId: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  before: SummarySide;
  after: SummarySide;
  changed: ('status' | 'designation' | 'teamId' | 'grossSalary' | 'joinDate' | 'probationStartDate' | 'confirmationDate')[];
  overdueCleared: { type: AppraisalType; dueDate: string }[];
  eventsToAdd: number;
  appraisalsToAdd: number;
  alreadyRecorded: number;
  rowsWithErrors: number;
  warnings: string[];
};

export type PastRecordsPreview = {
  rowCount: number;
  errors: RowError[];
  alreadyRecorded: number;
  recordsToAdd: number;
  employees: PastRecordsEmployeeSummary[];
};

export type PastRecordsApplyResult = {
  eventsAdded: number;
  appraisalsAdded: number;
  alreadyRecorded: number;
  employeesUpdated: number;
};

export type PastAppraisalView = {
  /** `appraisal:<id>` */
  id: string;
  type: AppraisalType;
  conductedOn: string;
  dueDate: string | null;
  marks: number | null;
  grade: FormGrade | null;
  outcome: string | null;
  actions: AppraisalAction[];
  notes: string | null;
  document: { id: string; fileName: string } | null;
  createdByName: string | null;
  createdAt: string;
};

export type EmployeePastRecords = {
  events: EmploymentEventView[];
  appraisals: PastAppraisalView[];
};

const base = (employeeId: string) => `/people/employees/${encodeURIComponent(employeeId)}/past-records`;

export const pastRecordsApi = {
  preview: (rows: PastRecordRow[]) =>
    apiClient.post<PastRecordsPreview>('/people/past-records/preview', { rows }).then((r) => r.data),
  apply: (rows: PastRecordRow[]) =>
    apiClient.post<PastRecordsApplyResult>('/people/past-records/apply', { rows }).then((r) => r.data),
  list: (employeeId: string) => apiClient.get<EmployeePastRecords>(base(employeeId)).then((r) => r.data),
  add: (employeeId: string, body: PastRecordBody) =>
    apiClient.post<EmployeePastRecords>(base(employeeId), body).then((r) => r.data),
  update: (employeeId: string, recordId: string, body: PastRecordBody) =>
    apiClient
      .patch<EmployeePastRecords>(`${base(employeeId)}/${encodeURIComponent(recordId)}`, body)
      .then((r) => r.data),
  remove: (employeeId: string, recordId: string) =>
    apiClient.delete<EmployeePastRecords>(`${base(employeeId)}/${encodeURIComponent(recordId)}`).then((r) => r.data),
};

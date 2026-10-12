/**
 * Response shapes for the exit / offboarding endpoints under `/api/people`. The frontend mirrors
 * these by hand (`apps/web/src/api/exits.ts`), so they are explicit: dates are `YYYY-MM-DD`
 * Dhaka calendar dates, timestamps are ISO-8601 strings, and null means "not recorded".
 */

import type {
  EmployeeStatusName,
  ExitChecklistGroupValue,
  ExitStatusValue,
  ExitTypeValue,
} from './exit-status';
import type { LetterKind } from './letter-content';

export type {
  ExitChecklistGroupValue,
  ExitStatusValue,
  ExitTypeValue,
  LetterKind,
};

export type ExitInterviewReasonValue =
  | 'CAREER_GROWTH'
  | 'COMPENSATION'
  | 'MANAGEMENT'
  | 'WORK_LIFE_BALANCE'
  | 'RELOCATION'
  | 'STUDIES'
  | 'OTHER';

export type ExitAnswerValue = 'YES' | 'MAYBE' | 'NO';

export interface ClearanceItemView {
  id: string;
  /** PROCESS = process tasks, ASSETS = company assets to collect. */
  group: ExitChecklistGroupValue;
  /** Stable id of a seeded item (e.g. `exit_interview`); null for a custom item. */
  key: string | null;
  label: string;
  done: boolean;
  doneAt: string | null;
  /** Name (or email) of whoever ticked it; null when open, for a machine credential or a deleted user. */
  doneByName: string | null;
  /** Marked not applicable. Never true together with `done`. */
  notApplicable: boolean;
  notApplicableAt: string | null;
  notApplicableByName: string | null;
  note: string | null;
}

export interface ExitInterviewView {
  primaryReason: ExitInterviewReasonValue | null;
  /** 1-5 each; null = not rated. */
  ratings: {
    role: number | null;
    teamLead: number | null;
    compensation: number | null;
    growth: number | null;
    environment: number | null;
  };
  /** "What could we have done to keep you?" */
  couldHaveDone: string | null;
  wouldRecommend: ExitAnswerValue | null;
  wouldRejoin: ExitAnswerValue | null;
  /** HR only. */
  notes: string | null;
  conductedByName: string | null;
  conductedAt: string;
}

/** A current document in the employee's EXIT category (resignation letter, generated letters...). */
export interface ExitDocumentView {
  id: string;
  docType: string;
  fileName: string;
  contentType: string;
  version: number;
  createdAt: string;
}

/** What the exit allows right now; the UI shows or hides controls from this, the API enforces it. */
export interface ExitAllowed {
  edit: boolean;
  advance: boolean;
  complete: boolean;
  cancel: boolean;
  letters: boolean;
}

export interface ExitEmployeeView {
  id: string;
  fullName: string;
  employeeCode: string | null;
  designation: string;
  department: string | null;
  teamName: string | null;
  joinDate: string;
  status: EmployeeStatusName;
  /** A login account is linked, so `disableLogin` on complete has something to do. */
  hasLogin: boolean;
}

export interface ExitView {
  id: string;
  employee: ExitEmployeeView;
  type: ExitTypeValue;
  status: ExitStatusValue;
  noticeDate: string;
  lastWorkingDay: string;
  reason: string | null;
  /** null until an interview is saved. */
  interview: ExitInterviewView | null;
  clearance: {
    items: ClearanceItemView[];
    done: number;
    notApplicable: number;
    /** done + notApplicable: the items that no longer block completion. */
    resolved: number;
    total: number;
  };
  documents: ExitDocumentView[];
  allowed: ExitAllowed;
  /** The note given when the exit was completed with clearance items still open. */
  overrideNote: string | null;
  /** The linked login was disabled when the exit completed. */
  loginDisabled: boolean;
  completedAt: string | null;
  /** Who completed (approved) the exit; null for a machine credential or a deleted user. */
  completedByName: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
  createdAt: string;
}

/** `GET /people/employees/:id/exit`: an envelope, because a bare `null` body arrives as an empty string. */
export interface EmployeeExitResponse {
  exit: ExitView | null;
}

export interface ExitListRow {
  id: string;
  employeeId: string;
  employeeName: string;
  designation: string;
  teamName: string | null;
  type: ExitTypeValue;
  status: ExitStatusValue;
  noticeDate: string;
  lastWorkingDay: string;
  /** Items done or not applicable. */
  clearanceResolved: number;
  clearanceTotal: number;
  createdAt: string;
}

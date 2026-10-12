import type {
  AppraisalActionValue,
  AppraisalTypeValue,
  FormGrade,
} from '../../appraisals/appraisals.types';
import type { EmploymentEventView } from '../people.types';
import type { RowError } from './past-record-rules';
import type { HistoryOutlook } from './past-record-rules';

/**
 * Response shapes for `/api/people/past-records/*` and
 * `/api/people/employees/:id/past-records` (0035). The frontend mirrors them by
 * hand. A record id is `event:<id>` for a past employment event and
 * `appraisal:<id>` for a past appraisal.
 */

/** One side of an employee's before -> after in the preview. Holds a salary: Owner/Admin only. */
export interface SummarySide extends HistoryOutlook {
  teamName: string | null;
}

export interface PastRecordsEmployeeSummary {
  employeeId: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  before: SummarySide;
  after: SummarySide;
  /** The fields that differ between before and after. */
  changed: (
    | 'status'
    | 'designation'
    | 'teamId'
    | 'grossSalary'
    | 'joinDate'
    | 'probationStartDate'
    | 'confirmationDate'
  )[];
  /** Overdue appraisals a past appraisal now covers. */
  overdueCleared: { type: AppraisalTypeValue; dueDate: string }[];
  eventsToAdd: number;
  appraisalsToAdd: number;
  alreadyRecorded: number;
  rowsWithErrors: number;
  warnings: string[];
}

export interface PastRecordsPreview {
  rowCount: number;
  /** Per row and field, sorted by row. Apply is refused while any remain. */
  errors: RowError[];
  /** Rows identical to something already recorded: skipped, not errors. */
  alreadyRecorded: number;
  recordsToAdd: number;
  employees: PastRecordsEmployeeSummary[];
}

export interface PastRecordsApplyResult {
  eventsAdded: number;
  appraisalsAdded: number;
  alreadyRecorded: number;
  employeesUpdated: number;
}

export interface PastAppraisalView {
  /** `appraisal:<id>` */
  id: string;
  type: AppraisalTypeValue;
  conductedOn: string;
  dueDate: string | null;
  marks: number | null;
  grade: FormGrade | null;
  outcome: string | null;
  actions: AppraisalActionValue[];
  notes: string | null;
  /** The linked scan, while that document still exists. */
  document: { id: string; fileName: string } | null;
  createdByName: string | null;
  createdAt: string;
}

/** An employee's past records. Event ids are plain; address one as `event:<id>`. */
export interface EmployeePastRecords {
  events: EmploymentEventView[];
  appraisals: PastAppraisalView[];
}

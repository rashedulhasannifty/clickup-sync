import type {
  EmployeeStatusValue,
  EmploymentEventTypeValue,
} from './people.types';

/**
 * What an employment event does to the employee row. Pure so the table of
 * side-effects (spec "Event side-effects") is testable without a database. The
 * repository applies the patch in the same transaction as the event insert.
 *
 * Dates are `YYYY-MM-DD`. Only keys that change are present.
 */
export interface EmployeePatch {
  designation?: string;
  confirmationDate?: string;
  exitDate?: string;
  status?: EmployeeStatusValue;
  teamId?: string;
  /** INCREMENT: the new gross salary, whole taka. */
  grossSalary?: number;
  /** PROBATION_STARTED: the regular appraisal schedule's new anchor. */
  probationStartDate?: string;
  /** INTERNSHIP_EXTENDED: the new expected internship end. */
  internshipEndDate?: string;
}

/** Events whose `toValue` is the new value and is therefore required. */
export const EVENT_REQUIRES_TO_VALUE: ReadonlySet<EmploymentEventTypeValue> =
  new Set([
    'PROMOTED',
    'DESIGNATION_CHANGED',
    'TRANSFERRED',
    'INTERNSHIP_EXTENDED',
  ]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (v: string | null): v is string =>
  v !== null &&
  DATE_ONLY.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/**
 * Why an event cannot be written for this employee as they stand (null when
 * it can). The lifecycle rules (0034): only an intern moves to probation (on
 * or after joining) or has the internship extended (to a later end date); an
 * intern is never confirmed directly.
 */
export function eventPreconditionError(a: {
  type: EmploymentEventTypeValue;
  effectiveDate: string;
  toValue: string | null;
  status: EmployeeStatusValue;
  joinDate: string;
  /** The current expected internship end (stored, else join + 3 months). */
  internshipEndDate: string;
}): string | null {
  switch (a.type) {
    case 'CONFIRMED':
      return a.status === 'INTERN'
        ? 'An intern cannot be confirmed: move them to probation first'
        : null;
    case 'PROBATION_STARTED':
      if (a.status !== 'INTERN')
        return 'Only an intern can be moved to probation';
      if (a.effectiveDate < a.joinDate)
        return 'Probation cannot start before the employee joined';
      return null;
    case 'INTERNSHIP_EXTENDED':
      if (a.status !== 'INTERN')
        return 'Only an intern’s internship can be extended';
      if (!isDateOnly(a.toValue))
        return 'The new internship end (toValue) must be a YYYY-MM-DD date';
      if (a.toValue <= a.internshipEndDate)
        return `The new internship end must be after the current one (${a.internshipEndDate})`;
      return null;
    default:
      return null;
  }
}

export function eventEffects(args: {
  type: EmploymentEventTypeValue;
  effectiveDate: string;
  toValue: string | null;
  /** For TRANSFERRED: `toValue` is the id of a team in the employee's org. */
  teamResolves: boolean;
}): EmployeePatch {
  const { type, effectiveDate, toValue, teamResolves } = args;
  switch (type) {
    case 'PROMOTED':
    case 'DESIGNATION_CHANGED':
      return toValue ? { designation: toValue } : {};
    case 'CONFIRMED':
      return { confirmationDate: effectiveDate, status: 'ACTIVE' };
    case 'NOTICE_GIVEN':
      return { status: 'NOTICE' };
    case 'EXITED':
      return { exitDate: effectiveDate, status: 'EXITED' };
    case 'TRANSFERRED':
      return toValue && teamResolves ? { teamId: toValue } : {};
    case 'PROBATION_STARTED':
      return { status: 'PROBATION', probationStartDate: effectiveDate };
    case 'JOINED_AS_INTERN':
      // Past records only. The join date and the cleared probation/confirmation dates are the
      // history fold's job (`foldEmployeeHistory`), which is the only path that replays it.
      return { status: 'INTERN' };
    case 'INTERNSHIP_EXTENDED':
      return isDateOnly(toValue) ? { internshipEndDate: toValue } : {};
    case 'INCREMENT':
      // toValue is the new gross salary; anything but whole taka is history only.
      return toValue && /^\d+$/.test(toValue)
        ? { grossSalary: Number(toValue) }
        : {};
    case 'JOINED':
    case 'NOTE':
      return {};
  }
}

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
}

/** Events whose `toValue` is the new value and is therefore required. */
export const EVENT_REQUIRES_TO_VALUE: ReadonlySet<EmploymentEventTypeValue> =
  new Set(['PROMOTED', 'DESIGNATION_CHANGED', 'TRANSFERRED']);

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

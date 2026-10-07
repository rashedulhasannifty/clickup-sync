import type { LeaveStatusValue, LeaveTypeValue } from './people.types';

/** DI token for the configured `AttendanceProvider` (see PeopleModule). */
export const ATTENDANCE_PROVIDER = 'ATTENDANCE_PROVIDER';

/** Who to fetch for. Providers key everything on the employee's email. */
export interface ProviderPerson {
  email: string;
  /** `YYYY-MM-DD` */
  joinDate: string;
  /** `YYYY-MM-DD`, or null while still employed. */
  exitDate: string | null;
}

export interface ProviderAttendanceRow {
  email: string;
  /** Dhaka calendar date, `YYYY-MM-DD`. */
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
}

export interface ProviderLeaveRow {
  email: string;
  /** Stable per leave; with the provider's `source` it is the upsert key. */
  externalId: string;
  type: LeaveTypeValue;
  startDate: string;
  /** Inclusive. */
  endDate: string;
  days: number;
  status: LeaveStatusValue;
  reason?: string;
}

export interface AttendanceFetchResult {
  attendance: ProviderAttendanceRow[];
  leaves: ProviderLeaveRow[];
}

/**
 * The seam the real office-entry/exit and leave API plugs into. The provider
 * absorbs the real API's shape; the tables do not change. `from`/`to` are
 * `YYYY-MM-DD` Dhaka dates, inclusive. Leave rows may fall outside the window
 * (e.g. pending requests for the coming weeks).
 */
export interface AttendanceProvider {
  /** Stamped on every row this provider writes (`attendance_days.source`, `leave_records.source`). */
  readonly source: string;
  fetch(
    people: ProviderPerson[],
    from: string,
    to: string,
  ): Promise<AttendanceFetchResult>;
}

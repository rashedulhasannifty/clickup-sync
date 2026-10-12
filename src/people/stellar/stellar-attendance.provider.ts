import type {
  AttendanceFetchResult,
  AttendanceProvider,
  ProviderPerson,
} from '../attendance-provider';
import { StellarApiClient } from './stellar-api.client';

/**
 * `ATTENDANCE_PROVIDER=stellar`: Stellar HRM, the office door and attendance
 * system. Its API is not built yet (see `StellarApiClient`), so `canSync` is
 * false: the crons log and skip, and rows come from the Owner/Admin CSV
 * imports. Once the client exists this provider delegates to it.
 */
export class StellarAttendanceProvider implements AttendanceProvider {
  readonly source = 'stellar';
  readonly attendanceSource = 'STELLAR_API' as const;

  constructor(private readonly api: StellarApiClient = new StellarApiClient()) {}

  get canSync(): boolean {
    return this.api.configured;
  }

  fetch(
    people: ProviderPerson[],
    from: string,
    to: string,
  ): Promise<AttendanceFetchResult> {
    if (!this.api.configured)
      return Promise.resolve({ attendance: [], leaves: [] });
    return this.api.fetch(people, from, to);
  }
}

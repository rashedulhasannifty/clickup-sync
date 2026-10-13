import type {
  AttendanceFetchResult,
  AttendanceProvider,
  ProviderPerson,
} from '../attendance-provider';
import { MAX_DAYS_PER_CALL, StellarApiClient } from './stellar-api.client';
import { aggregateStellarDays } from './stellar-csv';
import { pairPunches } from './stellar-log';

/**
 * `ATTENDANCE_PROVIDER=stellar`: Stellar HRM, the office door system. With
 * `STELLAR_AUTH_USER`/`STELLAR_AUTH_CODE` set it syncs from the API (rows
 * stamped `STELLAR_API`, which an import never overwrites); without them
 * `canSync` is false and rows come from the Owner/Admin CSV imports. The API
 * has no leave: Stellar leave still arrives through the leave CSV import.
 */
export class StellarAttendanceProvider implements AttendanceProvider {
  readonly source = 'stellar';
  readonly attendanceSource = 'STELLAR_API' as const;
  readonly maxDaysPerFetch = MAX_DAYS_PER_CALL;

  constructor(private readonly api: StellarApiClient) {}

  get canSync(): boolean {
    return this.api.configured;
  }

  async fetch(
    people: ProviderPerson[],
    from: string,
    to: string,
  ): Promise<AttendanceFetchResult> {
    if (!this.api.configured) return { attendance: [], leaves: [] };
    const log = await this.api.fetchLog(from, to);
    const byId = new Map(
      people.flatMap((p) => (p.attendanceId ? [[p.attendanceId, p] as const] : [])),
    );
    const unmatched = new Set<string>();
    const attendance: AttendanceFetchResult['attendance'] = [];
    for (const day of aggregateStellarDays(pairPunches(log.punches))) {
      const person = byId.get(day.attendanceId);
      if (!person) {
        unmatched.add(day.attendanceId);
        continue;
      }
      // Only days inside the employment: a badge used before joining or after leaving is not attendance.
      if (day.date < person.joinDate || (person.exitDate && day.date > person.exitDate)) continue;
      attendance.push({
        email: person.email,
        date: day.date,
        firstIn: day.firstIn,
        lastOut: day.lastOut,
        sessions: day.sessions,
        workedMinutes: day.workedMinutes,
        missingOut: day.missingOut,
        note: day.note,
      });
    }
    return { attendance, leaves: [], unmatchedIds: [...unmatched].sort() };
  }
}

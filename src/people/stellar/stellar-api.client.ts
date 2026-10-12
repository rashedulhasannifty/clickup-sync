import type { AttendanceFetchResult, ProviderPerson } from '../attendance-provider';

/**
 * Stellar HRM API client: NOT IMPLEMENTED YET.
 *
 * TODO(stellar-api): Stellar HRM (the office door / attendance system) will expose
 * its punches and leaves over an API. When it does, implement `fetch` here:
 * - key people on `Employee.attendanceId` (the numeric Stellar User ID), not email,
 *   so `ProviderPerson` will need to carry it;
 * - reuse `aggregateStellarDays` from `stellar-csv.ts` for the per-day maths, so the
 *   API and the CSV import produce identical rows;
 * - stamp attendance `STELLAR_API` and leaves `source = 'stellar'`;
 * - then flip `StellarAttendanceProvider.canSync` to true. Until then the scheduled
 *   sync logs and skips, and real data arrives through the CSV import
 *   (`POST /people/attendance/import/stellar`, `.../import/stellar-leaves`).
 * Never log a leave's description: it can hold health and family details.
 */
export class StellarApiClient {
  readonly configured = false;

  fetch(
    _people: ProviderPerson[],
    _from: string,
    _to: string,
  ): Promise<AttendanceFetchResult> {
    return Promise.reject(
      new Error('Stellar HRM API client is not implemented yet'),
    );
  }
}

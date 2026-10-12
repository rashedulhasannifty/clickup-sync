import type { AttendanceSource } from '@prisma/client';

/**
 * `attendance_days.source` as the API reports it. The web app predates the enum
 * and keys on these lowercase strings (`'dummy'` shows the demo-data badge).
 */
export type AttendanceSourceLabel = 'dummy' | 'stellar-csv' | 'stellar-api';

const LABELS: Record<AttendanceSource, AttendanceSourceLabel> = {
  DUMMY: 'dummy',
  STELLAR_CSV: 'stellar-csv',
  STELLAR_API: 'stellar-api',
};

export function sourceLabel(source: AttendanceSource): AttendanceSourceLabel {
  return LABELS[source];
}

/** Real door data, as opposed to the simulated rows. */
export function isRealSource(source: AttendanceSource): boolean {
  return source !== 'DUMMY';
}

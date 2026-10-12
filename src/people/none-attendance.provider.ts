import type {
  AttendanceFetchResult,
  AttendanceProvider,
} from './attendance-provider';

/** `ATTENDANCE_PROVIDER=none`: no attendance source is configured, so a sync is a no-op. */
export class NoneAttendanceProvider implements AttendanceProvider {
  readonly source = 'none';
  readonly attendanceSource = null;
  readonly canSync = false;

  fetch(): Promise<AttendanceFetchResult> {
    return Promise.resolve({ attendance: [], leaves: [] });
  }
}

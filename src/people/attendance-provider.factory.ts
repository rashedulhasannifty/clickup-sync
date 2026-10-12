import type { AttendanceProviderName } from '../config/env.validation';
import type { AttendanceProvider } from './attendance-provider';
import { DummyAttendanceProvider } from './dummy-attendance.provider';
import { NoneAttendanceProvider } from './none-attendance.provider';
import { StellarAttendanceProvider } from './stellar/stellar-attendance.provider';

/** The provider for an (already resolved) `ATTENDANCE_PROVIDER`. The tables never change with it. */
export function createAttendanceProvider(
  name: AttendanceProviderName,
): AttendanceProvider {
  switch (name) {
    case 'dummy':
      return new DummyAttendanceProvider();
    case 'stellar':
      return new StellarAttendanceProvider();
    case 'none':
      return new NoneAttendanceProvider();
  }
}

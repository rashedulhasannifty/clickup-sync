import type { AttendanceProviderName } from '../config/env.validation';
import type { AttendanceProvider } from './attendance-provider';
import { DummyAttendanceProvider } from './dummy-attendance.provider';
import { NoneAttendanceProvider } from './none-attendance.provider';
import { StellarApiClient } from './stellar/stellar-api.client';
import { StellarAttendanceProvider } from './stellar/stellar-attendance.provider';

/** The provider for an (already resolved) `ATTENDANCE_PROVIDER`. The tables never change with it. */
export function createAttendanceProvider(
  name: AttendanceProviderName,
  deps: { stellar?: StellarApiClient } = {},
): AttendanceProvider {
  switch (name) {
    case 'dummy':
      return new DummyAttendanceProvider();
    case 'stellar':
      return new StellarAttendanceProvider(
        deps.stellar ??
          new StellarApiClient(null, () =>
            Promise.reject(new Error('no Redis for Stellar HRM')),
          ),
      );
    case 'none':
      return new NoneAttendanceProvider();
  }
}

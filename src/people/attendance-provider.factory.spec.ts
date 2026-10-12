import { createAttendanceProvider } from './attendance-provider.factory';
import { DummyAttendanceProvider } from './dummy-attendance.provider';
import { NoneAttendanceProvider } from './none-attendance.provider';
import { StellarAttendanceProvider } from './stellar/stellar-attendance.provider';

describe('createAttendanceProvider', () => {
  it('maps each ATTENDANCE_PROVIDER value to its provider', () => {
    expect(createAttendanceProvider('dummy')).toBeInstanceOf(
      DummyAttendanceProvider,
    );
    expect(createAttendanceProvider('none')).toBeInstanceOf(
      NoneAttendanceProvider,
    );
    expect(createAttendanceProvider('stellar')).toBeInstanceOf(
      StellarAttendanceProvider,
    );
  });

  it('only the dummy can sync today; stellar waits for its API client', () => {
    expect(createAttendanceProvider('dummy')).toMatchObject({
      source: 'dummy',
      attendanceSource: 'DUMMY',
      canSync: true,
    });
    expect(createAttendanceProvider('none')).toMatchObject({
      attendanceSource: null,
      canSync: false,
    });
    const stellar = createAttendanceProvider('stellar');
    expect(stellar.source).toBe('stellar');
    expect(stellar.attendanceSource).toBe('STELLAR_API');
    expect(stellar.canSync).toBe(false);
  });

  it('the stellar provider fetches nothing until the API exists', async () => {
    await expect(
      createAttendanceProvider('stellar').fetch([], '2026-10-01', '2026-10-07'),
    ).resolves.toEqual({ attendance: [], leaves: [] });
  });
});

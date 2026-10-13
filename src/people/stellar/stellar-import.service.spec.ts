import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  MAX_STELLAR_CSV_BYTES,
  StellarImportService,
} from './stellar-import.service';

/** Fake people only. */
const ATT = [
  '"","User ID","User Name","Department","Date","In Time","Out Time","Total Hour","Note"',
  '"","7","TEST ALPHA","R&D","2026-07-06","11:00:00 AM","08:00:00 PM","09:00:00","private note"',
  '"","99","TEST UNKNOWN","BPO-B","2026-07-06","09:00:00 AM","-","-",""',
].join('\n');
const LEAVES = [
  '"","User Name","Leave Type","Date","Apply Date","Description","Status","Action"',
  '"","Test Alpha (7)","Sick Leave","2026-07-07 00:00:00","2026-07-07 09:00:00","Sensitive detail","approved","Edit"',
].join('\n');
const file = (text: string | Buffer) => {
  const buffer = typeof text === 'string' ? Buffer.from(text) : text;
  return { originalname: 'x.csv', buffer, size: buffer.length };
};

function make() {
  const employees = {
    byAttendanceIds: jest.fn().mockResolvedValue([
      { id: 'e7', fullName: 'Employee 7', attendanceId: '7', joinDate: '2026-01-01', exitDate: null },
    ]),
  };
  const attendance = {
    attendanceSourcesIn: jest.fn().mockResolvedValue([
      { employeeId: 'e7', date: '2026-07-06', source: 'DUMMY' },
    ]),
    leavesOfSourcesIn: jest.fn().mockResolvedValue([]),
    applyStellarAttendanceImport: jest
      .fn()
      .mockResolvedValue({ deleted: 1, inserted: 1, leavesDeleted: 0 }),
    applyStellarLeaveImport: jest.fn().mockResolvedValue({ deleted: 0, inserted: 1 }),
  };
  const log = jest.fn();
  const svc = new StellarImportService(
    employees as never,
    attendance as never,
    { map: jest.fn().mockResolvedValue(new Map()) } as never,
  );
  (svc as unknown as { logger: { log: jest.Mock } }).logger = { log };
  return { svc, employees, attendance, log };
}

describe('StellarImportService', () => {
  it('a dry run previews and writes nothing', async () => {
    const { svc, attendance, employees } = make();
    const r = await svc.importAttendance('org', file(ATT), true);
    expect(employees.byAttendanceIds).toHaveBeenCalledWith('org', ['7', '99']);
    expect(r).toMatchObject({
      kind: 'attendance',
      dryRun: true,
      range: { from: '2026-07-06', to: '2026-07-06' },
      applied: null,
      totals: { rowsToWrite: 1, replacedDummy: 1, unmatchedIds: 1 },
    });
    expect(r.unmatched[0]).toMatchObject({ attendanceId: '99', name: 'TEST UNKNOWN' });
    expect(attendance.applyStellarAttendanceImport).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty('writes');
  });

  it('a real run applies the plan and logs counts only', async () => {
    const { svc, attendance, log } = make();
    const r = await svc.importAttendance('org', file(ATT), false);
    expect(attendance.applyStellarAttendanceImport).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ['e7'], from: '2026-07-06', to: '2026-07-06' }),
    );
    expect(r.applied).toEqual({ deleted: 1, inserted: 1, leavesDeleted: 0 });
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/TEST|private note/);
  });

  it('leave import: replaces stellar + simulated leave only, never logs descriptions', async () => {
    const { svc, attendance, log } = make();
    const r = await svc.importLeaves('org', file(LEAVES), false);
    expect(attendance.leavesOfSourcesIn).toHaveBeenCalledWith(
      ['e7'],
      ['stellar', 'dummy'],
      '2026-07-07',
      '2026-07-07',
    );
    expect(attendance.applyStellarLeaveImport).toHaveBeenCalledWith({
      deleteIds: [],
      inserts: [expect.objectContaining({ externalId: 'stellar:7:2026-07-07:SICK', source: 'stellar' })],
    });
    expect(r.kind).toBe('leaves');
    expect(log.mock.calls.flat().join(' ')).not.toContain('Sensitive');
  });

  it('refuses the wrong export, a missing/oversized/non-UTF-8 file', async () => {
    const { svc } = make();
    await expect(svc.importAttendance('o', file(LEAVES), true)).rejects.toThrow(/leave import/);
    await expect(svc.importLeaves('o', file(ATT), true)).rejects.toThrow(/attendance import/);
    await expect(svc.importAttendance('o', file('a,b\n1,2'), true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.importAttendance('o', undefined, true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.importAttendance('o', { originalname: 'x', buffer: Buffer.alloc(1), size: MAX_STELLAR_CSV_BYTES + 1 }, true),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(
      svc.importAttendance('o', file(Buffer.from([0xff, 0xfe, 0x00])), true),
    ).rejects.toThrow(/UTF-8/);
  });
});

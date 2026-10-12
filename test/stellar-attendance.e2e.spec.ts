import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { DocumentsService } from '../src/documents/documents.service';
import { AttendanceRepository } from '../src/people/attendance.repository';
import { EmployeesService } from '../src/people/employees.service';
import { dhakaInstant } from '../src/people/people-dates';
import { ShiftsService } from '../src/people/shifts.service';
import { StellarImportService } from '../src/people/stellar/stellar-import.service';

/**
 * What only a real database can answer for the Stellar HRM import (0036): the
 * enum source column round-trips, the import's transaction replaces DUMMY and
 * STELLAR_CSV rows but never STELLAR_API ones, deletes only simulated leave,
 * is idempotent, the dummy sync's ON CONFLICT guard cannot overwrite real rows,
 * and a deleted shift sets its employees back to the default (FK SET NULL).
 * Fake people only.
 */
describe('Stellar HRM import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let employees: EmployeesService;
  let importer: StellarImportService;
  let attendance: AttendanceRepository;
  let shifts: ShiftsService;
  let orgId: string;
  let alphaId: string;
  const stamp = Date.now();
  const sid = (n: number) => String(900_000 + (stamp % 90_000) * 10 + n);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refusing to run e2e against a non-test database. Use `npm run test:e2e`.');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    employees = app.get(EmployeesService);
    importer = app.get(StellarImportService);
    attendance = app.get(AttendanceRepository);
    shifts = app.get(ShiftsService);
    jest.spyOn(app.get(DocumentsService), 'enabled', 'get').mockReturnValue(false);
    const org = await prisma.organization.create({ data: { name: 'Stellar import e2e org' } });
    orgId = org.id;
    const alpha = await employees.create(principal(), {
      fullName: 'Test Alpha',
      email: `stellar-e2e-alpha-${stamp}@example.test`,
      designation: 'Developer',
      joinDate: '2026-01-01',
      attendanceId: sid(1),
    });
    alphaId = alpha.id;
  });

  afterAll(async () => {
    await prisma?.employee.deleteMany({ where: { orgId } });
    await prisma?.workShift.deleteMany({ where: { orgId } });
    await prisma?.organization.deleteMany({ where: { id: orgId } });
    await app?.close();
  });

  function principal() {
    return { userId: 'machine', orgId, role: 'OWNER', email: 'm@x', isMachine: true } as never;
  }
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const file = (text: string) => {
    const buffer = Buffer.from(text);
    return { originalname: 'x.csv', buffer, size: buffer.length };
  };
  const ATT = () =>
    [
      '"","User ID","User Name","Department","Date","In Time","Out Time","Total Hour","Note"',
      `"","${sid(1)}","TEST ALPHA","R&D","2026-07-06","11:00:00 AM","01:00:00 PM","02:00:00",""`,
      `"","${sid(1)}","TEST ALPHA","R&D","2026-07-06","02:00:00 PM","-","-","IN: client visit"`,
      `"","${sid(1)}","TEST ALPHA","R&D","2026-07-07","-","-","-",""`,
      `"","${sid(1)}","TEST ALPHA","R&D","2026-07-08","10:00:00 AM","07:00:00 PM","09:00:00",""`,
      `"","${sid(9)}","TEST NOBODY","BPO-B","2026-07-06","09:00:00 AM","-","-",""`,
      '"","49845","EXIT","","2026-07-06","09:00:00 AM","09:00:05 AM","00:00:05",""',
    ].join('\n');

  it('replaces simulated rows and leave, keeps Stellar API rows and manual leave, and is idempotent', async () => {
    // Simulated data on two of the days, a real API row on the third, and leave.
    await attendance.upsertAttendance([
      { employeeId: alphaId, date: '2026-07-06', firstIn: dhakaInstant('2026-07-06', 540), lastOut: null, minutesInOffice: null, source: 'DUMMY' },
      { employeeId: alphaId, date: '2026-07-07', firstIn: dhakaInstant('2026-07-07', 540), lastOut: null, minutesInOffice: null, source: 'DUMMY' },
      { employeeId: alphaId, date: '2026-07-08', firstIn: dhakaInstant('2026-07-08', 600), lastOut: null, minutesInOffice: null, source: 'STELLAR_API' },
    ]);
    await prisma.leaveRecord.createMany({
      data: [
        { employeeId: alphaId, type: 'SICK', startDate: new Date('2026-07-07'), endDate: new Date('2026-07-07'), days: 1, status: 'APPROVED', source: 'dummy', externalId: `dummy:e2e:${stamp}` },
        { employeeId: alphaId, type: 'CASUAL', startDate: new Date('2026-07-07'), endDate: new Date('2026-07-07'), days: 1, status: 'APPROVED', source: 'manual' },
      ],
    });

    const preview = await importer.importAttendance(orgId, file(ATT()), true);
    expect(preview.totals).toMatchObject({ rowsToWrite: 2, replacedDummy: 2, keptApi: 1, dummyLeavesDeleted: 1, unmatchedIds: 1 });
    expect(await prisma.attendanceDay.count({ where: { employeeId: alphaId, source: 'DUMMY' } })).toBe(2);

    const run = await importer.importAttendance(orgId, file(ATT()), false);
    expect(run.applied).toEqual({ deleted: 2, inserted: 2, leavesDeleted: 1 });
    const rows = await prisma.attendanceDay.findMany({ where: { employeeId: alphaId }, orderBy: { date: 'asc' } });
    expect(rows.map((r) => [iso(r.date), r.source])).toEqual([
      ['2026-07-06', 'STELLAR_CSV'],
      ['2026-07-07', 'STELLAR_CSV'],
      ['2026-07-08', 'STELLAR_API'],
    ]);
    expect(rows[0]).toMatchObject({ sessions: 2, workedMinutes: 120, missingOut: true, note: 'IN: client visit' });
    expect(rows[1]).toMatchObject({ sessions: 0, firstIn: null });
    const leaves = await prisma.leaveRecord.findMany({ where: { employeeId: alphaId } });
    expect(leaves.map((l) => l.source)).toEqual(['manual']);

    const again = await importer.importAttendance(orgId, file(ATT()), false);
    expect(again.applied).toEqual({ deleted: 2, inserted: 2, leavesDeleted: 0 });
    expect(await prisma.attendanceDay.count({ where: { employeeId: alphaId } })).toBe(3);
  });

  it('the dummy sync cannot overwrite real rows (enum-ordered ON CONFLICT guard)', async () => {
    await attendance.upsertAttendance([
      { employeeId: alphaId, date: '2026-07-06', firstIn: dhakaInstant('2026-07-06', 500), lastOut: null, minutesInOffice: null, source: 'DUMMY' },
    ]);
    const row = await prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: alphaId, date: new Date('2026-07-06') } });
    expect(row.source).toBe('STELLAR_CSV');
    expect(row.sessions).toBe(2);
  });

  it('leave import merges days, replaces only Stellar leave and stores rejected as REJECTED', async () => {
    const LEAVES = [
      '"","User Name","Leave Type","Date","Apply Date","Description","Status","Action"',
      `"","Test Alpha (${sid(1)})","Casual Leave","2026-07-09 00:00:00","2026-07-01 10:00:00","Family","approved","Edit"`,
      `"","Test Alpha (${sid(1)})","Casual Leave","2026-07-10 00:00:00","2026-07-01 10:00:05","Family","approved","Edit"`,
      `"","Test Alpha (${sid(1)})","Casual Leave","2026-07-13 00:00:00","2026-07-01 10:00:09","Family","approved","Edit"`,
      `"","Test Alpha (${sid(1)})","Sick Leave","2026-07-14 00:00:00","2026-07-14 09:00:00","","rejected","Edit"`,
      `"","Test Alpha (${sid(1)})","Sick Leave","2026-07-11 00:00:00","2026-07-14 09:00:00","","approved","Edit"`,
    ].join('\n');
    const first = await importer.importLeaves(orgId, file(LEAVES), false);
    expect(first.applied).toEqual({ deleted: 0, inserted: 2 });
    expect(first.skipped.map((s) => s.reason)).toEqual(['weekend']);
    const second = await importer.importLeaves(orgId, file(LEAVES), false);
    expect(second.applied).toEqual({ deleted: 2, inserted: 2 });
    const stellar = await prisma.leaveRecord.findMany({ where: { employeeId: alphaId, source: 'stellar' }, orderBy: { startDate: 'asc' } });
    expect(stellar.map((l) => [iso(l.startDate), iso(l.endDate), l.days.toNumber(), l.status])).toEqual([
      ['2026-07-09', '2026-07-13', 3, 'APPROVED'],
      ['2026-07-14', '2026-07-14', 1, 'REJECTED'],
    ]);
    expect(await prisma.leaveRecord.count({ where: { employeeId: alphaId, source: 'manual' } })).toBe(1);
  });

  it('a Stellar ID is unique (409), and deleting a shift resets its employees to the default', async () => {
    await expect(
      employees.create(principal(), {
        fullName: 'Test Beta',
        email: `stellar-e2e-beta-${stamp}@example.test`,
        designation: 'Developer',
        joinDate: '2026-01-01',
        attendanceId: sid(1),
      }),
    ).rejects.toThrow(/Stellar ID/);

    const evening = await shifts.create(orgId, { name: 'Evening', startMinutes: 840, endMinutes: 1380 });
    await shifts.assign(orgId, { assignments: [{ employeeId: alphaId, shiftId: evening.id }] });
    expect((await shifts.list(orgId))[0].assignedCount).toBe(1);
    await shifts.remove(orgId, evening.id);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: alphaId } })).shiftId).toBeNull();
  });
});

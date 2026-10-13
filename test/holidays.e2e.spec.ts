import 'dotenv/config';
import 'reflect-metadata';

import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { DocumentsService } from '../src/documents/documents.service';
import { EmployeesService } from '../src/people/employees.service';
import { HolidaysService, presetDates } from '../src/people/holidays.service';
import { addDays, dhakaDateOf, isBusinessDay } from '../src/people/people-dates';
import { PeopleSummaryService } from '../src/people/people-summary.service';

/**
 * Office holidays (0039) against a real database: one row per date, unique per
 * org (a second prefill adds nothing), overlap refused, and a holiday reaching
 * the summary: the strip shows it and the available hours drop by one day.
 * Fake people only.
 */
describe('Holidays (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let holidays: HolidaysService;
  let summary: PeopleSummaryService;
  let orgId: string;
  let employeeId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refusing to run e2e against a non-test database. Use `npm run test:e2e`.');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    holidays = app.get(HolidaysService);
    summary = app.get(PeopleSummaryService);
    jest.spyOn(app.get(DocumentsService), 'enabled', 'get').mockReturnValue(false);
    const org = await prisma.organization.create({ data: { name: 'Holidays e2e org' } });
    orgId = org.id;
    const e = await app.get(EmployeesService).create(
      { userId: 'machine', orgId, role: 'OWNER', email: 'm@x', isMachine: true } as never,
      {
        fullName: 'Test Holiday',
        email: `holidays-e2e-${stamp}@example.test`,
        designation: 'Developer',
        joinDate: '2025-01-01',
      },
    );
    employeeId = e.id;
  });

  afterAll(async () => {
    await prisma?.employee.deleteMany({ where: { orgId } });
    await prisma?.holiday.deleteMany({ where: { orgId } });
    await prisma?.organization.deleteMany({ where: { id: orgId } });
    await app?.close();
  });

  it('prefills a year once, groups the dates, and refuses an overlapping holiday', async () => {
    const first = await holidays.prefill(orgId, 2026, null);
    expect(first).toEqual({ added: presetDates(2026).length, skipped: 0 });
    expect(await holidays.prefill(orgId, 2026, null)).toEqual({ added: 0, skipped: presetDates(2026).length });

    const year = await holidays.year(orgId, 2026);
    expect(year.presetMissing).toBe(0);
    const eid = year.holidays.find((h) => h.name === 'Eid-ul-Fitr');
    expect(eid).toMatchObject({ from: '2026-03-18', to: '2026-03-23', days: 6, workingDaysOff: 4 });

    await expect(
      holidays.create(orgId, { name: 'Overlap', from: '2026-12-15', to: '2026-12-17' }, null),
    ).rejects.toBeInstanceOf(ConflictException);

    await holidays.remove(orgId, eid!.ids);
    expect((await holidays.year(orgId, 2026)).presetMissing).toBe(6);
  });

  it('a recent weekday holiday shows in the strip and is not an available day', async () => {
    const today = dhakaDateOf(new Date());
    let day = addDays(today, -7);
    while (!isBusinessDay(day)) day = addDays(day, -1);
    const period = { from: addDays(day, -13), to: addDays(day, 13) };
    // Clear any preset date in the window so the only holiday is ours.
    await prisma.holiday.deleteMany({
      where: { orgId, date: { gte: new Date(period.from), lte: new Date(period.to) } },
    });

    const before = await summary.kpisForPeriod(orgId, employeeId, period);
    await holidays.create(orgId, { name: 'Test Day', from: day, to: day }, null);
    const after = await summary.kpisForPeriod(orgId, employeeId, period);
    expect(before.hours.available - after.hours.available).toBe(8);

    const s = await summary.summary(orgId, employeeId, {});
    expect(s.attendance.find((d) => d.date === day)).toMatchObject({ state: 'holiday', holiday: 'Test Day' });
  });
});

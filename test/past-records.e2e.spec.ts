import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { AppraisalsService } from '../src/appraisals/appraisals.service';
import { PrismaService } from '../src/database/prisma.service';
import { DocumentsService } from '../src/documents/documents.service';
import { EmployeesService } from '../src/people/employees.service';
import { PastRecordsService } from '../src/people/past-records/past-records.service';

const TODAY = '2026-10-12';

/**
 * What only a real database can answer for past records (0035): the new enum value, source
 * column and table round-trip; an import re-derives the employee in one transaction; a
 * re-apply adds nothing; and a paper appraisal clears an overdue yearly and blocks launching
 * that due date again.
 */
describe('Past records (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pastRecords: PastRecordsService;
  let appraisals: AppraisalsService;
  let employees: EmployeesService;
  let orgId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refusing to run e2e against a non-test database. Use `npm run test:e2e`.');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    pastRecords = app.get(PastRecordsService);
    appraisals = app.get(AppraisalsService);
    employees = app.get(EmployeesService);
    jest.spyOn(pastRecords as unknown as { today: () => string }, 'today').mockReturnValue(TODAY);
    jest.spyOn(appraisals as unknown as { today: () => string }, 'today').mockReturnValue(TODAY);
    jest.spyOn(app.get(DocumentsService), 'enabled', 'get').mockReturnValue(false);
    const org = await prisma.organization.create({ data: { name: 'Past records e2e org' } });
    orgId = org.id;
    await prisma.team.create({ data: { orgId, name: 'Platform e2e' } });
  });

  afterAll(async () => {
    await prisma?.appraisalCycle.deleteMany({ where: { orgId } });
    await prisma?.employee.deleteMany({ where: { orgId } });
    await prisma?.team.deleteMany({ where: { orgId } });
    await prisma?.organization.deleteMany({ where: { id: orgId } });
    await app?.close();
  });

  const principal = () => ({ userId: 'machine', orgId, role: 'OWNER', email: 'm@x', isMachine: true }) as never;
  const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

  /** Created the way import-from-users does: ACTIVE, joined when the login was made. */
  const createImported = (name: string) =>
    employees.create(principal(), {
      fullName: name,
      email: `past-e2e-${name.toLowerCase()}-${Date.now()}@example.test`,
      designation: 'Unassigned',
      joinDate: '2024-05-01',
      status: 'ACTIVE',
      grossSalary: 30000,
    });

  it('imports a history: status, designation, gross and confirmation follow it; a re-apply adds nothing', async () => {
    const emp = await createImported('Hana');
    const rows = [
      { row: 2, employee: emp.email, record: 'Joined as intern', date: '01/01/2022' },
      { row: 3, employee: emp.email, record: 'Moved to probation', date: '2022-04-01' },
      { row: 4, employee: emp.email, record: 'Confirmed', date: '2022-10-01' },
      { row: 5, employee: emp.email, record: 'Promotion', date: '2024-01-01', to: 'Developer' },
      { row: 6, employee: emp.email, record: 'Promotion', date: '2025-04-01', to: 'Senior Developer' },
      { row: 7, employee: emp.email, record: 'Increment', date: '2025-04-01', from: 40000, to: 46000 },
      { row: 8, employee: emp.email, record: 'Transfer', date: '2025-06-01', to: 'platform E2E' },
    ];
    const preview = await pastRecords.preview(orgId, rows as never);
    expect(preview).toMatchObject({ errors: [], alreadyRecorded: 0, recordsToAdd: 7 });
    expect(preview.employees[0].after).toMatchObject({ status: 'ACTIVE', designation: 'Senior Developer' });

    const applied = await pastRecords.apply(principal(), rows as never);
    expect(applied).toEqual({ eventsAdded: 7, appraisalsAdded: 0, alreadyRecorded: 0, employeesUpdated: 1 });

    const row = await prisma.employee.findUniqueOrThrow({ where: { id: emp.id }, include: { team: true } });
    expect(row).toMatchObject({ status: 'ACTIVE', designation: 'Senior Developer', grossSalary: 46000 });
    expect(row.team?.name).toBe('Platform e2e');
    expect(iso(row.joinDate)).toBe('2022-01-01');
    expect(iso(row.probationStartDate)).toBe('2022-04-01');
    expect(iso(row.confirmationDate)).toBe('2022-10-01');
    const events = await prisma.employmentEvent.findMany({ where: { employeeId: emp.id }, orderBy: { id: 'asc' } });
    expect(events.map((e) => [e.type, e.source])).toEqual([
      ['JOINED', 'APP'],
      ['JOINED_AS_INTERN', 'PAST_RECORD'],
      ['PROBATION_STARTED', 'PAST_RECORD'],
      ['CONFIRMED', 'PAST_RECORD'],
      ['PROMOTED', 'PAST_RECORD'],
      ['PROMOTED', 'PAST_RECORD'],
      ['INCREMENT', 'PAST_RECORD'],
      ['TRANSFERRED', 'PAST_RECORD'],
    ]);
    expect(events.find((e) => e.type === 'INCREMENT')).toMatchObject({ fromValue: '40000', toValue: '46000', notes: '15%' });

    const again = await pastRecords.apply(principal(), rows as never);
    expect(again).toEqual({ eventsAdded: 0, appraisalsAdded: 0, alreadyRecorded: 7, employeesUpdated: 0 });
    expect(await prisma.employmentEvent.count({ where: { employeeId: emp.id } })).toBe(8);

    // The timeline and the editor see them as past records.
    const listed = await pastRecords.list(orgId, emp.id);
    expect(listed.events).toHaveLength(7);
    expect(listed.events.every((e) => e.source === 'PAST_RECORD')).toBe(true);

    // Deleting the transfer restores the team the employee had before any past record.
    const transfer = listed.events.find((e) => e.type === 'TRANSFERRED')!;
    await pastRecords.remove(principal(), emp.id, `event:${transfer.id}`);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: emp.id } })).teamId).toBeNull();
  });

  it('a past appraisal clears the overdue yearly and blocks launching that due date again', async () => {
    const emp = await createImported('Paro');
    const overdue = await appraisals.overdueEmployees(orgId);
    expect(overdue.filter((r) => r.employeeId === emp.id).map((r) => [r.type, r.dueDate])).toEqual([
      ['YEARLY', '2026-05-01'],
    ]);

    const result = await pastRecords.apply(principal(), [
      { row: 2, employee: emp.email, record: 'Appraisal', date: '2026-05-08', marks: 86, actions: 'Increment' },
    ] as never);
    expect(result.appraisalsAdded).toBe(1);
    const stored = await prisma.pastAppraisal.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(stored).toMatchObject({ type: 'YEARLY', grade: 'B', marks: 86, actions: ['INCREMENT'] });

    expect((await appraisals.overdueEmployees(orgId)).some((r) => r.employeeId === emp.id)).toBe(false);
    const due = await appraisals.dueEmployees(orgId, { type: 'YEARLY', from: '2026-05-01', to: '2026-05-31' });
    expect([...due.due, ...due.overdue].some((r) => r.employeeId === emp.id)).toBe(false);

    const cycle = await appraisals.createCycle(principal(), {
      name: 'Yearly May 2026 (past records e2e)',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      type: 'YEARLY',
    });
    // Picked explicitly, the employee is refused as already appraised for that due date.
    await expect(appraisals.launch(orgId, cycle.id, { employeeIds: [emp.id] })).rejects.toThrow(
      'Everyone selected already has an appraisal for that due date',
    );
    // Picked with someone who is due, they are left out and reported as ALREADY_APPRAISED.
    const other = await createImported('Rumi');
    const launched = await appraisals.launch(orgId, cycle.id, { employeeIds: [emp.id, other.id] });
    expect(launched.created).toBe(1);
    expect(launched.notDue).toEqual([
      expect.objectContaining({ employeeId: emp.id, reason: 'ALREADY_APPRAISED', dueDate: '2026-05-01' }),
    ]);
    expect(await prisma.appraisal.count({ where: { employeeId: emp.id } })).toBe(0);
  });
});

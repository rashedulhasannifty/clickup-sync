import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { AppraisalsService } from '../src/appraisals/appraisals.service';
import { PrismaService } from '../src/database/prisma.service';
import { DocumentsService } from '../src/documents/documents.service';

/** Overdue, timing and the effective date count from today: pin it so the dates below never rot. */
const TODAY = '2026-10-12';
const pinToday = (svc: AppraisalsService) =>
  jest.spyOn(svc as unknown as { today: () => string }, 'today').mockReturnValue(TODAY);

/**
 * What only a real database can answer for join-date appraisals: migration 0032 applies, a new
 * cycle defaults to JOIN_DATE, a launch writes each appraisal's own review period and due date
 * into the `@db.Date` columns and they read back as the same calendar dates, and the due preview
 * picks the same people the launch does.
 */
describe('Appraisals counted from join dates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: AppraisalsService;
  let orgId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refusing to run e2e against a non-test database. Use `npm run test:e2e`.');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(AppraisalsService);
    pinToday(svc);
    // Sign-off files the form PDF best-effort; never upload into a real object store from a test.
    jest.spyOn(app.get(DocumentsService), 'enabled', 'get').mockReturnValue(false);

    const org = await prisma.organization.create({ data: { name: 'Join schedule e2e org' } });
    orgId = org.id;
    const people: [string, string, 'ACTIVE' | 'PROBATION' | 'EXITED'][] = [
      ['Jahid', '2025-04-15', 'ACTIVE'], // half-yearly due 15 Oct 2026
      ['Mira', '2024-08-31', 'ACTIVE'], // half-yearly due 28 Feb 2027 (clamped), not in October
      ['Rumi', '2026-09-01', 'PROBATION'], // nothing half-yearly before Sep 2027
      ['Gone', '2024-10-10', 'EXITED'],
    ];
    for (const [name, join, status] of people) {
      const e = await prisma.employee.create({
        data: {
          orgId,
          fullName: name,
          email: `join-e2e-${name.toLowerCase()}-${Date.now()}@example.test`,
          designation: 'Engineer',
          joinDate: new Date(`${join}T00:00:00.000Z`),
          status,
        },
      });
      ids[name] = e.id;
    }
  });

  afterAll(async () => {
    await prisma?.appraisalCycle.deleteMany({ where: { orgId } }); // appraisals cascade
    await prisma?.employee.deleteMany({ where: { orgId } });
    await prisma?.organization.deleteMany({ where: { id: orgId } });
    await app?.close();
  });

  const principal = () => ({ userId: 'machine', orgId, role: 'OWNER', email: 'm@x', isMachine: true }) as never;

  it('the due preview lists who is due in the window, and who is overdue', async () => {
    const r = await svc.dueEmployees(orgId, { type: 'HALF_YEARLY', from: '2026-10-01', to: '2026-10-31' });
    expect(r.due).toEqual([
      expect.objectContaining({
        employeeId: ids.Jahid,
        dueDate: '2026-10-15',
        periodStart: '2026-04-15',
        periodEnd: '2026-10-14',
        joinDate: '2025-04-15',
        daysEarly: 3,
      }),
    ]);
    // Mira's latest half-yearly (31 Aug 2026) was missed.
    expect(r.overdue).toEqual([expect.objectContaining({ employeeId: ids.Mira, dueDate: '2026-08-31', daysLate: 42 })]);
    expect(r.upcoming).toEqual([]);
  });

  it('a new cycle defaults to JOIN_DATE and a launch stores each appraisal’s own dates', async () => {
    const cycle = await svc.createCycle(principal(), {
      name: 'October 2026 appraisals',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      type: 'HALF_YEARLY',
    });
    expect(cycle.periodBasis).toBe('JOIN_DATE');

    // The default launch takes the due and the overdue.
    const r = await svc.launch(orgId, cycle.id, {});
    expect(r).toMatchObject({ created: 2, skipped: 0, notDue: [] });

    const rows = await svc.listAppraisals(orgId, cycle.id);
    expect(rows).toHaveLength(2);
    const jahid = rows.find((a) => a.employeeId === ids.Jahid);
    expect(jahid).toMatchObject({
      periodStart: '2026-04-15',
      periodEnd: '2026-10-14',
      dueDate: '2026-10-15',
      timing: { status: 'OPEN', days: 3 },
    });
    const view = await svc.getAppraisal(orgId, jahid!.id);
    expect(view.formHeader?.experienceInCompanyMonths).toBe(18);
    const mira = rows.find((a) => a.employeeId === ids.Mira);
    expect(mira).toMatchObject({
      periodStart: '2026-02-28',
      periodEnd: '2026-08-30',
      dueDate: '2026-08-31',
      timing: { status: 'OPEN_OVERDUE', days: 42 },
    });

    // Picking them again: both due dates already have an appraisal; Rumi is not due yet.
    await expect(
      svc.launch(orgId, cycle.id, { employeeIds: [ids.Jahid, ids.Mira, ids.Rumi] }),
    ).rejects.toThrow(/None of the selected employees/);
  });

  it('nobody is appraised twice for the same due date, in any cycle', async () => {
    // The preview for the same window is now empty (both are appraised in the October cycle)...
    const r = await svc.dueEmployees(orgId, { type: 'HALF_YEARLY', from: '2026-10-01', to: '2026-10-31' });
    expect([...r.due, ...r.overdue]).toEqual([]);
    // ...and a November cycle has nobody due or overdue: Mira's 31 Aug is covered.
    const nov = await svc.createCycle(principal(), {
      name: 'November 2026 appraisals',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      type: 'HALF_YEARLY',
    });
    await expect(svc.launch(orgId, nov.id, {})).rejects.toThrow(/Nobody is due/);
    // An explicit pick of someone already appraised for their latest due date is reported, not duplicated.
    const picked = await svc.launch(orgId, nov.id, { employeeIds: [ids.Mira, ids.Jahid] }).catch((e: Error) => e);
    expect(picked).toBeInstanceOf(Error);
    expect(await prisma.appraisal.count({ where: { cycleId: nov.id } })).toBe(0);
  });

  it('a late appraisal is backdated to its due date by default, and the dates can be adjusted', async () => {
    const cycle = await prisma.appraisalCycle.findFirstOrThrow({ where: { orgId, name: 'October 2026 appraisals' } });
    const row = await prisma.appraisal.findFirstOrThrow({ where: { cycleId: cycle.id, employeeId: ids.Mira } });

    // Adjust the review period; it round-trips through the @db.Date columns unchanged.
    const adjusted = await svc.update(orgId, row.id, { periodStart: '2026-03-01' });
    expect(adjusted).toMatchObject({ periodStart: '2026-03-01', periodEnd: '2026-08-30', dueDate: '2026-08-31' });
    await expect(svc.update(orgId, row.id, { periodEnd: '2026-09-01' })).rejects.toThrow(/on or before the due date/);

    // Walk it to final approval and approve a promotion.
    await svc.advance(principal(), row.id); // -> supervisor
    const keys = cycle.competencies as { key: string }[];
    await svc.update(orgId, row.id, {
      leadRatings: Object.fromEntries(keys.map((k) => [k.key, 8])),
      actions: ['PROMOTION'],
      newDesignation: 'Senior Engineer',
    });
    await svc.advance(principal(), row.id); // -> department head
    await svc.advance(principal(), row.id); // -> HR
    await svc.advance(principal(), row.id); // -> final approval
    const before = await svc.update(orgId, row.id, { approvalDecision: 'APPROVED' });
    expect(before.effective).toMatchObject({ mode: 'DUE_DATE', date: '2026-08-31', defaulted: true, backdated: true });
    const signed = await svc.advance(principal(), row.id);
    expect(signed.status).toBe('SIGNED_OFF');
    expect(signed.timing).toEqual({ status: 'LATE', days: 42 });

    const stored = await prisma.appraisal.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.effectiveDateMode).toBe('DUE_DATE');
    expect(stored.effectiveDate?.toISOString().slice(0, 10)).toBe('2026-08-31');
    const events = await prisma.employmentEvent.findMany({ where: { employeeId: ids.Mira, type: 'PROMOTED' } });
    expect(events).toHaveLength(1);
    expect(events[0].effectiveDate.toISOString().slice(0, 10)).toBe('2026-08-31');

    // A retry is a no-op: still one event, still the due date.
    await svc.advance(principal(), row.id);
    expect(await prisma.employmentEvent.count({ where: { employeeId: ids.Mira, type: 'PROMOTED' } })).toBe(1);
  });

  it('a calendar cycle keeps the cycle period and stores no per-appraisal dates', async () => {
    const cycle = await svc.createCycle(principal(), {
      name: 'H2 2026',
      periodStart: '2026-07-01',
      periodEnd: '2026-12-31',
      type: 'HALF_YEARLY',
      periodBasis: 'CALENDAR',
    });
    await svc.launch(orgId, cycle.id, {});
    const rows = await svc.listAppraisals(orgId, cycle.id);
    // Everyone not exited who joined by the period end.
    expect(rows.map((a) => a.employeeId).sort()).toEqual([ids.Jahid, ids.Mira, ids.Rumi].sort());
    const stored = await prisma.appraisal.findMany({ where: { cycleId: cycle.id } });
    expect(stored.every((a) => a.periodStart === null && a.dueDate === null)).toBe(true);
    expect(rows[0]).toMatchObject({ periodStart: '2026-07-01', periodEnd: '2026-12-31', dueDate: null });
  });
});

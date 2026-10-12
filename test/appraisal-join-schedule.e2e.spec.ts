import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { AppraisalsService } from '../src/appraisals/appraisals.service';
import { PrismaService } from '../src/database/prisma.service';

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

  it('the due preview lists only who is due in the window', async () => {
    const due = await svc.dueEmployees(orgId, { type: 'HALF_YEARLY', from: '2026-10-01', to: '2026-10-31' });
    expect(due).toEqual([
      expect.objectContaining({
        employeeId: ids.Jahid,
        dueDate: '2026-10-15',
        periodStart: '2026-04-15',
        periodEnd: '2026-10-14',
        joinDate: '2025-04-15',
      }),
    ]);
  });

  it('a new cycle defaults to JOIN_DATE and a launch stores each appraisal’s own dates', async () => {
    const cycle = await svc.createCycle(principal(), {
      name: 'October 2026 appraisals',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      type: 'HALF_YEARLY',
    });
    expect(cycle.periodBasis).toBe('JOIN_DATE');

    const r = await svc.launch(orgId, cycle.id, {});
    expect(r).toMatchObject({ created: 1, skipped: 0, notDue: [] });

    const rows = await svc.listAppraisals(orgId, cycle.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      employeeId: ids.Jahid,
      periodStart: '2026-04-15',
      periodEnd: '2026-10-14',
      dueDate: '2026-10-15',
    });
    const view = await svc.getAppraisal(orgId, rows[0].id);
    expect(view.formHeader?.experienceInCompanyMonths).toBe(18);

    // An explicit pick: Mira's latest half-yearly by 31 Oct 2026 was 31 Aug 2026; Rumi is not due yet.
    const again = await svc.launch(orgId, cycle.id, { employeeIds: [ids.Jahid, ids.Mira, ids.Rumi] });
    expect(again.created).toBe(1);
    expect(again.skipped).toBe(1);
    expect(again.notDue).toEqual([
      { employeeId: ids.Rumi, employeeName: 'Rumi', reason: 'NOT_YET_DUE', firstDueDate: '2027-09-01' },
    ]);
    const mira = (await svc.listAppraisals(orgId, cycle.id)).find((a) => a.employeeId === ids.Mira);
    expect(mira).toMatchObject({ periodStart: '2026-02-28', periodEnd: '2026-08-30', dueDate: '2026-08-31' });
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

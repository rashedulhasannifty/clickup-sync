import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { AppraisalsService } from '../src/appraisals/appraisals.service';
import { PrismaService } from '../src/database/prisma.service';
import { DocumentsService } from '../src/documents/documents.service';
import { EmployeesService } from '../src/people/employees.service';

const TODAY = '2026-10-12';

/**
 * What only a real database can answer for the intern lifecycle (0034): the new enum values and
 * columns round-trip, an internship review launches from the internship end, an approved "move
 * to probation" makes the employee PROBATION with a probation start that then anchors the
 * confirmation, and an approved extension makes a new internship review due at the new end.
 */
describe('Intern lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: AppraisalsService;
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
    svc = app.get(AppraisalsService);
    employees = app.get(EmployeesService);
    jest.spyOn(svc as unknown as { today: () => string }, 'today').mockReturnValue(TODAY);
    jest.spyOn(app.get(DocumentsService), 'enabled', 'get').mockReturnValue(false);
    const org = await prisma.organization.create({ data: { name: 'Intern lifecycle e2e org' } });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma?.appraisalCycle.deleteMany({ where: { orgId } });
    await prisma?.employee.deleteMany({ where: { orgId } });
    await prisma?.organization.deleteMany({ where: { id: orgId } });
    await app?.close();
  });

  const principal = () => ({ userId: 'machine', orgId, role: 'OWNER', email: 'm@x', isMachine: true }) as never;
  const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

  /** Rates every criterion, picks the outcome, and walks the review to sign-off as approved. */
  async function review(employeeId: string, cycleName: string, outcome: Record<string, unknown>) {
    const cycle = await svc.createCycle(principal(), {
      name: cycleName,
      periodStart: '2026-09-01',
      periodEnd: '2026-10-31',
      type: 'INTERNSHIP',
    });
    const launched = await svc.launch(orgId, cycle.id, { employeeIds: [employeeId] });
    expect(launched.created).toBe(1);
    const [row] = await svc.listAppraisals(orgId, cycle.id);
    await svc.advance(principal(), row.id); // -> supervisor
    await svc.update(orgId, row.id, {
      leadRatings: Object.fromEntries(cycle.competencies.map((c) => [c.key, 8])),
      ...outcome,
    });
    await svc.advance(principal(), row.id); // -> HR
    await svc.update(orgId, row.id, { approvalDecision: 'APPROVED', hrComment: 'Good' });
    const signed = await svc.advance(principal(), row.id);
    expect(signed.status).toBe('SIGNED_OFF');
    expect(signed.steps.map((s) => s.status)).toEqual(['SELF_REVIEW', 'LEAD_REVIEW', 'HR_REVIEW', 'SIGNED_OFF']);
    return row;
  }

  it('an intern moves to probation; the confirmation is then 6 months after the probation start', async () => {
    const created = await employees.create(principal(), {
      fullName: 'Ina',
      email: `intern-e2e-ina-${Date.now()}@example.test`,
      designation: 'Intern',
      joinDate: '2026-07-01',
      status: 'INTERN',
    });
    expect(created).toMatchObject({
      status: 'INTERN',
      probationStartDate: null,
      internshipEndDate: '2026-10-01',
      nextAppraisal: expect.objectContaining({ type: 'INTERNSHIP', dueDate: '2026-10-01', overdue: true }),
    });

    // Overdue (due 1 Oct, today 12 Oct) and listed in the due preview for October.
    const due = await svc.dueEmployees(orgId, { type: 'INTERNSHIP', from: '2026-10-01', to: '2026-10-31' });
    expect(due.due.map((r) => r.employeeId)).toEqual([created.id]);
    expect(due.due[0]).toMatchObject({ periodStart: '2026-07-01', periodEnd: '2026-09-30' });

    const row = await review(created.id, 'Interns Oct 2026', { internshipOutcome: 'MOVE_TO_PROBATION' });
    const stored = await prisma.appraisal.findUniqueOrThrow({ where: { id: row.id } });
    expect(iso(stored.proposedProbationStart)).toBe('2026-10-02');

    const after = await prisma.employee.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe('PROBATION');
    expect(iso(after.probationStartDate)).toBe('2026-10-02');
    const events = await prisma.employmentEvent.findMany({
      where: { employeeId: created.id, type: 'PROBATION_STARTED' },
    });
    expect(events.map((e) => iso(e.effectiveDate))).toEqual(['2026-10-02']);

    const profile = await employees.getProfile(orgId, created.id);
    expect(profile.nextAppraisal).toMatchObject({
      type: 'CONFIRMATION',
      dueDate: '2027-04-02',
      periodStart: '2026-10-02',
    });

    // A retry is a no-op: still one event.
    await svc.advance(principal(), row.id);
    expect(await prisma.employmentEvent.count({ where: { employeeId: created.id, type: 'PROBATION_STARTED' } })).toBe(
      1,
    );
  });

  it('an extension makes a new internship review due at the new end, covering the previous end onwards', async () => {
    const created = await employees.create(principal(), {
      fullName: 'Exa',
      email: `intern-e2e-exa-${Date.now()}@example.test`,
      designation: 'Intern',
      joinDate: '2026-07-10',
      status: 'INTERN',
      internshipEndDate: '2026-10-10',
    });
    await expect(
      review(created.id, 'Interns extension', {
        internshipOutcome: 'EXTEND_INTERNSHIP',
        proposedInternshipEnd: '2026-10-10',
      }),
    ).rejects.toThrow(/after the current one/);

    // The failed attempt left a cycle with the appraisal at the supervisor step; finish it properly.
    const open = await prisma.appraisal.findFirstOrThrow({
      where: { employeeId: created.id },
      include: { cycle: true },
    });
    const keys = open.cycle.competencies as { key: string }[];
    await svc.update(orgId, open.id, {
      leadRatings: Object.fromEntries(keys.map((c) => [c.key, 6])),
      internshipOutcome: 'EXTEND_INTERNSHIP',
      proposedInternshipEnd: '2026-12-10',
    });
    await svc.advance(principal(), open.id); // -> HR
    await svc.update(orgId, open.id, { approvalDecision: 'APPROVED' });
    await svc.advance(principal(), open.id);

    const after = await prisma.employee.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe('INTERN');
    expect(iso(after.internshipEndDate)).toBe('2026-12-10');
    const ext = await prisma.employmentEvent.findFirstOrThrow({
      where: { employeeId: created.id, type: 'INTERNSHIP_EXTENDED' },
    });
    expect(ext).toMatchObject({ fromValue: '2026-10-10', toValue: '2026-12-10' });

    const profile = await employees.getProfile(orgId, created.id);
    expect(profile.nextAppraisal).toMatchObject({
      type: 'INTERNSHIP',
      dueDate: '2026-12-10',
      periodStart: '2026-10-10',
      periodEnd: '2026-12-09',
    });
    const due = await svc.dueEmployees(orgId, { type: 'INTERNSHIP', from: '2026-12-01', to: '2026-12-31' });
    expect(due.due.map((r) => r.employeeId)).toEqual([created.id]);
  });

  it('an intern is never in a regular cycle, and cannot be confirmed by hand', async () => {
    const intern = await prisma.employee.findFirstOrThrow({ where: { orgId, status: 'INTERN' } });
    const yearly = await svc.dueEmployees(orgId, { type: 'YEARLY', from: '2026-01-01', to: '2027-12-31' });
    expect([...yearly.due, ...yearly.overdue, ...yearly.upcoming].map((r) => r.employeeId)).not.toContain(intern.id);
    await expect(
      employees.addEvent(principal(), intern.id, { type: 'CONFIRMED', effectiveDate: '2026-10-12' }),
    ).rejects.toThrow(/move them to probation first/);
  });
});

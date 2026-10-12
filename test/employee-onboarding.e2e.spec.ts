import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { EmployeesRepository } from '../src/people/employees.repository';
import { OnboardingRepository } from '../src/people/onboarding.repository';

/**
 * What only a real database can answer for the joining checklist: migration 0030 applies, creating
 * an employee seeds the checklist in the same write, re-seeding is a no-op thanks to the
 * (employee_id, key) unique index (NULL keys — custom items — stay unconstrained), the CHECK
 * forbids done + N/A, and the directory's grouped progress query is valid SQL.
 */
describe('Employee onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: OnboardingRepository;
  let orgId: string;
  let employeeId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refusing to run e2e against a non-test database. Use `npm run test:e2e`.');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    repo = app.get(OnboardingRepository);

    const org = await prisma.organization.create({ data: { name: 'Onboarding e2e org' } });
    orgId = org.id;
    const emp = await app.get(EmployeesRepository).create({
      orgId,
      fullName: 'Onboarding E2E',
      email: `onboarding-e2e-${Date.now()}@example.test`,
      employeeCode: null,
      userId: null,
      clickupUserId: null,
      designation: 'Engineer',
      grade: null,
      department: null,
      teamId: null,
      managerId: null,
      joinDate: '2026-10-01',
      createdBy: null,
    });
    employeeId = emp.id;
  });

  afterAll(async () => {
    await prisma?.employee.deleteMany({ where: { orgId } }); // onboarding items cascade
    await prisma?.organization.deleteMany({ where: { id: orgId } });
    await app?.close();
  });

  it('creating an employee seeds the 28-line checklist in form order', async () => {
    const items = await repo.listForEmployee(employeeId);
    expect(items).toHaveLength(28);
    expect(items[0]).toMatchObject({ key: 'doc_resume', group: 'DOCUMENTS', position: 0 });
  });

  it('re-seeding is idempotent; custom items (NULL key) are not constrained', async () => {
    expect(await repo.seedDefaults(employeeId)).toBe(0);
    await repo.addItem(employeeId, 'EQUIPMENT', 'Monitor');
    await repo.addItem(employeeId, 'EQUIPMENT', 'Monitor');
    expect(await repo.listForEmployee(employeeId)).toHaveLength(30);
  });

  it('the CHECK forbids an item that is both done and not applicable', async () => {
    const [first] = await repo.listForEmployee(employeeId);
    await expect(repo.updateItem(first.id, { done: true, notApplicable: true })).rejects.toBeDefined();
  });

  it('counts progress per employee in one grouped query', async () => {
    const [first, second] = await repo.listForEmployee(employeeId);
    await repo.updateItem(first.id, { done: true });
    await repo.updateItem(second.id, { notApplicable: true });
    expect((await repo.progressFor([employeeId])).get(employeeId)).toEqual({ resolved: 2, total: 30 });
  });
});

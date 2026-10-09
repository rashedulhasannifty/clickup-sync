import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { ExitsRepository } from '../src/exits/exits.repository';
import { EmployeesService } from '../src/people/employees.service';

/**
 * What only a real database can answer for offboarding: migration 0028 applies, and its partial
 * unique index really allows ONE active exit per employee (a new one only after the old is
 * completed or cancelled). Mocks cannot prove an index.
 */
describe('Employee exits (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: ExitsRepository;
  let orgId: string;
  let employeeId: string;

  const start = () =>
    repo.create({
      employeeId,
      type: 'RESIGNATION',
      noticeDate: '2026-10-01',
      lastWorkingDay: '2026-10-31',
      reason: null,
      previousStatus: 'ACTIVE',
      createdBy: null,
      clearanceLabels: ['A', 'B'],
    });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refusing to run e2e against a non-test database. Use `npm run test:e2e`.');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    repo = app.get(ExitsRepository);

    const org = await prisma.organization.create({ data: { name: 'Exit e2e org' } });
    orgId = org.id;
    const emp = await prisma.employee.create({
      data: {
        orgId,
        fullName: 'Exit E2E',
        email: `exit-e2e-${Date.now()}@example.test`,
        designation: 'Engineer',
        joinDate: new Date('2024-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    employeeId = emp.id;
  });

  afterAll(async () => {
    await prisma?.employee.deleteMany({ where: { orgId } }); // exits and items cascade
    await prisma?.user.deleteMany({ where: { orgId } });
    await prisma?.organization.deleteMany({ where: { id: orgId } });
    await app?.close();
  });

  it('seeds the clearance items in order and scopes lookups to the org', async () => {
    const exit = await start();
    expect(exit.items.map((i) => i.label)).toEqual(['A', 'B']);
    expect(await repo.findById(orgId, exit.id)).not.toBeNull();
    expect(await repo.findById('some-other-org', exit.id)).toBeNull();
    await repo.claim(exit.id, ['NOTICE'], { status: 'CANCELLED' });
  });

  it('allows one active exit per employee, and a new one once the old is closed', async () => {
    const first = await start();
    await expect(start()).rejects.toMatchObject({ code: 'P2002' });
    expect(await repo.hasActive(employeeId)).toBe(true);

    // claim is atomic: a second claim from the same status touches nothing
    expect(await repo.claim(first.id, ['NOTICE'], { status: 'INTERVIEW' })).toBe(true);
    expect(await repo.claim(first.id, ['NOTICE'], { status: 'INTERVIEW' })).toBe(false);

    expect(await repo.claim(first.id, ['INTERVIEW'], { status: 'CANCELLED' })).toBe(true);
    expect(await repo.hasActive(employeeId)).toBe(false);
    const second = await start();
    expect(second.id).not.toBe(first.id);
    expect((await repo.findForEmployee(orgId, employeeId))?.id).toBe(second.id);
  });

  it('import-from-users leaves an exited employee unlinked but links an active one', async () => {
    const stamp = Date.now();
    const mk = (tag: string, status: 'EXITED' | 'ACTIVE') =>
      prisma.employee.create({
        data: {
          orgId,
          fullName: `Import ${tag}`,
          email: `import-${tag}-${stamp}@example.test`,
          designation: 'Engineer',
          joinDate: new Date('2024-01-01T00:00:00Z'),
          status,
        },
      });
    const [gone, here] = [await mk('gone', 'EXITED'), await mk('here', 'ACTIVE')];
    for (const e of [gone, here])
      await prisma.user.create({
        data: { orgId, email: e.email, passwordHash: 'x', status: 'ACTIVE' },
      });

    const principal = { userId: 'u', orgId, role: 'OWNER', email: null, isMachine: true } as never;
    const res = await app.get(EmployeesService).importFromUsers(principal);

    expect(res.linked).toBe(1);
    expect((await prisma.employee.findUnique({ where: { id: gone.id } }))?.userId).toBeNull();
    expect((await prisma.employee.findUnique({ where: { id: here.id } }))?.userId).not.toBeNull();
  });
});

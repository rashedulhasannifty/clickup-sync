import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { SEED_ORG_ID } from '../src/auth/org.repository';

/**
 * Guards Important Finding 1's blind spot at the HTTP boundary: a unit test
 * with a mocked Prisma can prove the two `aggregate` calls carry the right
 * `where` shape, but it can't prove the SQL those `where`s compile to is
 * actually exhaustive and non-overlapping over real rows — in particular
 * over `task_id IS NULL` rows. Chargeability is resolved and stored per entry
 * now (`clickup_time_entries.is_chargeable`, defaulting `true`), so a
 * task-less row does have its own flag to read; this suite still seeds one
 * without setting it explicitly, to prove that default keeps it on the
 * chargeable side exactly as the old task-join fallback did.
 *
 * `timeEntriesAggregates`'s `totalEntries` is exactly `totalAgg._count` — the
 * caller's `where` verbatim (see `time-entries-report.service.ts`).
 * `timeEntriesList`'s `total` is exactly `clickupTimeEntry.count({ where })`
 * for the byte-identical `where` (same `buildTimeEntryWhere` call, same
 * params). So asserting those two numbers are equal for one window proves the
 * aggregates and the pager agree on exactly which rows the filter matches —
 * including the task-less row, which is exactly what a broken partition would
 * get wrong — done through the public API rather than reaching into the
 * service's private variables, because that's the only surface an e2e test
 * has. It also exercises the `chargeableHours`/`nonChargeableHours` split,
 * now sourced from each entry's own `is_chargeable` column rather than a
 * `NOT { task: { isChargeable: false } }` join: `nonChargeableHours` is
 * derived as `totalHours - chargeableHours` (never queried as its own
 * partition), so a task-less row silently falling through both halves would
 * show up as `chargeableHours + nonChargeableHours < totalHours` here.
 *
 * NOTE: this suite is UNRUN. There is no Postgres reachable on this machine
 * (port 5433 closed, no Docker), and `npm run test:e2e` provisions and
 * targets a real `<db>_test` database (see `test/run-e2e.js`) — there is
 * nothing for it to provision against here. It has been typechecked
 * (`npx tsc --noEmit`) and built (`npm run build`) but never executed. Run
 * it with `npm run test:e2e -- time-entries-chargeable-partition` once a
 * Postgres + Redis stack is available.
 */
describe('Time entries chargeable partition (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agent: request.Agent;

  // Distinctive ids/emails so this suite never collides with fixtures left
  // by another e2e file, and so its own cleanup can find exactly what it made.
  const E2E_PREFIX = 'e2e-chg-partition';
  const USER_EMAIL = `${E2E_PREFIX}@x.com`;
  const TASK_CHARGEABLE = `${E2E_PREFIX}-task-chargeable`;
  const TASK_NON_CHARGEABLE = `${E2E_PREFIX}-task-non-chargeable`;
  const ENTRY_CHARGEABLE = `${E2E_PREFIX}-entry-chargeable-task`;
  const ENTRY_NON_CHARGEABLE = `${E2E_PREFIX}-entry-non-chargeable-task`;
  const ENTRY_TASKLESS = `${E2E_PREFIX}-entry-taskless`;

  // A window far from "now" and from any real data, so this suite is immune
  // to whatever else lives in the test database.
  const FROM = '2031-06-01T00:00:00.000Z';
  const TO = '2031-06-02T00:00:00.000Z';

  beforeAll(async () => {
    // Same safety fuse as auth.e2e.spec.ts: this suite writes real rows via
    // Prisma, so it must never point at a developer's real database.
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error(
        'Refusing to run e2e against a non-test database. Use `npm run test:e2e`.',
      );
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get(PrismaService);

    // Idempotent: clear any leftovers from a previous failed run before
    // seeding, scoped to this suite's own ids only.
    await prisma.clickupTimeEntry.deleteMany({
      where: { timeEntryId: { in: [ENTRY_CHARGEABLE, ENTRY_NON_CHARGEABLE, ENTRY_TASKLESS] } },
    });
    await prisma.clickupTask.deleteMany({
      where: { taskId: { in: [TASK_CHARGEABLE, TASK_NON_CHARGEABLE] } },
    });
    await prisma.session.deleteMany({ where: { user: { email: USER_EMAIL } } });
    await prisma.user.deleteMany({ where: { email: USER_EMAIL } });

    // Seed an authenticated session. Reports carry no @Roles restriction (see
    // reports.controller.ts / roles.guard.ts), so any authenticated role can
    // reach them — this avoids depending on the org's one-time signup window,
    // which auth.e2e.spec.ts's own suite also exercises.
    const pw = new PasswordService();
    const passwordHash = await pw.hash('e2echargepass10');
    await prisma.user.create({
      data: {
        email: USER_EMAIL,
        passwordHash,
        name: 'E2E Chargeable Partition',
        role: 'ADMIN',
        status: 'ACTIVE',
        org: { connect: { id: SEED_ORG_ID } },
      },
    });

    agent = request.agent(app.getHttpServer());
    const login = await agent.post('/api/auth/login').send({
      email: USER_EMAIL,
      password: 'e2echargepass10',
    });
    if (login.status !== 200) {
      throw new Error(`e2e login failed: ${login.status} ${JSON.stringify(login.body)}`);
    }

    // Two tasks — one chargeable, one not — and three entries in the same
    // window: one on each task, plus one with no task at all. Reports now
    // read each entry's OWN `is_chargeable` column, not the joined task's
    // flag (see time-entries-report.service.ts), so the entries below set it
    // explicitly to match their task rather than relying on the join — this
    // is what a real cost write does (see the chargeability resolver). The
    // task-less entry deliberately leaves it unset to prove the column's
    // `true` default is what keeps it on the chargeable side.
    await prisma.clickupTask.create({
      data: { taskId: TASK_CHARGEABLE, taskName: 'E2E chargeable task', isChargeable: true },
    });
    await prisma.clickupTask.create({
      data: { taskId: TASK_NON_CHARGEABLE, taskName: 'E2E non-chargeable task', isChargeable: false },
    });
    await prisma.clickupTimeEntry.create({
      data: {
        timeEntryId: ENTRY_CHARGEABLE,
        taskId: TASK_CHARGEABLE,
        startTime: new Date('2031-06-01T10:00:00.000Z'),
        durationHours: 2,
        isChargeable: true,
      },
    });
    await prisma.clickupTimeEntry.create({
      data: {
        timeEntryId: ENTRY_NON_CHARGEABLE,
        taskId: TASK_NON_CHARGEABLE,
        startTime: new Date('2031-06-01T11:00:00.000Z'),
        durationHours: 5,
        isChargeable: false,
      },
    });
    await prisma.clickupTimeEntry.create({
      data: {
        timeEntryId: ENTRY_TASKLESS,
        taskId: null,
        startTime: new Date('2031-06-01T12:00:00.000Z'),
        durationHours: 1,
        // No isChargeable set: proves the column's `true` default is what
        // keeps a task-less entry chargeable now, not a task-join fallback.
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.clickupTimeEntry.deleteMany({
        where: { timeEntryId: { in: [ENTRY_CHARGEABLE, ENTRY_NON_CHARGEABLE, ENTRY_TASKLESS] } },
      });
      await prisma.clickupTask.deleteMany({
        where: { taskId: { in: [TASK_CHARGEABLE, TASK_NON_CHARGEABLE] } },
      });
      await prisma.session.deleteMany({ where: { user: { email: USER_EMAIL } } });
      await prisma.user.deleteMany({ where: { email: USER_EMAIL } });
    }
    if (app) await app.close();
  });

  it('partitions every entry in the window into chargeable xor non-chargeable, with the task-less row on the chargeable side', async () => {
    const aggRes = await agent.get(
      `/api/reports/time-entries/aggregates?from=${FROM}&to=${TO}`,
    );
    expect(aggRes.status).toBe(200);

    const listRes = await agent.get(
      `/api/reports/time-entries?from=${FROM}&to=${TO}&limit=100`,
    );
    expect(listRes.status).toBe(200);

    // Exhaustive + non-overlapping: the two aggregate partitions must account
    // for exactly the same rows the plain (unpartitioned) count sees for the
    // identical `where`. If a task-less row fell through both `aggregate`
    // calls — the scenario this test exists to catch — totalEntries would
    // undercount listRes.body.total.
    expect(aggRes.body.totalEntries).toBe(listRes.body.total);
    expect(aggRes.body.totalEntries).toBe(3);

    // The task-less entry (1h) must land on the chargeable side alongside the
    // chargeable-task entry (2h), not be dropped or miscounted as
    // non-chargeable: chargeableHours = 2 + 1 = 3, nonChargeableHours = 5.
    expect(aggRes.body.chargeableHours).toBe(3);
    expect(aggRes.body.nonChargeableHours).toBe(5);
    expect(aggRes.body.totalHours).toBe(8);
  });
});

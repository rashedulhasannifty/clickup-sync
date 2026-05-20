# Rates-from-UI Cost Recalculation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make UI-managed assignee rates actually produce costs — recompute existing time-entry costs when a rate changes (auto + manual), fix `valid_to` to closed-open `[from, to)`, and remove the dead Google Sheets wiring.

**Architecture:** A new `CostRecalculationService` re-runs the (corrected) `CostCalculatorService` over `clickup_time_entries`. Rate mutations flow through `RatesService` which enqueues a scoped `recalculate-costs` job on the existing `MAINTENANCE` BullMQ queue; a new `CostRecalcProcessor` runs it. A manual `POST /admin/rates/recalculate` endpoint + a frontend button enqueue the same job. The dead `ASSIGNEE_RATES` queue / `RatesSyncProcessor` / `/rates/sync` / Google Sheets docs are deleted.

**Tech Stack:** NestJS 11, Prisma 7 (`@prisma/client`), BullMQ (`@nestjs/bullmq`), Jest + ts-jest (backend only, `*.spec.ts`), React + Vite + React Query (frontend, no test harness — verified via build).

**Spec:** `docs/superpowers/specs/2026-05-20-rates-from-ui-design.md`

**Branch:** `feat/rates-from-ui-costs` (already created)

---

## File Structure

**Create:**
- `src/time-entries/cost-calculator.service.spec.ts` — boundary/behavior tests for the `valid_to` fix
- `src/time-entries/cost-recalculation.service.ts` — recompute orchestration
- `src/time-entries/cost-recalculation.service.spec.ts` — its tests
- `src/workers/cost-recalc.processor.ts` — BullMQ consumer on `MAINTENANCE`
- `src/rates/rates.service.spec.ts` — RatesService mutation-seam tests

**Modify:**
- `src/time-entries/cost-calculator.service.ts:12` — `gte` → `gt`
- `src/time-entries/time-entries.module.ts` — provide/export `CostRecalculationService`
- `src/queues/queue.constants.ts` — add `RECALCULATE_COSTS`; remove `SYNC_ASSIGNEE_RATES` + `ASSIGNEE_RATES`
- `src/queues/queue.service.ts` — drop the `ASSIGNEE_RATES` injection + map entry
- `src/rates/rates.service.ts` — replace `syncRates()` with `create/update/remove` + enqueue
- `src/rates/rates.repository.ts` — add `findById`
- `src/rates/rates.module.ts` — import `QueuesModule`
- `src/workers/workers.module.ts` — remove `RatesSyncProcessor`, add `CostRecalcProcessor`
- `src/admin/admin.controller.ts` — route rate mutations through `RatesService`; replace `/rates/sync` with `/rates/recalculate`
- `src/sync/sync.scheduler.ts` — remove the 1 AM `syncRates()` cron
- `apps/web/src/api/rates.ts`, `apps/web/src/hooks/useRates.ts`, `apps/web/src/pages/AssigneeRatesPage.tsx` — recalc button
- `CLAUDE.md`, `.env.example`, `README.md`/`docs/*` — remove Google Sheets references

**Delete:**
- `src/workers/rates-sync.processor.ts`

---

## Task 1: Fix `valid_to` to closed-open `[from, to)`

**Files:**
- Create: `src/time-entries/cost-calculator.service.spec.ts`
- Modify: `src/time-entries/cost-calculator.service.ts:12`

Note: the codebase has no test DB; this suite asserts the Prisma `where` predicate (the contract that defines closed-open semantics) plus the cost math, using a mocked PrismaService — the same unit-test style as the rest of the repo.

- [ ] **Step 1: Write the failing test**

Create `src/time-entries/cost-calculator.service.spec.ts`:

```typescript
import { CostCalculatorService } from './cost-calculator.service';

function makePrisma(rate: unknown) {
  const findFirst = jest.fn().mockResolvedValue(rate);
  return { prisma: { assigneeRate: { findFirst } } as any, findFirst };
}

describe('CostCalculatorService', () => {
  it('queries rates with an EXCLUSIVE valid_to (closed-open [from, to))', async () => {
    const { prisma, findFirst } = makePrisma(null);
    const svc = new CostCalculatorService(prisma);

    await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2);

    const where = findFirst.mock.calls[0][0].where;
    const validToClause = where.OR.find((c: any) => c.validTo && 'gt' in c.validTo) ?? where.OR[1];
    expect(validToClause.validTo.gt).toBeInstanceOf(Date);
    expect(validToClause.validTo.gte).toBeUndefined();
    expect(where.validFrom.lte).toBeInstanceOf(Date);
  });

  it('returns NO_RATE_FOUND when no effective rate exists', async () => {
    const { prisma } = makePrisma(null);
    const svc = new CostCalculatorService(prisma);

    const r = await svc.calculate('user-1', new Date('2024-06-15T00:00:00.000Z'), 5);

    expect(r.status).toBe('NO_RATE_FOUND');
    expect(r.costCents).toBe(0n);
    expect(r.rateId).toBeNull();
  });

  it('computes cost = round(hourlyRateCents * durationHours)', async () => {
    const { prisma } = makePrisma({ rateId: 7n, currency: 'AUD', hourlyRateCents: 15000n });
    const svc = new CostCalculatorService(prisma);

    const r = await svc.calculate('user-1', new Date('2024-06-15T00:00:00.000Z'), 2.5);

    expect(r.status).toBe('COST_CALCULATED');
    expect(r.hourlyRateCents).toBe(15000n);
    expect(r.costCents).toBe(37500n);
    expect(r.rateId).toBe(7n);
  });

  it('returns NO_RATE_FOUND when userId or startTime is null', async () => {
    const { prisma, findFirst } = makePrisma(null);
    const svc = new CostCalculatorService(prisma);

    const r = await svc.calculate(null, null, 3);

    expect(r.status).toBe('NO_RATE_FOUND');
    expect(findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/time-entries/cost-calculator.service.spec.ts --runInBand`
Expected: FAIL — the first test fails because the current code emits `{ validTo: { gte: entryDate } }`, so `validToClause.validTo.gt` is `undefined` (not a `Date`). Other tests should pass.

- [ ] **Step 3: Apply the fix**

In `src/time-entries/cost-calculator.service.ts`, line 12, change:

```typescript
      where: { assigneeId: userId, validFrom: { lte: entryDate }, OR: [{ validTo: null }, { validTo: { gte: entryDate } }] },
```

to:

```typescript
      where: { assigneeId: userId, validFrom: { lte: entryDate }, OR: [{ validTo: null }, { validTo: { gt: entryDate } }] },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/time-entries/cost-calculator.service.spec.ts --runInBand`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/time-entries/cost-calculator.service.ts src/time-entries/cost-calculator.service.spec.ts
git commit -m "fix: cost calculator uses closed-open [from,to) for valid_to

Aligns cost-calculator with the RateModal UI and reports.missingRates
which already treat valid_to as exclusive. A time entry exactly on a
rate's valid_to is no longer double-covered/mis-flagged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `CostRecalculationService`

**Files:**
- Create: `src/time-entries/cost-recalculation.service.ts`
- Create: `src/time-entries/cost-recalculation.service.spec.ts`
- Modify: `src/time-entries/time-entries.module.ts`

- [ ] **Step 1: Write the failing test**

Create `src/time-entries/cost-recalculation.service.spec.ts`:

```typescript
import { CostRecalculationService } from './cost-recalculation.service';

function makeDeps(entries: any[]) {
  const findMany = jest.fn().mockResolvedValue(entries);
  const update = jest.fn().mockResolvedValue({});
  const prisma = { clickupTimeEntry: { findMany, update } } as any;
  const calculate = jest.fn().mockResolvedValue({
    rateId: 9n, currency: 'AUD', hourlyRateCents: 10000n, costCents: 20000n, status: 'COST_CALCULATED',
  });
  const costs = { calculate } as any;
  return { svc: new CostRecalculationService(prisma, costs), prisma, findMany, update, calculate };
}

const ENTRY = { timeEntryId: 'te-1', userId: 'u1', startTime: new Date('2024-06-15T00:00:00Z'), durationHours: '2' };

describe('CostRecalculationService', () => {
  it('scopes the query to one assignee when assigneeId is given', async () => {
    const { svc, findMany } = makeDeps([ENTRY]);
    await svc.recalculate({ assigneeId: 'u1' });
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });

  it('scans all entries when assigneeId is omitted', async () => {
    const { svc, findMany } = makeDeps([ENTRY]);
    await svc.recalculate({});
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });

  it('recomputes each entry and writes the cost fields back', async () => {
    const { svc, update, calculate } = makeDeps([ENTRY]);
    const res = await svc.recalculate({ assigneeId: 'u1' });

    expect(calculate).toHaveBeenCalledWith('u1', ENTRY.startTime, 2);
    expect(update).toHaveBeenCalledWith({
      where: { timeEntryId: 'te-1' },
      data: { rateId: 9n, currency: 'AUD', hourlyRateCents: 10000n, costCents: 20000n, status: 'COST_CALCULATED' },
    });
    expect(res).toEqual({ scanned: 1, updated: 1 });
  });

  it('is idempotent — a second run issues the same update', async () => {
    const { svc, update } = makeDeps([ENTRY]);
    await svc.recalculate({ assigneeId: 'u1' });
    await svc.recalculate({ assigneeId: 'u1' });
    expect(update.mock.calls[0]).toEqual(update.mock.calls[1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/time-entries/cost-recalculation.service.spec.ts --runInBand`
Expected: FAIL — `Cannot find module './cost-recalculation.service'`.

- [ ] **Step 3: Write the implementation**

Create `src/time-entries/cost-recalculation.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CostCalculatorService } from './cost-calculator.service';

@Injectable()
export class CostRecalculationService {
  private readonly logger = new Logger(CostRecalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: CostCalculatorService,
  ) {}

  /**
   * Recompute cost_cents/rate_id/status for existing time entries using the
   * current assignee rates. Scoped to one assignee when assigneeId is given,
   * otherwise every entry. Idempotent.
   */
  async recalculate(opts: { assigneeId?: string }): Promise<{ scanned: number; updated: number }> {
    const where = opts.assigneeId ? { userId: opts.assigneeId } : {};
    const entries = await this.prisma.clickupTimeEntry.findMany({
      where,
      select: { timeEntryId: true, userId: true, startTime: true, durationHours: true },
    });

    let updated = 0;
    for (const e of entries) {
      const cost = await this.costs.calculate(e.userId, e.startTime, Number(e.durationHours));
      await this.prisma.clickupTimeEntry.update({
        where: { timeEntryId: e.timeEntryId },
        data: {
          rateId: cost.rateId,
          currency: cost.currency,
          hourlyRateCents: cost.hourlyRateCents,
          costCents: cost.costCents,
          status: cost.status,
        },
      });
      updated += 1;
    }

    this.logger.log(`Recalculated ${updated}/${entries.length} time entries (assignee=${opts.assigneeId ?? 'all'})`);
    return { scanned: entries.length, updated };
  }
}
```

- [ ] **Step 4: Wire it into the module**

In `src/time-entries/time-entries.module.ts`, add the import and register it in `providers` and `exports`:

```typescript
import { CostRecalculationService } from './cost-recalculation.service';
```

Change the `@Module` to include `CostRecalculationService` in both arrays:

```typescript
@Module({
  imports: [ClickupModule, QueuesModule],
  providers: [TimeEntriesRepository, TimeEntryReplacementsRepository, TagAssigneeMapRepository, CostCalculatorService, CostRecalculationService, TimeEntriesService, AssigneeReplacementService],
  exports: [TimeEntriesService, TimeEntriesRepository, TimeEntryReplacementsRepository, TagAssigneeMapRepository, CostCalculatorService, CostRecalculationService, AssigneeReplacementService],
})
export class TimeEntriesModule {}
```

- [ ] **Step 5: Run test + build**

Run: `npx jest src/time-entries/cost-recalculation.service.spec.ts --runInBand`
Expected: PASS — 4/4.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/time-entries/cost-recalculation.service.ts src/time-entries/cost-recalculation.service.spec.ts src/time-entries/time-entries.module.ts
git commit -m "feat: CostRecalculationService recomputes existing time-entry costs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `recalculate-costs` job + `CostRecalcProcessor`

**Files:**
- Modify: `src/queues/queue.constants.ts`
- Create: `src/workers/cost-recalc.processor.ts`
- Create: `src/workers/cost-recalc.processor.spec.ts`
- Modify: `src/workers/workers.module.ts`

- [ ] **Step 1: Add the job constant**

In `src/queues/queue.constants.ts`, add to the `JOBS` object (keep `SYNC_ASSIGNEE_RATES` for now — removed in Task 6):

```typescript
  RECALCULATE_COSTS: 'recalculate-costs',
```

so `JOBS` ends:

```typescript
  REFRESH_CLICKUP_WEBHOOKS: 'refresh-clickup-webhooks',
  REPLACE_TIME_ENTRY_ASSIGNEES: 'replace-time-entry-assignees',
  RECALCULATE_COSTS: 'recalculate-costs',
} as const;
```

- [ ] **Step 2: Write the failing test**

Create `src/workers/cost-recalc.processor.spec.ts`:

```typescript
import { CostRecalcProcessor } from './cost-recalc.processor';

function makeDeps() {
  const recalculate = jest.fn().mockResolvedValue({ scanned: 3, updated: 3 });
  const started = jest.fn().mockResolvedValue({ id: 1n });
  const finished = jest.fn().mockResolvedValue({});
  const failed = jest.fn().mockResolvedValue({});
  const proc = new CostRecalcProcessor({ recalculate } as any, { started, finished, failed } as any);
  return { proc, recalculate, started, finished, failed };
}

describe('CostRecalcProcessor', () => {
  it('runs the recalculation and logs success', async () => {
    const { proc, recalculate, finished } = makeDeps();
    const res = await proc.process({ id: '42', name: 'recalculate-costs', data: { assigneeId: 'u1' } } as any);
    expect(recalculate).toHaveBeenCalledWith({ assigneeId: 'u1' });
    expect(finished).toHaveBeenCalledWith(1n, { timeEntriesSynced: 3 });
    expect(res).toEqual({ scanned: 3, updated: 3 });
  });

  it('logs failure and rethrows', async () => {
    const { proc, recalculate, failed } = makeDeps();
    const err = new Error('boom');
    recalculate.mockRejectedValueOnce(err);
    await expect(proc.process({ id: '1', name: 'recalculate-costs', data: {} } as any)).rejects.toThrow('boom');
    expect(failed).toHaveBeenCalledWith(1n, err);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/workers/cost-recalc.processor.spec.ts --runInBand`
Expected: FAIL — `Cannot find module './cost-recalc.processor'`.

- [ ] **Step 4: Write the processor**

Create `src/workers/cost-recalc.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { CostRecalculationService } from '../time-entries/cost-recalculation.service';
import { JobLogsRepository } from '../jobs/job-logs.repository';

@Injectable()
@Processor(QUEUES.MAINTENANCE)
export class CostRecalcProcessor extends WorkerHost {
  constructor(
    private readonly recalc: CostRecalculationService,
    private readonly jobLogs: JobLogsRepository,
  ) {
    super();
  }

  async process(job: Job<{ assigneeId?: string }>) {
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.MAINTENANCE,
      jobName: job.name,
      entityType: 'assignee',
      entityId: job.data.assigneeId ?? '*',
    });
    try {
      const res = await this.recalc.recalculate({ assigneeId: job.data.assigneeId });
      await this.jobLogs.finished(log.id, { timeEntriesSynced: res.updated });
      return res;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }
}
```

- [ ] **Step 5: Register the processor**

In `src/workers/workers.module.ts`, add the import:

```typescript
import { CostRecalcProcessor } from './cost-recalc.processor';
```

and add `CostRecalcProcessor` to the `providers` array (leave `RatesSyncProcessor` for now — removed in Task 6):

```typescript
@Module({ imports: [QueuesModule, WebhooksModule, TasksModule, TimeEntriesModule, SyncModule, RatesModule, JobsModule], providers: [ClickupEventProcessor, TaskSyncProcessor, TimeEntrySyncProcessor, BackfillProcessor, RatesSyncProcessor, TimeEntryReplacementProcessor, CostRecalcProcessor] })
export class WorkersModule {}
```

- [ ] **Step 6: Run test + build**

Run: `npx jest src/workers/cost-recalc.processor.spec.ts --runInBand`
Expected: PASS — 2/2.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/queues/queue.constants.ts src/workers/cost-recalc.processor.ts src/workers/cost-recalc.processor.spec.ts src/workers/workers.module.ts
git commit -m "feat: recalculate-costs job + CostRecalcProcessor on MAINTENANCE queue

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `RatesService` mutation seam + `RatesRepository.findById`

**Files:**
- Modify: `src/rates/rates.repository.ts`
- Modify: `src/rates/rates.service.ts`
- Modify: `src/rates/rates.module.ts`
- Create: `src/rates/rates.service.spec.ts`

- [ ] **Step 1: Add `findById` to the repository**

In `src/rates/rates.repository.ts`, add this method to the `RatesRepository` class (after `findAll`):

```typescript
  async findById(id: bigint) {
    const r = await this.prisma.assigneeRate.findUnique({ where: { rateId: id } });
    return r ? mapRate(r) : null;
  }
```

- [ ] **Step 2: Write the failing test**

Create `src/rates/rates.service.spec.ts`:

```typescript
import { RatesService } from './rates.service';

function makeDeps() {
  const created = { id: '1', assigneeId: 'u1', assigneeName: null, assigneeEmail: null, currency: 'AUD', hourlyRateCents: 100, validFrom: new Date(), validTo: null, updatedAt: new Date() };
  const repo = {
    create: jest.fn().mockResolvedValue(created),
    update: jest.fn().mockResolvedValue({ ...created, assigneeId: 'u2' }),
    remove: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue({ ...created, assigneeId: 'u3' }),
  };
  const add = jest.fn().mockResolvedValue(undefined);
  const queues = { get: jest.fn().mockReturnValue({ add }), defaultJobOptions: jest.fn().mockReturnValue({}) };
  return { svc: new RatesService(repo as any, queues as any), repo, queues, add };
}

describe('RatesService', () => {
  it('create writes then enqueues a scoped recalculation', async () => {
    const { svc, repo, add } = makeDeps();
    const r = await svc.create({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 100, validFrom: new Date() } as any);
    expect(repo.create).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith('recalculate-costs', { assigneeId: 'u1' }, {});
    expect(r.assigneeId).toBe('u1');
  });

  it('update enqueues for the updated rate\'s assignee', async () => {
    const { svc, add } = makeDeps();
    await svc.update(5n, { hourlyRateCents: 200 });
    expect(add).toHaveBeenCalledWith('recalculate-costs', { assigneeId: 'u2' }, {});
  });

  it('remove looks up the assignee, deletes, then enqueues', async () => {
    const { svc, repo, add } = makeDeps();
    await svc.remove(7n);
    expect(repo.findById).toHaveBeenCalledWith(7n);
    expect(repo.remove).toHaveBeenCalledWith(7n);
    expect(add).toHaveBeenCalledWith('recalculate-costs', { assigneeId: 'u3' }, {});
  });

  it('a failed enqueue does not throw (rate write already succeeded)', async () => {
    const { svc, add } = makeDeps();
    add.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.create({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 1, validFrom: new Date() } as any)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/rates/rates.service.spec.ts --runInBand`
Expected: FAIL — current `RatesService` has only `syncRates()`; `svc.create` is not a function / constructor arity mismatch.

- [ ] **Step 4: Rewrite `RatesService`**

Replace the entire contents of `src/rates/rates.service.ts` with:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RatesRepository } from './rates.repository';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);

  constructor(
    private readonly repo: RatesRepository,
    private readonly queues: QueueService,
  ) {}

  private async enqueueRecalc(assigneeId: string) {
    try {
      await this.queues
        .get(QUEUES.MAINTENANCE)
        .add(JOBS.RECALCULATE_COSTS, { assigneeId }, this.queues.defaultJobOptions());
    } catch (e) {
      // Rate write already committed; recalculation can be retried via the
      // manual "Recalculate costs" button. Never fail the mutation here.
      this.logger.error(`Failed to enqueue cost recalculation for ${assigneeId}: ${(e as Error).message}`);
    }
  }

  async create(data: Parameters<RatesRepository['create']>[0]) {
    const rate = await this.repo.create(data);
    await this.enqueueRecalc(rate.assigneeId);
    return rate;
  }

  async update(id: bigint, data: Parameters<RatesRepository['update']>[1]) {
    const rate = await this.repo.update(id, data);
    await this.enqueueRecalc(rate.assigneeId);
    return rate;
  }

  async remove(id: bigint) {
    const existing = await this.repo.findById(id);
    await this.repo.remove(id);
    if (existing) await this.enqueueRecalc(existing.assigneeId);
  }
}
```

- [ ] **Step 5: Give `RatesModule` access to `QueueService`**

In `src/rates/rates.module.ts`, import `QueuesModule` and add it to `imports`:

```typescript
import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { RatesRepository } from './rates.repository';
import { RatesService } from './rates.service';

@Module({ imports: [QueuesModule], providers: [RatesRepository, RatesService], exports: [RatesService, RatesRepository] })
export class RatesModule {}
```

- [ ] **Step 6: Run test + build**

Run: `npx jest src/rates/rates.service.spec.ts --runInBand`
Expected: PASS — 4/4.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/rates/rates.repository.ts src/rates/rates.service.ts src/rates/rates.service.spec.ts src/rates/rates.module.ts
git commit -m "feat: RatesService mutation seam enqueues scoped cost recalculation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Admin routes use `RatesService`; replace `/rates/sync` with `/rates/recalculate`

**Files:**
- Modify: `src/admin/admin.controller.ts`

Note: `AdminController`'s constructor grows by one param. `test/admin.controller.spec.ts` is **already failing** (pre-existing arity mismatch, explicitly out of scope per the spec) — do not fix it here; just don't rely on it.

- [ ] **Step 1: Import `RatesService` and inject it**

In `src/admin/admin.controller.ts`, add the import near the other imports:

```typescript
import { RatesService } from '../rates/rates.service';
```

Add `ratesService` to the constructor (keep `ratesRepo` — still used by `listRates`):

```typescript
  constructor(
    private readonly queues: QueueService,
    private readonly deadLetters: DeadLetterRepository,
    private readonly clickup: ClickupClient,
    private readonly webhooks: ClickupWebhooksService,
    private readonly timeEntriesRepo: TimeEntriesRepository,
    private readonly ratesRepo: RatesRepository,
    private readonly tagAssigneeRepo: TagAssigneeMapRepository,
    private readonly tasksRepo: TasksRepository,
    private readonly ratesService: RatesService,
  ) {}
```

- [ ] **Step 2: Replace the `/rates/sync` route with `/rates/recalculate`**

In `src/admin/admin.controller.ts`, replace the entire `syncRates()` method (the `@Post('rates/sync')` block) with:

```typescript
  @Post('rates/recalculate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recalculate time-entry costs from current rates (optionally scoped to one assignee)' })
  recalculateCosts(@Query('assigneeId') assigneeId?: string) {
    this.queues
      .get(QUEUES.MAINTENANCE)
      .add(JOBS.RECALCULATE_COSTS, assigneeId ? { assigneeId } : {}, this.queues.defaultJobOptions());
    return { queued: true, scope: assigneeId ?? 'all' };
  }
```

- [ ] **Step 3: Route the rate CRUD mutations through `RatesService`**

In the same file, in `createRate(...)` change `return this.ratesRepo.create({...})` to `return this.ratesService.create({...})` (keep the existing `validFrom`/`validTo` `Date` parsing and arguments exactly as they are — only the receiver changes).

In `updateRate(...)` change `return this.ratesRepo.update(parseId(id), data)` to `return this.ratesService.update(parseId(id), data)`.

In `deleteRate(...)` change `return this.ratesRepo.remove(parseId(id))` to `return this.ratesService.remove(parseId(id))`.

Leave `listRates(...)` calling `this.ratesRepo.findAll(...)` unchanged.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Verify the manual endpoint shape (smoke test)**

Run: `npx jest --runInBand 2>&1 | tail -5`
Expected: all suites pass **except** the pre-existing `test/admin.controller.spec.ts` (arity mismatch — out of scope). No *new* failing suites.

- [ ] **Step 6: Commit**

```bash
git add src/admin/admin.controller.ts
git commit -m "feat: admin rate mutations trigger recalc; /rates/sync -> /rates/recalculate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Remove dead Google Sheets wiring (code)

**Files:**
- Delete: `src/workers/rates-sync.processor.ts`
- Modify: `src/workers/workers.module.ts`
- Modify: `src/queues/queue.constants.ts`
- Modify: `src/queues/queue.service.ts`
- Modify: `src/sync/sync.scheduler.ts`

- [ ] **Step 1: Delete the dead processor**

```bash
git rm src/workers/rates-sync.processor.ts
```

- [ ] **Step 2: Remove it from `workers.module.ts`**

In `src/workers/workers.module.ts`, delete the line:

```typescript
import { RatesSyncProcessor } from './rates-sync.processor';
```

and remove `RatesSyncProcessor` from the `providers` array (so it reads `..., TimeEntryReplacementProcessor, CostRecalcProcessor]`).

- [ ] **Step 3: Remove the dead queue + job constants**

In `src/queues/queue.constants.ts`, delete `ASSIGNEE_RATES: 'assignee-rates',` from `QUEUES` and `SYNC_ASSIGNEE_RATES: 'sync-assignee-rates',` from `JOBS`. Final file:

```typescript
export const QUEUES = {
  CLICKUP_WEBHOOKS: 'clickup-webhooks',
  CLICKUP_TASKS: 'clickup-tasks',
  CLICKUP_TIME_ENTRIES: 'clickup-time-entries',
  CLICKUP_BACKFILLS: 'clickup-backfills',
  MAINTENANCE: 'maintenance',
  CLICKUP_ASSIGNEE_REPLACEMENT: 'clickup-assignee-replacement',
} as const;

export const JOBS = {
  PROCESS_CLICKUP_EVENT: 'process-clickup-event',
  SYNC_CLICKUP_TASK: 'sync-clickup-task',
  DELETE_CLICKUP_TASK: 'delete-clickup-task',
  SYNC_TASK_TIME_ENTRIES: 'sync-task-time-entries',
  BACKFILL_CLICKUP_SPACE: 'backfill-clickup-space',
  REFRESH_CLICKUP_WEBHOOKS: 'refresh-clickup-webhooks',
  REPLACE_TIME_ENTRY_ASSIGNEES: 'replace-time-entry-assignees',
  RECALCULATE_COSTS: 'recalculate-costs',
} as const;
```

(`queues.module.ts` registers queues via `Object.values(QUEUES).map(...)`, so dropping the constant automatically unregisters the BullMQ queue — no change needed there.)

- [ ] **Step 4: Drop the `ASSIGNEE_RATES` injection from `QueueService`**

In `src/queues/queue.service.ts`, delete the constructor line:

```typescript
    @InjectQueue(QUEUES.ASSIGNEE_RATES) private readonly rates: Queue,
```

and delete the map entry:

```typescript
      [QUEUES.ASSIGNEE_RATES]: this.rates,
```

- [ ] **Step 5: Remove the 1 AM rate-sync cron**

In `src/sync/sync.scheduler.ts`, delete the entire `syncRates()` method (the `@Cron(CronExpression.EVERY_DAY_AT_1AM)` block) and remove `CronExpression` from the `@nestjs/schedule` import (it is no longer used — `reconcileRecentUpdates` uses a raw cron string). Resulting file:

```typescript
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

@Injectable()
export class SyncScheduler {
  constructor(private readonly queues: QueueService) {}

  @Cron('0 */15 * * * *')
  async reconcileRecentUpdates() {
    for (const space of CLICKUP_SPACES) {
      await this.queues.get(QUEUES.CLICKUP_BACKFILLS).add(JOBS.BACKFILL_CLICKUP_SPACE, { spaceId: space.id, lookbackDays: 1 }, this.queues.defaultJobOptions());
    }
  }
}
```

- [ ] **Step 6: Confirm no dangling references**

Run: `npx ripgrep -n "SYNC_ASSIGNEE_RATES|ASSIGNEE_RATES|RatesSyncProcessor|syncRates" src` (or your Grep tool with that pattern over `src`).
Expected: **no matches**. If any remain, remove them before continuing.

- [ ] **Step 7: Build + full tests**

Run: `npm run build`
Expected: exit 0.

Run: `npx jest --runInBand 2>&1 | tail -5`
Expected: all suites pass except the pre-existing `test/admin.controller.spec.ts`. No new failures.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove dead Google Sheets rate-sync wiring

Deletes RatesSyncProcessor, ASSIGNEE_RATES queue + SYNC_ASSIGNEE_RATES
job, the QueueService injection, and the 1 AM rate-sync cron. Rates are
managed via the UI; costs are recomputed by the recalculate-costs job.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Documentation cleanup

**Files:**
- Modify: `CLAUDE.md`, `.env.example`, and any `README.md` / `docs/ARCHITECTURE.md` / `docs/OPERATIONS.md` that mention Google Sheets rate sync.

- [ ] **Step 1: Find all Google Sheets references**

Run your Grep tool with pattern `GOOGLE_|Google Sheet|google.*sheet|assignee-rates|Sync Assignee Rates` over `CLAUDE.md`, `.env.example`, `README.md`, and `docs/` (case-insensitive). Record every hit.

- [ ] **Step 2: Edit `CLAUDE.md`**

Make these concrete changes:
- Remove the entire ```` ```env ```` block under "Required only for Google Sheets rate sync" (the `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_RATES_SHEET_ID` / `GOOGLE_RATES_SHEET_NAME` / `GOOGLE_ASSIGNEE_SHEET_NAME` lines) and its heading.
- In the "Assignee rates" subsection, replace "Rates come from the Google Sheet named `rates`." and the required-columns block with: "Rates are managed via the UI / `POST|PATCH|DELETE /admin/rates`. Changing a rate enqueues a scoped `recalculate-costs` job (queue `maintenance`) that recomputes existing `clickup_time_entries`. `valid_from`/`valid_to` are a closed-open interval `[from, to)`."
- In the "Expected queues" list, remove the `assignee-rates` bullet and add `maintenance` if not already listed.
- Remove the "Assignee-rate sync from Google Sheets" line from the project-purpose bullet list and the Google service-account line from the Security checklist.

- [ ] **Step 3: Edit `.env.example`**

Delete every `GOOGLE_*` line found in Step 1. If a comment header introduces the Google block, delete that too.

- [ ] **Step 4: Edit README / docs**

For each remaining hit in `README.md` / `docs/ARCHITECTURE.md` / `docs/OPERATIONS.md`, replace the Google-Sheets-rate-sync description with a one-line statement that rates are managed in the dashboard (`/assignee-rates`) and costs are recomputed by the `recalculate-costs` maintenance job. Do not remove unrelated content.

- [ ] **Step 5: Verify**

Re-run the Step 1 grep. Expected: no remaining functional references to Google Sheets rate sync (a historical mention in `source-workflows/` or this spec/plan is fine — those are historical artifacts; do not edit `source-workflows/`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: drop Google Sheets rate-sync; document UI rates + recalc

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Frontend — recalculate button

**Files:**
- Modify: `apps/web/src/api/rates.ts`
- Modify: `apps/web/src/hooks/useRates.ts`
- Modify: `apps/web/src/pages/AssigneeRatesPage.tsx`

Note: this repo has no frontend test harness (Jest is backend-only, `testRegex: .*\.spec\.ts$`). Frontend changes are verified with `npm run build:web` (tsc + Vite). This is consistent with the existing codebase, which has no component tests.

- [ ] **Step 1: Add the API call**

In `apps/web/src/api/rates.ts`, add to the `ratesApi` object (after `remove`):

```typescript
  recalculate: (assigneeId?: string) =>
    apiClient
      .post('/admin/rates/recalculate', null, { params: assigneeId ? { assigneeId } : {} })
      .then((r) => r.data as { queued: boolean; scope: string }),
```

- [ ] **Step 2: Add the hook**

In `apps/web/src/hooks/useRates.ts`, add at the end of the file:

```typescript
export function useRecalcCosts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assigneeId?: string) => ratesApi.recalculate(assigneeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rates'] });
      qc.invalidateQueries({ queryKey: ['time-entries'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['missing-rates'] });
    },
  });
}
```

- [ ] **Step 3: Wire the page — imports, hook, transient banner state**

In `apps/web/src/pages/AssigneeRatesPage.tsx`:

Add `RefreshCw` to the existing `lucide-react` import (alongside `Plus`, `Search`, etc.).

Add `useRecalcCosts` to the existing rates-hook import:

```typescript
import { useRates, useRecalcCosts } from '../hooks/useRates';
```

Add the `Callout` import (used elsewhere in the app) near the other UI imports:

```typescript
import { Callout } from '../components/ui/Callout';
```

Inside `AssigneeRatesPage()`, after the existing `const { data: rates, isLoading } = useRates();` line, add:

```typescript
  const recalc = useRecalcCosts();
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

  function runRecalc(assigneeId?: string) {
    recalc.mutate(assigneeId, {
      onSuccess: () => {
        setRecalcMsg(
          assigneeId
            ? 'Recalculation queued for this assignee — costs update shortly.'
            : 'Recalculation queued for all entries — costs update shortly.',
        );
        setTimeout(() => setRecalcMsg(null), 5000);
      },
    });
  }
```

- [ ] **Step 4: Add the global button + banner to the header**

In the `<PageHeader ... actions={ ... }>` block, add a "Recalculate costs" button before the existing "New rate" button:

```tsx
            <Button
              size="md"
              variant="default"
              icon={<RefreshCw size={13} />}
              loading={recalc.isPending}
              onClick={() => runRecalc()}
            >
              Recalculate costs
            </Button>
```

Immediately after the `<PageHeader ... />` element (before the metric-cards `<div>`), add:

```tsx
      {recalcMsg && (
        <Callout tone="blue">{recalcMsg}</Callout>
      )}
```

- [ ] **Step 5: Add a per-assignee recalc action**

In the per-assignee card header (the row that contains `<Button ... onClick={() => openNewForAssignee(g)}>New rate</Button>`), add this button immediately before that "New rate" button:

```tsx
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RefreshCw size={12} />}
                    loading={recalc.isPending}
                    onClick={() => runRecalc(g.assigneeId)}
                  >
                    Recalc
                  </Button>
```

- [ ] **Step 6: Build the frontend**

Run: `npm run build:web`
Expected: exit 0 (tsc + Vite build succeed, no type errors).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/rates.ts apps/web/src/hooks/useRates.ts apps/web/src/pages/AssigneeRatesPage.tsx
git commit -m "feat(web): recalculate-costs button (global + per-assignee) on Assignee Rates

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Backend build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 2: Full backend test suite**

Run: `npx jest --runInBand 2>&1 | tail -6`
Expected: all suites pass **except** `test/admin.controller.spec.ts` (pre-existing arity mismatch, explicitly out of scope). Test count is the prior total plus the new specs from Tasks 1–4. No other failing suites.

- [ ] **Step 3: Frontend build**

Run: `npm run build:web`
Expected: exit 0.

- [ ] **Step 4: Residue check**

Run your Grep tool for `ASSIGNEE_RATES|SYNC_ASSIGNEE_RATES|RatesSyncProcessor|syncRates` over `src`, and `GOOGLE_|Google Sheet` over `CLAUDE.md` `.env.example` `README.md` `docs`.
Expected: no functional matches (historical-only mentions in `source-workflows/` are acceptable and must not be edited).

- [ ] **Step 5: Manual acceptance (document results in the PR/commit, not automated)**

With `npm run dev:deps` + the dev server running:
1. Open `/assignee-rates`, create a rate for an assignee who has time entries.
2. Within a few seconds, that assignee's entries on `/time-entries` show a computed cost and `COST_CALCULATED` (no full re-sync).
3. Edit then delete a rate — entries recompute for that assignee.
4. Click the global "Recalculate costs" button — confirm the banner appears and `sync_job_logs` shows a `recalculate-costs` row (`queue_name = maintenance`).
5. Confirm a time entry whose date equals a rate's `valid_to` is **not** costed by that rate (consistent with `/missing-rates`).

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: rates-from-UI cost recalculation — final verification

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §4.1 valid_to fix → Task 1 ✓
- §4.2 CostRecalculationService → Task 2 ✓
- §4.3 async wiring (job const, processor, RatesService seam, RatesRepository.findById, module imports, AdminController routing) → Tasks 3, 4, 5 ✓
- §4.4 manual `/admin/rates/recalculate` → Task 5 ✓
- §4.5 frontend (api, hook, page buttons) → Task 8 ✓
- §4.6 dead Google Sheets removal → Task 6 ✓
- docs (§4.6 last bullet) → Task 7 ✓
- §6 testing (cost-calculator boundary, recalculation idempotent/scoped) → Tasks 1, 2 ✓ (processor + service-seam also covered in Tasks 3, 4)
- §7 acceptance criteria → Task 9 Step 5 ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; commands have expected output. Doc task (7) uses directed grep + concrete replacement text rather than vague "update docs". OK.

**Type consistency:** `CostRecalculationService.recalculate({ assigneeId? })` returns `{ scanned, updated }` — used identically in Tasks 2, 3. `JOBS.RECALCULATE_COSTS` literal `'recalculate-costs'` — used consistently in Tasks 3 (processor/test), 4 (RatesService/test), 5 (controller). `RatesRepository.findById` returns `mapRate | null` (`.assigneeId` is a string) — consumed in Task 4 `remove`. `jobLogs.started(...)` resolves to a record with `.id: bigint`; `finished(id, { timeEntriesSynced })` matches `JobLogsRepository` signatures. `QueueService.get(QUEUES.MAINTENANCE).add(name, data, opts)` matches existing usage. Consistent.

No gaps found.

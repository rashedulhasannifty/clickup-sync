# Task Chargeability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace reporting's reliance on ClickUp's unmaintained per-time-entry `billable` flag with our own per-task Chargeable / Non-chargeable flag, set by an Owner or Admin through a confirmation dialog.

**Architecture:** A locally-owned `is_chargeable` column on `clickup_tasks` (default `true`) that no ClickUp sync path ever writes. A time entry's chargeability is read through its task; a task-less entry counts as chargeable. Non-chargeable time still resolves and stores its rate but costs zero and carries a new `NOT_CHARGEABLE` status. Toggling a task enqueues the existing scoped `recalculate-costs` maintenance job.

**Tech Stack:** NestJS 11, Prisma 7 + PostgreSQL, BullMQ + Redis, Jest (backend); React 19 + Vite + TanStack Query (`apps/web`, no test runner).

**Spec:** `docs/superpowers/specs/2026-08-27-task-chargeability-design.md`

## Global Constraints

- Run all backend commands from the repository root. Backend tests: `npx jest <path>`; full suite `npm run test`; lint `npm run lint`; build `npm run build`.
- Frontend lives in `apps/web` and has **no test runner**. Verify frontend work with `cd apps/web && npx tsc -b && npx eslint . && npm run build`. `npx eslint .` currently reports **73 problems (48 errors, 25 warnings)** on `main` — all pre-existing. Your work must not raise those counts.
- Preserve Prettier formatting. Prefer explicit types over `any`; `unknown` + guards for untrusted payloads.
- Never log tokens, secrets, or raw auth headers.
- User-facing copy is **Chargeable** / **Non-chargeable**. Never "billable" in any label, header, or Excel column.
- The cost status string is exactly `NOT_CHARGEABLE`.
- The task-less time-entry bucket keeps its existing sentinel `__none__` (`NO_TASK_ID` in `src/reports/report-filter.util.ts`).
- API field renames are hard renames with no aliases: `billable` → `chargeable`, `billableHours` → `chargeableHours`, `nonBillableHours` → `nonChargeableHours`.
- Do not run `npm run dev:reset` or any destructive database command.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `prisma/migrations/0019_task_is_chargeable/migration.sql` | Adds the column + partial index |
| `src/admin/dto/set-task-chargeable.dto.ts` | Validates the PATCH body (ids + boolean, 500 cap) |
| `src/admin/admin-tasks.controller.ts` | `PATCH /admin/tasks/chargeable`, Owner/Admin, audited |
| `apps/web/src/components/ChargeableConfirmModal.tsx` | The confirmation dialog, both entry points |

**Modified**

| File | Change |
|---|---|
| `prisma/schema.prisma` | `isChargeable` in a local-annotations block on `ClickupTask` |
| `src/tasks/tasks.repository.ts` | Guardrail comment; `setChargeable()` |
| `src/time-entries/cost-calculator.service.ts` | `chargeable` opt, `NOT_CHARGEABLE` |
| `src/settings/settings.service.ts` | Delete `cost.nonBillableZero` |
| `src/time-entries/cost-recalculation.service.ts` | `taskIds` scope; read the task flag |
| `src/workers/cost-recalc.processor.ts` | Accept `taskIds` in the job payload |
| `src/time-entries/time-entries.service.ts` | Always pre-fetch the task flag |
| `src/time-entries/assignee-replacement.service.ts` | Pass the task flag |
| `src/reports/report-filter.util.ts` | `chargeable` filter through the task relation |
| `src/reports/time-entries-report.service.ts` | Aggregates, grouped fold, chargeable summary |
| `src/reports/tasks-report.service.ts` | Select `isChargeable`; chargeable preview |
| `src/reports/reports.controller.ts` | Renamed params, renamed + new endpoints |
| `src/reports/ops-report.service.ts` | Exclude `NOT_CHARGEABLE` from the missing-rate count |
| `src/admin/admin.module.ts` | Register `AdminTasksController` |
| `apps/web/src/**` | Labels, flag display, toggle, bulk action |

---

### Task 1: The column, and the guardrail that keeps it

**Files:**
- Modify: `prisma/schema.prisma` (model `ClickupTask`, after `raw`)
- Create: `prisma/migrations/0019_task_is_chargeable/migration.sql`
- Modify: `src/tasks/tasks.repository.ts:10-31`
- Test: `src/tasks/tasks.repository.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ClickupTask.isChargeable: boolean` (Prisma), column `clickup_tasks.is_chargeable`.

Background an implementer needs: `TasksRepository.upsert` builds both `create` and `update` by spreading `NormalizedTask` (the normalizer's output). `isChargeable` is not a field of `NormalizedTask`, so no sync path writes it — that is the entire mechanism protecting user-set flags from being reverted on the next resync. It is incidental, so this task makes it explicit and tested.

- [ ] **Step 1: Write the failing test**

Add to `src/tasks/tasks.repository.spec.ts`:

```typescript
describe('local annotations', () => {
  it('never writes is_chargeable, so a resync cannot revert a user-set flag', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const repo = new TasksRepository({ clickupTask: { upsert } } as never);

    await repo.upsert({ taskId: 't1', taskName: 'Fix webhook dedupe', raw: {} } as never);

    const call = upsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('isChargeable');
    expect(call.update).not.toHaveProperty('isChargeable');
  });
});
```

- [ ] **Step 2: Prove the test can fail**

This guardrail passes trivially today, so verify it can actually catch the regression it exists for. Temporarily add `isChargeable: true` to the `update` object in `src/tasks/tasks.repository.ts`:

```bash
npx jest src/tasks/tasks.repository.spec.ts
```
Expected: FAIL with `expect(received).not.toHaveProperty("isChargeable")`. **Revert the temporary line before continuing.**

- [ ] **Step 3: Add the column to the schema**

In `prisma/schema.prisma`, inside `model ClickupTask`, immediately after `raw  Json?`:

```prisma
  // ── Local annotations ───────────────────────────────────────────────────
  // Owned by THIS app, not mirrored from ClickUp. No sync path may write
  // these: `TasksRepository.upsert` spreads `NormalizedTask`, which contains
  // none of them, and a test enforces that. Anything added here inherits the
  // same rule — a sync that writes these silently reverts what a user set.
  isChargeable    Boolean  @default(true) @map("is_chargeable")
```

- [ ] **Step 4: Write the migration**

Create `prisma/migrations/0019_task_is_chargeable/migration.sql`:

```sql
-- Our own Chargeable/Non-chargeable flag, replacing reporting's use of
-- ClickUp's per-time-entry `billable` (which nobody maintains in ClickUp).
-- Every existing task becomes chargeable via the default; no backfill needed.
ALTER TABLE "clickup_tasks"
  ADD COLUMN IF NOT EXISTS "is_chargeable" BOOLEAN NOT NULL DEFAULT true;

-- Partial index: almost every row is `true`, so only the non-chargeable side
-- is selective enough to be worth indexing.
CREATE INDEX IF NOT EXISTS "clickup_tasks_non_chargeable_idx"
  ON "clickup_tasks" ("task_id")
  WHERE "is_chargeable" = false;
```

- [ ] **Step 5: Document the guardrail at the upsert**

In `src/tasks/tasks.repository.ts`, directly above `const shared = { ...task, ... }` in `upsert`:

```typescript
    // `shared` is built from NormalizedTask alone, which deliberately carries
    // no local annotations (see the "Local annotations" block in
    // schema.prisma). Do NOT switch this to writing every column: user-set
    // flags like `isChargeable` would revert on each task's next resync, with
    // no error anywhere. `tasks.repository.spec.ts` enforces this.
```

- [ ] **Step 6: Regenerate the client and apply the migration**

```bash
npm run prisma:generate
npm run prisma:deploy
```
Expected: the migration applies and `ClickupTask.isChargeable` appears in the generated types.

- [ ] **Step 7: Verify**

```bash
npx jest src/tasks/tasks.repository.spec.ts && npm run build
```
Expected: PASS, clean build.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0019_task_is_chargeable src/tasks/tasks.repository.ts src/tasks/tasks.repository.spec.ts
git commit -m "feat(tasks): add the locally-owned is_chargeable flag"
```

---

### Task 2: Cost calculator — non-chargeable costs zero

**Files:**
- Modify: `src/time-entries/cost-calculator.service.ts:22-42`
- Modify: `src/settings/settings.service.ts:22,34`
- Test: `src/time-entries/cost-calculator.service.spec.ts`

**Interfaces:**
- Consumes: `ClickupTask.isChargeable` (Task 1).
- Produces: `calculate(userId, startTime, durationHours, cache?, opts?: { chargeable?: boolean; dueDate?: Date | null })`. `opts.billable` is **gone**. Returns the existing shape `{ rateId, currency, hourlyRateCents, costCents, status }`, with `status` now also taking `'NOT_CHARGEABLE'`.

- [ ] **Step 1: Write the failing tests**

Add to `src/time-entries/cost-calculator.service.spec.ts`, using the helpers already at the top of that file: `makePrisma(rate)` returns `{ prisma, findFirst }`, and `makeSettings(cost, excludedIds)` builds the settings stub.

```typescript
describe('non-chargeable work', () => {
  const RATE = { rateId: 7n, currency: 'USD', hourlyRateCents: 6500n };
  const WHEN = new Date('2026-03-02T09:00:00.000Z');

  it('costs zero but keeps the resolved rate, so notional cost stays recoverable', async () => {
    const { prisma } = makePrisma(RATE);
    const svc = new CostCalculatorService(prisma, makeSettings());

    const res = await svc.calculate('u1', WHEN, 2, undefined, { chargeable: false });

    expect(res.costCents).toBe(0n);
    expect(res.status).toBe('NOT_CHARGEABLE');
    expect(res.rateId).toBe(7n);
    expect(res.hourlyRateCents).toBe(6500n);
  });

  it('reports NOT_CHARGEABLE rather than NO_RATE_FOUND when no rate exists', async () => {
    const { prisma } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings());

    const res = await svc.calculate('u1', WHEN, 2, undefined, { chargeable: false });

    expect(res.status).toBe('NOT_CHARGEABLE');
    expect(res.costCents).toBe(0n);
  });

  it('lets an excluded assignee win over chargeability', async () => {
    const { prisma } = makePrisma(RATE);
    const svc = new CostCalculatorService(prisma, makeSettings({}, ['u1']));

    const res = await svc.calculate('u1', WHEN, 2, undefined, { chargeable: false });

    expect(res.status).toBe('COST_EXCLUDED');
  });

  it('costs chargeable work normally', async () => {
    const { prisma } = makePrisma(RATE);
    const svc = new CostCalculatorService(prisma, makeSettings());

    const res = await svc.calculate('u1', WHEN, 2, undefined, { chargeable: true });

    expect(res.costCents).toBe(13000n);
    expect(res.status).toBe('COST_CALCULATED');
  });
});
```

Also drop `nonBillableZero` from that file's `makeSettings` signature and default object — Step 4 deletes the preference it stubs.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/time-entries/cost-calculator.service.spec.ts
```
Expected: FAIL — `NOT_CHARGEABLE` is never returned (the new tests get `COST_CALCULATED` / `NO_RATE_FOUND`).

- [ ] **Step 3: Implement**

In `src/time-entries/cost-calculator.service.ts`, replace the signature's `opts` and the `nonBillableZero` branch:

```typescript
  async calculate(
    userId: string | null,
    startTime: Date | null,
    durationHours: number,
    cache?: RateCache,
    opts?: { chargeable?: boolean; dueDate?: Date | null },
  ) {
    if (!userId || !startTime) return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND' };
    if (this.settings.getExcludedAssigneeIds().has(userId)) {
      return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'COST_EXCLUDED' };
    }
    const cost = this.settings.getPreferences().cost;
    const basis = cost.rateMatching === 'due' && opts?.dueDate ? opts.dueDate : startTime;
    const entryDate = new Date(Date.UTC(basis.getUTCFullYear(), basis.getUTCMonth(), basis.getUTCDate()));
    const rate = await this.resolveRate(userId, entryDate, cache);
    // Non-chargeable work costs nothing — but the rate is still resolved and
    // stored, so "what would this unbilled work have cost us" stays answerable
    // as hours x rate. A missing rate is not a problem to fix here either, so
    // NOT_CHARGEABLE wins over NO_RATE_FOUND and keeps this work out of the
    // Missing Rates report.
    if (opts?.chargeable === false) {
      return {
        rateId: rate?.rateId ?? null,
        currency: rate?.currency ?? 'USD',
        hourlyRateCents: rate?.hourlyRateCents ?? 0n,
        costCents: 0n,
        status: 'NOT_CHARGEABLE',
      };
    }
    if (!rate) return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND' };
    return { rateId: rate.rateId, currency: rate.currency, hourlyRateCents: rate.hourlyRateCents, costCents: BigInt(Math.round(Number(rate.hourlyRateCents) * durationHours)), status: 'COST_CALCULATED' };
  }
```

- [ ] **Step 4: Delete the superseded setting**

In `src/settings/settings.service.ts`, remove `nonBillableZero` from the `cost` type (line ~22) and from the defaults (line ~34), leaving:

```typescript
  cost: { autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due'; excludedAssignees: { id: string; name: string | null; email: string | null }[] };
```
```typescript
  cost: { autoRecalcOnRateChange: true, rateMatching: 'start', excludedAssignees: [] },
```

A stored preferences JSON may still contain the old key; it is simply ignored once the type drops it. Do not write a data migration for it.

- [ ] **Step 5: Run the tests**

```bash
npx jest src/time-entries/cost-calculator.service.spec.ts src/settings
```
Expected: PASS. If an existing test asserts `nonBillableZero` behavior, delete that test — the behavior is gone, and rewriting it to assert the new rule belongs in Step 1's block.

- [ ] **Step 6: Commit**

```bash
git add src/time-entries/cost-calculator.service.ts src/time-entries/cost-calculator.service.spec.ts src/settings/settings.service.ts
git commit -m "feat(cost): non-chargeable time costs zero and keeps its rate"
```

---

### Task 3: Recalculation reads the flag and can be scoped to tasks

**Files:**
- Modify: `src/time-entries/cost-recalculation.service.ts:29-60`
- Modify: `src/workers/cost-recalc.processor.ts:25-40`
- Modify: `src/reports/ops-report.service.ts:188`
- Test: `src/time-entries/cost-recalculation.service.spec.ts`, `src/workers/cost-recalc.processor.spec.ts`

**Interfaces:**
- Consumes: `calculate(..., { chargeable })` (Task 2).
- Produces: `recalculate(opts: { assigneeId?: string; taskIds?: string[] }): Promise<{ scanned: number; updated: number }>`; job payload `{ assigneeId?: string; taskIds?: string[] }` on `JOBS.RECALCULATE_COSTS`.

- [ ] **Step 1: Write the failing tests**

Add to `src/time-entries/cost-recalculation.service.spec.ts`. That file's harness is `makeDeps(entries)`, returning `{ svc, prisma, findMany, update, calculate }`, and it already defines a module-level `ENTRY` fixture.

```typescript
it('scopes the scan to the given tasks', async () => {
  const { svc, findMany } = makeDeps([]);

  await svc.recalculate({ taskIds: ['t1', 't2'] });

  expect(findMany.mock.calls[0][0].where).toEqual({ taskId: { in: ['t1', 't2'] } });
});

it("passes each entry's task chargeability to the calculator", async () => {
  const { svc, calculate } = makeDeps([{ ...ENTRY, task: { dueDate: null, isChargeable: false } }]);

  await svc.recalculate({});

  expect(calculate.mock.calls[0][4]).toEqual({ chargeable: false, dueDate: null });
});

it('treats an entry with no task as chargeable', async () => {
  const { svc, calculate } = makeDeps([{ ...ENTRY, task: null }]);

  await svc.recalculate({});

  expect(calculate.mock.calls[0][4]).toEqual({ chargeable: true, dueDate: null });
});
```

Also drop `billable` from the `ENTRY` fixture and `nonBillableZero` from that file's `makeSettings` — neither is read any more.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/time-entries/cost-recalculation.service.spec.ts
```
Expected: FAIL — `taskIds` is ignored, and the calculator still receives `{ billable, dueDate }`.

- [ ] **Step 3: Implement the service change**

In `src/time-entries/cost-recalculation.service.ts`:

```typescript
  async recalculate(opts: { assigneeId?: string; taskIds?: string[] }): Promise<{ scanned: number; updated: number }> {
    // Scopes are independent: an assignee, a set of tasks (what a chargeability
    // toggle enqueues), or everything.
    const where = {
      ...(opts.assigneeId ? { userId: opts.assigneeId } : {}),
      ...(opts.taskIds?.length ? { taskId: { in: opts.taskIds } } : {}),
    };
```

and inside the batch loop, change the `select` and the `calculate` call:

```typescript
        select: { timeEntryId: true, userId: true, startTime: true, durationHours: true, task: { select: { dueDate: true, isChargeable: true } } },
```
```typescript
        // No task means no flag to read — those entries are chargeable.
        const cost = await this.costs.calculate(e.userId, e.startTime, e.durationHours.toNumber(), cache, { chargeable: e.task?.isChargeable ?? true, dueDate: e.task?.dueDate ?? null });
```

- [ ] **Step 4: Thread `taskIds` through the processor**

In `src/workers/cost-recalc.processor.ts`:

```typescript
  async process(job: Job<{ assigneeId?: string; taskIds?: string[] }>) {
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.MAINTENANCE,
      jobName: job.name,
      // A chargeability toggle scopes by task, a rate change by assignee.
      entityType: job.data.taskIds?.length ? 'task' : 'assignee',
      entityId: job.data.taskIds?.length ? job.data.taskIds.join(',') : (job.data.assigneeId ?? '*'),
    });
    try {
      const res = await this.recalc.recalculate({ assigneeId: job.data.assigneeId, taskIds: job.data.taskIds });
```

- [ ] **Step 5: Keep non-chargeable work out of the ops missing-rate count**

In `src/reports/ops-report.service.ts:188`:

```typescript
          status: { notIn: ['COST_CALCULATED', 'COST_EXCLUDED', 'NOT_CHARGEABLE'] },
```

Without this, every non-chargeable entry inflates the "missing rates" figure on the Overview page.

- [ ] **Step 6: Run the tests**

```bash
npx jest src/time-entries/cost-recalculation.service.spec.ts src/workers/cost-recalc.processor.spec.ts src/reports
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/time-entries/cost-recalculation.service.ts src/time-entries/cost-recalculation.service.spec.ts src/workers/cost-recalc.processor.ts src/reports/ops-report.service.ts
git commit -m "feat(cost): recalculate by task and honor chargeability"
```

---

### Task 4: The sync path passes the task's flag

**Files:**
- Modify: `src/time-entries/time-entries.service.ts:234-263`
- Modify: `src/time-entries/assignee-replacement.service.ts:120-140`
- Test: `test/time-entries.service.spec.ts`

**Interfaces:**
- Consumes: `calculate(..., { chargeable, dueDate })` (Task 2).
- Produces: nothing new; every write path now stores chargeability-aware cost.

Background: the task pre-fetch at `time-entries.service.ts:238-244` runs **only** when `rateMatching === 'due'`. Chargeability is always needed, so the fetch becomes unconditional and returns both fields in one query per sync batch.

- [ ] **Step 1: Write the failing test**

`makeService` in `test/time-entries.service.spec.ts` builds its Prisma stub inline as
`{ clickupTask: { findMany: jest.fn().mockResolvedValue([]) } }`, with no override for it.
First extend the harness so a test can supply task rows — add `taskRows` to the
`overrides` type and use it:

```typescript
  const prisma = { clickupTask: { findMany: jest.fn().mockResolvedValue(overrides.taskRows ?? []) } } as any;
```

Then add the test (the entry point is `syncTaskTimeEntries(taskId)`; the harness's
default settings stub already uses `rateMatching: 'start'`):

```typescript
describe('TimeEntriesService.syncTaskTimeEntries — chargeability', () => {
  it("costs a non-chargeable task's entries at zero even with rateMatching=start", async () => {
    const { service, costs } = makeService({
      getTimeEntries: jest.fn().mockResolvedValue([{ id: 'e1', task: { id: 't1' }, user: { id: 'u1' } }]),
      taskRows: [{ taskId: 't1', dueDate: null, isChargeable: false }],
    });

    await service.syncTaskTimeEntries('t1');

    expect(costs.mock.calls[0][4]).toMatchObject({ chargeable: false });
  });

  it('treats an entry whose task row is missing as chargeable', async () => {
    const { service, costs } = makeService({
      getTimeEntries: jest.fn().mockResolvedValue([{ id: 'e1', task: { id: 't1' }, user: { id: 'u1' } }]),
      taskRows: [],
    });

    await service.syncTaskTimeEntries('t1');

    expect(costs.mock.calls[0][4]).toMatchObject({ chargeable: true });
  });
});
```

Also drop `nonBillableZero` from the settings stub inside `makeService`.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest test/time-entries.service.spec.ts
```
Expected: FAIL — the task pre-fetch is skipped under `rateMatching: 'start'`, so the calculator receives `{ billable, dueDate }` and `chargeable` is `undefined`.

- [ ] **Step 3: Implement**

Replace the conditional pre-fetch in `src/time-entries/time-entries.service.ts`:

```typescript
    // Task attributes the cost calculator needs, fetched once per batch rather
    // than once per entry. Unconditional now: `dueDate` matters only under
    // rateMatching='due', but `isChargeable` is always required.
    const taskRows = await this.prisma.clickupTask.findMany({
      where: { taskId: { in: [...resolvableTaskIds] } },
      select: { taskId: true, dueDate: true, isChargeable: true },
    });
    const taskAttrs = new Map(taskRows.map((t) => [t.taskId, t]));
```

and the calculate call:

```typescript
      const attrs = normalized.taskId ? taskAttrs.get(normalized.taskId) : undefined;
      // No task, or a task we couldn't read: chargeable. That matches the
      // column default and keeps task-less entries in the chargeable bucket.
      const cost = await this.costs.calculate(normalized.userId, normalized.startTime, normalized.durationHours, rateCache, { chargeable: attrs?.isChargeable ?? true, dueDate: attrs?.dueDate ?? null });
```

Delete the now-unused `dueByTask` variable and its `rateMatching` guard.

- [ ] **Step 4: Do the same for replacement entries**

In `src/time-entries/assignee-replacement.service.ts`, before the `calculate` call at line ~127, load the flag alongside the due date already being read, and pass it:

```typescript
    const task = data.taskId
      ? await this.prisma.clickupTask.findUnique({ where: { taskId: data.taskId }, select: { dueDate: true, isChargeable: true } })
      : null;
    const cost = await this.costs.calculate(realUserId, startTime, data.durationHours, undefined, { chargeable: task?.isChargeable ?? true, dueDate: task?.dueDate ?? null });
```

Replace whatever currently supplies `dueDate` there with this single lookup; do not leave two queries for the same row. `data.billable` stays on the replacement payload (it is what gets written to ClickUp) but no longer feeds `calculate`.

- [ ] **Step 5: Run the tests**

```bash
npx jest test/time-entries.service.spec.ts src/time-entries
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/time-entries/time-entries.service.ts src/time-entries/assignee-replacement.service.ts test/time-entries.service.spec.ts
git commit -m "feat(sync): cost time entries against their task's chargeability"
```

---

### Task 5: Setting the flag — endpoint, preview, audit

**Files:**
- Create: `src/admin/dto/set-task-chargeable.dto.ts`
- Create: `src/admin/admin-tasks.controller.ts`
- Modify: `src/admin/admin.module.ts`
- Modify: `src/tasks/tasks.repository.ts`
- Modify: `src/reports/tasks-report.service.ts`, `src/reports/reports.controller.ts`
- Test: `src/admin/admin-tasks.controller.spec.ts` (create), `test/tasks-report.service.spec.ts`

**Interfaces:**
- Consumes: `ClickupTask.isChargeable` (Task 1), `JOBS.RECALCULATE_COSTS` with `{ taskIds }` (Task 3).
- Produces:
  - `TasksRepository.setChargeable(taskIds: string[], chargeable: boolean): Promise<{ count: number }>`
  - `PATCH /admin/tasks/chargeable` body `{ taskIds: string[]; chargeable: boolean }` → `{ updated: number; requested: number; queued: boolean }`
  - `GET /reports/tasks/chargeable-preview?taskIds=a,b,c` → `{ tasks: number; changing: number; timeEntries: number; hours: number }`

- [ ] **Step 1: Write the failing tests**

Create `src/admin/admin-tasks.controller.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { AdminTasksController } from './admin-tasks.controller';

describe('AdminTasksController', () => {
  function makeCtrl(over: { setChargeable?: jest.Mock; add?: jest.Mock } = {}) {
    const add = over.add ?? jest.fn();
    const queues = { get: () => ({ add }), defaultJobOptions: () => ({}) } as never;
    const repo = { setChargeable: over.setChargeable ?? jest.fn().mockResolvedValue({ count: 2 }) } as never;
    return { ctrl: new AdminTasksController(queues, repo), add, repo };
  }

  it('sets the flag and enqueues a recalc scoped to those tasks', async () => {
    const { ctrl, add, repo } = makeCtrl();

    const res = await ctrl.setChargeable({ taskIds: ['t1', 't2'], chargeable: false });

    expect((repo as never as { setChargeable: jest.Mock }).setChargeable).toHaveBeenCalledWith(['t1', 't2'], false);
    expect(add.mock.calls[0][1]).toEqual({ taskIds: ['t1', 't2'] });
    expect(res).toEqual({ updated: 2, requested: 2, queued: true });
  });

  it('skips the recalc when nothing actually changed', async () => {
    const { ctrl, add } = makeCtrl({ setChargeable: jest.fn().mockResolvedValue({ count: 0 }) });

    const res = await ctrl.setChargeable({ taskIds: ['t1'], chargeable: true });

    expect(add).not.toHaveBeenCalled();
    expect(res).toEqual({ updated: 0, requested: 1, queued: false });
  });

  it('rejects more than 500 task ids', async () => {
    const { ctrl } = makeCtrl();
    const taskIds = Array.from({ length: 501 }, (_, i) => `t${i}`);

    await expect(ctrl.setChargeable({ taskIds, chargeable: false })).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/admin/admin-tasks.controller.spec.ts
```
Expected: FAIL — `Cannot find module './admin-tasks.controller'`.

- [ ] **Step 3: Write the DTO**

Create `src/admin/dto/set-task-chargeable.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsString } from 'class-validator';

/** Cap matches the preview endpoint: a comma-separated id list in a query
 *  string is bounded by URL length, and 500 is far above any hand-built
 *  selection the UI can produce. */
export const MAX_CHARGEABLE_TASK_IDS = 500;

export class SetTaskChargeableDto {
  @ApiProperty({ type: [String], maxItems: MAX_CHARGEABLE_TASK_IDS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_CHARGEABLE_TASK_IDS)
  @IsString({ each: true })
  taskIds!: string[];

  @ApiProperty({ description: 'true = Chargeable, false = Non-chargeable' })
  @IsBoolean()
  chargeable!: boolean;
}
```

- [ ] **Step 4: Add the repository write**

In `src/tasks/tasks.repository.ts`:

```typescript
  /**
   * Set the locally-owned chargeability flag. Only rows whose value actually
   * changes are counted, so the caller can skip a pointless recalculation —
   * and the returned count is what the UI reports back to the user.
   */
  setChargeable(taskIds: string[], chargeable: boolean) {
    return this.prisma.clickupTask.updateMany({
      where: { taskId: { in: taskIds }, isChargeable: !chargeable },
      data: { isChargeable: chargeable },
    });
  }
```

- [ ] **Step 5: Write the controller**

Create `src/admin/admin-tasks.controller.ts`:

```typescript
import { BadRequestException, Body, Controller, HttpCode, Patch, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { MAX_CHARGEABLE_TASK_IDS, SetTaskChargeableDto } from './dto/set-task-chargeable.dto';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { TasksRepository } from '../tasks/tasks.repository';

/** Locally-owned task annotations under `/admin`. Today: chargeability. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminTasksController {
  constructor(
    private readonly queues: QueueService,
    private readonly tasksRepo: TasksRepository,
  ) {}

  @Patch('tasks/chargeable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark tasks Chargeable or Non-chargeable. Non-chargeable time costs zero, so the affected tasks\' entries are re-costed by a scoped recalculate-costs job. Idempotent: tasks already in the requested state are neither written nor recalculated.' })
  async setChargeable(@Body() dto: SetTaskChargeableDto) {
    // Also guarded by the DTO; kept here so a direct service call can't bypass it.
    if (dto.taskIds.length > MAX_CHARGEABLE_TASK_IDS) {
      throw new BadRequestException(`At most ${MAX_CHARGEABLE_TASK_IDS} tasks per request`);
    }
    const { count } = await this.tasksRepo.setChargeable(dto.taskIds, dto.chargeable);
    // Nothing changed means no stored cost can have changed either.
    if (count > 0) {
      await this.queues
        .get(QUEUES.MAINTENANCE)
        .add(JOBS.RECALCULATE_COSTS, { taskIds: dto.taskIds }, this.queues.defaultJobOptions());
    }
    return { updated: count, requested: dto.taskIds.length, queued: count > 0 };
  }
}
```

- [ ] **Step 6: Register it**

In `src/admin/admin.module.ts`, add `AdminTasksController` to the `controllers` array next to the other `Admin*Controller`s, and make sure `TasksModule` (which exports `TasksRepository`) is in `imports` — add it if absent, following how the module already imports `RatesModule`.

- [ ] **Step 7: Run the controller tests**

```bash
npx jest src/admin/admin-tasks.controller.spec.ts
```
Expected: PASS.

- [ ] **Step 8: Write the failing preview test**

Add to `test/tasks-report.service.spec.ts`:

```typescript
describe('chargeablePreview', () => {
  it('reports how many of the given tasks would actually change', async () => {
    const prisma = {
      clickupTask: { count: jest.fn().mockResolvedValue(9) },
      clickupTimeEntry: { aggregate: jest.fn().mockResolvedValue({ _count: 84, _sum: { durationHours: { toNumber: () => 156.5 } } }) },
    } as never;

    const res = await new TasksReportService(prisma).chargeablePreview(['t1', 't2', 't3'], false);

    expect(res).toEqual({ tasks: 3, changing: 9, timeEntries: 84, hours: 156.5 });
  });
});
```

- [ ] **Step 9: Run it to verify it fails**

```bash
npx jest test/tasks-report.service.spec.ts
```
Expected: FAIL — `chargeablePreview is not a function`.

- [ ] **Step 10: Implement the preview**

In `src/reports/tasks-report.service.ts`:

```typescript
  /**
   * Numbers behind the chargeability confirmation dialog.
   *
   * `changing` counts only the tasks whose flag would actually flip — marking
   * twelve tasks non-chargeable when three already are should say nine, or the
   * dialog overstates what is about to happen. The entry count and hours cover
   * every given task, since that is the time whose cost is being re-evaluated.
   */
  async chargeablePreview(taskIds: string[], chargeable: boolean) {
    const [changing, entries] = await Promise.all([
      this.prisma.clickupTask.count({ where: { taskId: { in: taskIds }, isChargeable: !chargeable } }),
      this.prisma.clickupTimeEntry.aggregate({
        where: { taskId: { in: taskIds } },
        _count: true,
        _sum: { durationHours: true },
      }),
    ]);
    return {
      tasks: taskIds.length,
      changing,
      timeEntries: entries._count,
      hours: entries._sum.durationHours?.toNumber() ?? 0,
    };
  }
```

- [ ] **Step 11: Expose it**

In `src/reports/reports.controller.ts`, next to the other `tasks*` endpoints:

```typescript
  @Get('tasks/chargeable-preview')
  @ApiOperation({ summary: 'Counts behind the chargeability confirmation dialog: tasks given, tasks that would actually change, and the time entries + hours affected. `taskIds` is a comma-separated list, max 500.' })
  chargeablePreview(@Query('taskIds') taskIds = '', @Query('chargeable') chargeable?: string) {
    const ids = csvList(taskIds) ?? [];
    if (ids.length === 0) throw new BadRequestException('taskIds is required');
    if (ids.length > 500) throw new BadRequestException('At most 500 tasks per request');
    return this.tasksReports.chargeablePreview(ids, chargeable === 'true');
  }
```

`csvList` is already imported in this file's neighbours — import it from `./report-filter.util` if it is not yet imported here.

- [ ] **Step 12: Verify**

```bash
npx jest src/admin test/tasks-report.service.spec.ts test/reports.controller.spec.ts && npm run build
```
Expected: PASS, clean build.

- [ ] **Step 13: Commit**

```bash
git add src/admin src/tasks/tasks.repository.ts src/reports/tasks-report.service.ts src/reports/reports.controller.ts test/tasks-report.service.spec.ts
git commit -m "feat(admin): set task chargeability, with a preview for the dialog"
```

---

### Task 6: Reports read the task flag

**Files:**
- Modify: `src/reports/report-filter.util.ts:127,200-201`
- Modify: `src/reports/time-entries-report.service.ts` (aggregates, list select, `timeEntriesByTask`, `timeEntriesBillableSummary`)
- Modify: `src/reports/tasks-report.service.ts` (list select)
- Modify: `src/reports/reports.controller.ts` (params + endpoint rename)
- Test: `src/reports/report-filter.util.spec.ts`, `test/time-entries-report.service.spec.ts`, `test/reports.controller.spec.ts`

**Interfaces:**
- Consumes: `ClickupTask.isChargeable` (Task 1).
- Produces:
  - `TimeEntryFilters.chargeable?: string` (replaces `billable`)
  - aggregates → `{ …, chargeableHours, nonChargeableHours, … }` (replaces `billableHours`/`nonBillableHours`)
  - grouped rows → `{ …, chargeable: boolean, chargeableHours: number, … }`
  - flat rows → each item gains `chargeable: boolean`
  - `GET /reports/time-entries/chargeable-summary` → `{ chargeableHours, nonChargeableHours }`

- [ ] **Step 1: Write the failing filter tests**

Add to `src/reports/report-filter.util.spec.ts`:

```typescript
describe('chargeable filter', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-02-01T00:00:00.000Z');
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as never;
  const clausesOf = (where: Record<string, unknown>) => (where.AND ?? []) as Record<string, unknown>[];

  it('keeps task-less entries on the chargeable side', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'true' });
    expect(clausesOf(where)).toContainEqual({ NOT: { task: { isChargeable: false } } });
  });

  it('selects only non-chargeable tasks\' entries', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'false' });
    expect(clausesOf(where)).toContainEqual({ task: { isChargeable: false } });
  });

  it('no longer constrains the entry\'s own billable column', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'false' });
    expect(where.billable).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest src/reports/report-filter.util.spec.ts
```
Expected: FAIL — `chargeable` is not a known filter and no such clause is pushed.

- [ ] **Step 3: Implement the filter**

In `src/reports/report-filter.util.ts`, rename the field on `TimeEntryFilters` and replace the two `billable` lines:

```typescript
  /** Our own per-task flag, NOT ClickUp's per-entry `billable` column. */
  chargeable?: string;
```
```typescript
  // Chargeability lives on the task. 'true' must keep entries with no task at
  // all — they have no flag to read and count as chargeable — hence
  // `NOT { task isChargeable:false }` rather than `task { isChargeable:true }`,
  // which would drop them. Same shape as the archived filter above.
  if (f.chargeable === 'true') and.push({ NOT: { task: { isChargeable: false } } });
  else if (f.chargeable === 'false') and.push({ task: { isChargeable: false } });
```

- [ ] **Step 4: Write the failing report tests**

Add to `test/time-entries-report.service.spec.ts`:

```typescript
describe('chargeability in reports', () => {
  it('marks a flat entry chargeable from its task', async () => {
    const prisma = makePrisma();
    prisma.clickupTimeEntry.findMany.mockResolvedValue([{
      timeEntryId: 'e1', taskId: 't1', userId: 'u1', userName: 'Alice', userEmail: null,
      startTime: new Date(), endTime: null, durationHours: { toNumber: () => 1 },
      hourlyRateCents: 0n, costCents: 0n, status: 'NOT_CHARGEABLE', billable: true,
      description: null, syncedAt: new Date(), rateId: null, currency: 'USD',
      task: { taskName: 'T', client: null, listName: null, isChargeable: false },
    }]);
    const { items } = await new TimeEntriesReportService(prisma).timeEntriesList();
    expect(items[0].chargeable).toBe(false);
  });

  it('treats a task-less entry as chargeable', async () => {
    const prisma = makePrisma();
    prisma.clickupTimeEntry.findMany.mockResolvedValue([{
      timeEntryId: 'e1', taskId: null, userId: 'u1', userName: 'Alice', userEmail: null,
      startTime: new Date(), endTime: null, durationHours: { toNumber: () => 1 },
      hourlyRateCents: 0n, costCents: 0n, status: 'COST_CALCULATED', billable: false,
      description: null, syncedAt: new Date(), rateId: null, currency: 'USD', task: null,
    }]);
    const { items } = await new TimeEntriesReportService(prisma).timeEntriesList();
    expect(items[0].chargeable).toBe(true);
  });
});
```

and, in the existing `timeEntriesByTask` describe block:

```typescript
  it('reports a task\'s chargeability and zeroes its chargeable hours when off', async () => {
    const prisma = makePrisma(
      [group({ taskId: 't1', _sum: { durationHours: { toNumber: () => 6 }, costCents: BigInt(0) } })],
      [{ taskId: 't1', taskName: 'T', client: null, listName: null, isChargeable: false }],
    );
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0].chargeable).toBe(false);
    expect(items[0].totalHours).toBe(6);
    expect(items[0].chargeableHours).toBe(0);
  });
```

- [ ] **Step 5: Run to verify failure**

```bash
npx jest test/time-entries-report.service.spec.ts
```
Expected: FAIL — `chargeable` is undefined on both shapes.

- [ ] **Step 6: Implement in the report service**

Three edits in `src/reports/time-entries-report.service.ts`:

**(a) `timeEntriesList`** — add the flag to the join and the mapping:

```typescript
          task: { select: { taskName: true, client: true, listName: true, isChargeable: true } },
```
```typescript
        // No task, no flag — a task-less entry is chargeable.
        chargeable: e.task?.isChargeable ?? true,
```

**(b) `timeEntriesAggregates`** — the billable/non-billable split came from `groupBy({ by: ['billable'] })`, which cannot reach a relation field. Replace that groupBy with two aggregates over the same `where`:

```typescript
    const chargeableWhere = { AND: [where, { NOT: { task: { isChargeable: false } } }] };
    const nonChargeableWhere = { AND: [where, { task: { isChargeable: false } }] };
    const [chargeableAgg, nonChargeableAgg, byStatus] = await Promise.all([
      this.prisma.clickupTimeEntry.aggregate({ where: chargeableWhere, _count: true, _sum: { durationHours: true, costCents: true } }),
      this.prisma.clickupTimeEntry.aggregate({ where: nonChargeableWhere, _count: true, _sum: { durationHours: true, costCents: true } }),
      this.prisma.clickupTimeEntry.groupBy({ by: ['status'], where, _count: true }),
    ]);

    const chargeableHours = chargeableAgg._sum.durationHours?.toNumber() ?? 0;
    const nonChargeableHours = nonChargeableAgg._sum.durationHours?.toNumber() ?? 0;
    const totalEntries = chargeableAgg._count + nonChargeableAgg._count;
    const totalHours = chargeableHours + nonChargeableHours;
    // Non-chargeable cost is always zero, so this equals the chargeable total —
    // summed from both sides anyway so the number stays honest if that changes.
    const totalCostCents = Number(chargeableAgg._sum.costCents ?? 0n) + Number(nonChargeableAgg._sum.costCents ?? 0n);
```

Keep `avgRateCents`, `costCalculatedCount` and `noRateFoundCount` as they are, and return `chargeableHours` / `nonChargeableHours` in place of `billableHours` / `nonBillableHours`.

**(c) `timeEntriesByTask`** — chargeability is uniform per task, so it comes from the joined task row rather than the fold. Remove `'billable'` from the `by` list and the `billableHours`/`nonBillableHours` split in the `Bucket`, replacing them with a single `hours` accumulator; then in the final mapping:

```typescript
        const chargeable = t?.isChargeable ?? true;
        return {
          …
          totalHours: b.hours,
          chargeable,
          // A task is wholly chargeable or wholly not, so this is all-or-nothing
          // rather than a split within the task.
          chargeableHours: chargeable ? b.hours : 0,
```

and add `isChargeable: true` to that method's `clickupTask.findMany` select.

**(d) rename `timeEntriesBillableSummary` → `timeEntriesChargeableSummary`**, returning only hours:

```typescript
  /** Chargeable vs non-chargeable hours for the window. No cost split: a
   *  non-chargeable entry always costs zero, so one side would be a column of
   *  zeros and the other would equal total cost. */
  async timeEntriesChargeableSummary(fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const window = { startTime: { gte: from, lte: to } };
    const [chargeable, nonChargeable] = await Promise.all([
      this.prisma.clickupTimeEntry.aggregate({ where: { AND: [window, { NOT: { task: { isChargeable: false } } }] }, _sum: { durationHours: true } }),
      this.prisma.clickupTimeEntry.aggregate({ where: { AND: [window, { task: { isChargeable: false } }] }, _sum: { durationHours: true } }),
    ]);
    return {
      chargeableHours: chargeable._sum.durationHours?.toNumber() ?? 0,
      nonChargeableHours: nonChargeable._sum.durationHours?.toNumber() ?? 0,
    };
  }
```

- [ ] **Step 7: Expose the flag on the tasks list**

In `src/reports/tasks-report.service.ts`, add `isChargeable: true` to the `select` in the paged `tasks()` query (the block at ~line 241) so the Tasks page and drawer can render and toggle it.

- [ ] **Step 8: Rename the controller surface**

In `src/reports/reports.controller.ts`:
- rename every `@Query('billable') billable?: string` to `@Query('chargeable') chargeable?: string` on `timeEntriesList`, `timeEntriesAggregates` and `timeEntriesByTask`, threading the renamed value through;
- rename the route `time-entries/billable-summary` to `time-entries/chargeable-summary` and its handler to call `timeEntriesChargeableSummary`;
- update the `@ApiOperation` summaries that name `billable` to say `chargeable`, and add to the time-entries list summary: `` `chargeable=true|false` filters on the task's Chargeable flag; entries with no task count as chargeable. ``

- [ ] **Step 9: Run everything**

```bash
npx jest src/reports test/time-entries-report.service.spec.ts test/tasks-report.service.spec.ts test/reports.controller.spec.ts
```
Expected: PASS. Existing tests naming `billable` in these files must be renamed, not deleted — the behavior still exists, under the new field.

- [ ] **Step 10: Full backend verification**

```bash
npm run test && npm run lint && npm run build
```
Expected: all suites pass; lint reports no new problems.

- [ ] **Step 11: Commit**

```bash
git add src/reports test
git commit -m "feat(reports): split time by task chargeability, not ClickUp billable"
```

---

### Task 7: Frontend — show chargeability everywhere

**Files:**
- Modify: `apps/web/src/hooks/useReports.ts` (types), `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/pages/TimeEntriesPage.tsx`, `apps/web/src/pages/TasksPage.tsx`, `apps/web/src/pages/TimesheetPage.tsx`, `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/components/TimeEntryDrawer.tsx`, `apps/web/src/components/TaskTimeEntriesPanel.tsx`

**Interfaces:**
- Consumes: `chargeable` on entries and grouped rows, `chargeableHours` / `nonChargeableHours` on aggregates, `isChargeable` on tasks (Task 6).
- Produces: no new exports; this task is display only. The mutation UI is Task 8.

- [ ] **Step 1: Update the types**

In `apps/web/src/hooks/useReports.ts`: on `TimeEntriesAggregates` rename `billableHours` → `chargeableHours` and `nonBillableHours` → `nonChargeableHours`; on `TimeEntryTaskGroup` replace `billableHours`/`nonBillableHours` with `chargeable: boolean` and `chargeableHours: number`. In `apps/web/src/components/TimeEntryDrawer.tsx` add `chargeable: boolean` to `TimeEntryItem`.

- [ ] **Step 2: Rename the Time Entries filter and its labels**

In `apps/web/src/pages/TimeEntriesPage.tsx`:

```typescript
const CHARGEABLE_OPTIONS = [
  { value: '', label: 'Chargeable + non' },
  { value: 'true', label: 'Chargeable only' },
  { value: 'false', label: 'Non-chargeable only' },
];
```

Rename the `billable` state to `chargeable`, send it as `chargeable` in `params`, and point the `Select` at `CHARGEABLE_OPTIONS` with `ariaLabel="Filter by chargeable state"`. Update `reset()` and `hasFilters`.

- [ ] **Step 3: Swap the entry-level pill to the task's flag**

Still in `TimeEntriesPage.tsx`, the flat table's `billable` column becomes:

```tsx
    {
      key: 'chargeable',
      header: 'Charge',
      width: 110,
      sortable: false,
      render: (row) => (
        row.chargeable
          ? <Pill tone="green" size="xs">chargeable</Pill>
          : <Pill tone="gray" size="xs">non-chargeable</Pill>
      ),
    },
```

Make the same swap in `apps/web/src/components/TaskTimeEntriesPanel.tsx` (its `Bill` column header becomes `Charge`) and in `TimeEntryDrawer.tsx` wherever `billable` is rendered.

- [ ] **Step 4: Update the grouped columns and metric cards**

In the grouped column set, replace the `billableHours` column with:

```tsx
    {
      key: 'chargeable',
      header: 'Charge',
      width: 120,
      render: (row) => (
        row.chargeable
          ? <Pill tone="green" size="xs">chargeable</Pill>
          : <Pill tone="gray" size="xs">non-chargeable</Pill>
      ),
    },
```

In the `Rates` column's render, return early for a non-chargeable row before the missing/excluded checks — non-chargeable work has no rate to be missing:

```tsx
        if (!row.chargeable) return <span style={{ color: 'var(--text-faint)' }}>n/a</span>;
```

Rename the `Billable` metric card to `Chargeable` reading `agg.chargeableHours`, and `Non-billable` to `Non-chargeable` reading `agg.nonChargeableHours`. Rename `billablePct` to `chargeablePct`.

- [ ] **Step 5: Update the selection bar stats and the exports**

In `selectionStats`, rename the `billable` / `non-billable` labels to `chargeable` / `non-chargeable`, reading `r.chargeableHours` (grouped) and filtering on `r.chargeable` (flat).

In the grouped export column spec replace `{ header: 'Billable hours', … }` and `{ header: 'Non-billable hours', … }` with:

```typescript
          { header: 'Chargeable',       value: (r) => (r.chargeable ? 'Yes' : 'No'), key: 'chargeable' },
          { header: 'Chargeable hours', value: 'chargeableHours', key: 'chargeableHours', type: 'number' },
```

In the flat export spec replace the `Billable` column with `{ header: 'Chargeable', value: (r) => (r.chargeable ? 'Yes' : 'No'), key: 'chargeable' }`.

- [ ] **Step 6: Add the Tasks page column**

In `apps/web/src/pages/TasksPage.tsx`, add a column after `status`:

```tsx
    {
      key: 'chargeable',
      header: 'Charge',
      width: 120,
      render: (row) => (
        row.isChargeable === false
          ? <Pill tone="gray" size="xs">non-chargeable</Pill>
          : <Pill tone="green" size="xs">chargeable</Pill>
      ),
    },
```

and an export column `{ header: 'Chargeable', value: (r) => (r.isChargeable === false ? 'No' : 'Yes'), key: 'chargeable' }`.

- [ ] **Step 7: Remove the dead setting and rename the rest**

Delete the `nonBillableZero` control from `apps/web/src/pages/SettingsPage.tsx` and its field from `apps/web/src/api/settings.ts`. Rename any remaining `Billable` copy in `apps/web/src/pages/TimesheetPage.tsx`. Then confirm nothing user-facing still says billable:

```bash
grep -rn "illable" apps/web/src
```
Expected: no matches.

- [ ] **Step 8: Verify**

```bash
cd apps/web && npx tsc -b && npx eslint . && npm run build
```
Expected: clean typecheck and build; eslint still at 73 problems (48 errors, 25 warnings).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): show chargeability in place of ClickUp billable"
```

---

### Task 8: Frontend — setting it, behind a confirmation

**Files:**
- Create: `apps/web/src/components/ChargeableConfirmModal.tsx`
- Modify: `apps/web/src/api/admin.ts`, `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/components/SelectionBar.tsx` (new optional `actions` slot)
- Modify: `apps/web/src/pages/TasksPage.tsx` (drawer toggle + bulk action)

`useAuth` lives at `apps/web/src/hooks/useAuth.tsx` and exposes `hasRole(min: Role)`
where `Role` is `'OWNER' | 'ADMIN' | 'MEMBER'`, so `hasRole('ADMIN')` is true for
Owners and Admins and false for Members.

**Interfaces:**
- Consumes: `PATCH /admin/tasks/chargeable`, `GET /reports/tasks/chargeable-preview` (Task 5).
- Produces: `<ChargeableConfirmModal taskIds chargeable onClose onDone />`.

- [ ] **Step 1: Add the API calls**

In `apps/web/src/api/admin.ts`:

```typescript
  setTasksChargeable: (taskIds: string[], chargeable: boolean) =>
    apiClient.patch('/admin/tasks/chargeable', { taskIds, chargeable }).then(r => r.data as { updated: number; requested: number; queued: boolean }),
```

In `apps/web/src/api/reports.ts`:

```typescript
  chargeablePreview: (taskIds: string[], chargeable: boolean) =>
    apiClient.get('/reports/tasks/chargeable-preview', { params: { taskIds: taskIds.join(','), chargeable } })
      .then(r => r.data as { tasks: number; changing: number; timeEntries: number; hours: number }),
```

- [ ] **Step 2: Write the modal**

Create `apps/web/src/components/ChargeableConfirmModal.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { adminApi } from '../api/admin';
import { reportsApi } from '../api/reports';
import { fmt } from '../lib/formatters';

/**
 * Confirms a chargeability change before it happens — required on every route
 * that sets the flag. The counts come from the server: a Tasks row carries
 * ClickUp's rolled-up `time_spent`, not our own entry count.
 */
export function ChargeableConfirmModal({
  taskIds, chargeable, onClose,
}: { taskIds: string[]; chargeable: boolean; onClose: (changed: boolean) => void }) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ['chargeable-preview', taskIds, chargeable],
    queryFn: () => reportsApi.chargeablePreview(taskIds, chargeable),
  });

  const apply = useMutation({
    mutationFn: () => adminApi.setTasksChargeable(taskIds, chargeable),
    onSuccess: () => {
      // Cost, hours and the flag itself all move — drop every report cache
      // rather than trying to enumerate which ones are stale.
      qc.invalidateQueries();
      onClose(true);
    },
  });

  const label = chargeable ? 'chargeable' : 'non-chargeable';
  const p = preview.data;

  return (
    <Modal
      open
      onClose={() => onClose(false)}
      title={`Mark ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} ${label}?`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
          <Button
            variant="default"
            loading={apply.isPending}
            disabled={apply.isPending || preview.isLoading || p?.changing === 0}
            onClick={() => apply.mutate()}
          >
            {`Mark ${label}`}
          </Button>
        </>
      }
    >
      {preview.isLoading && <p style={{ color: 'var(--text-muted)' }}>Checking what this affects…</p>}
      {p && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <p>
            <strong>{fmt.number(p.changing)}</strong> of {fmt.number(p.tasks)} task
            {p.tasks === 1 ? '' : 's'} will change · <strong>{fmt.number(p.timeEntries)}</strong> time
            {' '}entr{p.timeEntries === 1 ? 'y' : 'ies'} · <strong>{fmt.hours(p.hours)}</strong>
          </p>
          {p.changing === 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              Every selected task is already {label}. Nothing to do.
            </p>
          )}
          {p.changing > 0 && (
            <p style={{ color: 'var(--text-muted)' }}>
              {chargeable
                ? 'Their time moves to Chargeable in all reports and its cost is calculated from assignee rates again.'
                : 'Their time moves to Non-chargeable in all reports and its cost becomes zero.'}
              {' '}Costs are recalculated in the background.
            </p>
          )}
        </div>
      )}
      {apply.isError && (
        <p style={{ color: 'var(--red, var(--text))', fontSize: 12 }}>Could not apply the change. Try again.</p>
      )}
    </Modal>
  );
}
```

- [ ] **Step 3: Wire the bulk action**

In `apps/web/src/pages/TasksPage.tsx`, add state and render the modal:

```tsx
  const [chargeableTarget, setChargeableTarget] = useState<boolean | null>(null);
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
```

First add the slot to `apps/web/src/components/SelectionBar.tsx` — a new optional
prop rendered between the stats and the Clear button:

```tsx
  /** Bulk actions for the selection, rendered before Clear. */
  actions?: React.ReactNode;
```
```tsx
      <span style={{ flex: 1 }} />
      {actions}
      <Button size="sm" variant="ghost" icon={<X size={12} strokeWidth={1.75} />} onClick={onClear}>
        Clear
      </Button>
```

Then pass the buttons in from `TasksPage`:

```tsx
        actions={canEdit ? (
          <>
            <Button size="sm" variant="subtle" onClick={() => setChargeableTarget(true)}>Mark chargeable</Button>
            <Button size="sm" variant="subtle" onClick={() => setChargeableTarget(false)}>Mark non-chargeable</Button>
          </>
        ) : undefined}
```

and at the end of the page body:

```tsx
      {chargeableTarget !== null && (
        <ChargeableConfirmModal
          taskIds={selection.selectedRows.map((r) => String(r.taskId ?? r.task_id ?? ''))}
          chargeable={chargeableTarget}
          onClose={(changed) => {
            setChargeableTarget(null);
            if (changed) selection.clear();
          }}
        />
      )}
```

- [ ] **Step 4: Wire the drawer toggle**

In `TaskDetailDrawer` (same file, from line 108), add to the overview tab:

```tsx
        <Field label="Chargeable">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {task.isChargeable === false
              ? <Pill tone="gray" size="xs">non-chargeable</Pill>
              : <Pill tone="green" size="xs">chargeable</Pill>}
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => onSetChargeable(task.isChargeable === false)}>
                {task.isChargeable === false ? 'Mark chargeable' : 'Mark non-chargeable'}
              </Button>
            )}
          </span>
        </Field>
```

`TaskDetailDrawer` is a local component in this file — pass `canEdit` and an `onSetChargeable(next: boolean)` callback in as props, and have the page open the same `ChargeableConfirmModal` with that one task id. Do not add a second confirmation path.

- [ ] **Step 5: Verify**

```bash
cd apps/web && npx tsc -b && npx eslint . && npm run build
```
Expected: clean; eslint unchanged from baseline.

- [ ] **Step 6: Manual check (requires the stack running)**

```bash
npm run dev:deps && npm run start:dev
```
Then, in the dashboard:
1. Tasks page → select 2 tasks → **Mark non-chargeable** → the dialog names 2 tasks and their entry count → confirm.
2. Those rows show `non-chargeable`; Time Entries for those tasks show `non-chargeable` and cost `—`.
3. Time Entries metric cards: Non-chargeable hours rise by those tasks' hours; Total cost falls by their former cost.
4. Re-run the same action → the dialog says every selected task is already non-chargeable and the confirm button is disabled.
5. Sign in as a Member → the buttons and the drawer toggle are absent.
6. Trigger a resync of one of those tasks (`POST /admin/sync/task`) → it is **still** non-chargeable.

Step 6 is the one that proves the guardrail from Task 1 under real conditions.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): set task chargeability behind a confirmation dialog"
```

---

## Done when

- `grep -rn "illable" apps/web/src` returns nothing.
- `npm run test`, `npm run lint`, `npm run build` pass from the root.
- `cd apps/web && npx tsc -b && npx eslint . && npm run build` passes with eslint at its 73-problem baseline.
- A task marked non-chargeable survives a resync (Task 8, manual step 6).

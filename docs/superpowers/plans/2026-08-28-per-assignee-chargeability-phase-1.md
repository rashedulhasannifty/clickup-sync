# Per-assignee chargeability — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Owner/Admin mark one assignee's tracked time on one task as non-chargeable, without changing chargeability for anybody else on that task.

**Architecture:** A `(task_id, user_id)` rule table sits between the existing task-level `is_chargeable` flag and the time entry. A pure resolver picks the most specific answer (entry override → rule → task flag → `true`); the cost calculator returns that answer alongside the cost, so the three existing cost write paths persist it onto a new denormalized `clickup_time_entries.is_chargeable` column just by spreading the object they already spread. Reports then filter on that one column instead of joining the task.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), BullMQ, Jest, React + TanStack Query (`apps/web`).

**Spec:** [`docs/superpowers/specs/2026-08-28-per-assignee-chargeability-design.md`](../specs/2026-08-28-per-assignee-chargeability-design.md)

## Global Constraints

- Node.js `>=22`, NestJS 11, Prisma 7. Do not change any pinned dependency version.
- Every task ends green on `npm run lint` (0 errors), `npm test`, `npm run build`.
- Preserve Prettier formatting. No `any` — use `unknown` plus guards for untrusted input; use generated Prisma types elsewhere.
- Never log tokens, secrets, or raw auth headers.
- `chargeable_override` is a **local annotation**: no sync path may ever write it. `is_chargeable` is **derived**: it is written on every cost write.
- Chargeability precedence, most specific first: entry override → `(task, assignee)` rule → task flag → `true`. The global `excludedAssignees` setting (`COST_EXCLUDED`) is orthogonal and is resolved separately — it already short-circuits at `cost-calculator.service.ts:30` and must not be re-implemented.
- Terminology is **Chargeable / Non-chargeable** everywhere, never "billable" (ClickUp's unused `billable` column keeps syncing and stays unread).
- Phase 1 does **not** build the per-entry override UI or write path. The `chargeable_override` column is created and *read* by the resolver, so phase 2 only adds writers.

---

### Task 1: Schema, migration and the local-annotation guardrail

**Files:**
- Modify: `prisma/schema.prisma` (model `ClickupTask`, model `ClickupTimeEntry`, new model `TaskAssigneeChargeability`)
- Create: `prisma/migrations/0020_per_assignee_chargeability/migration.sql`
- Modify: `src/time-entries/time-entries.repository.ts:10-21` (comment only)
- Test: `src/time-entries/time-entries.repository.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `TaskAssigneeChargeability` with fields `taskId: string`, `userId: string`, `chargeable: boolean`, `note: string | null`, `setBy: string | null`, `updatedAt: Date`. New `ClickupTimeEntry` fields `chargeableOverride: boolean | null` and `isChargeable: boolean`.

- [ ] **Step 1: Add the rules model and the two entry columns to the schema**

In `prisma/schema.prisma`, add to `model ClickupTask` (next to the existing `timeEntries` relation):

```prisma
  chargeabilityRules TaskAssigneeChargeability[]
```

Add to `model ClickupTimeEntry`, directly above the `task` relation, as its own labelled block:

```prisma
  // ── Local annotations ───────────────────────────────────────────────────
  // `chargeableOverride` is owned by THIS app, not mirrored from ClickUp. No
  // sync path may write it: `TimeEntriesRepository.upsert` spreads
  // `NormalizedTimeEntry` plus the cost object, and neither contains it. A
  // test enforces that. `isChargeable` is different — it is DERIVED, written
  // on every cost write as part of the cost object.
  chargeableOverride Boolean? @map("chargeable_override")
  isChargeable       Boolean  @default(true) @map("is_chargeable")
```

Add the new model after `model ClickupTimeEntry`:

```prisma
/// Local annotation: "this assignee's time on this task is (not) chargeable".
/// Sits between the task-level flag and the per-entry override.
model TaskAssigneeChargeability {
  taskId     String   @map("task_id")
  userId     String   @map("user_id")
  chargeable Boolean
  note       String?
  setBy      String?  @map("set_by")
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at")

  task       ClickupTask @relation(fields: [taskId], references: [taskId], onDelete: Cascade)

  @@id([taskId, userId])
  @@index([userId])
  @@map("task_assignee_chargeability")
}
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/0020_per_assignee_chargeability/migration.sql`:

```sql
-- Per-assignee chargeability: a (task, assignee) rule, plus a per-entry
-- override, layered over the existing task-level `is_chargeable` flag.
CREATE TABLE IF NOT EXISTS "task_assignee_chargeability" (
  "task_id"    TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "chargeable" BOOLEAN NOT NULL,
  "note"       TEXT,
  "set_by"     TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_assignee_chargeability_pkey" PRIMARY KEY ("task_id", "user_id")
);

-- A hard-deleted task takes its rules with it. Soft-deleted tasks keep theirs,
-- because the row survives.
ALTER TABLE "task_assignee_chargeability"
  ADD CONSTRAINT "task_assignee_chargeability_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "clickup_tasks"("task_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "task_assignee_chargeability_user_id_idx"
  ON "task_assignee_chargeability" ("user_id");

-- `chargeable_override` is nullable on purpose: NULL means "no override", which
-- is not the same as "overridden to chargeable".
ALTER TABLE "clickup_time_entries"
  ADD COLUMN IF NOT EXISTS "chargeable_override" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "is_chargeable" BOOLEAN NOT NULL DEFAULT true;

-- Backfill the resolved column to exactly today's semantics: an entry answers
-- to its task's flag, and a task-less entry is chargeable. Nothing about any
-- stored cost changes, so no recalculation is needed.
UPDATE "clickup_time_entries" e
   SET "is_chargeable" = false
  FROM "clickup_tasks" t
 WHERE e."task_id" = t."task_id"
   AND t."is_chargeable" = false;

-- Partial index, mirroring `clickup_tasks_non_chargeable_idx` from migration
-- 0019: almost every row is `true`, so only the non-chargeable side is
-- selective enough to be worth indexing.
CREATE INDEX IF NOT EXISTS "clickup_time_entries_non_chargeable_idx"
  ON "clickup_time_entries" ("time_entry_id")
  WHERE "is_chargeable" = false;
```

- [ ] **Step 3: Generate the Prisma client**

Run: `npm run prisma:generate`
Expected: succeeds, and `TaskAssigneeChargeability` appears in the generated types.

> **Note:** there is no local PostgreSQL in this environment, so `npm run prisma:deploy` cannot be run here. Do not skip writing the SQL correctly on the assumption it will be caught at runtime — it will not be caught until staging.

- [ ] **Step 4: Write the guardrail test**

Append to `src/time-entries/time-entries.repository.spec.ts`:

```ts
describe('local annotations', () => {
  it('never writes chargeable_override, so a resync cannot revert a user-set override', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const repo = new TimeEntriesRepository({ clickupTimeEntry: { upsert } } as never);

    await repo.upsert(
      { timeEntryId: 'te1', taskId: 't1', userId: 'u1', raw: {} } as never,
      { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND', isChargeable: true },
    );

    const call = upsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('chargeableOverride');
    expect(call.update).not.toHaveProperty('chargeableOverride');
  });

  it('does write is_chargeable, which is derived rather than user-set', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const repo = new TimeEntriesRepository({ clickupTimeEntry: { upsert } } as never);

    await repo.upsert(
      { timeEntryId: 'te1', taskId: 't1', userId: 'u1', raw: {} } as never,
      { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NOT_CHARGEABLE', isChargeable: false },
    );

    const call = upsert.mock.calls[0][0];
    expect(call.update.isChargeable).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npx jest src/time-entries/time-entries.repository.spec.ts -t "local annotations" -v`
Expected: the first test PASSES immediately (the override is absent because nothing writes it — this is a regression guard, not a red-green cycle). The second FAILS on a TypeScript error: `isChargeable` is not in the `cost` parameter type.

- [ ] **Step 6: Widen the repository's cost parameter and document the rule**

In `src/time-entries/time-entries.repository.ts`, change the `upsert` signature's `cost` parameter to include the new field, and extend the existing comment:

```ts
  // `cost` carries every derived costing column, including `isChargeable` — the
  // resolved answer from the chargeability stack. It is spread into the payload
  // below, which is how the column gets written without any call site changing.
  //
  // What must NOT appear in either object: `chargeableOverride`. That is a user
  // decision living on a table that resyncs constantly, and a sync path writing
  // it would silently revert what somebody set. A test enforces this.
  upsert(
    entry: NormalizedTimeEntry,
    cost: {
      rateId: bigint | null;
      currency: string;
      hourlyRateCents: bigint;
      costCents: bigint;
      status: string;
      isChargeable: boolean;
    },
  ) {
```

- [ ] **Step 7: Run the full suite**

Run: `npm run lint && npm test && npm run build`
Expected: lint 0 errors; every test passes (call sites still compile because Task 4 has not changed the calculator yet — if `npm run build` fails on a missing `isChargeable` at a call site, that is expected only after Task 4; at this point the calculator's return does not feed `upsert` with the new field, so add `isChargeable: true` at the single call site in `time-entries.service.ts` as a temporary literal and delete it in Task 5).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0020_per_assignee_chargeability src/time-entries/time-entries.repository.ts src/time-entries/time-entries.repository.spec.ts
git commit -m "feat(chargeability): add (task, assignee) rules table and entry columns

New task_assignee_chargeability table, plus chargeable_override (user-owned)
and is_chargeable (derived) on clickup_time_entries. Backfills is_chargeable
from the task flag so the column starts out agreeing with what reports already
show. Adds the local-annotation guardrail test for the override, mirroring the
one that protects clickup_tasks.is_chargeable."
```

---

### Task 2: The pure resolver

**Files:**
- Create: `src/time-entries/chargeability.ts`
- Test: `src/time-entries/chargeability.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `resolveChargeability(input: ChargeabilityInput): ResolvedChargeability`
  - `type ChargeabilitySource = 'entry' | 'assignee' | 'task' | 'default'`
  - `interface ChargeabilityInput { entryOverride?: boolean | null; rule?: boolean | null; taskChargeable?: boolean | null }`
  - `interface ResolvedChargeability { chargeable: boolean; source: ChargeabilitySource }`
  - `ruleKey(taskId: string, userId: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/time-entries/chargeability.spec.ts`:

```ts
import { resolveChargeability, ruleKey } from './chargeability';

describe('resolveChargeability', () => {
  it('falls back to chargeable when nothing is set', () => {
    expect(resolveChargeability({})).toEqual({ chargeable: true, source: 'default' });
  });

  it('uses the task flag when there is no rule and no override', () => {
    expect(resolveChargeability({ taskChargeable: false })).toEqual({ chargeable: false, source: 'task' });
  });

  it('lets a rule override the task flag', () => {
    expect(resolveChargeability({ rule: false, taskChargeable: true })).toEqual({ chargeable: false, source: 'assignee' });
  });

  // The case that motivates "most specific wins in EITHER direction": one
  // person's time is billable on an otherwise internal task.
  it('lets a rule make time chargeable on a non-chargeable task', () => {
    expect(resolveChargeability({ rule: true, taskChargeable: false })).toEqual({ chargeable: true, source: 'assignee' });
  });

  it('lets an entry override beat its own rule', () => {
    expect(resolveChargeability({ entryOverride: true, rule: false, taskChargeable: false }))
      .toEqual({ chargeable: true, source: 'entry' });
    expect(resolveChargeability({ entryOverride: false, rule: true, taskChargeable: true }))
      .toEqual({ chargeable: false, source: 'entry' });
  });

  // null and undefined both mean "this layer says nothing" — null is what an
  // unset `chargeable_override` column reads as, undefined is what a missing
  // Map lookup returns. Neither may be coerced to false.
  it.each([null, undefined])('treats %p as "layer says nothing", not as false', (empty) => {
    expect(resolveChargeability({ entryOverride: empty, rule: empty, taskChargeable: true }))
      .toEqual({ chargeable: true, source: 'task' });
  });

  it('does not let a null task flag mask a rule', () => {
    expect(resolveChargeability({ rule: false, taskChargeable: null }))
      .toEqual({ chargeable: false, source: 'assignee' });
  });
});

describe('ruleKey', () => {
  it('joins task and user with a separator that cannot appear in a ClickUp id', () => {
    expect(ruleKey('86abc123', 'u1')).toBe('86abc123|u1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/time-entries/chargeability.spec.ts`
Expected: FAIL — `Cannot find module './chargeability'`.

- [ ] **Step 3: Write the implementation**

Create `src/time-entries/chargeability.ts`:

```ts
/**
 * Chargeability resolution.
 *
 * Four layers can answer "is this time billable?", and the most specific one
 * that has an opinion wins — in EITHER direction, so a rule can make one
 * person's time chargeable on an otherwise non-chargeable task.
 *
 * The global `excludedAssignees` setting is deliberately NOT part of this. That
 * decides whether we COST an identity, not whether the work is billable; the
 * two are orthogonal, and it already short-circuits in
 * `CostCalculatorService.calculate` before chargeability is consulted.
 */
export type ChargeabilitySource = 'entry' | 'assignee' | 'task' | 'default';

export interface ChargeabilityInput {
  /** `clickup_time_entries.chargeable_override`. null = no override. */
  entryOverride?: boolean | null;
  /** The `(task, assignee)` rule, if one exists. */
  rule?: boolean | null;
  /** `clickup_tasks.is_chargeable`. null/undefined = no task to read. */
  taskChargeable?: boolean | null;
}

export interface ResolvedChargeability {
  chargeable: boolean;
  source: ChargeabilitySource;
}

export function resolveChargeability(input: ChargeabilityInput): ResolvedChargeability {
  // `typeof === 'boolean'` and not a truthiness check: `false` is a real answer
  // from every layer, and `null`/`undefined` both mean "no opinion".
  if (typeof input.entryOverride === 'boolean') return { chargeable: input.entryOverride, source: 'entry' };
  if (typeof input.rule === 'boolean') return { chargeable: input.rule, source: 'assignee' };
  if (typeof input.taskChargeable === 'boolean') return { chargeable: input.taskChargeable, source: 'task' };
  // No task, or a task we couldn't read: chargeable. Matches the column default
  // and keeps task-less entries in the chargeable bucket, as they were before.
  return { chargeable: true, source: 'default' };
}

/** Key for the batch rule lookup Maps. `|` cannot occur in a ClickUp id. */
export function ruleKey(taskId: string, userId: string): string {
  return `${taskId}|${userId}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/time-entries/chargeability.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/time-entries/chargeability.ts src/time-entries/chargeability.spec.ts
git commit -m "feat(chargeability): add the pure precedence resolver

entry override > (task, assignee) rule > task flag > chargeable, with each
layer able to override the one below in either direction. null and undefined
both mean 'this layer has no opinion' and must never coerce to false."
```

---

### Task 3: The rules repository

**Files:**
- Create: `src/tasks/task-assignee-chargeability.repository.ts`
- Create: `src/tasks/task-assignee-chargeability.repository.spec.ts`
- Modify: `src/tasks/tasks.module.ts` (provide + export the repository)

**Interfaces:**
- Consumes: `ruleKey` from `src/time-entries/chargeability.ts`.
- Produces class `TaskAssigneeChargeabilityRepository` with:
  - `findForTasks(taskIds: string[]): Promise<Map<string, boolean>>` — keyed by `ruleKey`
  - `findForTask(taskId: string): Promise<{ userId: string; chargeable: boolean }[]>`
  - `findOne(taskId: string, userId: string): Promise<boolean | null>`
  - `setRule(input: { taskId: string; userId: string; chargeable: boolean; setBy?: string | null; note?: string | null }): Promise<{ changed: boolean }>`
  - `clearRule(taskId: string, userId: string): Promise<{ changed: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `src/tasks/task-assignee-chargeability.repository.spec.ts`:

```ts
import { TaskAssigneeChargeabilityRepository } from './task-assignee-chargeability.repository';

function makeRepo(over: Partial<Record<'findMany' | 'findUnique' | 'upsert' | 'deleteMany', jest.Mock>> = {}) {
  const findMany = over.findMany ?? jest.fn().mockResolvedValue([]);
  const findUnique = over.findUnique ?? jest.fn().mockResolvedValue(null);
  const upsert = over.upsert ?? jest.fn().mockResolvedValue({});
  const deleteMany = over.deleteMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { taskAssigneeChargeability: { findMany, findUnique, upsert, deleteMany } } as never;
  return { repo: new TaskAssigneeChargeabilityRepository(prisma), findMany, findUnique, upsert, deleteMany };
}

describe('TaskAssigneeChargeabilityRepository', () => {
  describe('findForTasks', () => {
    it('returns a Map keyed taskId|userId', async () => {
      const { repo } = makeRepo({
        findMany: jest.fn().mockResolvedValue([
          { taskId: 't1', userId: 'u1', chargeable: false },
          { taskId: 't2', userId: 'u1', chargeable: true },
        ]),
      });

      const map = await repo.findForTasks(['t1', 't2']);

      expect(map.get('t1|u1')).toBe(false);
      expect(map.get('t2|u1')).toBe(true);
      expect(map.get('t1|u2')).toBeUndefined();
    });

    // Guards the batch hot path: an empty `in` list is a full table scan in
    // waiting, and the cost paths call this once per batch regardless.
    it('does not query at all for an empty task list', async () => {
      const { repo, findMany } = makeRepo();
      const map = await repo.findForTasks([]);
      expect(findMany).not.toHaveBeenCalled();
      expect(map.size).toBe(0);
    });
  });

  describe('setRule', () => {
    it('writes and reports changed when there is no existing rule', async () => {
      const { repo, upsert } = makeRepo();
      const res = await repo.setRule({ taskId: 't1', userId: 'u1', chargeable: false, setBy: 'ops@x.com' });

      expect(res).toEqual({ changed: true });
      expect(upsert.mock.calls[0][0].create).toMatchObject({ taskId: 't1', userId: 'u1', chargeable: false, setBy: 'ops@x.com' });
    });

    // Idempotency, exactly like PATCH /admin/tasks/chargeable: writing the value
    // a row already holds must not enqueue a pointless recalculation.
    it('is a no-op when the stored value already matches', async () => {
      const { repo, upsert } = makeRepo({ findUnique: jest.fn().mockResolvedValue({ chargeable: false }) });
      const res = await repo.setRule({ taskId: 't1', userId: 'u1', chargeable: false });

      expect(res).toEqual({ changed: false });
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe('clearRule', () => {
    it('reports changed only when a row was actually removed', async () => {
      const { repo } = makeRepo({ deleteMany: jest.fn().mockResolvedValue({ count: 0 }) });
      expect(await repo.clearRule('t1', 'u1')).toEqual({ changed: false });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/tasks/task-assignee-chargeability.repository.spec.ts`
Expected: FAIL — `Cannot find module './task-assignee-chargeability.repository'`.

- [ ] **Step 3: Write the implementation**

Create `src/tasks/task-assignee-chargeability.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ruleKey } from '../time-entries/chargeability';

/**
 * The `(task, assignee)` chargeability rules — a local annotation, never
 * touched by any ClickUp sync path.
 */
@Injectable()
export class TaskAssigneeChargeabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rules for a batch of tasks, as a Map keyed `taskId|userId`. Every cost
   * write path calls this once per batch rather than once per entry.
   */
  async findForTasks(taskIds: string[]): Promise<Map<string, boolean>> {
    // An empty `in` list would scan the table for nothing.
    if (taskIds.length === 0) return new Map();
    const rows = await this.prisma.taskAssigneeChargeability.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, userId: true, chargeable: true },
    });
    return new Map(rows.map((r) => [ruleKey(r.taskId, r.userId), r.chargeable]));
  }

  findForTask(taskId: string) {
    return this.prisma.taskAssigneeChargeability.findMany({
      where: { taskId },
      select: { userId: true, chargeable: true },
    });
  }

  async findOne(taskId: string, userId: string): Promise<boolean | null> {
    const row = await this.prisma.taskAssigneeChargeability.findUnique({
      where: { taskId_userId: { taskId, userId } },
      select: { chargeable: true },
    });
    return row?.chargeable ?? null;
  }

  /**
   * Upsert a rule. Reports whether anything actually changed so the caller can
   * skip a pointless recalculation — same contract as
   * `TasksRepository.setChargeable`.
   */
  async setRule(input: {
    taskId: string;
    userId: string;
    chargeable: boolean;
    setBy?: string | null;
    note?: string | null;
  }): Promise<{ changed: boolean }> {
    const existing = await this.prisma.taskAssigneeChargeability.findUnique({
      where: { taskId_userId: { taskId: input.taskId, userId: input.userId } },
      select: { chargeable: true },
    });
    if (existing?.chargeable === input.chargeable) return { changed: false };
    await this.prisma.taskAssigneeChargeability.upsert({
      where: { taskId_userId: { taskId: input.taskId, userId: input.userId } },
      create: {
        taskId: input.taskId,
        userId: input.userId,
        chargeable: input.chargeable,
        setBy: input.setBy ?? null,
        note: input.note ?? null,
      },
      update: {
        chargeable: input.chargeable,
        setBy: input.setBy ?? null,
        note: input.note ?? null,
      },
    });
    return { changed: true };
  }

  /** Remove a rule. Idempotent: clearing an absent rule changes nothing. */
  async clearRule(taskId: string, userId: string): Promise<{ changed: boolean }> {
    const { count } = await this.prisma.taskAssigneeChargeability.deleteMany({ where: { taskId, userId } });
    return { changed: count > 0 };
  }
}
```

- [ ] **Step 4: Register it in the module**

In `src/tasks/tasks.module.ts`, add `TaskAssigneeChargeabilityRepository` to both `providers` and `exports`, alongside `TasksRepository`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest src/tasks/task-assignee-chargeability.repository.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/task-assignee-chargeability.repository.ts src/tasks/task-assignee-chargeability.repository.spec.ts src/tasks/tasks.module.ts
git commit -m "feat(chargeability): add the (task, assignee) rules repository

Batch lookup returns a Map keyed taskId|userId for the cost hot paths, and
skips the query entirely for an empty batch. setRule/clearRule report whether
anything changed so callers can skip a pointless recalculation."
```

---

### Task 4: The calculator returns the resolved answer

**Files:**
- Modify: `src/time-entries/cost-calculator.service.ts:22-53`
- Test: `src/time-entries/cost-calculator.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CostCalculatorService.calculate` returns an added field `isChargeable: boolean` on **every** branch — including the `NO_RATE_FOUND` guard and the `COST_EXCLUDED` early return.

- [ ] **Step 1: Write the failing test**

Append to `src/time-entries/cost-calculator.service.spec.ts`:

```ts
describe('isChargeable in the returned cost', () => {
  it('is true by default so a caller that passes no opts writes the column default', async () => {
    const { prisma } = makePrisma({ rateId: 1n, currency: 'USD', hourlyRateCents: 10000n });
    const res = await new CostCalculatorService(prisma, makeSettings()).calculate('u1', new Date('2026-01-05'), 2);
    expect(res.isChargeable).toBe(true);
    expect(res.status).toBe('COST_CALCULATED');
  });

  it('is false when the resolved answer is non-chargeable', async () => {
    const { prisma } = makePrisma({ rateId: 1n, currency: 'USD', hourlyRateCents: 10000n });
    const res = await new CostCalculatorService(prisma, makeSettings())
      .calculate('u1', new Date('2026-01-05'), 2, undefined, { chargeable: false });
    expect(res).toMatchObject({ isChargeable: false, costCents: 0n, status: 'NOT_CHARGEABLE' });
  });

  // Costing exclusion and billability are orthogonal: an excluded assignee's
  // time on a non-chargeable task is BOTH excluded and non-chargeable. Forcing
  // one of them would make the calculator disagree with the migration's
  // backfill, which reads the task flag for every row.
  it('still reports chargeability for a globally excluded assignee', async () => {
    const { prisma } = makePrisma(null);
    const svc = new CostCalculatorService(prisma, makeSettings({}, ['u1']));

    const excludedOnChargeableTask = await svc.calculate('u1', new Date('2026-01-05'), 2);
    expect(excludedOnChargeableTask).toMatchObject({ status: 'COST_EXCLUDED', isChargeable: true });

    const excludedOnNonChargeableTask = await svc.calculate('u1', new Date('2026-01-05'), 2, undefined, { chargeable: false });
    expect(excludedOnNonChargeableTask).toMatchObject({ status: 'COST_EXCLUDED', isChargeable: false });
  });

  it('reports chargeability even when there is no user or start time', async () => {
    const { prisma } = makePrisma(null);
    const res = await new CostCalculatorService(prisma, makeSettings())
      .calculate(null, null, 2, undefined, { chargeable: false });
    expect(res).toMatchObject({ status: 'NO_RATE_FOUND', isChargeable: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/time-entries/cost-calculator.service.spec.ts -t "isChargeable in the returned cost"`
Expected: FAIL — `isChargeable` is `undefined` on every returned object.

- [ ] **Step 3: Write the implementation**

In `src/time-entries/cost-calculator.service.ts`, add one line at the top of `calculate` and thread it through every `return`:

```ts
  ) {
    // Resolved once and returned on EVERY branch. Callers spread this object
    // into the time-entry upsert, so this is what writes `is_chargeable` — and
    // keeping it out of the branches below is what stops the calculator from
    // disagreeing with the migration's backfill about the same row.
    //
    // Deliberately independent of the COST_EXCLUDED branch: excluding an
    // identity from COSTING says nothing about whether the work is BILLABLE.
    const isChargeable = opts?.chargeable !== false;
    if (!userId || !startTime) return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND', isChargeable };
    if (this.settings.getExcludedAssigneeIds().has(userId)) {
      return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'COST_EXCLUDED', isChargeable };
    }
```

Add `isChargeable` to the remaining three returns as well: the `NOT_CHARGEABLE` branch (where it is always `false`, but pass the variable rather than a literal so there is one source of truth), the `!rate` `NO_RATE_FOUND` return, and the final `COST_CALCULATED` return.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/time-entries/cost-calculator.service.spec.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Remove the temporary literal from Task 1**

In `src/time-entries/time-entries.service.ts`, delete the temporary `isChargeable: true` added in Task 1 Step 7 if one was needed — the calculator's return now supplies it through the existing `...cost` spread.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm run lint && npm test && npm run build`

```bash
git add src/time-entries/cost-calculator.service.ts src/time-entries/cost-calculator.service.spec.ts src/time-entries/time-entries.service.ts
git commit -m "feat(chargeability): return isChargeable from the cost calculator

Every branch reports the resolved answer, including COST_EXCLUDED and the
no-user/no-start-time guard. Callers already spread the cost object into the
time-entry upsert, so this is what persists the new column — and it puts the
'costing exclusion is orthogonal to billability' decision in exactly one place."
```

---

### Task 5: Resolve rules and overrides in the three cost write paths

**Files:**
- Modify: `src/time-entries/time-entries.service.ts:236-266`
- Modify: `src/time-entries/cost-recalculation.service.ts:45-70`
- Modify: `src/time-entries/assignee-replacement.service.ts:120-130`
- Modify: `src/time-entries/time-entries.module.ts` (import `TasksModule` if the rules repository is not already reachable)
- Test: `src/time-entries/cost-recalculation.service.spec.ts`, `test/assignee-replacement.service.spec.ts`

**Interfaces:**
- Consumes: `resolveChargeability`, `ruleKey` (Task 2); `TaskAssigneeChargeabilityRepository.findForTasks`, `.findOne` (Task 3); `calculate(...).isChargeable` (Task 4).
- Produces: no new exported symbols. After this task, every written time entry's `is_chargeable` reflects the full stack.

- [ ] **Step 1: Write the failing test for the recalculation path**

Append to `src/time-entries/cost-recalculation.service.spec.ts` (follow the file's existing `makeDeps`-style helper; the assertions below are what matter):

```ts
it('resolves the (task, assignee) rule over the task flag when re-costing', async () => {
  // Task is chargeable; the rule says this assignee's time on it is not.
  const entry = {
    timeEntryId: 'te1', userId: 'u1', startTime: new Date('2026-01-05'),
    durationHours: { toNumber: () => 2 }, chargeableOverride: null,
    task: { dueDate: null, isChargeable: true },
    taskId: 't1',
  };
  const { svc, calculate } = makeDeps({
    entries: [entry],
    rules: new Map([['t1|u1', false]]),
  });

  await svc.recalculate({ taskIds: ['t1'] });

  expect(calculate.mock.calls[0][4]).toMatchObject({ chargeable: false });
});

it('lets a per-entry override beat the rule', async () => {
  const entry = {
    timeEntryId: 'te1', userId: 'u1', startTime: new Date('2026-01-05'),
    durationHours: { toNumber: () => 2 }, chargeableOverride: true,
    task: { dueDate: null, isChargeable: false },
    taskId: 't1',
  };
  const { svc, calculate } = makeDeps({ entries: [entry], rules: new Map([['t1|u1', false]]) });

  await svc.recalculate({ taskIds: ['t1'] });

  expect(calculate.mock.calls[0][4]).toMatchObject({ chargeable: true });
});

it('writes the resolved is_chargeable onto the row', async () => {
  const entry = {
    timeEntryId: 'te1', userId: 'u1', startTime: new Date('2026-01-05'),
    durationHours: { toNumber: () => 2 }, chargeableOverride: null,
    task: { dueDate: null, isChargeable: false }, taskId: 't1',
  };
  const { svc, update } = makeDeps({ entries: [entry], rules: new Map() });

  await svc.recalculate({ taskIds: ['t1'] });

  expect(update.mock.calls[0][0].data).toMatchObject({ isChargeable: false });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/time-entries/cost-recalculation.service.spec.ts`
Expected: FAIL — the service does not yet take a rules repository, and `data` has no `isChargeable`.

- [ ] **Step 3: Implement the recalculation path**

In `src/time-entries/cost-recalculation.service.ts`: inject `TaskAssigneeChargeabilityRepository`, add `chargeableOverride: true` and `taskId: true` to the `select`, and resolve per entry.

```ts
      // One rules lookup per batch, not per entry — same reasoning as the
      // shared RateCache above.
      const taskIds = [...new Set(entries.map((e) => e.taskId).filter((id): id is string => id != null))];
      const rules = await this.rules.findForTasks(taskIds);

      for (const e of entries) {
        const { chargeable } = resolveChargeability({
          entryOverride: e.chargeableOverride,
          rule: e.taskId && e.userId ? rules.get(ruleKey(e.taskId, e.userId)) : undefined,
          taskChargeable: e.task?.isChargeable,
        });
        const cost = await this.costs.calculate(e.userId, e.startTime, e.durationHours.toNumber(), cache, { chargeable, dueDate: e.task?.dueDate ?? null });
        await this.prisma.clickupTimeEntry.update({
          where: { timeEntryId: e.timeEntryId },
          data: {
            rateId: cost.rateId,
            currency: cost.currency,
            hourlyRateCents: cost.hourlyRateCents,
            costCents: cost.costCents,
            status: cost.status,
            isChargeable: cost.isChargeable,
          },
        });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/time-entries/cost-recalculation.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Implement the live sync path**

In `src/time-entries/time-entries.service.ts`, after the existing `taskAttrs` Map is built, add the rules Map and the stored overrides, then resolve per entry.

```ts
    const rules = await this.rules.findForTasks([...resolvableTaskIds]);
    // Existing overrides for the entries about to be re-upserted. The upsert
    // never writes this column (see the repository guardrail), so the stored
    // value is the user's decision and must be read back, not assumed null.
    const overrideRows = await this.prisma.clickupTimeEntry.findMany({
      where: { timeEntryId: { in: entries.map((e) => this.normalizer.normalizeTimeEntry(e).timeEntryId) } },
      select: { timeEntryId: true, chargeableOverride: true },
    });
    const overrides = new Map(overrideRows.map((r) => [r.timeEntryId, r.chargeableOverride]));
```

and in the per-entry loop, replacing the current `{ chargeable: attrs?.isChargeable ?? true, ... }`:

```ts
      const { chargeable } = resolveChargeability({
        entryOverride: overrides.get(normalized.timeEntryId),
        rule: normalized.taskId && normalized.userId ? rules.get(ruleKey(normalized.taskId, normalized.userId)) : undefined,
        taskChargeable: attrs?.isChargeable,
      });
      const cost = await this.costs.calculate(normalized.userId, normalized.startTime, normalized.durationHours, rateCache, { chargeable, dueDate: attrs?.dueDate ?? null });
```

> Normalize each entry once and reuse it — do not call `normalizeTimeEntry` twice per entry as the snippet above does for brevity. Hoist the normalized list above the override query and iterate that.

- [ ] **Step 6: Implement the replacement path**

In `src/time-entries/assignee-replacement.service.ts` around line 124, resolve against the **replacement** assignee (`realUserId`), not the original logger:

```ts
    // The replacement entry belongs to a DIFFERENT user than the original, so
    // it must answer to that user's rule — resolving against the original
    // logger's would bill the wrong person's exclusion.
    const rule = data.taskId ? await this.rules.findOne(data.taskId, realUserId) : null;
    const { chargeable } = resolveChargeability({ rule, taskChargeable: task?.isChargeable });
    const cost = await this.costs.calculate(realUserId, startTime, data.durationHours, undefined, { chargeable, dueDate: task?.dueDate ?? null });
```

- [ ] **Step 7: Add the replacement-path test**

Append to `test/assignee-replacement.service.spec.ts`, matching the file's existing setup helper:

```ts
it('resolves the replacement assignee rule, not the original logger rule', async () => {
  // 'original' logged the time; 'mapped' is who it is being replaced onto, and
  // only 'mapped' has a non-chargeable rule on this task.
  const { svc, findOne, calculate } = setupWithRules({ 't1|mapped': false });

  await svc.replace({ timeEntryId: 'te1', taskId: 't1', /* …existing fixture fields… */ } as never);

  expect(findOne).toHaveBeenCalledWith('t1', 'mapped');
  expect(calculate.mock.calls[0][4]).toMatchObject({ chargeable: false });
});
```

- [ ] **Step 8: Run the full suite and commit**

Run: `npm run lint && npm test && npm run build`

```bash
git add src/time-entries/
git commit -m "feat(chargeability): resolve rules and overrides on every cost path

Live sync, recalculation and assignee replacement all resolve the full stack
before costing, and persist the resolved answer to is_chargeable. The rules
lookup is one query per batch. The replacement path resolves against the NEW
assignee, since that is whose time the replacement entry represents."
```

---

### Task 6: `PATCH /admin/tasks/:taskId/assignee-chargeable`

**Files:**
- Create: `src/admin/dto/set-assignee-chargeable.dto.ts`
- Modify: `src/admin/admin-tasks.controller.ts`
- Test: `src/admin/admin-tasks.controller.spec.ts`

**Interfaces:**
- Consumes: `TaskAssigneeChargeabilityRepository.setRule` / `.clearRule` (Task 3).
- Produces: `AdminTasksController.setAssigneeChargeable(taskId: string, dto: SetAssigneeChargeableDto, user)` returning `{ changed: boolean; queued: boolean }`.

- [ ] **Step 1: Write the failing test**

Append to `src/admin/admin-tasks.controller.spec.ts`:

```ts
describe('setAssigneeChargeable', () => {
  function makeRuleCtrl(over: { setRule?: jest.Mock; clearRule?: jest.Mock } = {}) {
    const add = jest.fn();
    const queues = { get: () => ({ add }), defaultJobOptions: () => ({}) } as never;
    const tasksRepo = { setChargeable: jest.fn() } as never;
    const rules = {
      setRule: over.setRule ?? jest.fn().mockResolvedValue({ changed: true }),
      clearRule: over.clearRule ?? jest.fn().mockResolvedValue({ changed: true }),
    } as never;
    return { ctrl: new AdminTasksController(queues, tasksRepo, rules), add, rules };
  }

  it('sets the rule and enqueues a recalc scoped to that assignee on that task', async () => {
    const { ctrl, add, rules } = makeRuleCtrl();

    const res = await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: false });

    expect((rules as never as { setRule: jest.Mock }).setRule)
      .toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', userId: 'u1', chargeable: false }));
    // Both scopes: the recalc service ANDs them, so only this assignee's
    // entries on this task are re-costed.
    expect(add.mock.calls[0][1]).toEqual({ assigneeId: 'u1', taskIds: ['t1'] });
    expect(res).toEqual({ changed: true, queued: true });
  });

  it('clears the rule when chargeable is null', async () => {
    const { ctrl, rules } = makeRuleCtrl();
    await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: null });
    expect((rules as never as { clearRule: jest.Mock }).clearRule).toHaveBeenCalledWith('t1', 'u1');
  });

  it('skips the recalc when nothing changed', async () => {
    const { ctrl, add } = makeRuleCtrl({ setRule: jest.fn().mockResolvedValue({ changed: false }) });
    const res = await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: false });
    expect(add).not.toHaveBeenCalled();
    expect(res).toEqual({ changed: false, queued: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/admin/admin-tasks.controller.spec.ts -t "setAssigneeChargeable"`
Expected: FAIL — `ctrl.setAssigneeChargeable is not a function`.

- [ ] **Step 3: Write the DTO**

Create `src/admin/dto/set-assignee-chargeable.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetAssigneeChargeableDto {
  @ApiProperty({ description: 'ClickUp user id, as stored on clickup_time_entries.user_id' })
  @IsString()
  userId!: string;

  @ApiProperty({
    nullable: true,
    description: 'true = chargeable, false = non-chargeable, null = clear the rule and fall back to the task flag',
  })
  @IsOptional()
  @IsBoolean()
  chargeable!: boolean | null;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
```

- [ ] **Step 4: Write the endpoint**

In `src/admin/admin-tasks.controller.ts`, inject `TaskAssigneeChargeabilityRepository` as a third constructor parameter and add:

```ts
  @Patch('tasks/:taskId/assignee-chargeable')
  @HttpCode(200)
  @ApiOperation({ summary: "Mark one assignee's time on one task Chargeable or Non-chargeable. `chargeable: null` clears the rule and falls back to the task flag. Re-costs only that assignee's entries on that task, via a recalculate-costs job scoped to both. Idempotent: a rule already in the requested state is neither written nor recalculated." })
  async setAssigneeChargeable(@Param('taskId') taskId: string, @Body() dto: SetAssigneeChargeableDto) {
    const { changed } = dto.chargeable === null
      ? await this.rules.clearRule(taskId, dto.userId)
      : await this.rules.setRule({ taskId, userId: dto.userId, chargeable: dto.chargeable, note: dto.note ?? null });
    // Nothing changed means no stored cost can have changed either.
    if (changed) {
      // Both scopes: `CostRecalculationService.recalculate` ANDs assigneeId and
      // taskIds, so this re-costs exactly this assignee's entries on this task.
      await this.queues
        .get(QUEUES.MAINTENANCE)
        .add(JOBS.RECALCULATE_COSTS, { assigneeId: dto.userId, taskIds: [taskId] }, this.queues.defaultJobOptions());
    }
    return { changed, queued: changed };
  }
```

Add `Param` to the `@nestjs/common` import and `SetAssigneeChargeableDto` to the DTO imports. The class already carries `@Roles(Role.OWNER, Role.ADMIN)` and `@UseInterceptors(AuditLogInterceptor)`, so authorization and audit logging need no per-route work.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx jest src/admin/admin-tasks.controller.spec.ts`
Expected: PASS, including the three pre-existing tests.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm run lint && npm test && npm run build`

```bash
git add src/admin/
git commit -m "feat(chargeability): add PATCH /admin/tasks/:taskId/assignee-chargeable

Sets or clears a (task, assignee) rule and enqueues a recalc scoped to BOTH
the assignee and the task, which the recalculation service ANDs. Idempotent:
no change means no write and no job. Owner/Admin and audited by the
controller-level decorators."
```

---

### Task 7: Reports read the entry's own column

**Files:**
- Modify: `src/reports/report-filter.util.ts:201-206`
- Modify: `src/reports/time-entries-report.service.ts:215`, `:268`, `:424-435`, `:498-520`
- Test: `src/reports/report-filter.util.spec.ts`, `test/time-entries-report.service.spec.ts`

**Interfaces:**
- Consumes: the `clickup_time_entries.is_chargeable` column (Task 1), populated by Tasks 4–5.
- Produces: no signature changes. `?chargeable=true|false` and `chargeableHours` now resolve per entry.

- [ ] **Step 1: Write the failing test for the filter**

Append to `src/reports/report-filter.util.spec.ts`:

Add these **inside the existing `describe('buildTimeEntryWhere', ...)` block**, so they reuse its `from`, `to`, `prisma` and `clausesOf` helpers (the file has no `makePrisma`):

```ts
  it('filters chargeability on the entry column, not through the task join', async () => {
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'true' });
    expect(clausesOf(where)).toContainEqual({ isChargeable: true });
    // The old task-join form must be gone: it cannot see a per-assignee rule.
    expect(JSON.stringify(clausesOf(where))).not.toContain('task');
  });

  it('keeps task-less entries chargeable', async () => {
    // The column defaults to true for an entry with no task, which is what the
    // old `NOT { task: { isChargeable: false } }` achieved by hand.
    const where = await buildTimeEntryWhere(prisma, { from, to, chargeable: 'false' });
    expect(clausesOf(where)).toContainEqual({ isChargeable: false });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/reports/report-filter.util.spec.ts -t "chargeable filter"`
Expected: FAIL — the clause is still `{ NOT: { task: { isChargeable: false } } }`.

- [ ] **Step 3: Switch the filter**

In `src/reports/report-filter.util.ts`, replace lines 201-206:

```ts
  // Chargeability is resolved per entry and stored on the row (see the
  // chargeability resolver), so this is a plain column test — no task join.
  // A task-less entry keeps the column default `true`, which is exactly what
  // the previous `NOT { task: { isChargeable: false } }` form achieved by hand.
  if (f.chargeable === 'true') and.push({ isChargeable: true });
  else if (f.chargeable === 'false') and.push({ isChargeable: false });
```

- [ ] **Step 4: Switch the two aggregates**

In `src/reports/time-entries-report.service.ts`, line 215:

```ts
      this.prisma.clickupTimeEntry.aggregate({ where: { AND: [window, { isChargeable: true }] }, _sum: { durationHours: true } }),
```

and line 268:

```ts
    const chargeableWhere = { AND: [where, { isChargeable: true }] };
```

- [ ] **Step 5: Fix the grouped-by-task split**

Still in `src/reports/time-entries-report.service.ts`: add `isChargeable` to the `groupBy` `by` array (around line 425), carry a `chargeableHours` accumulator on the `Bucket` type, and add to it only when the group is chargeable:

```ts
    const groups = await this.prisma.clickupTimeEntry.groupBy({
      by: ['taskId', 'userId', 'userName', 'status', 'currency', 'isChargeable'],
```

```ts
      b.hours += hours;
      // Chargeability is per entry now, so a task can be partly chargeable —
      // this is a real sum, not the task's flag applied to the whole bucket.
      if (g.isChargeable) b.chargeableHours += hours;
```

and in the returned item, replacing `chargeable: chargeable, chargeableHours: chargeable ? b.hours : 0`:

```ts
        // `chargeable` is now tri-state at the row level: all, none, or some.
        chargeable: b.chargeableHours === b.hours,
        partiallyChargeable: b.chargeableHours > 0 && b.chargeableHours < b.hours,
        chargeableHours: b.chargeableHours,
```

Delete the now-false comment above it (`// A task is wholly chargeable or wholly not…`) and the now-unused `const chargeable = t?.isChargeable ?? true;`.

- [ ] **Step 6: Write the grouped-view test**

Append to `test/time-entries-report.service.spec.ts`:

The file's `makePrisma(overrides)` merges into the *top-level* prisma object; per-model returns are set with `mockResolvedValue` afterwards. Follow that:

```ts
it('sums chargeable hours per task rather than applying the task flag to the whole row', async () => {
  // One task, two assignees, 2h each — only one of them chargeable.
  const hrs = (n: number) => ({ toNumber: () => n });
  const prisma = makePrisma({ clickupTask: { findMany: jest.fn().mockResolvedValue([
    { taskId: 't1', taskName: 'T', client: null, listName: null, isChargeable: true },
  ]) } });
  prisma.clickupTimeEntry.groupBy.mockResolvedValue([
    { taskId: 't1', userId: 'u1', userName: 'A', status: 'COST_CALCULATED', currency: 'USD', isChargeable: true,
      _count: 1, _sum: { durationHours: hrs(2), costCents: BigInt(1000) }, _max: { startTime: new Date('2026-01-05') } },
    { taskId: 't1', userId: 'u2', userName: 'B', status: 'NOT_CHARGEABLE', currency: 'USD', isChargeable: false,
      _count: 1, _sum: { durationHours: hrs(2), costCents: BigInt(0) }, _max: { startTime: new Date('2026-01-05') } },
  ]);

  const res = await new TimeEntriesReportService(prisma).timeEntriesByTask({});

  expect(res.items[0]).toMatchObject({ totalHours: 4, chargeableHours: 2, chargeable: false, partiallyChargeable: true });
});
```

- [ ] **Step 7: Re-read the partition e2e before running anything**

`test/time-entries-chargeable-partition.e2e.spec.ts` exists specifically to prove
the chargeable / non-chargeable split is exhaustive and non-overlapping over real
rows — *especially* `task_id IS NULL` rows, which it notes "have no `isChargeable`
to read". That sentence stops being true in this task: those rows now have their
own column, defaulted to `true`.

Read that file and update its comment to match, but **do not weaken its
assertions** — the invariant it guards (`chargeableAgg._count + nonChargeableAgg._count`
equals `count({ where })` for the identical `where`) is exactly what this change
must preserve, and it is the only test that checks it against real SQL rather
than a mocked `where` shape. It needs a live database, so it will not run in this
environment; note in the commit message that it is unverified locally.

- [ ] **Step 8: Run the affected suites**

Run: `npx jest src/reports/report-filter.util.spec.ts test/time-entries-report.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Run the full suite and commit**

Run: `npm run lint && npm test && npm run build`

```bash
git add src/reports/ test/
git commit -m "feat(chargeability): resolve the chargeable filter per entry

The ?chargeable filter and the two hours aggregates read the entry's own
is_chargeable column instead of joining the task, so they see per-assignee
rules. The grouped-by-task view's chargeableHours becomes a real sum — its
all-or-nothing form was correct only while a task had a single answer."
```

---

### Task 8: `GET /reports/tasks/:taskId/assignee-chargeability`

**Files:**
- Modify: `src/reports/time-entries-report.service.ts` (new method)
- Modify: `src/reports/reports.controller.ts` (new route)
- Test: `test/time-entries-report.service.spec.ts`

**Interfaces:**
- Consumes: `resolveChargeability` (Task 2), `TaskAssigneeChargeabilityRepository.findForTask` (Task 3).
- Produces: `taskAssigneeChargeability(taskId: string): Promise<{ userId: string; userName: string | null; entryCount: number; hours: number; rule: boolean | null; chargeable: boolean; source: ChargeabilitySource }[]>` — the rows the drawer renders in Task 9.

- [ ] **Step 1: Write the failing test**

Append to `test/time-entries-report.service.spec.ts`, inside the top-level
`describe('TimeEntriesReportService', ...)` so `makePrisma` is in scope:

```ts
describe('taskAssigneeChargeability', () => {
  it('lists everyone who logged time on the task with their resolved chargeability', async () => {
    const hrs = (n: number) => ({ toNumber: () => n });
    const prisma = makePrisma({
      clickupTask: { findUnique: jest.fn().mockResolvedValue({ isChargeable: true }) },
      taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([{ userId: 'u2', chargeable: false }]) },
    });
    prisma.clickupTimeEntry.groupBy.mockResolvedValue([
      { userId: 'u1', userName: 'Ada', _count: 2, _sum: { durationHours: hrs(3) } },
      { userId: 'u2', userName: 'Grace', _count: 1, _sum: { durationHours: hrs(2) } },
    ]);

    const rows = await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1');

    expect(rows).toEqual([
      { userId: 'u1', userName: 'Ada', entryCount: 2, hours: 3, rule: null, chargeable: true, source: 'task' },
      { userId: 'u2', userName: 'Grace', entryCount: 1, hours: 2, rule: false, chargeable: false, source: 'assignee' },
    ]);
  });

  it('drops entries with no logger, which have no identity to key a rule on', async () => {
    const prisma = makePrisma({
      clickupTask: { findUnique: jest.fn().mockResolvedValue({ isChargeable: true }) },
      taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([]) },
    });
    prisma.clickupTimeEntry.groupBy.mockResolvedValue([
      { userId: null, userName: null, _count: 1, _sum: { durationHours: { toNumber: () => 1 } } },
    ]);

    expect(await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest test/time-entries-report.service.spec.ts -t "resolved chargeability"`
Expected: FAIL — `taskAssigneeChargeability is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/reports/time-entries-report.service.ts`:

```ts
  /**
   * Everyone who has logged time on one task, with the chargeability answer
   * that currently applies to them and which layer produced it. Backs the task
   * drawer's per-assignee controls.
   *
   * Grouped from time entries rather than from the task's `assignees_names`,
   * because billing follows who logged the time — and `assignees_names` carries
   * no user ids to key a rule on.
   */
  async taskAssigneeChargeability(taskId: string) {
    // Requires: import { resolveChargeability } from '../time-entries/chargeability';
    const [task, rules, groups] = await Promise.all([
      this.prisma.clickupTask.findUnique({ where: { taskId }, select: { isChargeable: true } }),
      this.prisma.taskAssigneeChargeability.findMany({ where: { taskId }, select: { userId: true, chargeable: true } }),
      this.prisma.clickupTimeEntry.groupBy({
        by: ['userId', 'userName'],
        where: { taskId },
        _count: true,
        _sum: { durationHours: true },
      }),
    ]);
    const ruleByUser = new Map(rules.map((r) => [r.userId, r.chargeable]));
    return groups
      .filter((g): g is typeof g & { userId: string } => g.userId != null)
      .map((g) => {
        const rule = ruleByUser.get(g.userId) ?? null;
        // Phase 1 has no per-entry override writer, so `entryOverride` is not
        // consulted here. Phase 2 adds it and this call gains a third input.
        const { chargeable, source } = resolveChargeability({ rule, taskChargeable: task?.isChargeable });
        return {
          userId: g.userId,
          userName: g.userName,
          entryCount: g._count,
          hours: g._sum.durationHours?.toNumber() ?? 0,
          rule,
          chargeable,
          source,
        };
      })
      .sort((a, b) => (a.userName ?? '').localeCompare(b.userName ?? ''));
  }
```

- [ ] **Step 4: Add the route**

In `src/reports/reports.controller.ts`:

```ts
  @Get('tasks/:taskId/assignee-chargeability')
  @ApiOperation({ summary: "Everyone who logged time on one task, with hours, the (task, assignee) rule if any, the resolved chargeability, and which layer decided it ('assignee' | 'task' | 'default'). Backs the task drawer's per-assignee controls." })
  taskAssigneeChargeability(@Param('taskId') taskId: string) {
    return this.timeEntriesReports.taskAssigneeChargeability(taskId);
  }
```

Add `Param` to the `@nestjs/common` import if it is not already there. Place the route **after** any other `tasks/...` routes that use a literal segment, so `tasks/chargeable-preview` is not shadowed by `:taskId`.

- [ ] **Step 5: Run it to verify it passes, then the full suite**

Run: `npx jest test/time-entries-report.service.spec.ts && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/reports/
git commit -m "feat(chargeability): add GET /reports/tasks/:taskId/assignee-chargeability

Groups the task's time entries by logger, joins any (task, assignee) rule, and
returns the resolved answer plus the layer that produced it. Grouped from
entries rather than assignees_names, which carries no user ids to key on."
```

---

### Task 9: The task drawer's per-assignee controls

**Files:**
- Modify: `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/api/admin.ts`
- Modify: `apps/web/src/hooks/useReports.ts`
- Modify: `apps/web/src/pages/TasksPage.tsx` (the drawer's Business section, below the existing `Chargeable` Field around line 262)

**Interfaces:**
- Consumes: `GET /reports/tasks/:taskId/assignee-chargeability` (Task 8), `PATCH /admin/tasks/:taskId/assignee-chargeable` (Task 6).
- Produces: hook `useTaskAssigneeChargeability(taskId: string | null)`, mutation hook `useSetAssigneeChargeable()`.

- [ ] **Step 1: Add the API clients**

In `apps/web/src/api/reports.ts`:

```ts
  taskAssigneeChargeability: (taskId: string) =>
    apiClient.get(`/reports/tasks/${taskId}/assignee-chargeability`).then(r => r.data),
```

In `apps/web/src/api/admin.ts`, beside the existing `setTaskChargeable`:

```ts
  setAssigneeChargeable: (taskId: string, userId: string, chargeable: boolean | null) =>
    apiClient.patch(`/admin/tasks/${taskId}/assignee-chargeable`, { userId, chargeable })
      .then(r => r.data as { changed: boolean; queued: boolean }),
```

- [ ] **Step 2: Add the hooks**

In `apps/web/src/hooks/useReports.ts`:

```ts
export interface TaskAssigneeChargeability {
  userId: string;
  userName: string | null;
  entryCount: number;
  hours: number;
  rule: boolean | null;
  chargeable: boolean;
  source: 'entry' | 'assignee' | 'task' | 'default';
}

/** Per-assignee chargeability for one task. Disabled until a task is selected. */
export function useTaskAssigneeChargeability(taskId: string | null) {
  return useQuery<TaskAssigneeChargeability[]>({
    queryKey: ['task-assignee-chargeability', taskId],
    queryFn: () => reportsApi.taskAssigneeChargeability(taskId as string),
    enabled: !!taskId,
  });
}

export function useSetAssigneeChargeable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, userId, chargeable }: { taskId: string; userId: string; chargeable: boolean | null }) =>
      adminApi.setAssigneeChargeable(taskId, userId, chargeable),
    onSuccess: () => {
      // The recalc is asynchronous, so costs on screen lag by a moment; the
      // rule itself is immediate, which is what these two views show.
      qc.invalidateQueries({ queryKey: ['task-assignee-chargeability'] });
      qc.invalidateQueries({ queryKey: ['time-entries'] });
    },
  });
}
```

- [ ] **Step 3: Render the controls in the drawer**

In `apps/web/src/pages/TasksPage.tsx`, immediately below the existing `<Field label="Chargeable">` block, add:

```tsx
              {assigneeCharge.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Field label="Per assignee">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {assigneeCharge.map((a) => (
                        <span key={a.userId} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <ClickupAvatar userId={a.userId} name={a.userName ?? ''} size={18} />
                          <span style={{ fontSize: 12 }}>{a.userName ?? a.userId}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt.duration(a.hours)}</span>
                          {a.chargeable
                            ? <Pill tone="green" size="xs">chargeable</Pill>
                            : <Pill tone="gray" size="xs">non-chargeable</Pill>}
                          {/* Where the answer came from — so "why is this zero?"
                              is answerable without opening the rules screen. */}
                          {a.source === 'assignee' && <Pill tone="gray" size="xs">rule</Pill>}
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAssigneeChargeable.mutate({ taskId, userId: a.userId, chargeable: !a.chargeable })}
                            >
                              {a.chargeable ? 'Mark non-chargeable' : 'Mark chargeable'}
                            </Button>
                          )}
                          {canEdit && a.rule !== null && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAssigneeChargeable.mutate({ taskId, userId: a.userId, chargeable: null })}
                            >
                              Clear rule
                            </Button>
                          )}
                        </span>
                      ))}
                    </div>
                  </Field>
                </div>
              )}
```

with, near the drawer component's other hooks:

```tsx
  const { data: assigneeChargeData } = useTaskAssigneeChargeability(taskId);
  const assigneeCharge = assigneeChargeData ?? [];
  const setAssigneeChargeable = useSetAssigneeChargeable();
```

Import `useTaskAssigneeChargeability` and `useSetAssigneeChargeable` from `../hooks/useReports`, and `ClickupAvatar` if the drawer does not already import it.

- [ ] **Step 4: Typecheck the frontend**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm run lint && npm test && npm run build`

```bash
git add apps/web/src
git commit -m "feat(chargeability): per-assignee controls in the task drawer

Lists everyone who logged time on the task with their hours and resolved
chargeability, a badge showing when a rule (rather than the task flag) decided
it, and buttons to set or clear that rule. Members see the state without the
controls, matching the task-level flag."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Data model: rules table, `chargeable_override`, `is_chargeable` | 1 |
| Guardrail (no sync path writes the override) | 1 |
| Precedence stack / resolver | 2 |
| Layer 0 needs no code | 2 (asserted in Task 4's test) |
| Decision 3: chargeability resolved independently of `COST_EXCLUDED` | 4 |
| Write paths (3 call sites) | 5 |
| Recalculation scoped to `(assignee, task)` | 6 |
| `PATCH .../assignee-chargeable` | 6 |
| Reports: filter + aggregates | 7 |
| Grouped-by-task `chargeableHours` split | 7 |
| Drawer per-assignee control | 8, 9 |
| Backfill | 1 |

**Deferred to later phases, by design:** the per-entry override *writer* and its `timeEntryIds` recalc scope with the bounded job log (phase 2); `GET`/`DELETE /admin/chargeability-rules` and the rules screen (phase 3); the tri-state pill on the Tasks page (phase 4 — `partiallyChargeable` is already emitted by Task 7, so phase 4 is presentation only).

**Known gap this plan cannot close:** no local PostgreSQL, so migration `0020` and its backfill are never executed during these tasks. They are exercised for the first time wherever `prisma:deploy` next runs. Verify the backfill row count there against `SELECT count(*) FROM clickup_time_entries e JOIN clickup_tasks t USING (task_id) WHERE t.is_chargeable = false` before trusting any chargeable-hours number.

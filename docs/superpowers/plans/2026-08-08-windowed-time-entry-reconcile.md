# Windowed Time-Entry Reconcile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile tracked time with a handful of jobs per (space × date-slice) via ClickUp's team-level `time_entries` window, instead of one job per task.

**Architecture:** A new client fetch (`getTimeEntriesWindow`) pulls all entries in a `[start,end]` window for a space in one call; a new service method (`reconcileWindow`) reuses the existing normalize→FK-guard→cost→upsert→tag pipeline (extracted into shared private helpers) and prunes deletions at window granularity through the task→space join; a new admin endpoint fans out one deprioritized BullMQ job per (configured space × 30-day slice).

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), BullMQ, Jest 30. Frontend: React 19 + Vite (TypeScript).

## Global Constraints

- Node `>=22`; NestJS DI only (no manual `new` of services).
- All ClickUp HTTP calls live in `src/clickup/clickup.client.ts`; all DB writes in repositories.
- Keep normalization pure; add a test for every new parser/branch.
- Prefer explicit types; `unknown` + guards for untrusted payloads; no `any` in new signatures.
- Never log tokens/secrets. Preserve Prettier formatting.
- Jobs must be idempotent, deprioritized for bulk work (`BACKFILL_TIME_ENTRY_PRIORITY`), and dead-letter on exhaustion.
- Delete-reconciliation must be scoped to exactly the window+space+members fetched; skip the prune when a slice returns `>= PRUNE_SAFETY_MAX_ENTRIES` (1000).
- Backend tests run with: `npx jest <path/to/file.spec.ts>`. Full suite: `npm test`.
- Frontend has **no** test harness; its check is `cd apps/web && npx tsc -b` (must stay green — `noUnusedLocals` is on).
- Commit after every task. No `Co-Authored-By: Claude` trailer (repo convention).

---

### Task 1: Generalize `buildTimeEntriesQuery`

Make the query builder accept an options object with optional `taskId` **or** `spaceId`, so the same helper serves both the per-task fetch and the new windowed fetch.

**Files:**
- Modify: `src/clickup/time-entries.util.ts`
- Modify: `src/clickup/clickup.client.ts` (the one existing caller, ~line 385)
- Test: `src/clickup/time-entries.util.spec.ts`

**Interfaces:**
- Produces: `buildTimeEntriesQuery(options: TimeEntriesQueryOptions): string` where `TimeEntriesQueryOptions = { taskId?: string; spaceId?: string; assigneeIds?: string[]; startDate?: number; endDate?: number }`.

- [ ] **Step 1: Update the failing tests**

Replace the existing positional-arg calls and add space cases in `src/clickup/time-entries.util.spec.ts`. The full `buildTimeEntriesQuery` describe block becomes:

```ts
describe('buildTimeEntriesQuery', () => {
  it('includes task_id when a taskId is given, and no space_id', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: '86abc' }));
    expect(p.get('task_id')).toBe('86abc');
    expect(p.get('space_id')).toBeNull();
  });

  it('includes space_id when a spaceId is given, and no task_id', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ spaceId: '3577824' }));
    expect(p.get('space_id')).toBe('3577824');
    expect(p.get('task_id')).toBeNull();
  });

  it('joins multiple assignee ids with a comma (ClickUp returns only the token owner without this)', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: 't', assigneeIds: ['a', 'b'] }));
    expect(p.get('assignee')).toBe('a,b');
  });

  it('omits assignee when the list is empty', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: 't', assigneeIds: [] }));
    expect(p.get('assignee')).toBeNull();
  });

  it('always emits the resolved window', () => {
    const p = new URLSearchParams(buildTimeEntriesQuery({ taskId: 't', startDate: 5, endDate: 9 }));
    expect(p.get('start_date')).toBe('5');
    expect(p.get('end_date')).toBe('9');
  });
});
```

Also update the one call in the `resolveTimeEntriesWindow` describe block from `buildTimeEntriesQuery('t', { startDate: 5, endDate: 9 })` to `buildTimeEntriesQuery({ taskId: 't', startDate: 5, endDate: 9 })`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/clickup/time-entries.util.spec.ts`
Expected: FAIL — current `buildTimeEntriesQuery(taskId, options)` signature rejects the object-only call / type errors.

- [ ] **Step 3: Change the builder signature**

In `src/clickup/time-entries.util.ts`, add `taskId`/`spaceId` to the options interface and rewrite the builder:

```ts
export interface TimeEntriesQueryOptions {
  taskId?: string;
  spaceId?: string;
  assigneeIds?: string[];
  startDate?: number;
  endDate?: number;
}

export function buildTimeEntriesQuery(options: TimeEntriesQueryOptions): string {
  const params = new URLSearchParams();
  if (options.taskId) params.append('task_id', options.taskId);
  if (options.spaceId) params.append('space_id', options.spaceId);
  if (options.assigneeIds && options.assigneeIds.length > 0) {
    params.append('assignee', options.assigneeIds.join(','));
  }
  const { startMs, endMs } = resolveTimeEntriesWindow(options);
  params.append('start_date', String(startMs));
  params.append('end_date', String(endMs));
  return params.toString();
}
```

`resolveTimeEntriesWindow` is unchanged (it reads only `startDate`/`endDate`).

- [ ] **Step 4: Update the existing caller**

In `src/clickup/clickup.client.ts`, inside `getTimeEntries`, change:

```ts
const qs = buildTimeEntriesQuery(taskId, {
  assigneeIds: options?.assigneeIds,
  startDate: sliceStart,
  endDate: sliceEnd,
});
```

to:

```ts
const qs = buildTimeEntriesQuery({
  taskId,
  assigneeIds: options?.assigneeIds,
  startDate: sliceStart,
  endDate: sliceEnd,
});
```

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `npx jest src/clickup/time-entries.util.spec.ts src/clickup/clickup.client.spec.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/clickup/time-entries.util.ts src/clickup/time-entries.util.spec.ts src/clickup/clickup.client.ts
git commit -m "refactor(clickup): generalize buildTimeEntriesQuery to task or space scope"
```

---

### Task 2: Add `getTimeEntriesWindow` to the ClickUp client

Fetch all tracked-time entries in a window for a space (or workspace-wide), sliced like `getTimeEntries`, deduped by id.

**Files:**
- Modify: `src/clickup/clickup.client.ts`
- Test: `src/clickup/clickup.client.spec.ts`

**Interfaces:**
- Consumes: `buildTimeEntriesQuery` (Task 1), `resolveTimeEntriesWindow`, `TIME_ENTRIES_SLICE_MS` (existing module const), `this.request` (existing private).
- Produces: `getTimeEntriesWindow(teamId: string, options: { spaceId?: string; assigneeIds?: string[]; startDate?: number; endDate?: number }): Promise<ClickUpTimeEntry[]>`.

- [ ] **Step 1: Write the failing test**

Add to `src/clickup/clickup.client.spec.ts` (follow the file's existing mocking of the private `request` — mirror how `getTimeEntries` is tested; if there is no such test, mock via `jest.spyOn(client as any, 'request')`):

```ts
describe('getTimeEntriesWindow', () => {
  it('queries the team endpoint with space_id, assignee and window; dedupes by id', async () => {
    const client = makeClient(); // however the spec constructs a ClickupClient
    const req = jest.spyOn(client as any, 'request').mockResolvedValue({
      data: [{ id: 'te1' }, { id: 'te1' }, { id: 'te2' }],
    });

    const out = await client.getTimeEntriesWindow('team1', {
      spaceId: 'sp1',
      assigneeIds: ['u1', 'u2'],
      startDate: 1000,
      endDate: 2000,
    });

    expect(out.map((e: any) => e.id)).toEqual(['te1', 'te2']);
    const path = req.mock.calls[0][1] as string;
    expect(path).toContain('/team/team1/time_entries?');
    expect(path).toContain('space_id=sp1');
    expect(path).toContain('assignee=u1%2Cu2');
    expect(path).not.toContain('task_id=');
  });
});
```

(If the spec has no `makeClient` helper, construct the client the same way the existing `getTimeEntries`/`getTasksBySpace` tests do in that file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/clickup/clickup.client.spec.ts -t getTimeEntriesWindow`
Expected: FAIL — `getTimeEntriesWindow is not a function`.

- [ ] **Step 3: Implement `getTimeEntriesWindow`**

Add to `src/clickup/clickup.client.ts`, next to `getTimeEntries`:

```ts
/**
 * Windowed team-level fetch: every tracked-time entry in [start,end] for a
 * space (or the whole workspace when spaceId is omitted), in <=1-year slices.
 * Unlike getTimeEntries this omits task_id, so one call covers all tasks —
 * the memory-cheap path for a reconcile. Deduped by entry id across slice
 * boundaries; the union is authoritative for the full window.
 */
async getTimeEntriesWindow(
  teamId: string,
  options: { spaceId?: string; assigneeIds?: string[]; startDate?: number; endDate?: number },
): Promise<ClickUpTimeEntry[]> {
  const { startMs, endMs } = resolveTimeEntriesWindow(options);
  const byId = new Map<string, ClickUpTimeEntry>();
  const out: ClickUpTimeEntry[] = [];
  for (let sliceStart = startMs; sliceStart < endMs; sliceStart += TIME_ENTRIES_SLICE_MS) {
    const sliceEnd = Math.min(sliceStart + TIME_ENTRIES_SLICE_MS, endMs);
    const qs = buildTimeEntriesQuery({
      spaceId: options.spaceId,
      assigneeIds: options.assigneeIds,
      startDate: sliceStart,
      endDate: sliceEnd,
    });
    const res: any = await this.request('GET', `/team/${teamId}/time_entries?${qs}`);
    const entries: ClickUpTimeEntry[] = res.data || res.entries || [];
    for (const entry of entries) {
      const id = (entry as { id?: string }).id;
      if (id == null) {
        out.push(entry);
      } else if (!byId.has(id)) {
        byId.set(id, entry);
        out.push(entry);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/clickup/clickup.client.spec.ts -t getTimeEntriesWindow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/clickup/clickup.client.ts src/clickup/clickup.client.spec.ts
git commit -m "feat(clickup): add getTimeEntriesWindow for windowed reconcile"
```

---

### Task 3: Add `pruneWindowOutsideSet` to the repository

Space-scoped delete-reconciliation: remove local rows in a window (for the reconciled space + members) that ClickUp did not return.

**Files:**
- Modify: `src/time-entries/time-entries.repository.ts`
- Test: `src/time-entries/time-entries.repository.spec.ts`

**Interfaces:**
- Produces: `pruneWindowOutsideSet(args: { spaceId: string; userIds: string[]; startMs: number; endMs: number; keepIds: string[] }): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Add to `src/time-entries/time-entries.repository.spec.ts` (mirror the existing `pruneTaskEntriesOutsideSet` test's Prisma mock):

```ts
describe('pruneWindowOutsideSet', () => {
  it('deletes only in-window rows for the space + members that are not kept, scoped via the task join', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const repo = new TimeEntriesRepository({ clickupTimeEntry: { deleteMany } } as any);

    const count = await repo.pruneWindowOutsideSet({
      spaceId: 'sp1',
      userIds: ['u1', 'u2'],
      startMs: 1000,
      endMs: 2000,
      keepIds: ['te1', 'te2'],
    });

    expect(count).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        task: { is: { spaceId: 'sp1' } },
        userId: { in: ['u1', 'u2'] },
        startTime: { gte: new Date(1000), lte: new Date(2000) },
        timeEntryId: { notIn: ['te1', 'te2'] },
      },
    });
  });
});
```

(Match however the existing spec constructs `TimeEntriesRepository` — pass the mocked `PrismaService`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/time-entries/time-entries.repository.spec.ts -t pruneWindowOutsideSet`
Expected: FAIL — method undefined.

- [ ] **Step 3: Implement `pruneWindowOutsideSet`**

Add to `src/time-entries/time-entries.repository.ts`, next to `pruneTaskEntriesOutsideSet`:

```ts
/**
 * Window-scoped delete-reconciliation for reconcileWindow. Space is reached via
 * the task join (clickup_time_entries has no space_id), so scoping by spaceId is
 * REQUIRED: the fetch (and keepIds) is space-scoped, so an unscoped prune would
 * delete other spaces' in-window rows. Rows with a null task_id have no related
 * task and are therefore never pruned (conservative, matches departed-user
 * safety: the userIds filter also excludes rows from members not in the set).
 */
async pruneWindowOutsideSet(args: {
  spaceId: string;
  userIds: string[];
  startMs: number;
  endMs: number;
  keepIds: string[];
}): Promise<number> {
  const { count } = await this.prisma.clickupTimeEntry.deleteMany({
    where: {
      task: { is: { spaceId: args.spaceId } },
      userId: { in: args.userIds },
      startTime: { gte: new Date(args.startMs), lte: new Date(args.endMs) },
      timeEntryId: { notIn: args.keepIds },
    },
  });
  return count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/time-entries/time-entries.repository.spec.ts -t pruneWindowOutsideSet`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/time-entries/time-entries.repository.ts src/time-entries/time-entries.repository.spec.ts
git commit -m "feat(time-entries): add space-scoped pruneWindowOutsideSet"
```

---

### Task 4: Extract shared persist + tag-replacement helpers (behavior-preserving)

Pull the per-entry upsert loop and the tag-replacement enqueue out of `syncTaskTimeEntries` into private helpers so `reconcileWindow` (Task 5) reuses them verbatim. No behavior change — existing tests must stay green.

**Files:**
- Modify: `src/time-entries/time-entries.service.ts`
- Test (regression only): `src/time-entries/task-reconciliation.service.spec.ts` (existing; do not edit — must stay green)

**Interfaces:**
- Produces (private methods on `TimeEntriesService`):
  - `persistEntries(entries: ClickUpTimeEntry[]): Promise<{ count: number; upserted: { normalized: NormalizedTimeEntry; rawTags: string[] }[] }>` — ensures every distinct referenced task exists (FK guard), skips FK-unresolvable entries, normalizes, computes cost, upserts.
  - `enqueueTagReplacements(upserted: { normalized: NormalizedTimeEntry; rawTags: string[] }[], fallbackTaskId?: string): Promise<void>`.

- [ ] **Step 1: Add `persistEntries` private method**

Add to `src/time-entries/time-entries.service.ts`. This is the existing loop, generalized to seed the FK-resolvable set from **all** distinct referenced task ids (the per-task path already ensures its queried task separately, so behavior is preserved):

```ts
private async persistEntries(
  entries: ClickUpTimeEntry[],
): Promise<{ count: number; upserted: { normalized: NormalizedTimeEntry; rawTags: string[] }[] }> {
  const resolvableTaskIds = new Set<string>();
  const distinctTaskIds = [
    ...new Set(entries.map((e) => e.task?.id).filter((id): id is string => !!id)),
  ];
  for (const tid of distinctTaskIds) {
    if (await this.ensureTaskExists(tid)) resolvableTaskIds.add(tid);
    else this.logger.warn(`Time entry references task ${tid} not resolvable in ClickUp — its entries will be skipped`);
  }

  let dueByTask: Map<string, Date | null> | null = null;
  if (this.settings.getPreferences().cost.rateMatching === 'due') {
    const taskRows = await this.prisma.clickupTask.findMany({
      where: { taskId: { in: [...resolvableTaskIds] } },
      select: { taskId: true, dueDate: true },
    });
    dueByTask = new Map(taskRows.map((t) => [t.taskId, t.dueDate]));
  }

  let count = 0;
  const upserted: { normalized: NormalizedTimeEntry; rawTags: string[] }[] = [];
  const rateCache = new Map();
  for (const entry of entries) {
    const normalized = this.normalizer.normalizeTimeEntry(entry);
    if (normalized.taskId != null && !resolvableTaskIds.has(normalized.taskId)) {
      this.logger.warn(`Skipping time entry ${normalized.timeEntryId}: task ${normalized.taskId} unresolved (FK guard)`);
      continue;
    }
    const rawTags = extractEntryTagNames(entry);
    upserted.push({ normalized, rawTags });
    const cost = await this.costs.calculate(normalized.userId, normalized.startTime, normalized.durationHours, rateCache, { billable: normalized.billable, dueDate: dueByTask?.get(normalized.taskId ?? '') ?? null });
    await this.repo.upsert(normalized, cost);
    if (cost.status === 'NO_RATE_FOUND') this.logger.warn(`Missing rate for user ${normalized.userId} on time entry ${normalized.timeEntryId}`);
    count += 1;
  }
  return { count, upserted };
}
```

- [ ] **Step 2: Add `enqueueTagReplacements` private method**

Add the existing tag block as a helper (the only change: `taskId` fallback is a parameter):

```ts
private async enqueueTagReplacements(
  upserted: { normalized: NormalizedTimeEntry; rawTags: string[] }[],
  fallbackTaskId?: string,
): Promise<void> {
  const activeMap = await this.tagAssigneeMap.findAllActive();
  if (activeMap.length === 0) return;
  const activeTagNames = new Set(activeMap.map((m) => m.tagName.toLowerCase()));
  for (const { normalized, rawTags } of upserted) {
    if (rawTags.length === 0) continue;
    if (!rawTags.some((t) => activeTagNames.has(t))) continue;
    await this.queues.get(QUEUES.CLICKUP_ASSIGNEE_REPLACEMENT).add(
      JOBS.REPLACE_TIME_ENTRY_ASSIGNEES,
      {
        timeEntryId: normalized.timeEntryId,
        taskId: normalized.taskId ?? fallbackTaskId ?? '',
        startMs: normalized.startTime?.getTime() ?? 0,
        endMs: normalized.endTime?.getTime() ?? 0,
        durationHours: normalized.durationHours,
        billable: normalized.billable,
        description: normalized.description ?? undefined,
        originalUserId: normalized.userId ?? '',
        tags: rawTags,
      } satisfies ReplacementJobData,
      { ...this.queues.defaultJobOptions(), jobId: replacementJobId(normalized.timeEntryId) },
    );
  }
}
```

- [ ] **Step 3: Rewire `syncTaskTimeEntries` to use the helpers**

In `syncTaskTimeEntries`, replace the inline FK-resolution + upsert loop (the block from `const resolvableTaskIds = new Set<string>([taskId]);` through the `for (const entry of entries) { … }` loop) with:

```ts
const { count, upserted } = await this.persistEntries(entries);
```

Keep the surrounding code as-is: the top `ensureTaskExists(taskId)` guard, the `resolveTimeEntriesWindow` + `getTimeEntries` fetch, and the task-scoped prune block (`pruneTaskEntriesOutsideSet`) that reads `upserted`/`ids`/`startMs`/`endMs`. Then replace the inline tag-replacement block at the end with:

```ts
await this.enqueueTagReplacements(upserted, taskId);

return count;
```

- [ ] **Step 4: Run the existing suite to confirm no behavior change**

Run: `npx jest src/time-entries/`
Expected: PASS (all existing time-entries specs, including `task-reconciliation.service.spec.ts`).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/time-entries/time-entries.service.ts
git commit -m "refactor(time-entries): extract persistEntries + enqueueTagReplacements helpers"
```

---

### Task 5: Add `reconcileWindow` service method

Windowed reconcile: fetch a space's entries in a window, upsert via `persistEntries`, prune deletions at window granularity, enqueue tag replacements.

**Files:**
- Modify: `src/time-entries/time-entries.service.ts`
- Test: `src/time-entries/time-entries-reconcile-window.spec.ts` (create)

**Interfaces:**
- Consumes: `persistEntries`, `enqueueTagReplacements` (Task 4); `clickup.getTimeEntriesWindow` (Task 2); `repo.pruneWindowOutsideSet` (Task 3); `members.getMemberIds`; `resolveTimeEntriesWindow`; `PRUNE_SAFETY_MAX_ENTRIES` (module const, same file).
- Produces: `reconcileWindow(spaceId: string, startDate: number, endDate: number): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `src/time-entries/time-entries-reconcile-window.spec.ts`. Construct the service with all constructor deps mocked (mirror how `task-reconciliation.service.spec.ts` builds `TimeEntriesService`). Cover: upsert path, window-scoped prune with the shared window, and the truncation guard.

```ts
import { TimeEntriesService } from './time-entries.service';

function makeService(overrides: Partial<Record<string, any>> = {}) {
  const clickup = { getTimeEntriesWindow: jest.fn().mockResolvedValue([{ id: 'te1', task: { id: 'tk1' } }]) };
  const normalizer = { normalizeTimeEntry: (e: any) => ({ timeEntryId: e.id, taskId: e.task?.id ?? null, userId: 'u1', startTime: new Date(1500), endTime: new Date(1600), durationHours: 1, billable: true, description: null, raw: e }) };
  const repo = { upsert: jest.fn().mockResolvedValue(undefined), pruneWindowOutsideSet: jest.fn().mockResolvedValue(0) };
  const costs = { calculate: jest.fn().mockResolvedValue({ status: 'COST_CALCULATED', costCents: 0 }) };
  const queues = { get: () => ({ add: jest.fn() }), defaultJobOptions: () => ({}) };
  const members = { getMemberIds: jest.fn().mockResolvedValue(['u1', 'u2']) };
  const tagAssigneeMap = { findAllActive: jest.fn().mockResolvedValue([]) };
  const tasksRepo = { exists: jest.fn().mockResolvedValue(true) };
  const tasksService = { syncTask: jest.fn() };
  const settings = { getTeamId: () => 'team1', getPreferences: () => ({ cost: { rateMatching: 'start' } }) };
  const prisma = { clickupTask: { findMany: jest.fn().mockResolvedValue([]) } };
  const svc = new TimeEntriesService(
    clickup as any, normalizer as any, repo as any, costs as any, queues as any,
    members as any, tagAssigneeMap as any, tasksRepo as any, tasksService as any, settings as any, prisma as any,
  );
  return { svc, clickup, repo, members };
}

describe('reconcileWindow', () => {
  it('upserts fetched entries and prunes the same window/space/members it fetched', async () => {
    const { svc, clickup, repo, members } = makeService();
    const count = await svc.reconcileWindow('sp1', 1000, 2000);

    expect(count).toBe(1);
    expect(members.getMemberIds).toHaveBeenCalled();
    expect(clickup.getTimeEntriesWindow).toHaveBeenCalledWith('team1', {
      spaceId: 'sp1', assigneeIds: ['u1', 'u2'], startDate: 1000, endDate: 2000,
    });
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(repo.pruneWindowOutsideSet).toHaveBeenCalledWith({
      spaceId: 'sp1', userIds: ['u1', 'u2'], startMs: 1000, endMs: 2000, keepIds: ['te1'],
    });
  });

  it('skips the prune when the slice looks truncated (>= PRUNE_SAFETY_MAX_ENTRIES)', async () => {
    const { svc, clickup, repo } = makeService();
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `te${i}`, task: { id: 'tk1' } }));
    clickup.getTimeEntriesWindow.mockResolvedValue(many);

    await svc.reconcileWindow('sp1', 1000, 2000);

    expect(repo.pruneWindowOutsideSet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/time-entries/time-entries-reconcile-window.spec.ts`
Expected: FAIL — `reconcileWindow is not a function`.

- [ ] **Step 3: Implement `reconcileWindow`**

Add to `src/time-entries/time-entries.service.ts`:

```ts
/**
 * Windowed reconcile: pulls a space's tracked time in [startDate,endDate] in
 * one team-level call (all members), upserts via the shared pipeline, and
 * prunes deletions at window granularity. Cheaper than one-job-per-task and
 * catches deletions on tasks the 30-day space backfill never revisits. The
 * fetch and prune share one resolved window so they can't drift.
 */
async reconcileWindow(spaceId: string, startDate: number, endDate: number): Promise<number> {
  const teamId = this.settings.getTeamId();
  const ids = await this.members.getMemberIds();
  const { startMs, endMs } = resolveTimeEntriesWindow({ startDate, endDate });

  const entries = await this.clickup.getTimeEntriesWindow(teamId, {
    spaceId,
    assigneeIds: ids,
    startDate: startMs,
    endDate: endMs,
  });

  const { count, upserted } = await this.persistEntries(entries);

  // Delete-reconciliation for exactly this space × window × members. A
  // suspiciously large slice is treated as possibly-truncated — upsert only,
  // never prune off a partial read.
  if (entries.length >= PRUNE_SAFETY_MAX_ENTRIES) {
    this.logger.warn(
      `Fetched ${entries.length} time entries for space ${spaceId} (>= ${PRUNE_SAFETY_MAX_ENTRIES}); skipping delete-reconciliation to avoid pruning live rows on a possibly-truncated response`,
    );
  } else {
    const keepIds = upserted.map((u) => u.normalized.timeEntryId);
    const pruned = await this.repo.pruneWindowOutsideSet({ spaceId, userIds: ids, startMs, endMs, keepIds });
    if (pruned > 0) this.logger.log(`Pruned ${pruned} time entr${pruned === 1 ? 'y' : 'ies'} deleted in ClickUp for space ${spaceId}`);
  }

  await this.enqueueTagReplacements(upserted);
  return count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/time-entries/time-entries-reconcile-window.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/time-entries/time-entries.service.ts src/time-entries/time-entries-reconcile-window.spec.ts
git commit -m "feat(time-entries): add windowed reconcileWindow"
```

---

### Task 6: Add the job constant and branch the worker

Register the new job name and route it in the existing time-entry processor.

**Files:**
- Modify: `src/queues/queue.constants.ts`
- Modify: `src/workers/time-entry-sync.processor.ts`
- Test: `src/workers/time-entry-sync.processor.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `timeEntries.reconcileWindow` (Task 5); `JOBS.RECONCILE_TIME_ENTRIES_WINDOW`.
- Produces: job name constant `JOBS.RECONCILE_TIME_ENTRIES_WINDOW = 'reconcile-time-entries-window'`; processor handles payload `{ spaceId: string; startDate: number; endDate: number }` for that job name.

- [ ] **Step 1: Add the job constant**

In `src/queues/queue.constants.ts`, add to the `JOBS` object:

```ts
  RECONCILE_TIME_ENTRIES_WINDOW: 'reconcile-time-entries-window',
```

- [ ] **Step 2: Write the failing test**

Create `src/workers/time-entry-sync.processor.spec.ts`:

```ts
import { JOBS, QUEUES } from '../queues/queue.constants';
import { TimeEntrySyncProcessor } from './time-entry-sync.processor';

function makeProcessor(timeEntries: any) {
  const jobLogs = { started: jest.fn().mockResolvedValue({ id: 'log1' }), finished: jest.fn(), failed: jest.fn() };
  const deadLetters = { recordIfExhausted: jest.fn() };
  return new TimeEntrySyncProcessor(timeEntries, jobLogs as any, deadLetters as any);
}

describe('TimeEntrySyncProcessor', () => {
  it('routes RECONCILE_TIME_ENTRIES_WINDOW jobs to reconcileWindow', async () => {
    const timeEntries = { reconcileWindow: jest.fn().mockResolvedValue(5), syncTaskTimeEntries: jest.fn() };
    const proc = makeProcessor(timeEntries);
    await proc.process({ id: 'j1', name: JOBS.RECONCILE_TIME_ENTRIES_WINDOW, data: { spaceId: 'sp1', startDate: 1000, endDate: 2000 } } as any);
    expect(timeEntries.reconcileWindow).toHaveBeenCalledWith('sp1', 1000, 2000);
    expect(timeEntries.syncTaskTimeEntries).not.toHaveBeenCalled();
  });

  it('routes other jobs to syncTaskTimeEntries', async () => {
    const timeEntries = { reconcileWindow: jest.fn(), syncTaskTimeEntries: jest.fn().mockResolvedValue(2) };
    const proc = makeProcessor(timeEntries);
    await proc.process({ id: 'j2', name: JOBS.SYNC_TASK_TIME_ENTRIES, data: { taskId: 'tk1', startDate: 1, endDate: 2 } } as any);
    expect(timeEntries.syncTaskTimeEntries).toHaveBeenCalledWith('tk1', undefined, 1, 2);
    expect(timeEntries.reconcileWindow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/workers/time-entry-sync.processor.spec.ts`
Expected: FAIL — the processor currently always calls `syncTaskTimeEntries`.

- [ ] **Step 4: Branch the processor**

In `src/workers/time-entry-sync.processor.ts`, import `JOBS` (already imports `QUEUES` from the same module) and rewrite `process` to branch on `job.name`:

```ts
async process(job: Job<{ taskId?: string; assigneeIds?: string[]; startDate?: number; endDate?: number; spaceId?: string }>) {
  if (job.name === JOBS.RECONCILE_TIME_ENTRIES_WINDOW) {
    const log = await this.jobLogs.started({ jobId: job.id?.toString(), queueName: QUEUES.CLICKUP_TIME_ENTRIES, jobName: job.name, entityType: 'space', entityId: job.data.spaceId });
    try {
      const result = await this.timeEntries.reconcileWindow(job.data.spaceId!, job.data.startDate!, job.data.endDate!);
      await this.jobLogs.finished(log.id, { timeEntriesSynced: result });
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }

  const log = await this.jobLogs.started({ jobId: job.id?.toString(), queueName: QUEUES.CLICKUP_TIME_ENTRIES, jobName: job.name, entityType: 'task', entityId: job.data.taskId });
  try {
    const result = await this.timeEntries.syncTaskTimeEntries(job.data.taskId!, job.data.assigneeIds, job.data.startDate, job.data.endDate);
    await this.jobLogs.finished(log.id, { timeEntriesSynced: result });
    return result;
  } catch (e) {
    await this.jobLogs.failed(log.id, e);
    throw e;
  }
}
```

Update the import line to `import { JOBS, QUEUES, clickupWorkerOptions } from '../queues/queue.constants';`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/workers/time-entry-sync.processor.spec.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/queues/queue.constants.ts src/workers/time-entry-sync.processor.ts src/workers/time-entry-sync.processor.spec.ts
git commit -m "feat(workers): route reconcile-time-entries-window jobs to reconcileWindow"
```

---

### Task 7: Add the admin endpoint

`POST /admin/time-entries/reconcile-window` fans out one deprioritized job per (configured space × 30-day slice).

**Files:**
- Modify: `src/admin/admin-sync.controller.ts`
- Test: `src/admin/admin-sync.controller.spec.ts` (create if absent)

**Interfaces:**
- Consumes: `JOBS.RECONCILE_TIME_ENTRIES_WINDOW`, `BACKFILL_TIME_ENTRY_PRIORITY`, `QUEUES.CLICKUP_TIME_ENTRIES`, `CLICKUP_SPACES`, `subtractDays`, `this.queues`.
- Produces: endpoint returning `{ queued: number }`.

- [ ] **Step 1: Add the slice constant and import the priority**

In `src/admin/admin-sync.controller.ts` add near the top (module scope):

```ts
const RECONCILE_WINDOW_SLICE_DAYS = 30;
const RECONCILE_WINDOW_DEFAULT_LOOKBACK_DAYS = 90;
```

Add `BACKFILL_TIME_ENTRY_PRIORITY` to the existing `queue.constants` import:

```ts
import { JOBS, QUEUES, BACKFILL_TIME_ENTRY_PRIORITY } from '../queues/queue.constants';
```

- [ ] **Step 2: Write the failing test**

Create `src/admin/admin-sync.controller.spec.ts` (or add a describe if it exists). Mock `queues.get(...).add`, `queues.defaultJobOptions()`, and rely on the real `CLICKUP_SPACES` (3 configured spaces):

```ts
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
// import the controller and construct with mocked deps as the file's other tests do

describe('POST reconcile-window', () => {
  it('enqueues one job per configured space per 30-day slice for a 90-day lookback', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const controller = makeController({ queues: { get: () => ({ add }), defaultJobOptions: () => ({}) } });

    const res = await controller.reconcileTimeEntriesWindow({ lookbackDays: 90 });

    const slices = Math.ceil(90 / 30); // 3
    expect(res.queued).toBe(CLICKUP_SPACES.length * slices);
    expect(add).toHaveBeenCalledTimes(CLICKUP_SPACES.length * slices);
    // each add is the windowed reconcile job, deprioritized
    const [name, , opts] = add.mock.calls[0];
    expect(name).toBe('reconcile-time-entries-window');
    expect(opts.priority).toBe(100);
  });

  it('rejects an unknown spaceId', async () => {
    const controller = makeController({ queues: { get: () => ({ add: jest.fn() }), defaultJobOptions: () => ({}) } });
    await expect(controller.reconcileTimeEntriesWindow({ spaceId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

(Provide a `makeController` helper matching how the controller is constructed — its constructor deps are `queues, settings, prisma, tasksRepo, timeEntriesRepo, …`; only `queues` needs real behavior here.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/admin/admin-sync.controller.spec.ts -t reconcile-window`
Expected: FAIL — method undefined.

- [ ] **Step 4: Implement the endpoint**

Add to `src/admin/admin-sync.controller.ts` (near `syncAllTimeEntries`). Slices march forward from `start` in `RECONCILE_WINDOW_SLICE_DAYS` steps, clamped to `end`:

```ts
@Post('time-entries/reconcile-window')
@HttpCode(200)
@ApiOperation({ summary: 'Windowed time-entry reconcile: one job per configured space per date-slice (cheap alternative to the per-task sync-all).' })
async reconcileTimeEntriesWindow(@Body() dto: { spaceId?: string; lookbackDays?: number }) {
  const spaces = dto.spaceId
    ? (() => {
        const hit = CLICKUP_SPACES.find((s) => s.id === dto.spaceId);
        if (!hit) throw new BadRequestException(`Unknown space ${dto.spaceId}`);
        return [hit];
      })()
    : CLICKUP_SPACES;

  const lookbackDays = dto.lookbackDays && dto.lookbackDays > 0 ? Math.round(dto.lookbackDays) : RECONCILE_WINDOW_DEFAULT_LOOKBACK_DAYS;
  const sliceMs = RECONCILE_WINDOW_SLICE_DAYS * 24 * 60 * 60 * 1000;
  const end = Date.now();
  const start = subtractDays(lookbackDays).getTime();

  const queue = this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES);
  const jobOpts = { ...this.queues.defaultJobOptions(), priority: BACKFILL_TIME_ENTRY_PRIORITY };

  let queued = 0;
  for (const space of spaces) {
    for (let sliceStart = start; sliceStart < end; sliceStart += sliceMs) {
      const sliceEnd = Math.min(sliceStart + sliceMs, end);
      await queue.add(
        JOBS.RECONCILE_TIME_ENTRIES_WINDOW,
        { spaceId: space.id, startDate: sliceStart, endDate: sliceEnd },
        jobOpts,
      );
      queued += 1;
    }
  }
  return { queued };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/admin/admin-sync.controller.spec.ts -t reconcile-window && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/admin/admin-sync.controller.ts src/admin/admin-sync.controller.spec.ts
git commit -m "feat(admin): add POST /admin/time-entries/reconcile-window"
```

---

### Task 8: Wire the Settings control to the windowed reconcile (frontend)

Repoint the "Reconcile time entries" control from the per-task endpoint to the windowed one, reword the confirm copy, and remove the now-unused `useSyncAllTimeEntries` frontend wiring. The **backend** `/time-entries/sync-all` endpoint stays (API-only).

**Files:**
- Modify: `apps/web/src/api/admin.ts`
- Modify: `apps/web/src/hooks/useAdmin.ts`
- Modify: `apps/web/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: backend `POST /admin/time-entries/reconcile-window` (Task 7).
- Produces: `adminApi.reconcileTimeEntriesWindow(lookbackDays?: number): Promise<{ queued: number }>`, `useReconcileTimeEntriesWindow()`.

- [ ] **Step 1: Add the API client method; remove the dead per-task one**

In `apps/web/src/api/admin.ts`, replace the `syncAllTimeEntries` method with:

```ts
  reconcileTimeEntriesWindow: (lookbackDays?: number) =>
    apiClient.post('/admin/time-entries/reconcile-window', { lookbackDays }).then(r => r.data as { queued: number }),
```

- [ ] **Step 2: Swap the hook**

In `apps/web/src/hooks/useAdmin.ts`, replace `useSyncAllTimeEntries` with:

```ts
export function useReconcileTimeEntriesWindow() {
  return useMutation({ mutationFn: (lookbackDays?: number) => adminApi.reconcileTimeEntriesWindow(lookbackDays) });
}
```

- [ ] **Step 3: Repoint the Settings control + reword copy**

In `apps/web/src/pages/SettingsPage.tsx`:
- Change the import from `useSyncAllTimeEntries` to `useReconcileTimeEntriesWindow`.
- Change `const syncAllTimeEntries = useSyncAllTimeEntries();` to `const reconcileTimeEntries = useReconcileTimeEntriesWindow();` and update the three references (`.isPending` in the row button + `.isPending`/`.mutate` in the modal) accordingly.
- In the "Reconcile time entries" `SettingRow` `desc`, replace the heavy warning with:

```
Re-pull tracked time for every configured space over the last N days, in a few windowed jobs (not one per task). Time-entries only — it won't detect task deletes; use Full reconciliation for that.
```

- In the confirm `Modal`, replace the body copy with the lighter version:

```tsx
<div style={{ fontSize: 13, color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 8 }}>
  <p style={{ margin: 0 }}>
    Reconciles the last <strong>{teReconcileDays} days</strong> of tracked time across all configured spaces using
    a few windowed jobs. Deletions in that window are pruned.
  </p>
  <p style={{ margin: 0, color: 'var(--text-muted)' }}>
    For a single space, sync it from the Spaces page instead.
  </p>
</div>
```

- Update the mutate call to use `reconcileTimeEntries.mutate(days, { … })` and the success toast to: `` `Queued ${res.queued} windowed reconcile job${res.queued === 1 ? '' : 's'} (last ${days} days). Hours will refresh as workers drain the queue.` ``.

- [ ] **Step 4: Typecheck (frontend has no test harness)**

Run: `cd apps/web && npx tsc -b`
Expected: EXIT 0, no errors (confirms `useSyncAllTimeEntries`/`syncAllTimeEntries` are fully removed and nothing else referenced them; `noUnusedLocals` is on).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/admin.ts apps/web/src/hooks/useAdmin.ts apps/web/src/pages/SettingsPage.tsx
git commit -m "feat(web): point Settings reconcile at the windowed endpoint"
```

---

### Task 9: Full-suite verification + `space_id` probe

Confirm the whole change is green and settle the one deferred question.

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Backend build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Frontend typecheck**

Run: `cd apps/web && npx tsc -b`
Expected: EXIT 0.

- [ ] **Step 4: Probe `space_id` support (manual, staging or a scratch script)**

With a valid `CLICKUP_API_TOKEN` and `CLICKUP_TEAM_ID`, confirm the endpoint honors the filter:

```bash
curl -s -H "Authorization: $CLICKUP_API_TOKEN" \
  "https://api.clickup.com/api/v2/team/$CLICKUP_TEAM_ID/time_entries?space_id=3577824&start_date=<ms>&end_date=<ms>&assignee=<memberIds>" | jq '.data | length'
```

Expected: entries returned are limited to the given space. **If `space_id` is NOT honored** (results include other spaces): change `getTimeEntriesWindow` callers to omit `spaceId` (workspace-wide fetch), keep the FK-skip in `persistEntries` (entries for tasks outside configured spaces are already skipped), and keep the space-scoped `pruneWindowOutsideSet` unchanged (it already scopes the prune correctly). No other task changes.

- [ ] **Step 5: Update the spec's deferred-question note**

Record the probe result in `docs/superpowers/specs/2026-08-08-windowed-time-entry-reconcile-design.md` under "Open question deferred to implementation" (either "confirmed: `space_id` honored" or "fallback applied").

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-08-windowed-time-entry-reconcile-design.md
git commit -m "docs: record space_id probe result for windowed reconcile"
```

---

## Self-Review

**Spec coverage:**
- §1 client windowed fetch → Tasks 1–2. ✓
- §2 `reconcileWindow` reusing the pipeline → Tasks 4–5. ✓
- §3 space-scoped prune → Task 3. ✓
- §4 job + worker → Task 6. ✓
- §5 admin endpoint → Task 7. ✓
- §6 frontend rewire + remove dead hook (keep backend endpoint) → Task 8. ✓
- Error handling (truncation guard, departed-user safety, FK-skip, cross-space isolation) → Tasks 3 & 5 code + tests. ✓
- Testing list → per-task tests in Tasks 1–7. ✓
- Deferred `space_id` question → Task 9. ✓

**Type consistency:** `getTimeEntriesWindow(teamId, { spaceId, assigneeIds, startDate, endDate })`, `reconcileWindow(spaceId, startDate, endDate)`, `pruneWindowOutsideSet({ spaceId, userIds, startMs, endMs, keepIds })`, `persistEntries(entries) → { count, upserted }`, `enqueueTagReplacements(upserted, fallbackTaskId?)`, `JOBS.RECONCILE_TIME_ENTRIES_WINDOW = 'reconcile-time-entries-window'` — used consistently across Tasks 2, 3, 4, 5, 6, 7.

**Placeholder scan:** no TBD/TODO; every code step has concrete code. The `makeController`/`makeClient`/`makeService` test helpers are described with their exact mocked deps and told to mirror the existing spec construction in that file.

# ClickUp List Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-select ClickUp **List** filter to the Tasks and Time Entries pages, scoped to the selected Space, mirroring the existing Client filter end-to-end.

**Architecture:** A new `GET /reports/lists` endpoint returns distinct lists (optionally scoped to a space) for the dropdowns. The `tasks()`, `timeEntriesList()`, and `timeEntriesAggregates()` service methods gain a `listId` filter. The frontend adds a `useLists(spaceId)` hook and a `<Select>` on each page; Time Entries also gains a List column (table + CSV).

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL (raw SQL via `Prisma.sql`), Jest/ts-jest (backend); React + Vite + @tanstack/react-query (web).

**Spec:** `docs/superpowers/specs/2026-06-05-list-filter-design.md`

**Conventions:** This repo omits the `Co-Authored-By: Claude` commit trailer. `npm run lint` is broken (no root ESLint config) — do **not** gate on it; use `npm run test` and `npm run build`.

---

## File Structure

- `src/reports/reports.service.ts` — add `tasksLists()`; add `listId` to `tasks()`, `timeEntriesList()`, `timeEntriesAggregates()`; add `listName` to the time-entry select/mapping.
- `src/reports/reports.controller.ts` — add `GET /reports/lists`; add `@Query('listId')` to `tasks`, `time-entries`, `time-entries/aggregates`.
- `test/reports.service.spec.ts` — tests for the new behavior.
- `apps/web/src/api/reports.ts` — add `lists()`.
- `apps/web/src/hooks/useReports.ts` — add `useLists()`.
- `apps/web/src/components/TimeEntryDrawer.tsx` — add `listName` to `TimeEntryItem`.
- `apps/web/src/pages/TasksPage.tsx` — List `<Select>`, wiring.
- `apps/web/src/pages/TimeEntriesPage.tsx` — List `<Select>`, column, CSV, wiring.

Backend commands (run from repo root):
- Single test file: `npx jest --runInBand test/reports.service.spec.ts -t "<name>"`
- Full backend tests: `npm run test`

Frontend commands (run from `apps/web`):
- Typecheck + build: `npm run build`

---

## Task 1: Backend — `tasksLists()` service method + `GET /reports/lists`

**Files:**
- Modify: `src/reports/reports.service.ts` (add method after `tasksClients()`, ~line 123)
- Modify: `src/reports/reports.controller.ts` (add route after the `clients` route, ~line 27)
- Test: `test/reports.service.spec.ts` (add `describe('tasksLists', …)` after the existing `tasksClients` block, ~line 89)

- [ ] **Step 1: Write the failing tests**

Add this block immediately after the `describe('tasksClients', …)` block in `test/reports.service.spec.ts`:

```ts
  describe('tasksLists', () => {
    it('maps distinct list rows to { listId, listName, spaceName, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { list_id: 'L1', list_name: 'Backlog', space_name: 'Projects', task_count: BigInt(7) },
        { list_id: 'L2', list_name: 'Sprint 12', space_name: 'R&D Apps', task_count: BigInt(3) },
      ]);
      const result = await new ReportsService(prisma).tasksLists();
      expect(result).toEqual([
        { listId: 'L1', listName: 'Backlog', spaceName: 'Projects', taskCount: 7 },
        { listId: 'L2', listName: 'Sprint 12', spaceName: 'R&D Apps', taskCount: 3 },
      ]);
    });

    it('scopes by space_id when spaceId is given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).tasksLists('3577824');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/space_id\s*=/);
    });

    it('excludes soft-deleted tasks and empty lists in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).tasksLists();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/list_name\s*<>\s*''/);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "tasksLists"`
Expected: FAIL — `tasksLists is not a function` (method doesn't exist yet).

- [ ] **Step 3: Implement `tasksLists()`**

In `src/reports/reports.service.ts`, add this method directly after `tasksClients()` (after its closing `}` near line 123):

```ts
  async tasksLists(spaceId?: string) {
    type Row = { list_id: string; list_name: string; space_name: string | null; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT list_id, list_name, MAX(space_name) AS space_name, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND list_id IS NOT NULL
        AND list_name <> ''
        ${spaceId ? Prisma.sql`AND space_id = ${spaceId}` : Prisma.empty}
      GROUP BY list_id, list_name
      ORDER BY MAX(space_name) ASC, list_name ASC
    `);
    return rows.map((r) => ({
      listId: r.list_id,
      listName: r.list_name,
      spaceName: r.space_name,
      taskCount: Number(r.task_count),
    }));
  }
```

Note: `Prisma` is already imported at the top of the file (`import { Prisma } from '@prisma/client';`). `MAX(space_name)` collapses old rows with a NULL `space_name`, matching the `tasksSummary` bySpace pattern.

- [ ] **Step 4: Add the controller route**

In `src/reports/reports.controller.ts`, add this directly after the `tasksClients()` route (after line 27):

```ts
  @Get('lists')
  @ApiOperation({ summary: 'Distinct ClickUp lists for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks (list_id/list_name, non-empty, non-deleted) with per-list task counts. Pass spaceId to scope to one space.' })
  tasksLists(@Query('spaceId') spaceId?: string) { return this.reports.tasksLists(spaceId); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "tasksLists"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): add /reports/lists endpoint for List filter dropdowns"
```

---

## Task 2: Backend — `listId` filter on `tasks()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`tasks()` signature ~line 125-139, where-clause ~line 158)
- Modify: `src/reports/reports.controller.ts` (`tasks` route ~line 31-47)
- Test: `test/reports.service.spec.ts` (add after `describe('tasks (client filter)', …)`, ~line 108)

- [ ] **Step 1: Write the failing test**

Add this block after the `describe('tasks (client filter)', …)` block:

```ts
  describe('tasks (list filter)', () => {
    it('adds an exact listId equality to the where clause when listId is given', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toBe('L1');
    });

    it('omits the listId clause when listId is undefined', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "tasks \(list filter\)"`
Expected: FAIL — `arg.where.listId` is `undefined` when `'L1'` was expected (the 14th positional arg is currently ignored).

- [ ] **Step 3: Add the `listId` parameter and filter**

In `src/reports/reports.service.ts`, change the `tasks()` signature — add `listId?: string` as the **last** parameter (after `taskIds?: string,` on line 138):

```ts
    client?: string,
    taskIds?: string,
    listId?: string,
  ) {
```

Then add the filter. Directly after the existing `if (client) where.client = client;` (line 158), add:

```ts
    if (listId) where.listId = listId;
```

- [ ] **Step 4: Wire the controller**

In `src/reports/reports.controller.ts`, in the `tasks(...)` method, add a query param after `@Query('taskIds') taskIds?: string,` (line 44):

```ts
    @Query('taskIds') taskIds?: string,
    @Query('listId') listId?: string,
  ) {
    return this.reports.tasks(spaceId, status, search, from, to, Number(limit) || 50, Number(offset) || 0, priority, assigneeId, type, archived, client, taskIds, listId);
  }
```

(Append `, listId` to the existing `return this.reports.tasks(...)` call.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "tasks \(list filter\)"`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): filter tasks by listId"
```

---

## Task 3: Backend — `listId` filter + `listName` column on `timeEntriesList()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`timeEntriesList()` ~line 449-537)
- Modify: `src/reports/reports.controller.ts` (`timeEntriesList` route ~line 127-145)
- Test: `test/reports.service.spec.ts` (add after `describe('timeEntriesList (client filter + column)', …)`, ~line 773)

- [ ] **Step 1: Write the failing tests**

Add this block after the `describe('timeEntriesList (client filter + column)', …)` block:

```ts
  describe('timeEntriesList (list filter + column)', () => {
    it('filters by listId via the task relation in where.AND', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: 'L1' } });
    });

    it('selects the related task listName and maps it onto each row', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 't1', taskId: 'k1', userId: 'u1', userName: 'Alice', userEmail: 'a@x.com',
        startTime: new Date('2026-05-01T00:00:00Z'), endTime: null,
        durationHours: { toNumber: () => 2 }, hourlyRateCents: BigInt(15000),
        costCents: BigInt(30000), status: 'COST_CALCULATED', billable: true,
        description: null, syncedAt: new Date('2026-05-01T00:00:00Z'), rateId: null, currency: 'USD',
        task: { taskName: 'Build thing', client: 'Acme Corp', listName: 'Backlog' },
      }]);
      prisma.clickupTimeEntry.count.mockResolvedValue(1);
      const result = await new ReportsService(prisma).timeEntriesList();
      const selectArg = prisma.clickupTimeEntry.findMany.mock.calls[0][0].select;
      expect(selectArg.task.select.listName).toBe(true);
      expect(result.items[0].listName).toBe('Backlog');
    });

    it('maps listName to null when the entry has no task', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 't2', taskId: null, userId: 'u1', userName: 'Bob', userEmail: null,
        startTime: new Date('2026-05-01T00:00:00Z'), endTime: null,
        durationHours: { toNumber: () => 1 }, hourlyRateCents: BigInt(0),
        costCents: BigInt(0), status: 'SYNCED', billable: false,
        description: null, syncedAt: new Date('2026-05-01T00:00:00Z'), rateId: null, currency: 'USD',
        task: null,
      }]);
      prisma.clickupTimeEntry.count.mockResolvedValue(1);
      const result = await new ReportsService(prisma).timeEntriesList();
      expect(result.items[0].listName).toBeNull();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "timeEntriesList \(list filter"`
Expected: FAIL — the `{ task: { listId: 'L1' } }` clause is absent and `result.items[0].listName` is `undefined`.

- [ ] **Step 3: Add the `listId` parameter, filter, select, and mapping**

In `src/reports/reports.service.ts`, `timeEntriesList()`:

(a) Add `listId?: string` as the **last** parameter (after `client?: string,` on line 460):

```ts
    client?: string,
    listId?: string,
  ) {
```

(b) Add the relation filter directly after `if (client) and.push({ task: { client } });` (line 474):

```ts
    if (listId) and.push({ task: { listId } });
```

(c) Add `listName: true` to the task select. Change line 507 from:

```ts
          task: { select: { taskName: true, client: true } },
```

to:

```ts
          task: { select: { taskName: true, client: true, listName: true } },
```

(d) Add the mapping. Directly after `client: e.task?.client ?? null,` (line 517):

```ts
        listName: e.task?.listName ?? null,
```

- [ ] **Step 4: Wire the controller**

In `src/reports/reports.controller.ts`, `timeEntriesList(...)` method, add a param after `@Query('client') client?: string,` (line 140):

```ts
    @Query('client') client?: string,
    @Query('listId') listId?: string,
  ) {
    return this.reports.timeEntriesList(
      userId, from, to, status, Number(limit) || 50, Number(offset) || 0, billable, search, spaceId, missingOnly, client, listId,
    );
  }
```

(Append `, listId` to the existing `return this.reports.timeEntriesList(...)` arguments.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "timeEntriesList \(list filter"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): filter time entries by listId and expose list name"
```

---

## Task 4: Backend — `listId` filter on `timeEntriesAggregates()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`timeEntriesAggregates()` ~line 361-402)
- Modify: `src/reports/reports.controller.ts` (`timeEntriesAggregates` route ~line 79-93)
- Test: `test/reports.service.spec.ts` (add after `describe('timeEntriesAggregates (client filter)', …)`, ~line 785)

- [ ] **Step 1: Write the failing test**

Add this block after the `describe('timeEntriesAggregates (client filter)', …)` block (the last describe before the file's closing `});`):

```ts
  describe('timeEntriesAggregates (list filter)', () => {
    it('filters aggregates by listId via the task relation', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: 'L1' } });
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "timeEntriesAggregates \(list filter\)"`
Expected: FAIL — `{ task: { listId: 'L1' } }` is not present in `where.AND` (the 10th positional arg is ignored).

- [ ] **Step 3: Add the `listId` parameter and filter**

In `src/reports/reports.service.ts`, `timeEntriesAggregates()`:

(a) Add `listId?: string` as the **last** parameter (after `client?: string,` on line 370):

```ts
    client?: string,
    listId?: string,
  ) {
```

(b) Add the relation filter directly after `if (client) and.push({ task: { client } });` (line 381):

```ts
    if (listId) and.push({ task: { listId } });
```

- [ ] **Step 4: Wire the controller**

In `src/reports/reports.controller.ts`, `timeEntriesAggregates(...)` method, add a param after `@Query('client') client?: string,` (line 90):

```ts
    @Query('client') client?: string,
    @Query('listId') listId?: string,
  ) {
    return this.reports.timeEntriesAggregates(userId, from, to, status, billable, search, spaceId, missingOnly, client, listId);
  }
```

(Append `, listId` to the existing `return this.reports.timeEntriesAggregates(...)` call.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "timeEntriesAggregates \(list filter\)"`
Expected: PASS.

- [ ] **Step 6: Run the full backend test suite + build**

Run: `npm run test`
Expected: PASS (all suites green).

Run: `npm run build`
Expected: clean compile (no TS errors).

- [ ] **Step 7: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): honor listId filter in time-entry aggregates"
```

---

## Task 5: Frontend — `lists()` API call + `useLists()` hook + `TimeEntryItem.listName`

**Files:**
- Modify: `apps/web/src/api/reports.ts` (after `clients:`, ~line 9)
- Modify: `apps/web/src/hooks/useReports.ts` (after `useClients`, ~line 23)
- Modify: `apps/web/src/components/TimeEntryDrawer.tsx` (`TimeEntryItem` interface, ~line 10-15)

- [ ] **Step 1: Add the API call**

In `apps/web/src/api/reports.ts`, add directly after the `clients:` line (line 9):

```ts
  lists: (params?: { spaceId?: string }) =>
    apiClient.get('/reports/lists', { params }).then(r => r.data),
```

- [ ] **Step 2: Add the `useLists` hook**

In `apps/web/src/hooks/useReports.ts`, add directly after the `useClients` function (after line 23):

```ts
export function useLists(spaceId?: string) {
  return useQuery({
    queryKey: ['lists', spaceId ?? 'all'],
    queryFn: () => reportsApi.lists(spaceId ? { spaceId } : undefined),
  });
}
```

- [ ] **Step 3: Extend the `TimeEntryItem` interface**

In `apps/web/src/components/TimeEntryDrawer.tsx`, add `listName` next to the existing `client` field (after line 15, `client?: string | null;`):

```ts
  listName?: string | null;
```

- [ ] **Step 4: Typecheck**

Run (from `apps/web`): `npm run build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts apps/web/src/components/TimeEntryDrawer.tsx
git commit -m "feat(web): add lists API, useLists hook, TimeEntryItem.listName"
```

---

## Task 6: Frontend — List filter on TasksPage

**Files:**
- Modify: `apps/web/src/pages/TasksPage.tsx`

- [ ] **Step 1: Import `useLists`**

Change the hooks import (line 8) from:

```ts
import { useTasks, useTasksAssignees, useTasksSummary, useClients } from '../hooks/useReports';
```

to:

```ts
import { useTasks, useTasksAssignees, useTasksSummary, useClients, useLists } from '../hooks/useReports';
```

- [ ] **Step 2: Load lists scoped to the selected space**

Directly after `const { data: clientsData } = useClients();` (line 236), add:

```ts
  const { data: listsData } = useLists(space !== 'all' ? space : undefined);
```

(`space` is already destructured from `useGlobalFilters()` on line 232.)

- [ ] **Step 3: Add `listFilter` state**

Directly after `const [clientFilter, setClientFilter] = useState('');` (line 246), add:

```ts
  const [listFilter, setListFilter] = useState('');
```

- [ ] **Step 4: Reset the list filter when the space changes**

A list belongs to one space, so a selection from the previous space is meaningless after switching. Add this effect directly after the search-debounce effect (after line 280):

```ts
  // A ClickUp list belongs to a single space, so a selection made under one
  // space is meaningless after the topbar space changes — clear it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListFilter('');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [space]);
```

- [ ] **Step 5: Build the `listOptions` memo**

Directly after the `clientOptions` memo (after line 308), add:

```ts
  const listOptions = useMemo(() => {
    const rows = (Array.isArray(listsData) ? listsData : []) as { listId: string; listName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts = [{ value: '', label: 'Any list' }];
    for (const r of rows) {
      if (!r.listId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.listName}${count}` : `${r.listName}${count}`;
      opts.push({ value: r.listId, label });
    }
    return opts;
  }, [listsData, space]);
```

- [ ] **Step 6: Pass `listId` to the query**

In the `taskParams` memo, add `listId` after the `client` line (after line 340, `client: clientFilter || undefined,`):

```ts
    listId: listFilter || undefined,
```

Then add `listFilter` to the memo's dependency array (line 346) — insert it after `clientFilter,`:

```ts
  }), [page, pageSize, isDeepLink, space, statusFilter, priorityFilter, typeFilter, search, assigneeFilter, clientFilter, listFilter, archivedFilter, taskIdsFilter, fromDate, toDate]);
```

- [ ] **Step 7: Include `listFilter` in `hasFilters` and `reset()`**

Change `hasFilters` (line 356-358) to add `|| listFilter`:

```ts
  const hasFilters = !!(
    searchRaw || search || statusFilter || priorityFilter || typeFilter || assigneeFilter || clientFilter || listFilter || archivedFilter !== 'exclude' || taskIdsFilter.length > 0
  );
```

In `reset()`, add after `setClientFilter('');` (line 367):

```ts
    setListFilter('');
```

- [ ] **Step 8: Add the `<Select>` to the filter bar**

Directly after the client `<Select>` (line 669), add:

```tsx
        <Select size="md" value={listFilter} onChange={v => { setListFilter(v); setPage(1); }} options={listOptions} />
```

- [ ] **Step 9: Typecheck + build**

Run (from `apps/web`): `npm run build`
Expected: clean compile.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/TasksPage.tsx
git commit -m "feat(web): add ClickUp List filter to Tasks page"
```

---

## Task 7: Frontend — List filter + column on TimeEntriesPage

**Files:**
- Modify: `apps/web/src/pages/TimeEntriesPage.tsx`

- [ ] **Step 1: Import `useLists`**

Change the hooks import (line 8) from:

```ts
import { useTimeEntriesList, useTimeEntriesByUser, useTimeEntriesAggregates, useClients } from '../hooks/useReports';
```

to:

```ts
import { useTimeEntriesList, useTimeEntriesByUser, useTimeEntriesAggregates, useClients, useLists } from '../hooks/useReports';
```

- [ ] **Step 2: Load lists scoped to the selected space**

Directly after `const { data: clientsData } = useClients();` (line 47), add:

```ts
  const { data: listsData } = useLists(space !== 'all' ? space : undefined);
```

(`space` is already destructured from `useGlobalFilters()` on line 45.)

- [ ] **Step 3: Add `listFilter` state**

Directly after `const [clientFilter, setClientFilter] = useState('');` (line 59), add:

```ts
  const [listFilter, setListFilter] = useState('');
```

- [ ] **Step 4: Reset the list filter when the space changes**

Add this effect directly after the `missingOnly` effect (after line 150):

```ts
  // A ClickUp list belongs to a single space — clear the selection when the
  // topbar space changes so a stale list ID doesn't filter to zero rows.
  useEffect(() => {
    setListFilter('');
    setPage(1);
  }, [space]);
```

- [ ] **Step 5: Build the `listOptions` memo**

Directly after the `clientOptions` memo (after line 173), add:

```ts
  const listOptions = useMemo(() => {
    const rows = (Array.isArray(listsData) ? listsData : []) as { listId: string; listName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts = [{ value: '', label: 'Any list' }];
    for (const r of rows) {
      if (!r.listId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.listName}${count}` : `${r.listName}${count}`;
      opts.push({ value: r.listId, label });
    }
    return opts;
  }, [listsData, space]);
```

- [ ] **Step 6: Pass `listId` to the query**

In the `params` memo, add `listId` after the `client` line (after line 180, `client: clientFilter || undefined,`):

```ts
    listId: listFilter || undefined,
```

Then add `listFilter` to the memo's dependency array (line 189) — insert it after `clientFilter,`:

```ts
  }), [pageSize, page, search, userId, clientFilter, listFilter, billable, status, missingOnly, deepLinkActive, space, fromDate, toDate]);
```

(The `aggParams` memo strips only `limit`/`offset`, so `listId` flows into the aggregates query automatically — no change needed there.)

- [ ] **Step 7: Add the List CSV column**

In the `exportCsv` columns array, add directly after the Client column (after line 204, `{ header: 'Client', value: 'client' },`):

```ts
        { header: 'List',          value: 'listName' },
```

- [ ] **Step 8: Add the List table column**

In the `columns` memo, add a new column object directly after the `client` column block (after its closing `},` on line 305):

```tsx
    {
      key: 'listName',
      header: 'List',
      width: 140,
      render: (row) => (
        row.listName
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.listName}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>
      ),
    },
```

- [ ] **Step 9: Include `listFilter` in `hasFilters` and `reset()`**

Change `hasFilters` (line 244-246) to add `|| listFilter`:

```ts
  const hasFilters = !!(
    search || userId || clientFilter || listFilter || billable || status || missingOnly
  );
```

In `reset()`, add after `setClientFilter('');` (line 251):

```ts
    setListFilter('');
```

- [ ] **Step 10: Add the `<Select>` to the filter bar**

Directly after the client `<Select>` (line 513), add:

```tsx
        <Select size="md" options={listOptions} value={listFilter} onChange={(v) => { setListFilter(v); setPage(1); }} />
```

- [ ] **Step 11: Typecheck + build**

Run (from `apps/web`): `npm run build`
Expected: clean compile.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/pages/TimeEntriesPage.tsx
git commit -m "feat(web): add ClickUp List filter and column to Time Entries page"
```

---

## Final verification

- [ ] **Backend:** from repo root, `npm run test` and `npm run build` both pass.
- [ ] **Frontend:** from `apps/web`, `npm run build` passes.
- [ ] **Manual (optional):** start the app and confirm on both pages that (a) the List dropdown lists only the selected space's lists, (b) selecting a list narrows the table and (on Time Entries) the metric cards, (c) "All spaces" prefixes each option with its space name, (d) switching the topbar Space clears the list selection, and (e) Reset clears it. See the `web-visual-verification-setup` memory for the screenshot harness.

## Notes on scope

- No Prisma schema change: `listId`/`listName` already exist on `clickup_tasks`.
- No new index is added; `listId` equality filtering rides the existing query patterns (same as the `client` filter). Add an index later only if the `clickup_tasks(list_id)` / time-entry join shows up as slow at real data volume.

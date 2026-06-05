# ClickUp Folder Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-select ClickUp **Folder** filter to the Tasks and Time Entries pages, scoped to the selected Space, filtering independently of the List filter.

**Architecture:** A new `GET /reports/folders` endpoint returns distinct folders (optionally space-scoped) for the dropdowns. The `tasks()`, `timeEntriesList()`, and `timeEntriesAggregates()` service methods gain a `folderId` filter. The frontend adds a `useFolders(spaceId)` hook and a `<Select>` on each page, placed before the List select. This is a near-exact mirror of the already-merged List filter — no table column, CSV change, or schema change.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL (raw SQL via `Prisma.sql`), Jest/ts-jest (backend); React + Vite + @tanstack/react-query (web).

**Spec:** `docs/superpowers/specs/2026-06-05-folder-filter-design.md`

**Conventions:** This repo omits the `Co-Authored-By: Claude` commit trailer. `npm run lint` is broken (no root ESLint config) — do **not** gate on it; use `npm run test` and `npm run build`.

**Pre-existing working-tree state:** The working tree contains UNRELATED uncommitted WIP (webhooks, Settings, Overview, etc.). Do NOT touch or revert it. When committing, `git add` ONLY the specific files named per task; committing the whole of those files is fine.

---

## File Structure

- `src/reports/reports.service.ts` — add `tasksFolders()`; add `folderId` to `tasks()`, `timeEntriesList()`, `timeEntriesAggregates()`.
- `src/reports/reports.controller.ts` — add `GET /reports/folders`; add `@Query('folderId')` to `tasks`, `time-entries`, `time-entries/aggregates`.
- `test/reports.service.spec.ts` — tests for the new behavior.
- `apps/web/src/api/reports.ts` — add `folders()`.
- `apps/web/src/hooks/useReports.ts` — add `useFolders()`.
- `apps/web/src/pages/TasksPage.tsx` — Folder `<Select>`, wiring.
- `apps/web/src/pages/TimeEntriesPage.tsx` — Folder `<Select>`, wiring.

Backend commands (repo root):
- Single test file: `npx jest --runInBand test/reports.service.spec.ts -t "<name>"`
- Full backend tests: `npm run test`

Frontend commands (`apps/web`):
- Typecheck + build: `npm run build`

Line numbers below are current as of writing; if they have shifted, locate the anchor code by content (each step names the adjacent `listId`/`listFilter` line to anchor against).

---

## Task 1: Backend — `tasksFolders()` service method + `GET /reports/folders`

**Files:**
- Modify: `src/reports/reports.service.ts` (add method after `tasksLists()`, which ends ~line 143)
- Modify: `src/reports/reports.controller.ts` (add route after the `tasksLists` route at line 29-31)
- Test: `test/reports.service.spec.ts` (add `describe('tasksFolders', …)` after the existing `describe('tasksLists', …)` block)

- [ ] **Step 1: Write the failing tests**

Add this block immediately after the existing `describe('tasksLists', …)` block in `test/reports.service.spec.ts`:

```ts
  describe('tasksFolders', () => {
    it('maps distinct folder rows to { folderId, folderName, spaceName, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { folder_id: 'F1', folder_name: 'Q3 Campaigns', space_name: 'Digital Marketing', task_count: BigInt(9) },
        { folder_id: 'F2', folder_name: 'Internal', space_name: 'R&D Apps', task_count: BigInt(4) },
      ]);
      const result = await new ReportsService(prisma).tasksFolders();
      expect(result).toEqual([
        { folderId: 'F1', folderName: 'Q3 Campaigns', spaceName: 'Digital Marketing', taskCount: 9 },
        { folderId: 'F2', folderName: 'Internal', spaceName: 'R&D Apps', taskCount: 4 },
      ]);
    });

    it('scopes by space_id when spaceId is given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).tasksFolders('3577824');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/space_id\s*=/);
    });

    it('excludes soft-deleted tasks, null folders, and empty folder names in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).tasksFolders();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/folder_id\s+IS\s+NOT\s+NULL/i);
      expect(sqlText).toMatch(/folder_name\s*<>\s*''/);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "tasksFolders"`
Expected: FAIL — `tasksFolders is not a function`.

- [ ] **Step 3: Implement `tasksFolders()`**

In `src/reports/reports.service.ts`, add this method directly after the `tasksLists()` method's closing brace (`tasksLists` starts at line 125). `Prisma` is already imported at the top.

```ts
  async tasksFolders(spaceId?: string) {
    type Row = { folder_id: string; folder_name: string; space_name: string | null; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT folder_id, folder_name, MAX(space_name) AS space_name, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND folder_id IS NOT NULL
        AND folder_name <> ''
        ${spaceId ? Prisma.sql`AND space_id = ${spaceId}` : Prisma.empty}
      GROUP BY folder_id, folder_name
      ORDER BY MAX(space_name) ASC, folder_name ASC
    `);
    return rows.map((r) => ({
      folderId: r.folder_id,
      folderName: r.folder_name,
      spaceName: r.space_name,
      taskCount: Number(r.task_count),
    }));
  }
```

- [ ] **Step 4: Add the controller route**

In `src/reports/reports.controller.ts`, add this directly after the `tasksLists()` route (line 29-31, the one decorated `@Get('lists')`):

```ts
  @Get('folders')
  @ApiOperation({ summary: 'Distinct ClickUp folders for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks (folder_id/folder_name, non-empty, non-deleted) with per-folder task counts. Pass spaceId to scope to one space.' })
  tasksFolders(@Query('spaceId') spaceId?: string) { return this.reports.tasksFolders(spaceId); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "tasksFolders"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): add /reports/folders endpoint for Folder filter dropdowns"
```

---

## Task 2: Backend — `folderId` filter on `tasks()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`tasks()` signature ~line 145-160, where-clause after line 180)
- Modify: `src/reports/reports.controller.ts` (`tasks` route ~line 33-52)
- Test: `test/reports.service.spec.ts` (add after the existing `describe('tasks (list filter)', …)` block)

- [ ] **Step 1: Write the failing test**

Add this block after the existing `describe('tasks (list filter)', …)` block:

```ts
  describe('tasks (folder filter)', () => {
    it('adds an exact folderId equality to the where clause when folderId is given', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toBe('F1');
    });

    it('omits the folderId clause when folderId is undefined', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "tasks \(folder filter\)"`
Expected: FAIL — `arg.where.folderId` is `undefined` when `'F1'` was expected (the 15th positional arg is currently ignored).

- [ ] **Step 3: Add the `folderId` parameter and filter**

In `src/reports/reports.service.ts`, the `tasks()` parameter list currently ends with `listId?: string,` (line 159). Add `folderId?: string,` as the LAST parameter:

```ts
    taskIds?: string,
    listId?: string,
    folderId?: string,
  ) {
```

Then add the filter directly after the existing `if (listId) where.listId = listId;` (line 180):

```ts
    if (folderId) where.folderId = folderId;
```

- [ ] **Step 4: Wire the controller**

In `src/reports/reports.controller.ts`, in the `tasks(...)` method, add a query param after `@Query('listId') listId?: string,` (line 49):

```ts
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
  ) {
```

And append `, folderId` to the END of the existing `return this.reports.tasks(...)` call (line 51), so it ends `…, client, taskIds, listId, folderId);`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "tasks \(folder filter\)"`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): filter tasks by folderId"
```

---

## Task 3: Backend — `folderId` filter on `timeEntriesList()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`timeEntriesList()` ~line 473-500)
- Modify: `src/reports/reports.controller.ts` (`timeEntriesList` route ~line 133-151)
- Test: `test/reports.service.spec.ts` (add after the existing `describe('timeEntriesList (list filter + column)', …)` block)

- [ ] **Step 1: Write the failing test**

Add this block after the existing `describe('timeEntriesList (list filter + column)', …)` block:

```ts
  describe('timeEntriesList (folder filter)', () => {
    it('filters by folderId via the task relation in where.AND', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: 'F1' } });
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "timeEntriesList \(folder filter\)"`
Expected: FAIL — `{ task: { folderId: 'F1' } }` is absent from `where.AND` (the 13th positional arg is ignored).

- [ ] **Step 3: Add the `folderId` parameter and filter**

In `src/reports/reports.service.ts`, `timeEntriesList()`'s parameter list currently ends with `listId?: string,` (line 485). Add `folderId?: string,` as the LAST parameter:

```ts
    client?: string,
    listId?: string,
    folderId?: string,
  ) {
```

Then add the relation filter directly after `if (listId) and.push({ task: { listId } });` (line 500):

```ts
    if (folderId) and.push({ task: { folderId } });
```

(No select/mapping change — there is no Folder column.)

NOTE: an identical `if (listId) and.push(...)` line exists in `timeEntriesAggregates` (line 405). Make sure you add the `folderId` line inside `timeEntriesList` (the one near line 500, which is followed by the `findMany` select), not the aggregates one.

- [ ] **Step 4: Wire the controller**

In `src/reports/reports.controller.ts`, `timeEntriesList(...)` method, add a param after `@Query('listId') listId?: string,` (line 147):

```ts
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
  ) {
```

And add `folderId` as the final argument to the `this.reports.timeEntriesList(...)` call (line 149-151), so the argument list ends `…, missingOnly, client, listId, folderId,`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "timeEntriesList \(folder filter\)"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): filter time entries by folderId"
```

---

## Task 4: Backend — `folderId` filter on `timeEntriesAggregates()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`timeEntriesAggregates()` ~line 383-405)
- Modify: `src/reports/reports.controller.ts` (`timeEntriesAggregates` route ~line 84-99)
- Test: `test/reports.service.spec.ts` (add after the existing `describe('timeEntriesAggregates (list filter)', …)` block)

- [ ] **Step 1: Write the failing test**

Add this block after the existing `describe('timeEntriesAggregates (list filter)', …)` block:

```ts
  describe('timeEntriesAggregates (folder filter)', () => {
    it('filters aggregates by folderId via the task relation', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: 'F1' } });
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "timeEntriesAggregates \(folder filter\)"`
Expected: FAIL — `{ task: { folderId: 'F1' } }` not present (the 11th positional arg is ignored).

- [ ] **Step 3: Add the `folderId` parameter and filter**

In `src/reports/reports.service.ts`, `timeEntriesAggregates()`'s parameter list currently ends with `listId?: string,` (line 393). Add `folderId?: string,` as the LAST parameter:

```ts
    client?: string,
    listId?: string,
    folderId?: string,
  ) {
```

Then add the relation filter directly after `if (listId) and.push({ task: { listId } });` (line 405, the one inside `timeEntriesAggregates`):

```ts
    if (folderId) and.push({ task: { folderId } });
```

- [ ] **Step 4: Wire the controller**

In `src/reports/reports.controller.ts`, `timeEntriesAggregates(...)` method, add a param after `@Query('listId') listId?: string,` (line 96):

```ts
    @Query('listId') listId?: string,
    @Query('folderId') folderId?: string,
  ) {
```

And append `, folderId` to the END of the `this.reports.timeEntriesAggregates(...)` call (line 98), so it ends `…, missingOnly, client, listId, folderId);`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest --runInBand test/reports.service.spec.ts -t "timeEntriesAggregates \(folder filter\)"`
Expected: PASS.

- [ ] **Step 6: Run the full backend test suite + build**

Run: `npm run test`
Expected: all suites PASS.

Run: `npm run build`
Expected: clean compile, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): honor folderId filter in time-entry aggregates"
```

---

## Task 5: Frontend — `folders()` API call + `useFolders()` hook

**Files:**
- Modify: `apps/web/src/api/reports.ts` (after the `lists:` entry)
- Modify: `apps/web/src/hooks/useReports.ts` (after `useLists`)

- [ ] **Step 1: Add the API call**

In `apps/web/src/api/reports.ts`, find the existing `lists:` entry:

```ts
  lists: (params?: { spaceId?: string }) =>
    apiClient.get('/reports/lists', { params }).then(r => r.data),
```

Add directly after it:

```ts
  folders: (params?: { spaceId?: string }) =>
    apiClient.get('/reports/folders', { params }).then(r => r.data),
```

- [ ] **Step 2: Add the `useFolders` hook**

In `apps/web/src/hooks/useReports.ts`, find the existing `useLists` function:

```ts
export function useLists(spaceId?: string) {
  return useQuery({
    queryKey: ['lists', spaceId ?? 'all'],
    queryFn: () => reportsApi.lists(spaceId ? { spaceId } : undefined),
  });
}
```

Add directly after it:

```ts
export function useFolders(spaceId?: string) {
  return useQuery({
    queryKey: ['folders', spaceId ?? 'all'],
    queryFn: () => reportsApi.folders(spaceId ? { spaceId } : undefined),
  });
}
```

- [ ] **Step 3: Typecheck**

Run (from `apps/web`): `npm run build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): add folders API and useFolders hook"
```

---

## Task 6: Frontend — Folder filter on TasksPage

**Files:**
- Modify: `apps/web/src/pages/TasksPage.tsx`

- [ ] **Step 1: Import `useFolders`**

The hooks import (line 8) currently is:

```ts
import { useTasks, useTasksAssignees, useTasksSummary, useClients, useLists } from '../hooks/useReports';
```

Change it to add `useFolders`:

```ts
import { useTasks, useTasksAssignees, useTasksSummary, useClients, useLists, useFolders } from '../hooks/useReports';
```

- [ ] **Step 2: Load folders scoped to the selected space**

Find `const { data: listsData } = useLists(space !== 'all' ? space : undefined);` (line 237). Add directly after it:

```ts
  const { data: foldersData } = useFolders(space !== 'all' ? space : undefined);
```

- [ ] **Step 3: Add `folderFilter` state**

Find `const [listFilter, setListFilter] = useState('');` (line 248). Add directly after it:

```ts
  const [folderFilter, setFolderFilter] = useState('');
```

- [ ] **Step 4: Clear `folderFilter` on space change**

There is an existing effect that clears `listFilter` and resets the page on `[space]`. It currently reads:

```ts
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListFilter('');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [space]);
```

Add a `setFolderFilter('')` line inside it, directly after the `setListFilter('');` line:

```ts
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListFilter('');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolderFilter('');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [space]);
```

- [ ] **Step 5: Build the `folderOptions` memo**

Find the existing `listOptions` memo (starts line 321). Add directly after its closing `}, [listsData, space]);`:

```ts
  const folderOptions = useMemo(() => {
    const rows = (Array.isArray(foldersData) ? foldersData : []) as { folderId: string; folderName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts = [{ value: '', label: 'Any folder' }];
    for (const r of rows) {
      if (!r.folderId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.folderName}${count}` : `${r.folderName}${count}`;
      opts.push({ value: r.folderId, label });
    }
    return opts;
  }, [foldersData, space]);
```

- [ ] **Step 6: Pass `folderId` to the query**

In the `taskParams` memo, find `listId: listFilter || undefined,` (line 365). Add directly after it:

```ts
    folderId: folderFilter || undefined,
```

Then add `folderFilter` to that memo's dependency array (line 371) — insert it right after `listFilter,`:

```ts
  }), [page, pageSize, isDeepLink, space, statusFilter, priorityFilter, typeFilter, search, assigneeFilter, clientFilter, listFilter, folderFilter, archivedFilter, taskIdsFilter, fromDate, toDate]);
```

- [ ] **Step 7: Include `folderFilter` in `hasFilters` and `reset()`**

Change the `hasFilters` expression (line 382) to add `|| folderFilter` right after the `listFilter` term:

```ts
    searchRaw || search || statusFilter || priorityFilter || typeFilter || assigneeFilter || clientFilter || listFilter || folderFilter || archivedFilter !== 'exclude' || taskIdsFilter.length > 0
```

In `reset()`, find `setListFilter('');` (line 393) and add directly after it:

```ts
    setFolderFilter('');
```

- [ ] **Step 8: Add the `<Select>` to the filter bar (before the List select)**

Find the List `<Select>` (line 696):

```tsx
        <Select size="md" value={listFilter} onChange={v => { setListFilter(v); setPage(1); }} options={listOptions} />
```

Add a Folder `<Select>` directly BEFORE it:

```tsx
        <Select size="md" value={folderFilter} onChange={v => { setFolderFilter(v); setPage(1); }} options={folderOptions} />
```

- [ ] **Step 9: Typecheck + build**

Run (from `apps/web`): `npm run build`
Expected: clean compile.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/TasksPage.tsx
git commit -m "feat(web): add ClickUp Folder filter to Tasks page"
```

---

## Task 7: Frontend — Folder filter on TimeEntriesPage

**Files:**
- Modify: `apps/web/src/pages/TimeEntriesPage.tsx`

- [ ] **Step 1: Import `useFolders`**

The hooks import (line 8) currently is:

```ts
import { useTimeEntriesList, useTimeEntriesByUser, useTimeEntriesAggregates, useClients, useLists } from '../hooks/useReports';
```

Change it to add `useFolders`:

```ts
import { useTimeEntriesList, useTimeEntriesByUser, useTimeEntriesAggregates, useClients, useLists, useFolders } from '../hooks/useReports';
```

- [ ] **Step 2: Load folders scoped to the selected space**

Find `const { data: listsData } = useLists(space !== 'all' ? space : undefined);` (line 48). Add directly after it:

```ts
  const { data: foldersData } = useFolders(space !== 'all' ? space : undefined);
```

- [ ] **Step 3: Add `folderFilter` state**

Find `const [listFilter, setListFilter] = useState('');` (line 61). Add directly after it:

```ts
  const [folderFilter, setFolderFilter] = useState('');
```

- [ ] **Step 4: Clear `folderFilter` on space change**

There is an existing effect that clears `listFilter` and resets the page on `[space]`. It currently reads:

```ts
  useEffect(() => {
    setListFilter('');
    setPage(1);
  }, [space]);
```

Add a `setFolderFilter('')` line inside it, directly after `setListFilter('');`:

```ts
  useEffect(() => {
    setListFilter('');
    setFolderFilter('');
    setPage(1);
  }, [space]);
```

- [ ] **Step 5: Build the `folderOptions` memo**

Find the existing `listOptions` memo (starts line 184). Add directly after its closing `}, [listsData, space]);`:

```ts
  const folderOptions = useMemo(() => {
    const rows = (Array.isArray(foldersData) ? foldersData : []) as { folderId: string; folderName: string; spaceName?: string | null; taskCount?: number }[];
    const showSpace = space === 'all';
    const opts = [{ value: '', label: 'Any folder' }];
    for (const r of rows) {
      if (!r.folderId) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      const label = showSpace && r.spaceName ? `${r.spaceName} · ${r.folderName}${count}` : `${r.folderName}${count}`;
      opts.push({ value: r.folderId, label });
    }
    return opts;
  }, [foldersData, space]);
```

- [ ] **Step 6: Pass `folderId` to the query**

In the `params` memo, find `listId: listFilter || undefined,` (line 203). Add directly after it:

```ts
    folderId: folderFilter || undefined,
```

Then add `folderFilter` to that memo's dependency array (line 212) — insert it right after `listFilter,`:

```ts
  }), [pageSize, page, search, userId, clientFilter, listFilter, folderFilter, billable, status, missingOnly, deepLinkActive, space, fromDate, toDate]);
```

(The `aggParams` derivation strips only `limit`/`offset`, so `folderId` flows into the aggregates query automatically — no change there.)

- [ ] **Step 7: Include `folderFilter` in `hasFilters` and `reset()`**

Change the `hasFilters` expression (line 269) to add `|| folderFilter` right after the `listFilter` term:

```ts
    search || userId || clientFilter || listFilter || folderFilter || billable || status || missingOnly
```

In `reset()`, find `setListFilter('');` (line 277) and add directly after it:

```ts
    setFolderFilter('');
```

- [ ] **Step 8: Add the `<Select>` to the filter bar (before the List select)**

Find the List `<Select>` (line 549):

```tsx
        <Select size="md" options={listOptions} value={listFilter} onChange={(v) => { setListFilter(v); setPage(1); }} />
```

Add a Folder `<Select>` directly BEFORE it:

```tsx
        <Select size="md" options={folderOptions} value={folderFilter} onChange={(v) => { setFolderFilter(v); setPage(1); }} />
```

- [ ] **Step 9: Typecheck + build**

Run (from `apps/web`): `npm run build`
Expected: clean compile.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/TimeEntriesPage.tsx
git commit -m "feat(web): add ClickUp Folder filter to Time Entries page"
```

---

## Final verification

- [ ] **Backend:** from repo root, `npm run test` and `npm run build` both pass.
- [ ] **Frontend:** from `apps/web`, `npm run build` passes.
- [ ] **Manual (optional):** on both pages confirm (a) the Folder dropdown lists only the selected space's folders, (b) selecting a folder narrows the table and (on Time Entries) the metric cards, (c) "All spaces" prefixes each option with its space name, (d) switching the topbar Space clears both the folder and list selections, (e) Folder and List can be combined, and (f) Reset clears the folder selection. See the `web-visual-verification-setup` memory for the screenshot harness.

## Notes on scope

- No Prisma schema change: `folderId`/`folderName` already exist on `clickup_tasks` and are populated by the normalizer.
- No table column or CSV field is added (filter-only, per the spec).
- No cascade between Folder and List — they are independent AND filters.

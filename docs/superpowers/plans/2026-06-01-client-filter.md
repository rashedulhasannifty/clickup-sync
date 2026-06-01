# Client Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-select Client filter to the Tasks and Time Entries pages, plus a visible Client column (table + CSV) on Time Entries, backed by a shared `/reports/clients` endpoint.

**Architecture:** Backend adds one distinct-clients endpoint and threads an optional `client` param through `tasks()`, `timeEntriesList()`, and `timeEntriesAggregates()` in `ReportsService` (filtering `clickup_tasks.client` directly for tasks, and via the existing `task` relation for time entries). Frontend adds a `useClients()` hook and a `<Select>` to each page's filter bar, plus a Client column to the Time Entries table/CSV.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL, Jest; React + TanStack Query (Vite) in `apps/web`.

**Spec:** `docs/superpowers/specs/2026-06-01-client-filter-design.md`

**Conventions:**
- Run backend tests with `npm run test` (Jest, `--runInBand`). Target one file with `npm run test -- reports.service` or a single test with `-t "<name>"`.
- Commit messages: do NOT add a `Co-Authored-By: Claude` trailer (project preference).
- Preserve Prettier formatting.

---

### Task 1: Backend — `tasksClients()` service method + `/reports/clients` endpoint

**Files:**
- Modify: `src/reports/reports.service.ts` (add method after `tasksAssignees()`, ends line 109)
- Modify: `src/reports/reports.controller.ts` (add endpoint after `tasksAssignees`, line 23)
- Test: `test/reports.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block inside the top-level `describe('ReportsService', ...)` in `test/reports.service.spec.ts` (e.g. after the `tasksBySpaceStatus` block):

```ts
  describe('tasksClients', () => {
    it('maps distinct client rows to { client, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { client: 'Acme Corp', task_count: BigInt(12) },
        { client: 'Globex', task_count: BigInt(3) },
      ]);
      const result = await new ReportsService(prisma).tasksClients();
      expect(result).toEqual([
        { client: 'Acme Corp', taskCount: 12 },
        { client: 'Globex', taskCount: 3 },
      ]);
    });

    it('excludes soft-deleted tasks and empty clients in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).tasksClients();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/client\s*<>\s*''/);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- reports.service -t "tasksClients"`
Expected: FAIL — `new ReportsService(prisma).tasksClients is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/reports/reports.service.ts`, add this method immediately after `tasksAssignees()` closes (after line 109):

```ts
  async tasksClients() {
    type Row = { client: string; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT client, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND client IS NOT NULL
        AND client <> ''
      GROUP BY client
      ORDER BY client ASC
    `);
    return rows.map((r) => ({ client: r.client, taskCount: Number(r.task_count) }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- reports.service -t "tasksClients"`
Expected: PASS (both cases).

- [ ] **Step 5: Wire the controller endpoint**

In `src/reports/reports.controller.ts`, add this immediately after the `tasksAssignees()` method (after line 23):

```ts
  @Get('clients')
  @ApiOperation({ summary: 'Distinct task clients for the Tasks and Time Entries page filter dropdowns. Drawn from clickup_tasks.client (non-empty, non-deleted), with per-client task counts.' })
  tasksClients() { return this.reports.tasksClients(); }
```

- [ ] **Step 6: Run the full reports suite + build**

Run: `npm run test -- reports && npm run build`
Expected: PASS, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): add GET /reports/clients distinct-clients endpoint"
```

---

### Task 2: Backend — `client` filter on `tasks()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`tasks()`, signature line 111-123, where-build ~line 139)
- Modify: `src/reports/reports.controller.ts` (`tasks()`, lines 27-41)
- Test: `test/reports.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block in `test/reports.service.spec.ts`:

```ts
  describe('tasks (client filter)', () => {
    it('adds an exact client equality to the where clause when client is given', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBe('Acme Corp');
    });

    it('omits the client clause when client is undefined', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- reports.service -t "tasks (client filter)"`
Expected: FAIL — `arg.where.client` is `undefined` in the first case (param not yet accepted).

- [ ] **Step 3: Add the `client` param to the service signature**

In `src/reports/reports.service.ts`, change the `tasks(` signature (lines 111-123) to add `client` as the final parameter:

```ts
  async tasks(
    spaceId?: string,
    status?: string,
    search?: string,
    fromParam?: string,
    toParam?: string,
    limit = 50,
    offset = 0,
    priority?: string,
    assigneeId?: string,
    type?: string,
    archived?: string,
    client?: string,
  ) {
```

- [ ] **Step 4: Apply the filter in the where clause**

In the same method, immediately after the `if (priority) where.priority = priority;` line (line 141), add:

```ts
    if (client) where.client = client;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- reports.service -t "tasks (client filter)"`
Expected: PASS.

- [ ] **Step 6: Thread the param through the controller**

In `src/reports/reports.controller.ts`, update the `tasks()` method (lines 27-41). Add the query param and pass it as the final argument:

```ts
  tasks(
    @Query('spaceId') spaceId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('priority') priority?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('type') type?: string,
    @Query('archived') archived?: string,
    @Query('client') client?: string,
  ) {
    return this.reports.tasks(spaceId, status, search, from, to, Number(limit) || 50, Number(offset) || 0, priority, assigneeId, type, archived, client);
  }
```

- [ ] **Step 7: Run the reports suite + build**

Run: `npm run test -- reports && npm run build`
Expected: PASS, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): filter tasks by client"
```

---

### Task 3: Backend — `client` filter + client field on `timeEntriesList()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`timeEntriesList()`, signature line 422-433, where-build ~line 441, select line 474, mapping ~line 483)
- Modify: `src/reports/reports.controller.ts` (`timeEntriesList()`, lines 109-124)
- Test: `test/reports.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block in `test/reports.service.spec.ts`:

```ts
  describe('timeEntriesList (client filter + column)', () => {
    it('filters by client via the task relation in where.AND', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: 'Acme Corp' } });
    });

    it('selects the related task client and maps it onto each row', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 't1', taskId: 'k1', userId: 'u1', userName: 'Alice', userEmail: 'a@x.com',
        startTime: new Date('2026-05-01T00:00:00Z'), endTime: null,
        durationHours: { toNumber: () => 2 }, hourlyRateCents: BigInt(15000),
        costCents: BigInt(30000), status: 'COST_CALCULATED', billable: true,
        description: null, syncedAt: new Date('2026-05-01T00:00:00Z'), rateId: null, currency: 'USD',
        task: { taskName: 'Build thing', client: 'Acme Corp' },
      }]);
      prisma.clickupTimeEntry.count.mockResolvedValue(1);
      const result = await new ReportsService(prisma).timeEntriesList();
      const selectArg = prisma.clickupTimeEntry.findMany.mock.calls[0][0].select;
      expect(selectArg.task.select.client).toBe(true);
      expect(result.items[0].client).toBe('Acme Corp');
    });

    it('maps client to null when the entry has no task', async () => {
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
      expect(result.items[0].client).toBeNull();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- reports.service -t "timeEntriesList (client filter + column)"`
Expected: FAIL — the relation filter isn't added, `selectArg.task.select.client` is undefined, and `result.items[0].client` is undefined.

- [ ] **Step 3: Add the `client` param to the service signature**

In `src/reports/reports.service.ts`, change the `timeEntriesList(` signature (lines 422-433) to add `client` as the final parameter:

```ts
  async timeEntriesList(
    userId?: string,
    fromParam?: string,
    toParam?: string,
    status?: string,
    limit = 50,
    offset = 0,
    billable?: string,
    search?: string,
    spaceId?: string,
    missingOnly?: string,
    client?: string,
  ) {
```

- [ ] **Step 4: Add the relation filter**

In the same method, immediately after the `if (spaceId) and.push({ task: { spaceId, isDeleted: false } });` line (line 441), add:

```ts
    if (client) and.push({ task: { client } });
```

- [ ] **Step 5: Select the related client and map it**

In the `findMany` `select` (line 474), change the `task` select to include `client`:

```ts
          task: { select: { taskName: true, client: true } },
```

Then in the `items.map(...)` return object (after the `taskName:` line at 483), add a `client` field:

```ts
        taskName: e.task?.taskName ?? null,
        client: e.task?.client ?? null,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- reports.service -t "timeEntriesList (client filter + column)"`
Expected: PASS (all three cases).

- [ ] **Step 7: Thread the param through the controller**

In `src/reports/reports.controller.ts`, update `timeEntriesList()` (lines 109-124):

```ts
  timeEntriesList(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('billable') billable?: string,
    @Query('search') search?: string,
    @Query('spaceId') spaceId?: string,
    @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string,
  ) {
    return this.reports.timeEntriesList(
      userId, from, to, status, Number(limit) || 50, Number(offset) || 0, billable, search, spaceId, missingOnly, client,
    );
  }
```

- [ ] **Step 8: Run the reports suite + build**

Run: `npm run test -- reports && npm run build`
Expected: PASS, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): filter time entries by client and return client per row"
```

---

### Task 4: Backend — `client` filter on `timeEntriesAggregates()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`timeEntriesAggregates()`, signature line 340-349, where-build ~line 354)
- Modify: `src/reports/reports.controller.ts` (`timeEntriesAggregates()`, lines 75-86)
- Test: `test/reports.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block in `test/reports.service.spec.ts`:

```ts
  describe('timeEntriesAggregates (client filter)', () => {
    it('filters aggregates by client via the task relation', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: 'Acme Corp' } });
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- reports.service -t "timeEntriesAggregates (client filter)"`
Expected: FAIL — `and` does not contain the task/client clause.

- [ ] **Step 3: Add the `client` param to the service signature**

In `src/reports/reports.service.ts`, change the `timeEntriesAggregates(` signature (lines 340-349) to add `client` as the final parameter:

```ts
  async timeEntriesAggregates(
    userId?: string,
    fromParam?: string,
    toParam?: string,
    status?: string,
    billable?: string,
    search?: string,
    spaceId?: string,
    missingOnly?: string,
    client?: string,
  ) {
```

- [ ] **Step 4: Add the relation filter**

In the same method, immediately after the `if (spaceId) and.push({ task: { spaceId, isDeleted: false } });` line (line 354), add:

```ts
    if (client) and.push({ task: { client } });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- reports.service -t "timeEntriesAggregates (client filter)"`
Expected: PASS.

- [ ] **Step 6: Thread the param through the controller**

In `src/reports/reports.controller.ts`, update `timeEntriesAggregates()` (lines 75-86):

```ts
  timeEntriesAggregates(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('billable') billable?: string,
    @Query('search') search?: string,
    @Query('spaceId') spaceId?: string,
    @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string,
  ) {
    return this.reports.timeEntriesAggregates(userId, from, to, status, billable, search, spaceId, missingOnly, client);
  }
```

- [ ] **Step 7: Run the full backend suite + build**

Run: `npm run test && npm run build`
Expected: PASS, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat(reports): apply client filter to time-entry aggregates"
```

---

### Task 5: Frontend — API client method + `useClients()` hook

**Files:**
- Modify: `apps/web/src/api/reports.ts` (after `tasksAssignees`, line 8)
- Modify: `apps/web/src/hooks/useReports.ts` (after `useTasksAssignees`, line 17-19)

- [ ] **Step 1: Add the API client method**

In `apps/web/src/api/reports.ts`, add a `clients` method immediately after the `tasksAssignees:` line (line 8):

```ts
  clients: () => apiClient.get('/reports/clients').then(r => r.data),
```

- [ ] **Step 2: Add the `useClients` hook**

In `apps/web/src/hooks/useReports.ts`, add this immediately after the `useTasksAssignees` function (after line 19):

```ts
export function useClients() {
  return useQuery({ queryKey: ['clients'], queryFn: reportsApi.clients });
}
```

- [ ] **Step 3: Verify the web build/typecheck**

Run: `npm run build:web`
Expected: build succeeds (no TS errors). The new hook is unused for now — that's fine; it's consumed in Tasks 6-7.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): add clients API client + useClients hook"
```

---

### Task 6: Frontend — Client filter on TasksPage

**Files:**
- Modify: `apps/web/src/pages/TasksPage.tsx`

- [ ] **Step 1: Import the hook**

In `apps/web/src/pages/TasksPage.tsx`, extend the existing `useReports` import (line 8) to include `useClients`:

```ts
import { useTasks, useTasksAssignees, useTasksSummary, useClients } from '../hooks/useReports';
```

- [ ] **Step 2: Load clients and add filter state**

Immediately after `const { data: summary } = useTasksSummary();` (line 235), add:

```ts
  const { data: clientsData } = useClients();
```

Then add a `clientFilter` state next to the other filter `useState`s (after line 245, `archivedFilter`):

```ts
  const [clientFilter, setClientFilter] = useState('');
```

- [ ] **Step 3: Build the client options**

After the `assigneeOptions` `useMemo` (ends line 272), add:

```ts
  const clientOptions = useMemo(() => {
    const rows = (Array.isArray(clientsData) ? clientsData : []) as { client: string; taskCount?: number }[];
    const opts = [{ value: '', label: 'Any client' }];
    for (const r of rows) {
      if (!r.client) continue;
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      opts.push({ value: r.client, label: `${r.client}${count}` });
    }
    return opts;
  }, [clientsData]);
```

- [ ] **Step 4: Pass the filter to the query**

In the `taskParams` `useMemo` (lines 290-303), add a `client` field after `assigneeId` (line 298) and add `clientFilter` to the dependency array:

```ts
    assigneeId: assigneeFilter || undefined,
    client: clientFilter || undefined,
    archived: archivedFilter,
```

Update the deps array (line 303) to include `clientFilter`:

```ts
  }), [page, pageSize, space, statusFilter, priorityFilter, typeFilter, search, assigneeFilter, clientFilter, archivedFilter, fromDate, toDate]);
```

- [ ] **Step 5: Include in hasFilters and reset**

Update `hasFilters` (lines 313-315) to include `clientFilter`:

```ts
  const hasFilters = !!(
    searchRaw || search || statusFilter || priorityFilter || typeFilter || assigneeFilter || clientFilter || archivedFilter !== 'exclude'
  );
```

In `reset()` (lines 317-326), add after `setAssigneeFilter('');` (line 323):

```ts
    setClientFilter('');
```

- [ ] **Step 6: Render the Select in the filter bar**

In the filter bar, add a client `<Select>` immediately after the assignee `<Select>` (line 593):

```tsx
        <Select size="md" value={clientFilter} onChange={v => { setClientFilter(v); setPage(1); }} options={clientOptions} />
```

- [ ] **Step 7: Verify the web build**

Run: `npm run build:web`
Expected: build succeeds.

- [ ] **Step 8: Manual smoke check**

With `npm run dev:all` running, open the Tasks page, pick a client from the new dropdown, and confirm the list narrows to that client and the Reset button clears it. (Backend must be up on 3002.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/TasksPage.tsx
git commit -m "feat(web): client filter on Tasks page"
```

---

### Task 7: Frontend — Client filter + column on TimeEntriesPage

**Files:**
- Modify: `apps/web/src/components/TimeEntryDrawer.tsx` (`TimeEntryItem` interface, lines 10-30)
- Modify: `apps/web/src/pages/TimeEntriesPage.tsx`

- [ ] **Step 1: Extend the TimeEntryItem type**

In `apps/web/src/components/TimeEntryDrawer.tsx`, add a `client` field to the `TimeEntryItem` interface, after `taskName` (line 14):

```ts
  taskName: string | null;
  client?: string | null;
```

- [ ] **Step 2: Import the hook and Pill (Pill already imported), add filter state**

In `apps/web/src/pages/TimeEntriesPage.tsx`, extend the `useReports` import (line 8) to include `useClients`:

```ts
import { useTimeEntriesList, useTimeEntriesByUser, useTimeEntriesAggregates, useClients } from '../hooks/useReports';
```

After `const { data: byUser } = useTimeEntriesByUser();` (line 46), add:

```ts
  const { data: clientsData } = useClients();
```

Add a `clientFilter` state next to the other filter `useState`s (after line 85, `missingOnly`):

```ts
  const [clientFilter, setClientFilter] = useState('');
```

- [ ] **Step 3: Build the client options**

After the `assigneeOptions` `useMemo` (ends line 126), add:

```ts
  const clientOptions = useMemo(() => {
    const rows = (Array.isArray(clientsData) ? clientsData : []) as { client: string; taskCount?: number }[];
    const opts = [{ value: '', label: 'Any client' }];
    for (const r of rows) {
      if (!r.client) continue;
      opts.push({ value: r.client, label: r.client });
    }
    return opts;
  }, [clientsData]);
```

- [ ] **Step 4: Pass the filter to the query**

In the `params` `useMemo` (lines 128-139), add a `client` field after `userId` (line 132) and add `clientFilter` to the dependency array:

```ts
    userId: userId || undefined,
    client: clientFilter || undefined,
```

Update the deps array (line 139) to include `clientFilter`:

```ts
  }), [pageSize, page, search, userId, clientFilter, billable, status, missingOnly, space, fromDate, toDate]);
```

(`aggParams` is derived from `params` by stripping `limit`/`offset`, so the aggregates query inherits `client` automatically — no change needed.)

- [ ] **Step 5: Include in hasFilters and reset**

Update `hasFilters` (lines 193-195) to include `clientFilter`:

```ts
  const hasFilters = !!(
    search || userId || clientFilter || billable || status || missingOnly
  );
```

In `reset()` (lines 197-205), add after `setUserId('');` (line 200):

```ts
    setClientFilter('');
```

- [ ] **Step 6: Render the Select in the filter bar**

In the filter bar, add a client `<Select>` immediately after the assignee `<Select>` (line 419):

```tsx
        <Select size="md" options={clientOptions} value={clientFilter} onChange={(v) => { setClientFilter(v); setPage(1); }} />
```

- [ ] **Step 7: Add the Client column to the table**

In the `columns` `useMemo` (lines 207-324), add a Client column object immediately after the `userName`/Assignee column (after its closing `},` at line 242):

```tsx
    {
      key: 'client',
      header: 'Client',
      width: 140,
      render: (row) => (
        row.client
          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.client}</span>
          : <span style={{ color: 'var(--text-faint)' }}>—</span>
      ),
    },
```

- [ ] **Step 8: Add the Client column to the CSV export**

In `exportCsv` (lines 144-168), add a Client column to the `cols` array immediately after the `User email` entry (line 153):

```ts
        { header: 'User email',    value: 'userEmail' },
        { header: 'Client',        value: 'client' },
```

- [ ] **Step 9: Verify the web build**

Run: `npm run build:web`
Expected: build succeeds.

- [ ] **Step 10: Manual smoke check**

With `npm run dev:all` running, open the Time Entries page: confirm the new Client column shows each row's client, the dropdown narrows the list and updates the metric cards, the CSV export includes a Client column, and Reset clears it.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/components/TimeEntryDrawer.tsx apps/web/src/pages/TimeEntriesPage.tsx
git commit -m "feat(web): client filter + Client column on Time Entries page"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full backend test + build**

Run: `npm run test && npm run build`
Expected: all PASS.

- [ ] **Step 2: Lint + web build**

Run: `npm run lint && npm run build:web`
Expected: clean.

- [ ] **Step 3: End-to-end manual check**

With `npm run dev:all` up: on both pages, pick the same client and confirm consistent filtering; clear via Reset; confirm CSV exports on both pages include the client.

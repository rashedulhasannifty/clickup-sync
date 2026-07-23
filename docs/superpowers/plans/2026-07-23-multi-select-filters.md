# Multi-Select Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick multiple values in the categorical filter dropdowns on the Tasks and Time Entries dashboard pages (e.g. two clients at once), instead of one value per dropdown.

**Architecture:** A new `MultiSelect` React component replaces `Select` for the categorical filters on both pages. Page filter state changes from `string` to `string[]` and serializes to the **existing** query params as comma-separated values (`?client=Acme,Beta`). The report services split those params with a new `csvList()` helper and convert each `where.x = value` equality into `where.x = { in: [...] }`. Because a single value parses as a one-element list, every existing deep-link keeps working with no controller signature change.

**Tech Stack:** NestJS 11 + Prisma 7 (backend), React 19 + Vite + `@tanstack/react-query` (dashboard at `apps/web`), Jest + ts-jest (backend tests only — the web app has no test runner).

**Spec:** `docs/superpowers/specs/2026-07-23-multi-select-filters-design.md`

## Global Constraints

- Filters that become multi-select — **Tasks**: Status, Priority, Assignee, Client, Folder, List. **Time Entries**: Assignee, Client, Folder, List, Cost status.
- Filters that stay single-select and must NOT be touched — **Tasks**: Type, Archived. **Time Entries**: Billable, the Missing-rate `Switch`. Also the global topbar Space filter.
- Wire format is **comma-separated values in the existing query param names**. Do not add repeated params and do not add new plural param names.
- An empty selection means "no constraint": the param is omitted from the request entirely, and the service skips the where-clause.
- `reports.controller.ts` method signatures stay `@Query('x') x?: string`. Only `@ApiOperation` summary text changes.
- Never edit only one of `timeEntriesList` / `timeEntriesAggregates` — their where-clauses are duplicated on purpose and must stay in lockstep, or the metric cards disagree with the table.
- Preserve Prettier formatting and the surrounding comment density. Keep existing explanatory comments unless the code they describe is gone.
- Commit messages follow the repo's Conventional Commits style. **Do NOT add a `Co-Authored-By: Claude` trailer** — this project omits it.
- `npm run lint` at the **repo root** is known-broken (no root ESLint config, exits 2) and is excluded from the CI gate — a failure there is not a signal. Use `npm test` and the builds instead. `apps/web` is different: it has a working `eslint.config.js`, so lint output on the web files is real (see Task 4 Step 3). Note `TasksPage.tsx` already carries one pre-existing `react-hooks/set-state-in-effect` error unrelated to this work — don't chase it.

---

## File Structure

**Create:**
- `src/reports/report-filter.util.ts` — `csvList()`, the single place comma-separated filter params are parsed.
- `test/report-filter.util.spec.ts` — unit tests for `csvList()`.
- `apps/web/src/components/ui/MultiSelect.tsx` — the checkbox + search dropdown.

**Modify:**
- `src/reports/tasks-report.service.ts` — `tasks()` where-clause (restructured onto an AND accumulator).
- `src/reports/time-entries-report.service.ts` — `timeEntriesList()` and `timeEntriesAggregates()` where-clauses.
- `src/reports/reports.controller.ts` — `@ApiOperation` text only.
- `test/tasks-report.service.spec.ts` — updated + new filter assertions.
- `test/time-entries-report.service.spec.ts` — updated + new filter assertions.
- `apps/web/src/pages/TasksPage.tsx` — six filter states → `string[]`.
- `apps/web/src/pages/TimeEntriesPage.tsx` — five filter states → `string[]`.

Tasks 1–3 are backend and independently testable. Task 4 builds the component with nothing consuming it yet. Tasks 5–6 wire the two pages. Task 7 is end-to-end verification in a browser.

---

### Task 1: `csvList()` parsing helper

**Files:**
- Create: `src/reports/report-filter.util.ts`
- Test: `test/report-filter.util.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function csvList(value?: string): string[] | undefined` — splits on commas, trims each part, drops empty parts, de-duplicates preserving first-seen order, and returns `undefined` when nothing usable remains (so callers can treat "absent" and "empty" identically).

- [ ] **Step 1: Write the failing test**

Create `test/report-filter.util.spec.ts`:

```ts
import { csvList } from '../src/reports/report-filter.util';

describe('csvList', () => {
  it('returns undefined for undefined', () => {
    expect(csvList(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(csvList('')).toBeUndefined();
  });

  it('returns undefined for a comma-only string', () => {
    expect(csvList(' , , ')).toBeUndefined();
  });

  it('wraps a single value in a one-element list (the deep-link path)', () => {
    expect(csvList('Acme Corp')).toEqual(['Acme Corp']);
  });

  it('splits multiple values', () => {
    expect(csvList('Acme,Beta,Contoso')).toEqual(['Acme', 'Beta', 'Contoso']);
  });

  it('trims surrounding whitespace on each value', () => {
    expect(csvList(' Acme , Beta ')).toEqual(['Acme', 'Beta']);
  });

  it('drops empty parts between commas', () => {
    expect(csvList('Acme,,Beta, ,Contoso')).toEqual(['Acme', 'Beta', 'Contoso']);
  });

  it('de-duplicates while preserving first-seen order', () => {
    expect(csvList('Beta,Acme,Beta')).toEqual(['Beta', 'Acme']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/report-filter.util.spec.ts`

Expected: FAIL — `Cannot find module '../src/reports/report-filter.util'`.

- [ ] **Step 3: Write the implementation**

Create `src/reports/report-filter.util.ts`:

```ts
/**
 * Shared parsing for the dashboard's multi-select filter params.
 *
 * The Tasks and Time Entries filter dropdowns send their selections as a
 * comma-separated list in the *existing* single-value query params
 * (`?client=Acme,Beta`). That keeps every pre-existing deep-link working —
 * `?client=Acme` simply parses as a one-element list — so no caller had to
 * change when the dropdowns became multi-select.
 */

/**
 * Split a comma-separated query param into a de-duplicated list of trimmed,
 * non-empty values.
 *
 * Returns `undefined` when nothing usable remains (absent param, empty string,
 * or commas only) so callers can treat "absent" and "empty selection"
 * identically and skip the where-clause entirely.
 */
export function csvList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return [...new Set(parts)];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/report-filter.util.spec.ts`

Expected: PASS — 8 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/reports/report-filter.util.ts test/report-filter.util.spec.ts
git commit -m "feat(reports): add csvList helper for comma-separated filter params"
```

---

### Task 2: Multi-value filters in `tasks()`

**Files:**
- Modify: `src/reports/tasks-report.service.ts` (the `tasks()` where-clause, currently lines 165–214)
- Modify: `src/reports/reports.controller.ts` (the `@ApiOperation` on `@Get('tasks')`, line 69)
- Test: `test/tasks-report.service.spec.ts`

**Interfaces:**
- Consumes: `csvList(value?: string): string[] | undefined` from `../src/reports/report-filter.util` (Task 1).
- Produces: no signature change. `tasks()` keeps its 15 positional params in the same order — `(spaceId, status, search, fromParam, toParam, limit, offset, priority, assigneeId, type, archived, client, taskIds, listId, folderId)`. Only the shape of the generated `where` changes.

**Why this task restructures the where-clause:** today `assigneeId` writes `where.assigneesNames = { contains: … }` while `search` separately assigns `where.AND = [{ OR: [...] }]`. A *multi*-assignee filter has to become an `OR` of `contains` clauses, which cannot live on the bare `assigneesNames` key alongside the search `OR`. Both move onto an `and: []` accumulator — the same pattern `timeEntriesList` already uses.

- [ ] **Step 1: Write the failing tests**

In `test/tasks-report.service.spec.ts`, **replace** the three existing `describe` blocks `tasks (client filter)`, `tasks (list filter)` and `tasks (folder filter)` (lines 141–196) with the block below, and leave `tasks (taskIds filter)` and everything else untouched.

Reminder of the positional argument order, since these calls are mostly `undefined`:
`(spaceId, status, search, from, to, limit, offset, priority, assigneeId, type, archived, client, taskIds, listId, folderId)`

```ts
  describe('tasks (client filter)', () => {
    it('wraps a single client in an IN clause (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toEqual({ in: ['Acme Corp'] });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp,Globex',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toEqual({ in: ['Acme Corp', 'Globex'] });
    });

    it('omits the client clause when client is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBeUndefined();
    });

    it('omits the client clause when client is commas only', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, ' , ',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBeUndefined();
    });
  });

  describe('tasks (list filter)', () => {
    it('wraps a single listId in an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toEqual({ in: ['L1'] });
    });

    it('splits a comma-separated listId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'L1,L2',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toEqual({ in: ['L1', 'L2'] });
    });

    it('omits the listId clause when listId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toBeUndefined();
    });
  });

  describe('tasks (folder filter)', () => {
    it('wraps a single folderId in an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toEqual({ in: ['F1'] });
    });

    it('splits a comma-separated folderId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1,F2',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toEqual({ in: ['F1', 'F2'] });
    });

    it('omits the folderId clause when folderId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toBeUndefined();
    });
  });

  describe('tasks (status filter)', () => {
    it('wraps a single status in an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(undefined, 'in progress');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['in progress'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(undefined, 'in progress,in review');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['in progress', 'in review'] });
    });

    it('omits the status clause when status is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toBeUndefined();
    });
  });

  describe('tasks (priority filter)', () => {
    it('splits a comma-separated priority list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0, 'urgent,high',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.priority).toEqual({ in: ['urgent', 'high'] });
    });

    it('omits the priority clause when priority is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.priority).toBeUndefined();
    });
  });

  describe('tasks (assignee filter)', () => {
    it('pushes a single-name OR group onto where.AND', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, 'Alice',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({
        OR: [{ assigneesNames: { contains: 'Alice', mode: 'insensitive' } }],
      });
      // The bare key must be gone — it would collide with the search OR below.
      expect(arg.where.assigneesNames).toBeUndefined();
    });

    it('ORs every selected assignee name inside one AND entry', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, 'Alice,Bob',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({
        OR: [
          { assigneesNames: { contains: 'Alice', mode: 'insensitive' } },
          { assigneesNames: { contains: 'Bob', mode: 'insensitive' } },
        ],
      });
    });

    it('keeps the assignee OR and the search OR as separate AND entries', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, 'launch', undefined, undefined, 50, 0,
        undefined, 'Alice,Bob',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toHaveLength(2);
      expect(and).toContainEqual({
        OR: [
          { assigneesNames: { contains: 'Alice', mode: 'insensitive' } },
          { assigneesNames: { contains: 'Bob', mode: 'insensitive' } },
        ],
      });
      // The search group is the other entry — identified by a field only it uses.
      const searchGroup = and.find((g) =>
        g.OR?.some((c: any) => c.taskName?.contains === 'launch'),
      );
      expect(searchGroup).toBeDefined();
    });

    it('omits the assignee clause when assigneeId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.AND).toBeUndefined();
      expect(arg.where.assigneesNames).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/tasks-report.service.spec.ts`

Expected: FAIL. The client/list/folder tests fail with `Expected: {"in": ["Acme Corp"]} / Received: "Acme Corp"`, and the assignee tests fail because `where.AND` is `undefined` (search-only today) while `where.assigneesNames` is set.

- [ ] **Step 3: Write the implementation**

In `src/reports/tasks-report.service.ts`, add the import next to the existing `parseDate` import at the top of the file:

```ts
import { parseDate } from './report-date.util';
import { csvList } from './report-filter.util';
```

Then replace the whole where-clause construction inside `tasks()` — everything from `const safeLimit = …` down to and including the closing brace of the `if (search?.trim()) { … }` block (currently lines 165–214) — with:

```ts
    // Cap kept generous so the dashboard's "Export CSV" can pull a complete
    // filtered set in one shot. The page UI never offers > 100 rows/page, so
    // this only matters for export requests.
    const safeLimit = Math.min(limit, 5000);
    const where: Prisma.ClickupTaskWhereInput = {};
    // Clauses that would otherwise collide on a single `where` key accumulate
    // here and land on `where.AND` at the end. The assignee filter and the
    // free-text search each need their own OR group, so neither can own a bare
    // top-level key. Same pattern as `timeEntriesList`.
    const and: Prisma.ClickupTaskWhereInput[] = [];
    // ClickUp `archived` flag (exclude / include / only). Always hide soft-deleted rows unless we add a separate flag later.
    where.isDeleted = false;
    if (archived === 'only') {
      where.archived = true;
    } else if (archived === 'include') {
      // show archived and non-archived
    } else {
      // exclude, hide, undefined, '' — default: hide archived tasks
      where.archived = false;
    }
    // The categorical filters are multi-select in the dashboard and arrive as a
    // comma-separated list. A single value parses as a one-element list, so
    // pre-existing deep-links (e.g. `?client=Acme`) behave exactly as before.
    const statuses = csvList(status);
    const priorities = csvList(priority);
    const clients = csvList(client);
    const listIds = csvList(listId);
    const folderIds = csvList(folderId);
    const assigneeNames = csvList(assigneeId);
    if (spaceId) where.spaceId = spaceId;
    if (statuses) where.status = { in: statuses };
    if (priorities) where.priority = { in: priorities };
    if (clients) where.client = { in: clients };
    if (listIds) where.listId = { in: listIds };
    if (folderIds) where.folderId = { in: folderIds };
    if (type === 'parent') where.parentTaskId = null;
    if (type === 'subtask') where.parentTaskId = { not: null };
    // `assignees_names` is a single comma-joined string, so each selected name
    // is a substring match and multiple names OR together. Substring matching
    // means "Sam" also matches "Sameer" — pre-existing behavior, unchanged.
    if (assigneeNames) {
      and.push({
        OR: assigneeNames.map((n) => ({
          assigneesNames: { contains: n, mode: 'insensitive' as const },
        })),
      });
    }
    if (taskIds) {
      const ids = taskIds.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) where.taskId = { in: ids };
    }
    if (fromParam || toParam) {
      where.updatedDate = { gte: parseDate(fromParam, new Date(0)), lte: parseDate(toParam, new Date()) };
    }
    // Free-text search across short, indexed-friendly fields. Avoid description / raw
    // JSON — ILIKE on those gets expensive fast. Pushed onto the AND accumulator so
    // search stacks with the other filters above (mirrors `timeEntriesList`).
    if (search?.trim()) {
      const q = search.trim();
      and.push({
        OR: [
          { taskName: { contains: q, mode: 'insensitive' } },
          { taskId: { contains: q, mode: 'insensitive' } },
          { assigneesNames: { contains: q, mode: 'insensitive' } },
          { assigneesEmails: { contains: q, mode: 'insensitive' } },
          { client: { contains: q, mode: 'insensitive' } },
          { listName: { contains: q, mode: 'insensitive' } },
          { spaceName: { contains: q, mode: 'insensitive' } },
          { sprintName: { contains: q, mode: 'insensitive' } },
          { department: { contains: q, mode: 'insensitive' } },
          { executiveName: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;
```

Leave the `const [items, total] = await Promise.all([…])` block and everything after it exactly as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/tasks-report.service.spec.ts`

Expected: PASS — all tests in the file, including the untouched `tasksSummary` / `tasksLists` / `taskIds` / `sprintPoints` / `spaces` blocks.

- [ ] **Step 5: Update the Swagger description**

In `src/reports/reports.controller.ts`, replace the `@ApiOperation` on `@Get('tasks')` (line 69) with:

```ts
  @ApiOperation({ summary: 'Paginated task list with filters. `status`, `priority`, `assigneeId`, `client`, `listId` and `folderId` each accept a comma-separated list of values (OR semantics); a single value behaves exactly as before. `archived`: exclude (default, hide archived) | include | only (archived tasks). Soft-deleted rows are always excluded.' })
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`

Expected: exits 0, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/reports/tasks-report.service.ts src/reports/reports.controller.ts test/tasks-report.service.spec.ts
git commit -m "feat(reports): accept multi-value filters on GET /reports/tasks"
```

---

### Task 3: Multi-value filters in `timeEntriesList()` and `timeEntriesAggregates()`

**Files:**
- Modify: `src/reports/time-entries-report.service.ts` (`timeEntriesAggregates` where-clause at lines 242–272; `timeEntriesList` where-clause at lines 339–369)
- Modify: `src/reports/reports.controller.ts` (`@ApiOperation` on `@Get('time-entries')` line 201 and `@Get('time-entries/aggregates')` line 132)
- Test: `test/time-entries-report.service.spec.ts`

**Interfaces:**
- Consumes: `csvList(value?: string): string[] | undefined` from `./report-filter.util` (Task 1).
- Produces: no signature change. `timeEntriesList()` keeps `(userId, fromParam, toParam, status, limit, offset, billable, search, spaceId, missingOnly, client, listId, folderId)` and `timeEntriesAggregates()` keeps `(userId, fromParam, toParam, status, billable, search, spaceId, missingOnly, client, listId, folderId)`.

**Both methods must be edited.** Their where-clauses are duplicated on purpose (there is a comment saying so above `timeEntriesAggregates`). Converting only one makes the Time Entries metric cards report different numbers than the table below them.

- [ ] **Step 1: Write the failing tests**

In `test/time-entries-report.service.spec.ts`, **replace** the `it('filters by client via the task relation in where.AND', …)` case inside `timeEntriesList (client filter + column)` (lines 161–170) with the two cases below. Leave the other two cases in that describe block (`selects the related task client…`, `maps client to null…`) untouched.

```ts
    it('wraps a single client in an IN clause inside where.AND (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp'] } } });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp,Globex',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp', 'Globex'] } } });
    });
```

Replace the `it('filters by listId via the task relation in where.AND', …)` case inside `timeEntriesList (list filter + column)` (lines 206–215) with:

```ts
    it('wraps a single listId in an IN clause inside where.AND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1'] } } });
    });

    it('splits a comma-separated listId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, 'L1,L2',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1', 'L2'] } } });
    });
```

Replace the entire `timeEntriesList (folder filter)` describe block (lines 250–261) with:

```ts
  describe('timeEntriesList (folder filter)', () => {
    it('wraps a single folderId in an IN clause inside where.AND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: { in: ['F1'] } } });
    });

    it('splits a comma-separated folderId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'F1,F2',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: { in: ['F1', 'F2'] } } });
    });
  });

  describe('timeEntriesList (userId filter)', () => {
    it('wraps a single userId in an IN clause (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList('u1');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1'] });
    });

    it('splits a comma-separated userId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList('u1,u2');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1', 'u2'] });
    });

    it('omits the userId clause when userId is undefined', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList();
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toBeUndefined();
    });
  });

  describe('timeEntriesList (status filter)', () => {
    it('wraps a single status in an IN clause (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, 'NO_RATE_FOUND',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['NO_RATE_FOUND'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, 'COST_CALCULATED,COST_EXCLUDED',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['COST_CALCULATED', 'COST_EXCLUDED'] });
    });

    it('missingOnly still forces the scalar NO_RATE_FOUND and overrides a multi-value status', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, 'COST_CALCULATED,COST_EXCLUDED', 50, 0,
        undefined, undefined, undefined, 'true',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.status).toBe('NO_RATE_FOUND');
    });
  });
```

Finally, replace the three `timeEntriesAggregates (…)` describe blocks at the end of the file (lines 263–297) with:

```ts
  describe('timeEntriesAggregates (client filter)', () => {
    it('wraps a single client in an IN clause via the task relation', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp'] } } });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Acme Corp,Globex',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp', 'Globex'] } } });
    });
  });

  describe('timeEntriesAggregates (list filter)', () => {
    it('splits a comma-separated listId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'L1,L2',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1', 'L2'] } } });
    });
  });

  describe('timeEntriesAggregates (folder filter)', () => {
    it('splits a comma-separated folderId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1,F2',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: { in: ['F1', 'F2'] } } });
    });
  });

  describe('timeEntriesAggregates (userId + status filters)', () => {
    it('splits a comma-separated userId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates('u1,u2');
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1', 'u2'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, 'COST_CALCULATED,COST_EXCLUDED',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['COST_CALCULATED', 'COST_EXCLUDED'] });
    });

    it('missingOnly still forces the scalar NO_RATE_FOUND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, 'COST_CALCULATED', undefined, undefined, undefined, 'true',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.status).toBe('NO_RATE_FOUND');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/time-entries-report.service.spec.ts`

Expected: FAIL — the `toContainEqual({ task: { client: { in: [...] } } })` assertions fail against the current `{ task: { client: 'Acme Corp' } }`, and `where.userId` / `where.status` are bare strings rather than `{ in: [...] }`.

- [ ] **Step 3: Write the implementation**

In `src/reports/time-entries-report.service.ts`, add the import next to the existing date-util import at the top:

```ts
import { defaultFrom, parseDate } from './report-date.util';
import { csvList } from './report-filter.util';
```

Now the where-clause itself. **The block below appears byte-identically in both `timeEntriesAggregates()` (lines 244–257) and `timeEntriesList()` (lines 341–354)** — verified with `diff`. Both need the *same* replacement, so do this as **one `Edit` call with `replace_all: true`**, not two sequential edits. Two sequential edits fail: the first one errors with "found multiple times" because the quoted text is not unique.

**Expect exactly 2 occurrences replaced. If the count is not 2, stop and re-read the file** — it means one of the methods has drifted and the two where-clauses are no longer in lockstep, which is the exact bug this plan exists to avoid.

Replace this block:

```ts
    if (spaceId) and.push({ task: { spaceId, isDeleted: false } });
    // Intentionally no `isDeleted: false` here (unlike the spaceId clause):
    // the base list shows entries regardless of task soft-deletion, so the
    // client filter stays consistent with that. Don't "fix" this to exclude
    // deleted tasks — it would make client-only vs client+space disagree.
    if (client) and.push({ task: { client } });
    if (listId) and.push({ task: { listId } });
    if (folderId) and.push({ task: { folderId } });
    if (userId) where.userId = userId;
    if (missingOnly === 'true') {
      where.status = 'NO_RATE_FOUND';
    } else if (status) {
      where.status = status;
    }
```

with:

```ts
    if (spaceId) and.push({ task: { spaceId, isDeleted: false } });
    // The categorical filters are multi-select in the dashboard and arrive as a
    // comma-separated list. A single value parses as a one-element list, so
    // pre-existing deep-links (e.g. `?userId=u1&status=NO_RATE_FOUND`) behave
    // exactly as before.
    const clients = csvList(client);
    const listIds = csvList(listId);
    const folderIds = csvList(folderId);
    const userIds = csvList(userId);
    const statuses = csvList(status);
    // Intentionally no `isDeleted: false` here (unlike the spaceId clause):
    // the base list shows entries regardless of task soft-deletion, so the
    // client filter stays consistent with that. Don't "fix" this to exclude
    // deleted tasks — it would make client-only vs client+space disagree.
    if (clients) and.push({ task: { client: { in: clients } } });
    if (listIds) and.push({ task: { listId: { in: listIds } } });
    if (folderIds) and.push({ task: { folderId: { in: folderIds } } });
    if (userIds) where.userId = { in: userIds };
    if (missingOnly === 'true') {
      where.status = 'NO_RATE_FOUND';
    } else if (statuses) {
      where.status = { in: statuses };
    }
```

After the `replace_all` edit, both methods carry the identical new block. That duplication is intentional and documented in the comment above `timeEntriesAggregates` — do not extract it into a shared helper.

Leave `billable`, `search`, `spaceId` and the `from`/`to` window alone in both methods.

Confirm both landed:

```bash
grep -c "where.userId = { in: userIds }" src/reports/time-entries-report.service.ts
```

Expected output: `2`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- test/time-entries-report.service.spec.ts`

Expected: PASS — every test in the file.

- [ ] **Step 5: Run the whole backend suite**

Run: `npm test`

Expected: PASS, entire suite. `test/reports.controller.spec.ts` only covers `overviewDeltas` / `anomalies` / `costTrend` / `hourSpikes` / `budgetStatus`, so it does not assert on these filter params and needs no change — but run the full suite anyway to catch anything else that reads the report services.

- [ ] **Step 6: Update the Swagger descriptions**

In `src/reports/reports.controller.ts`, replace the `@ApiOperation` on `@Get('time-entries')` (line 201) with:

```ts
  @ApiOperation({ summary: 'Paginated time entry list (userId, from, to, status, billable, search, spaceId, missingOnly, client, listId, folderId). `userId`, `status`, `client`, `listId` and `folderId` each accept a comma-separated list of values (OR semantics); a single value behaves exactly as before. `missingOnly=true` overrides `status`.' })
```

and the one on `@Get('time-entries/aggregates')` (line 132) with:

```ts
  @ApiOperation({ summary: 'Server-side aggregates for the Time Entries page metric cards. Accepts the same filters as /time-entries, including the same comma-separated multi-value support.' })
```

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build`

Expected: exits 0, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/reports/time-entries-report.service.ts src/reports/reports.controller.ts test/time-entries-report.service.spec.ts
git commit -m "feat(reports): accept multi-value filters on the time-entries list + aggregates"
```

---

### Task 4: `MultiSelect` component

**Files:**
- Create: `apps/web/src/components/ui/MultiSelect.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function MultiSelect(props: MultiSelectProps)` where

  ```ts
  interface MultiSelectOption { value: string; label: string; icon?: ReactNode }
  interface MultiSelectProps {
    options: MultiSelectOption[];
    value: string[];
    onChange: (value: string[]) => void;
    allLabel: string;          // trigger text when nothing is selected
    className?: string;
    size?: 'sm' | 'md';
    disabled?: boolean;
    ariaLabel?: string;
    menuAlign?: 'left' | 'right';
    menuPlacement?: 'bottom' | 'top';
    searchable?: boolean;      // defaults to true
  }
  ```

  Tasks 5 and 6 import it as `import { MultiSelect } from '../components/ui/MultiSelect';`.

There is no test runner in `apps/web`, so this task is verified by the TypeScript build. Behavior is verified in Task 7.

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/ui/MultiSelect.tsx`:

```tsx
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search, Square, SquareCheck } from 'lucide-react';

interface MultiSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Trigger label when nothing is selected, e.g. "Any client". An empty
   *  selection means "no constraint", so there is no empty sentinel option. */
  allLabel: string;
  className?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Accessible name for screen readers when there's no visible <label>. */
  ariaLabel?: string;
  /** Which edge the dropdown menu aligns to. Defaults to 'left'. */
  menuAlign?: 'left' | 'right';
  /** Which way the menu opens. Defaults to 'bottom'. */
  menuPlacement?: 'bottom' | 'top';
  /** In-menu type-to-filter box. Defaults to true — List and Assignee can run
   *  to dozens of options. */
  searchable?: boolean;
}

/**
 * Multi-select dropdown for the Tasks / Time Entries filter bars.
 *
 * Deliberately NOT an extension of `Select`: that component's model is
 * commit-and-close on a scalar value, while this one stays open, toggles
 * membership, and needs a different trigger label and a search box. It copies
 * `Select`'s trigger *styling* (btn-3d, heights, radius, focus border swap) so
 * the two are indistinguishable sitting side by side in the same filter bar.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  allLabel,
  className = '',
  size = 'md',
  disabled,
  ariaLabel,
  menuAlign = 'left',
  menuPlacement = 'bottom',
  searchable = true,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedSet = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Each time the menu opens, clear the previous search and drop focus into the
  // search box so typing narrows the list immediately.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      if (searchable) searchRef.current?.focus();
    } else {
      setActiveIndex(-1);
    }
  }, [open, searchable]);

  // Typing shrinks the list — clamp the highlight so it never points past the end.
  useEffect(() => {
    setActiveIndex((i) => (filtered.length === 0 ? -1 : Math.min(i < 0 ? 0 : i, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function toggle(optValue: string) {
    onChange(selectedSet.has(optValue) ? value.filter((v) => v !== optValue) : [...value, optValue]);
  }

  // Attached to the wrapper, not the trigger: once the menu is open focus lives
  // in the search input, so the arrow keys have to be caught as they bubble.
  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case ' ':
        // Space is a literal character while the search box has focus. Only
        // treat it as "toggle the highlighted option" from the trigger itself.
        if (e.target === searchRef.current) break;
        e.preventDefault();
        if (filtered[activeIndex]) toggle(filtered[activeIndex].value);
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[activeIndex]) toggle(filtered[activeIndex].value);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  // Trigger label: "Any client" → "Acme" → "Acme +2". The count fallback covers
  // a selected value that is no longer in `options` (e.g. a list from a space
  // the topbar has since switched away from).
  const firstSelected = options.find((o) => selectedSet.has(o.value));
  const triggerLabel =
    value.length === 0
      ? allLabel
      : !firstSelected
        ? `${value.length} selected`
        : value.length === 1
          ? firstSelected.label
          : `${firstSelected.label} +${value.length - 1}`;
  const hasSelection = value.length > 0;

  const h = size === 'sm' ? 28 : 32;
  const fs = size === 'sm' ? 12 : 13;

  return (
    <div
      ref={ref}
      className={className}
      onKeyDown={onKeyDown}
      style={{ position: 'relative', display: 'inline-flex', minWidth: 80 }}
    >
      <button
        type="button"
        className="btn-3d"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        // Ignore keyboard-synthesized clicks (detail === 0) — Enter/Space are
        // fully handled in onKeyDown, and letting the click through would
        // immediately toggle the menu a second time.
        onClick={(e) => { if (e.detail !== 0) !disabled && setOpen((o) => !o); }}
        style={{
          ['--b-edge' as string]: 'var(--border-strong)',
          ['--b-glow' as string]: 'var(--btn-neutral-glow)',
          ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: h,
          padding: '0 28px 0 10px',
          fontSize: fs,
          fontWeight: 500,
          background: 'var(--surface)',
          color: 'var(--text)',
          // An active filter is visible without opening the menu.
          border: `1px solid ${hasSelection ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 9,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          fontFamily: 'inherit',
          outline: 'none',
          whiteSpace: 'nowrap',
          position: 'relative',
          minWidth: 80,
          transition: 'border-color 120ms',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = hasSelection ? 'var(--accent)' : 'var(--border)'; }}
      >
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            overflow: 'hidden',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            color: hasSelection ? 'var(--text)' : 'var(--text-muted)',
          }}
        >
          {value.length === 1 && firstSelected?.icon}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{triggerLabel}</span>
        </span>
        <span
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            display: 'flex',
            pointerEvents: 'none',
          }}
        >
          <ChevronDown size={14} strokeWidth={2} />
        </span>
      </button>

      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            ...(menuPlacement === 'top' ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
            ...(menuAlign === 'right' ? { right: 0 } : { left: 0 }),
            zIndex: 40,
            minWidth: 220,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 320,
          }}
        >
          {searchable && (
            <div style={{ position: 'relative', padding: 4, flexShrink: 0 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', display: 'flex', pointerEvents: 'none' }}>
                <Search size={12} strokeWidth={1.75} />
              </span>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label="Filter options"
                style={{
                  width: '100%',
                  height: 28,
                  padding: '0 8px 0 26px',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  color: 'var(--text)',
                  background: 'var(--muted-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)' }}>No matches</div>
            ) : (
              filtered.map((opt, idx) => {
                const checked = selectedSet.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    className="row-3d"
                    id={`${listboxId}-opt-${idx}`}
                    role="option"
                    aria-selected={checked}
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(idx)}
                    // Note: no setOpen(false) — the menu stays open so several
                    // options can be ticked in one visit.
                    onClick={() => toggle(opt.value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 8px',
                      fontSize: 13,
                      fontWeight: 500,
                      background: idx === activeIndex ? 'var(--hover)' : 'transparent',
                      color: 'var(--text)',
                      border: 0,
                      borderRadius: 5,
                      cursor: 'pointer',
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                      fontFamily: 'inherit',
                    }}
                  >
                    {/* A glyph, not just a background tint — selection state must
                        not be conveyed by color alone. */}
                    <span style={{ display: 'flex', flexShrink: 0, color: checked ? 'var(--accent)' : 'var(--text-faint)' }}>
                      {checked ? <SquareCheck size={14} strokeWidth={2} /> : <Square size={14} strokeWidth={2} />}
                    </span>
                    {opt.icon}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>

          {hasSelection && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => { onChange([]); setOpen(false); }}
              style={{
                flexShrink: 0,
                marginTop: 4,
                padding: '7px 8px',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'inherit',
                color: 'var(--text-muted)',
                background: 'transparent',
                border: 0,
                borderTop: '1px solid var(--border)',
                borderRadius: 0,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd apps/web && npx tsc -b`

Expected: exits 0, no output. If it reports an unused import, remove only the genuinely unused one — do not delete `Square`/`SquareCheck`/`Search`, all three are used.

- [ ] **Step 3: Check the two `useEffect`s against the web lint rule**

Unlike the repo root, `apps/web` has a working ESLint config, and `react-hooks/set-state-in-effect` reports a synchronous `setState` inside an effect as a **hard error** in some shapes. Two effects in this component call `setQuery` / `setActiveIndex` directly.

Run: `cd apps/web && npx eslint src/components/ui/MultiSelect.tsx`

- If it reports **zero errors**, change nothing and move on.
- If it flags `react-hooks/set-state-in-effect` on a line, add `// eslint-disable-next-line react-hooks/set-state-in-effect` immediately above **that specific line** — the same convention `TasksPage.tsx` and `TimeEntriesPage.tsx` already use.

Do **not** add the directives pre-emptively to lines the rule does not flag: ESLint then reports them back as `Unused eslint-disable directive` warnings. `warning`-level output (e.g. `react-hooks/exhaustive-deps`) needs no action — those already exist throughout this codebase.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/MultiSelect.tsx
git commit -m "feat(web): add MultiSelect dropdown with checkboxes and in-menu search"
```

---

### Task 5: Wire the Tasks page

**Files:**
- Modify: `apps/web/src/pages/TasksPage.tsx`

**Interfaces:**
- Consumes: `MultiSelect` from Task 4, and the multi-value `GET /reports/tasks` from Task 2.
- Produces: nothing consumed by later tasks.

Six states change type: `statusFilter`, `priorityFilter`, `assigneeFilter`, `clientFilter`, `listFilter`, `folderFilter` become `string[]`. **`typeFilter` and `archivedFilter` stay `string`** and keep their `<Select>`.

- [ ] **Step 1: Import `MultiSelect`**

Add below the existing `Select` import (line 16). Keep the `Select` import — Type and Archived still use it.

```tsx
import { Select } from '../components/ui/Select';
import { MultiSelect } from '../components/ui/MultiSelect';
```

- [ ] **Step 2: Drop the sentinel from `PRIORITY_OPTIONS`**

Replace the constant at lines 32–38 with:

```tsx
const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];
```

Leave `TYPE_OPTIONS` and `ARCHIVED_OPTIONS` exactly as they are — they keep their `{ value: '', … }` first entry because they stay single-select.

- [ ] **Step 3: Change the six state declarations**

Replace lines 284–290 with:

```tsx
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [listFilter, setListFilter] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<string[]>([]);
```

- [ ] **Step 4: Clear the list/folder selections as arrays on space change**

In the `useEffect(() => { … }, [space])` at lines 336–343, change the two setters:

```tsx
    setListFilter([]);
    setFolderFilter([]);
```

(Keep the surrounding comment and the `// eslint-disable-next-line react-hooks/set-state-in-effect` directives.)

- [ ] **Step 5: Drop the sentinel from the five option builders**

In `assigneeOptions` (line 354), replace:

```tsx
    const opts: { value: string; label: string; icon?: ReactNode }[] = [{ value: '', label: 'Any assignee' }];
```
with:
```tsx
    const opts: { value: string; label: string; icon?: ReactNode }[] = [];
```

In `clientOptions` (line 366), replace `const opts = [{ value: '', label: 'Any client' }];` with `const opts: { value: string; label: string }[] = [];`

In `listOptions` (line 378), replace `const opts = [{ value: '', label: 'Any list' }];` with `const opts: { value: string; label: string }[] = [];`

In `folderOptions` (line 391), replace `const opts = [{ value: '', label: 'Any folder' }];` with `const opts: { value: string; label: string }[] = [];`

In `statusOptions` (line 406), replace:

```tsx
    const opts: { value: string; label: string }[] = [{ value: '', label: 'Any status' }];
```
with:
```tsx
    const opts: { value: string; label: string }[] = [];
```

- [ ] **Step 6: Serialize the arrays in `taskParams`**

In the `taskParams` `useMemo` (lines 418–439), replace these six lines:

```tsx
    status: statusFilter || undefined,
    priority: priorityFilter || undefined,
    type: typeFilter || undefined,
    search: search || undefined,
    assigneeId: assigneeFilter || undefined,
    client: clientFilter || undefined,
    listId: listFilter || undefined,
    folderId: folderFilter || undefined,
```

with:

```tsx
    // Multi-select filters go over the wire comma-separated; an empty selection
    // omits the param entirely, which the backend reads as "no constraint".
    status: statusFilter.length ? statusFilter.join(',') : undefined,
    priority: priorityFilter.length ? priorityFilter.join(',') : undefined,
    type: typeFilter || undefined,
    search: search || undefined,
    assigneeId: assigneeFilter.length ? assigneeFilter.join(',') : undefined,
    client: clientFilter.length ? clientFilter.join(',') : undefined,
    listId: listFilter.length ? listFilter.join(',') : undefined,
    folderId: folderFilter.length ? folderFilter.join(',') : undefined,
```

The dependency array on line 439 already lists all six states by name and needs no change.

- [ ] **Step 7: Update `hasFilters` and `reset()`**

Replace `hasFilters` (lines 447–449) with:

```tsx
  const hasFilters = !!(
    searchRaw || search || statusFilter.length || priorityFilter.length || typeFilter
    || assigneeFilter.length || clientFilter.length || listFilter.length || folderFilter.length
    || archivedFilter !== 'exclude' || taskIdsFilter.length > 0
  );
```

Replace the body of `reset()` (lines 451–464) with:

```tsx
  function reset() {
    setSearchRaw('');
    setSearch('');
    setStatusFilter([]);
    setPriorityFilter([]);
    setTypeFilter('');
    setAssigneeFilter([]);
    setClientFilter([]);
    setListFilter([]);
    setFolderFilter([]);
    setArchivedFilter('exclude');
    setTaskIdsFilter([]);
    setPage(1);
  }
```

- [ ] **Step 8: Swap the six filter controls**

Replace the eight `<Select>` lines in the filter bar (lines 773–780) with:

```tsx
        <MultiSelect ariaLabel="Filter by status" size="md" allLabel="Any status" value={statusFilter} onChange={v => { setStatusFilter(v); setPage(1); }} options={statusOptions} />
        <MultiSelect ariaLabel="Filter by priority" size="md" allLabel="Any priority" value={priorityFilter} onChange={v => { setPriorityFilter(v); setPage(1); }} options={PRIORITY_OPTIONS} />
        <MultiSelect ariaLabel="Filter by assignee" size="md" allLabel="Any assignee" value={assigneeFilter} onChange={v => { setAssigneeFilter(v); setPage(1); }} options={assigneeOptions} />
        <MultiSelect ariaLabel="Filter by client" size="md" allLabel="Any client" value={clientFilter} onChange={v => { setClientFilter(v); setPage(1); }} options={clientOptions} />
        <MultiSelect ariaLabel="Filter by folder" size="md" allLabel="Any folder" value={folderFilter} onChange={v => { setFolderFilter(v); setPage(1); }} options={folderOptions} />
        <MultiSelect ariaLabel="Filter by list" size="md" allLabel="Any list" value={listFilter} onChange={v => { setListFilter(v); setPage(1); }} options={listOptions} />
        <Select ariaLabel="Filter by type" size="md" value={typeFilter} onChange={v => { setTypeFilter(v); setPage(1); }} options={TYPE_OPTIONS} />
        <Select ariaLabel="Filter by archived state" size="md" value={archivedFilter} onChange={v => { setArchivedFilter(v); setPage(1); }} options={ARCHIVED_OPTIONS} />
```

- [ ] **Step 9: Verify it typechecks**

Run: `cd apps/web && npx tsc -b`

Expected: exits 0. A `Type 'string' is not assignable to type 'string[]'` error means a call site from steps 3–8 was missed — fix it before continuing.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/TasksPage.tsx
git commit -m "feat(web): multi-select status, priority, assignee, client, folder and list filters on Tasks"
```

---

### Task 6: Wire the Time Entries page

**Files:**
- Modify: `apps/web/src/pages/TimeEntriesPage.tsx`

**Interfaces:**
- Consumes: `MultiSelect` from Task 4, and the multi-value `GET /reports/time-entries` + `/aggregates` from Task 3.
- Produces: nothing consumed by later tasks.

Five states change type: `userId`, `clientFilter`, `listFilter`, `folderFilter`, `status` become `string[]`. **`billable` stays `string` and `missingOnly` stays `boolean`**, both keeping their existing controls.

The URL deep-link effect in this file is the highest-risk edit in the whole plan — `MissingRatesPage` and `CostBucketDrawer` both navigate here with scalar params.

- [ ] **Step 1: Import `MultiSelect`**

Add below the existing `Select` import (line 19). Keep `Select` — Billable still uses it.

```tsx
import { Select } from '../components/ui/Select';
import { MultiSelect } from '../components/ui/MultiSelect';
```

- [ ] **Step 2: Drop the sentinel from `STATUS_OPTIONS`**

Replace lines 37–42 with:

```tsx
const STATUS_OPTIONS = [
  { value: 'COST_CALCULATED', label: 'Cost calculated' },
  { value: 'NO_RATE_FOUND', label: 'No rate found' },
  { value: 'COST_EXCLUDED', label: 'Excluded' },
];
```

Leave `BILLABLE_OPTIONS` exactly as it is.

- [ ] **Step 3: Change the five state declarations**

Replace lines 76–82 with:

```tsx
  const [userId, setUserId] = useState<string[]>([]);
  const [billable, setBillable] = useState('');
  const [status, setStatus] = useState<string[]>([]);
  const [missingOnly, setMissingOnly] = useState(false);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [listFilter, setListFilter] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<string[]>([]);
```

- [ ] **Step 4: Wrap the deep-link params in arrays**

This is the step that keeps `MissingRatesPage` (`?userId=…&status=NO_RATE_FOUND`) and `CostBucketDrawer` (`?from=…&to=…&search=…`) working. Inside the mount `useEffect`, make exactly these three changes and leave every surrounding comment and eslint directive in place.

Line 134 — replace:
```tsx
    if (urlUserId) setUserId(urlUserId);
```
with:
```tsx
    if (urlUserId) setUserId([urlUserId]);
```

Line 136 — replace:
```tsx
    if (urlClient) setClientFilter(urlClient);
```
with:
```tsx
    if (urlClient) setClientFilter([urlClient]);
```

Line 151 — replace:
```tsx
      setStatus(urlStatus);
```
with:
```tsx
      setStatus([urlStatus]);
```

- [ ] **Step 5: Update the two dependent effects**

In the `missingOnly` effect (lines 184–186), replace `setStatus('')` with `setStatus([])`:

```tsx
  useEffect(() => {
    if (missingOnly) setStatus([]);
  }, [missingOnly]);
```

In the `[space]` effect (lines 190–194), replace the two setters:

```tsx
    setListFilter([]);
    setFolderFilter([]);
```

- [ ] **Step 6: Drop the sentinel from the four option builders**

In `assigneeOptions` (line 199), replace:
```tsx
    const opts: { value: string; label: string; icon?: ReactNode }[] = [{ value: '', label: 'Any assignee' }];
```
with:
```tsx
    const opts: { value: string; label: string; icon?: ReactNode }[] = [];
```

In `clientOptions` (line 211), replace `const opts = [{ value: '', label: 'Any client' }];` with `const opts: { value: string; label: string }[] = [];`

In `listOptions` (line 222), replace `const opts = [{ value: '', label: 'Any list' }];` with `const opts: { value: string; label: string }[] = [];`

In `folderOptions` (line 235), replace `const opts = [{ value: '', label: 'Any folder' }];` with `const opts: { value: string; label: string }[] = [];`

- [ ] **Step 7: Serialize the arrays in `params`**

In the `params` `useMemo` (lines 245–269), replace these five lines:

```tsx
    userId: userId || undefined,
    client: clientFilter || undefined,
    listId: listFilter || undefined,
    folderId: folderFilter || undefined,
    billable: billable === 'true' || billable === 'false' ? billable : undefined,
    status: missingOnly ? undefined : (status || undefined),
```

with:

```tsx
    // Multi-select filters go over the wire comma-separated; an empty selection
    // omits the param entirely, which the backend reads as "no constraint".
    userId: userId.length ? userId.join(',') : undefined,
    client: clientFilter.length ? clientFilter.join(',') : undefined,
    listId: listFilter.length ? listFilter.join(',') : undefined,
    folderId: folderFilter.length ? folderFilter.join(',') : undefined,
    billable: billable === 'true' || billable === 'false' ? billable : undefined,
    status: missingOnly ? undefined : (status.length ? status.join(',') : undefined),
```

The dependency array on line 269 already names all five states and needs no change. `aggParams` derives from `params` by stripping `limit`/`offset`, so the aggregates query picks this up with no edit.

- [ ] **Step 8: Update `hasFilters` and `reset()`**

Replace `hasFilters` (lines 331–333) with:

```tsx
  const hasFilters = !!(
    search || userId.length || clientFilter.length || listFilter.length
    || folderFilter.length || billable || status.length || missingOnly
  );
```

Replace the body of `reset()` (lines 335–350) with:

```tsx
  const reset = useCallback(() => {
    setSearchRaw('');
    setSearch('');
    setUserId([]);
    setClientFilter([]);
    setListFilter([]);
    setFolderFilter([]);
    setBillable('');
    setStatus([]);
    setMissingOnly(false);
    setDeepLinkActive(false);
    setBypassSpace(false);
    setLinkFrom(null);
    setLinkTo(null);
    setPage(1);
  }, []);
```

- [ ] **Step 9: Swap the five filter controls**

Replace the six `<Select>` lines in the filter bar (lines 661–666) with:

```tsx
        <MultiSelect ariaLabel="Filter by assignee" size="md" allLabel="Any assignee" options={assigneeOptions} value={userId} onChange={(v) => { setUserId(v); setPage(1); }} />
        <MultiSelect ariaLabel="Filter by client" size="md" allLabel="Any client" options={clientOptions} value={clientFilter} onChange={(v) => { setClientFilter(v); setPage(1); }} />
        <MultiSelect ariaLabel="Filter by folder" size="md" allLabel="Any folder" options={folderOptions} value={folderFilter} onChange={(v) => { setFolderFilter(v); setPage(1); }} />
        <MultiSelect ariaLabel="Filter by list" size="md" allLabel="Any list" options={listOptions} value={listFilter} onChange={(v) => { setListFilter(v); setPage(1); }} />
        <Select ariaLabel="Filter by billable state" size="md" options={BILLABLE_OPTIONS} value={billable} onChange={(v) => { setBillable(v); setPage(1); }} />
        <MultiSelect ariaLabel="Filter by cost status" size="md" allLabel="Any status" options={STATUS_OPTIONS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} disabled={missingOnly} />
```

Leave the `<label>`-wrapped `<Switch>` for "Missing rate only" and the Reset `<Button>` after it untouched.

- [ ] **Step 10: Verify it typechecks**

Run: `cd apps/web && npx tsc -b`

Expected: exits 0. A `Type 'string' is not assignable to type 'string[]'` error points at a missed call site from steps 3–9 — most likely one of the three deep-link setters in step 4.

- [ ] **Step 11: Verify the whole web app builds**

Run: `cd apps/web && npm run build`

Expected: exits 0, Vite writes the bundle without errors.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/pages/TimeEntriesPage.tsx
git commit -m "feat(web): multi-select assignee, client, folder, list and cost-status filters on Time Entries"
```

---

### Task 7: End-to-end verification in the browser

**Files:** none modified. This task only runs the app and confirms behavior.

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing.

Setup (per the project's existing local-dev arrangement): backend on port `3002`, web dev server on port `5174`.

- [ ] **Step 1: Run the full backend suite one more time**

Run: `npm test`

Expected: PASS, no failures anywhere in `test/`.

- [ ] **Step 2: Start the stack**

```bash
npm run dev:deps      # postgres + redis
npm run start:dev     # backend
npm run dev:web       # dashboard (separate terminal)
```

- [ ] **Step 3: Verify Tasks-page multi-select**

Open the Tasks page. Confirm each of the following, and note the row count in the header pill at each step:

1. The Status trigger reads `Any status` with nothing selected.
2. Opening it shows a search box; typing narrows the option list; "No matches" appears for a nonsense query.
3. Ticking one status keeps the menu open, marks a filled checkbox, tints the trigger border, and the trigger reads that status name.
4. Ticking a second status changes the trigger to `<first> +1` and the row count **grows** relative to one status (union, not intersection). This is the core assertion of the whole feature — a shrinking count means the backend built an AND instead of an IN.
5. `Clear selection` empties the filter, closes the menu, and restores the full row count.
6. Type and Archived are still single-select dropdowns that close on pick.
7. `Reset` clears every filter at once.
8. Open the **rightmost** dropdowns (List, Type) and check the menu does not clip past the right edge of the filter-bar card. `MultiSelect`'s menu is `minWidth: 220` — wider than the old `Select` menu, which sized to its trigger — so the last dropdown in the row is the one at risk. If it clips, add `menuAlign="right"` to that dropdown so the menu grows inward, and commit the fix.

- [ ] **Step 4: Verify Time-Entries multi-select and the metric cards**

Open the Time Entries page. Select two clients and confirm:

1. The row count grows versus a single client.
2. **The metric cards (Total hours, Billable, Total cost) also grow**, and are consistent with the table. Cards that stay frozen on the single-client figure mean `timeEntriesAggregates` was missed in Task 3 — go back and apply the same change there.
3. Ticking "Missing rate only" greys out the Cost status dropdown as before.

- [ ] **Step 5: Verify the deep-links still work**

1. Go to Missing Rates → click an assignee's "Entries" button. It must land on Time Entries with **that assignee pre-selected in the Assignee dropdown** and the amber "deep link" chip showing. An `Any assignee` trigger here means step 4 of Task 6 was missed.
2. Go to Overview → open the cost-trend bucket drawer → click a client row. It must land on Time Entries with the search box and date window applied and the "linked view" chip showing.
3. Go to Missing Rates → click "Show more" / a task row. It must land on Tasks filtered to those task IDs with the "deep link" chip showing.

- [ ] **Step 6: Verify Excel export respects the multi-selection**

On the Tasks page with two clients selected, click **Export Excel**. Open the file and confirm the Client column contains rows for **both** selected clients and nothing else.

Repeat on the **Time Entries** page with two assignees selected: the exported User name column must contain both, and nothing else. Both pages spread the same params object into the export request, so a failure here means the params serialization in Task 5 Step 6 / Task 6 Step 7 is wrong, not the export code.

- [ ] **Step 7: Commit anything outstanding**

If steps 3–6 surfaced fixes, commit them. Otherwise there is nothing to commit and this task ends here.

```bash
git status   # expect: clean
```

---

## Notes for the implementer

- **`tasks()` takes 15 positional parameters.** When adding or editing a test call, count the `undefined`s against this order: `(spaceId, status, search, from, to, limit, offset, priority, assigneeId, type, archived, client, taskIds, listId, folderId)`. An off-by-one silently tests the wrong filter.
- `timeEntriesList()` order is `(userId, from, to, status, limit, offset, billable, search, spaceId, missingOnly, client, listId, folderId)`; `timeEntriesAggregates()` order is `(userId, from, to, status, billable, search, spaceId, missingOnly, client, listId, folderId)` — note aggregates has **no** `limit`/`offset`, so the two are not interchangeable.
- Do not "fix" the missing `isDeleted: false` on the client/list/folder relation filters in `time-entries-report.service.ts`. There is a comment explaining why it is absent; changing it makes client-only and client+space results disagree.
- The assignee filter's substring matching (`Sam` matches `Sameer`) is pre-existing and explicitly out of scope. Leave it.
- `SpacesPage` links to `/tasks?spaceId=…` but `TasksPage` never reads that param. This is a pre-existing dead deep-link, unrelated to this work — do not fix it here.

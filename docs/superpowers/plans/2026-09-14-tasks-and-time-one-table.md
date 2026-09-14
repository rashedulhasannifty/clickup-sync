# Tasks & time one-table page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/work` page ("Tasks & time", Beta) that lists every task with activity in the date range, the time logged on it, and expands each task into its time entries. It runs next to the existing Tasks and Time Entries pages as a trial.

**Architecture:**
- **Backend:** one new read-only service, `WorkReportService`, behind `GET /reports/work` (paged rows plus totals) and `GET /reports/work/entries` (the entries behind the same rows, for export). It reuses the two existing filter builders:
  - `buildTimeEntryWhere` for the entry side
  - a new `buildTaskWhere`, extracted unchanged from `TasksReportService.tasks`, for the task side

  The pure folding, pill, sort and totals logic lives in `work.assemble.ts` and is unit-tested without Prisma.
- **Frontend:** one new page and one new expansion component. The task drawer moves to its own file. `DataTable` gains server-side sort, and the xlsx helper gains multi-sheet export. Nothing on the old pages changes behavior.

**Tech Stack:** NestJS 11, Prisma 7, Jest (backend, `npm run test`), React + TanStack Query + Vite (`apps/web`, no test runner; it's verified by `npm run lint` + `npm run build` + a manual check).

**Spec:** `docs/superpowers/specs/2026-09-14-tasks-and-time-one-table-design.md`. Read it before starting. This plan implements it exactly; where the plan chooses a detail the spec leaves open, the task says so.

## Global Constraints

- The old pages (`TasksPage.tsx`, `TimeEntriesPage.tsx`, `TaskTimeEntriesPanel.tsx`) must behave exactly as before. The only edits allowed there are the drawer move (Task 6) and imports.
- No schema change, no migration, no new dependency (CLAUDE.md: "This starter intentionally pins package versions").
- No new write endpoint. Edits call the existing `PATCH /admin/tasks/chargeable` (via `ChargeableConfirmModal`) and `PATCH /admin/time-entries/chargeable-override`.
- **Date rule:** a task is listed if `updated_date` **or** an entry's `start_time` is in `[from, to]`. Logged and cost count only entries whose `start_time` is in range.
- **Chargeable pill and filter use one function (`rowChargeable`).** The `chargeable` filter runs before paging.
- **Space filter:** the entry side never passes `spaceId` to `buildTimeEntryWhere`. It adds `{ task: { spaceId } }` itself, so deleted tasks' time still counts.
- **`archived`:** default `'include'` on this page, applied identically to both sides.
- **Money:** new fields are `costCents` + `currency`. Don't add new `*Aud` fields.
- Prettier formatting. No `any` in new code (use `unknown` + narrowing). Never log tokens or secrets.
- **Feedback link:** it comes from `VITE_WORK_FEEDBACK_URL`. The link is hidden when unset. Don't hard-code an email address.

---

## File structure

**Backend**

| File | Responsibility |
|---|---|
| `src/reports/task-filter.util.ts` (new) | `TaskFilters`, `buildTaskWhere`, `WHOLLY_CHARGEABLE`, `WHOLLY_NON_CHARGEABLE`, `TASK_LIST_SELECT`, all moved out of `tasks-report.service.ts` |
| `src/reports/tasks-report.service.ts` (modify) | `tasks()` calls `buildTaskWhere` + `TASK_LIST_SELECT`; out-of-date comment fixed |
| `src/reports/work.assemble.ts` (new) | Pure: fold entry groups, row pill, `inRangeBecause`, sort, totals |
| `src/reports/work.assemble.spec.ts` (new) | Unit tests for the above |
| `src/reports/work-report.service.ts` (new) | Queries: entry aggregation, candidate tasks, chargeable inputs, paging, full columns, export entries |
| `test/work-report.service.spec.ts` (new) | Service tests with a mocked Prisma |
| `test/task-filter.util.spec.ts` (new) | `buildTaskWhere` options |
| `src/reports/reports.controller.ts`, `reports.module.ts`, `test/reports.controller.spec.ts` (modify) | Two routes, provider, controller test |

**Frontend (`apps/web/src`)**

| File | Responsibility |
|---|---|
| `hooks/useReports.ts` (modify) | `WorkRow` types, `useWork`; add `['work']` invalidation to the two chargeability hooks |
| `api/reports.ts` (modify) | `work()`, `workEntries()` |
| `lib/workParams.ts` (new) | `WorkParams` type, `NO_TASK_ID`, `toEntryListParams` (the one place the entry-list params are derived) |
| `lib/xlsx.ts` (modify) | `xlsxSheet` + `exportXlsxSheets` (multi-sheet); `exportXlsx` delegates to them |
| `hooks/useFilterOptions.tsx` (new) | Dropdown option builders shared with the new page |
| `components/tasks/TaskDetailDrawer.tsx` (new, moved) | The task drawer, plus `parseAssignees`, `subProjectsOf`, `Task` |
| `pages/TasksPage.tsx` (modify) | Imports the drawer from its new home; no behavior change |
| `components/ui/DataTable.tsx` (modify) | Optional controlled server-side sort (`sort` + `onSortChange`) |
| `components/work/WorkEntryRows.tsx` (new) | One task's entries, with round checkboxes |
| `pages/WorkPage.tsx` (new) | The page |
| `components/layout/Sidebar.tsx`, `components/layout/CommandPalette.tsx`, `App.tsx`, `apps/web/.env.example` (modify) | Nav item + Beta tag, palette entry, route, env var |

---

### Task 1: Extract `buildTaskWhere` (no behavior change)

**Files:**
- Create: `src/reports/task-filter.util.ts`
- Modify: `src/reports/tasks-report.service.ts:1-26` (imports + the two `WHOLLY_*` consts), `:252-367` (where-building + select inside `tasks()`)
- Test: `test/task-filter.util.spec.ts` (new); `test/tasks-report.service.spec.ts` (must stay green, unchanged)

**Interfaces:**
- Produces:
  - `buildTaskWhere(prisma: Pick<PrismaService, '$queryRaw'>, f: TaskFilters, opts?: TaskWhereOptions): Promise<Prisma.ClickupTaskWhereInput>`
  - `TaskFilters`, `TaskWhereOptions { dateWindow?: boolean; excludeDeleted?: boolean }`
  - `TASK_LIST_SELECT` (a `Prisma.ClickupTaskSelect`)
  - `WHOLLY_CHARGEABLE`, `WHOLLY_NON_CHARGEABLE`

- [ ] **Step 1: Write the failing test**

Create `test/task-filter.util.spec.ts`:

```ts
import { buildTaskWhere } from '../src/reports/task-filter.util';

describe('buildTaskWhere', () => {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;

  it('defaults: hides deleted tasks and applies from/to to updated_date', async () => {
    const where = await buildTaskWhere(prisma, { from: '2026-09-01', to: '2026-09-14' });
    expect(where.isDeleted).toBe(false);
    expect(where.updatedDate).toEqual({ gte: new Date('2026-09-01'), lte: new Date('2026-09-14') });
  });

  it('dateWindow:false drops the updated_date window', async () => {
    const where = await buildTaskWhere(prisma, { from: '2026-09-01', to: '2026-09-14' }, { dateWindow: false });
    expect(where.updatedDate).toBeUndefined();
  });

  it('excludeDeleted:false keeps soft-deleted tasks', async () => {
    const where = await buildTaskWhere(prisma, {}, { excludeDeleted: false });
    expect(where.isDeleted).toBeUndefined();
  });

  it('archived: undefined hides archived (existing Tasks-page behavior), include adds no clause', async () => {
    expect((await buildTaskWhere(prisma, {})).archived).toBe(false);
    expect((await buildTaskWhere(prisma, { archived: 'include' })).archived).toBeUndefined();
  });

  it('assigneeNames and search both land on AND without colliding', async () => {
    const where = await buildTaskWhere(prisma, { assigneeNames: 'Sam,Ria', search: 'checkout' });
    expect(Array.isArray(where.AND)).toBe(true);
    expect((where.AND as unknown[]).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/task-filter.util.spec.ts`
Expected: FAIL with `Cannot find module '../src/reports/task-filter.util'`.

- [ ] **Step 3: Create `src/reports/task-filter.util.ts`**

Move the two consts **verbatim**, with their doc comments, from `tasks-report.service.ts:8-26`. Move the where-building body from `tasks()` (lines 253-352) into the function below, renaming `this.prisma` → `prisma` and the positional params → `f.*`. Keep every existing comment in the moved code. The full file:

```ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { parseDate } from './report-date.util';
import { csvList, sprintStatusListIds, taskSearchOr } from './report-filter.util';

/**
 * "Everything on this task is chargeable": the flag says so, no (task,
 * assignee) rule contradicts it, and no entry has been overridden away.
 * `none` rather than "all entries are chargeable" so a task with no time on it
 * still qualifies. `partial` is defined as the complement of these two, which
 * is what keeps the three filter buckets exhaustive — see the filter below.
 */
export const WHOLLY_CHARGEABLE = {
  isChargeable: true,
  chargeabilityRules: { none: { chargeable: false } },
  timeEntries: { none: { isChargeable: false } },
} satisfies Prisma.ClickupTaskWhereInput;

export const WHOLLY_NON_CHARGEABLE = {
  isChargeable: false,
  chargeabilityRules: { none: { chargeable: true } },
  timeEntries: { none: { isChargeable: true } },
} satisfies Prisma.ClickupTaskWhereInput;

/** Columns the task list (and the /work page's rows) render. */
export const TASK_LIST_SELECT = {
  taskId: true, taskName: true, url: true, spaceId: true, spaceName: true, status: true, statusType: true, statusColor: true,
  priority: true, parentTaskId: true, assigneesNames: true, assigneesEmails: true,
  updatedDate: true, syncedAt: true, sprintPoints: true, sprintName: true, cost: true,
  client: true, subProjects: true, department: true, isDeleted: true, archived: true,
  listName: true, dueDate: true, timeEstimate: true, timeSpent: true,
  createdDate: true, closedDate: true, startDate: true, syncCount: true,
  estimation: true, folderName: true, creatorName: true, executiveName: true,
  isChargeable: true,
} satisfies Prisma.ClickupTaskSelect;

/** Every filter the Tasks page accepts. Multi-selects are comma-separated (see `csvList`). */
export interface TaskFilters {
  spaceId?: string;
  status?: string;
  search?: string;
  /** Applied to `updated_date` unless `dateWindow: false`. */
  from?: string;
  to?: string;
  priority?: string;
  /** Task assignee NAMES (substring match on `assignees_names`). */
  assigneeNames?: string;
  type?: string;
  archived?: string;
  client?: string;
  taskIds?: string;
  listId?: string;
  folderId?: string;
  sprintStatus?: string;
  chargeable?: string;
  subProject?: string;
}

export interface TaskWhereOptions {
  /** Apply `from`/`to` to `updated_date` (the Tasks page's meaning). Default true. */
  dateWindow?: boolean;
  /** Hide soft-deleted tasks. Default true. */
  excludeDeleted?: boolean;
}

/**
 * The one where-clause builder behind `/reports/tasks`, and the task side of
 * `/reports/work`. Extracted from `TasksReportService.tasks` unchanged; the two
 * options exist only so /work can list deleted tasks that have time in range
 * and apply its own "updated OR logged" date rule.
 */
export async function buildTaskWhere(
  prisma: Pick<PrismaService, '$queryRaw'>,
  f: TaskFilters,
  opts: TaskWhereOptions = {},
): Promise<Prisma.ClickupTaskWhereInput> {
  const where: Prisma.ClickupTaskWhereInput = {};
  // Clauses that would otherwise collide on a single `where` key accumulate
  // here and land on `where.AND` at the end. The assignee filter and the
  // free-text search each need their own OR group, so neither can own a bare
  // top-level key. Same pattern as `timeEntriesList`.
  const and: Prisma.ClickupTaskWhereInput[] = [];
  if (opts.excludeDeleted !== false) where.isDeleted = false;
  if (f.archived === 'only') {
    where.archived = true;
  } else if (f.archived === 'include') {
    // show archived and non-archived
  } else {
    // exclude, hide, undefined, '' — default: hide archived tasks
    where.archived = false;
  }
  // The categorical filters are multi-select in the dashboard and arrive as a
  // comma-separated list. A single value parses as a one-element list, so
  // pre-existing deep-links (e.g. `?client=Acme`) behave exactly as before.
  const statuses = csvList(f.status);
  const priorities = csvList(f.priority);
  const clients = csvList(f.client);
  const subProjects = csvList(f.subProject);
  const listIds = csvList(f.listId);
  const folderIds = csvList(f.folderId);
  const assigneeNames = csvList(f.assigneeNames);
  if (f.spaceId) where.spaceId = f.spaceId;
  if (statuses) where.status = { in: statuses };
  if (priorities) where.priority = { in: priorities };
  if (clients) where.client = { in: clients };
  // Any-of, exact per value — see `buildTimeEntryWhere`.
  if (subProjects) where.subProjects = { hasSome: subProjects };
  if (listIds) where.listId = { in: listIds };
  if (folderIds) where.folderId = { in: folderIds };
  if (f.type === 'parent') where.parentTaskId = null;
  if (f.type === 'subtask') where.parentTaskId = { not: null };
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
  if (f.taskIds) {
    const ids = f.taskIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) where.taskId = { in: ids };
  }
  if (opts.dateWindow !== false && (f.from || f.to)) {
    where.updatedDate = { gte: parseDate(f.from, new Date(0)), lte: parseDate(f.to, new Date()) };
  }
  // Free-text search across short, indexed-friendly fields (see `taskSearchOr`
  // for the field list and why it is shared with the Time Entries page).
  if (f.search?.trim()) {
    and.push({ OR: taskSearchOr(f.search.trim()) });
  }
  // Sprint (== clickup_lists row) status filter: 'active'/'completed' scopes
  // to tasks whose list isn't/is archived; 'all'/absent/unrecognized emits
  // no clause at all. See `sprintStatusListIds` for the fetch-ids-then-IN
  // rationale, and why an empty array must still push a (never-matching)
  // clause instead of being treated as "no filter".
  const sprintListIds = await sprintStatusListIds(prisma, f.sprintStatus);
  if (sprintListIds) and.push({ listId: { in: sprintListIds } });

  // Chargeability filter. Defined on the task flag, its (task, assignee)
  // rules and its entries — exactly the inputs of the tri-state pill that
  // `tasks()` emits — so the three buckets are mutually exclusive. Anything
  // else (absent, 'all', unrecognized) emits no clause.
  if (f.chargeable === 'true') {
    and.push(WHOLLY_CHARGEABLE);
  } else if (f.chargeable === 'false') {
    and.push(WHOLLY_NON_CHARGEABLE);
  } else if (f.chargeable === 'partial') {
    // The COMPLEMENT of the other two, not an enumeration of the ways a task
    // can be split. Enumerating them left a hole: a task whose every entry
    // was overridden away is not "mixed" and has no disagreeing rule, so it
    // matched none of the three buckets and was reachable by no filter.
    // Defining partial structurally makes the three exhaustive by
    // construction — a future signal cannot escape them again. Two separate
    // NOTs, not `NOT: [a, b]`, so this is unambiguously NOT(a) AND NOT(b).
    and.push({ NOT: WHOLLY_CHARGEABLE });
    and.push({ NOT: WHOLLY_NON_CHARGEABLE });
  }
  if (and.length) where.AND = and;
  return where;
}
```

The rewritten chargeability comment replaces the out-of-date "Phase 2 note … inert today" paragraph (old `tasks-report.service.ts:329-336`). Overrides ship now, and `WHOLLY_*` already carry the `timeEntries` arm.

- [ ] **Step 4: Point `tasks()` at the new module**

In `src/reports/tasks-report.service.ts`:
1. **Imports:** delete the two `WHOLLY_*` consts and their doc comment (lines 8-26). Change the imports to:
   ```ts
   import { csvList, sprintStatusListIds, taskSearchOr } from './report-filter.util';
   import { buildTaskWhere, TASK_LIST_SELECT } from './task-filter.util';
   ```
   Run `npm run lint` afterwards and drop any import that becomes unused. `csvList`, `sprintStatusListIds` and `taskSearchOr` are still used by other methods in the file; the linter will say if not.
2. **Where-building:** in `tasks()`, replace everything from `const where: Prisma.ClickupTaskWhereInput = {};` through `if (and.length) where.AND = and;` with:
   ```ts
   const where = await buildTaskWhere(this.prisma, {
     spaceId, status, search, from: fromParam, to: toParam, priority,
     assigneeNames: assigneeId, type, archived, client, taskIds, listId,
     folderId, sprintStatus, chargeable, subProject,
   });
   ```
3. **Select:** replace the inline `select: { taskId: true, … isChargeable: true, }` object in the `findMany` with `select: TASK_LIST_SELECT,`.

- [ ] **Step 5: Run tests to verify both pass**

Run: `npm run test -- test/task-filter.util.spec.ts test/tasks-report.service.spec.ts`
Expected: PASS (the existing tasks-report tests pass unchanged).

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/reports/task-filter.util.ts src/reports/tasks-report.service.ts test/task-filter.util.spec.ts
git commit -m "refactor(reports): extract buildTaskWhere from tasks()

No behavior change. /reports/work will reuse it for its task side. Also
replaces the out-of-date 'override arm is inert' comment: overrides ship
and WHOLLY_* already carry the entries arm."
```

---

### Task 2: Pure assembly helpers (`work.assemble.ts`)

**Files:**
- Create: `src/reports/work.assemble.ts`
- Test: `src/reports/work.assemble.spec.ts` (co-located, like `timesheet.assemble.spec.ts`)

**Interfaces:**
- Consumes: `isPartiallyChargeable` from `src/time-entries/chargeability.ts`
- Produces:
  - `EntryGroupRow`, `EntryBucket`, `foldEntryGroups(rows): Map<string, EntryBucket>`. Null `taskId` is keyed under the `noTaskKey` argument.
  - `TaskChargeInputs`, `RowChargeable`, `ChargeableSource`, `rowChargeable(bucket, task): { chargeable: RowChargeable; source: ChargeableSource }`
  - `WorkCandidate`, `ResolvedRow`, `inRangeBecause(c, bucket, from, to)`
  - `WorkSort`, `parseWorkSort(v)`, `sortRows(rows, sort, dir)`
  - `WorkTotals`, `sumTotals(rows)`

- [ ] **Step 1: Write the failing tests**

Create `src/reports/work.assemble.spec.ts`:

```ts
import {
  foldEntryGroups, inRangeBecause, parseWorkSort, rowChargeable, sortRows, sumTotals,
  type EntryBucket, type EntryGroupRow, type ResolvedRow,
} from './work.assemble';

const g = (over: Partial<EntryGroupRow>): EntryGroupRow => ({
  taskId: 't1', userId: 'u1', userName: 'Rashedul', status: 'COST_CALCULATED', currency: 'USD',
  isChargeable: true, count: 1, hours: 1, costCents: 5000, lastStart: new Date('2026-09-10T10:00:00Z'),
  ...over,
});

const bucket = (over: Partial<EntryBucket>): EntryBucket => ({
  entryCount: 1, hours: 1, chargeableHours: 1, nonChargeableCount: 0, costCents: 0,
  missingRateCount: 0, excludedCount: 0, lastActivity: null, currency: 'USD', loggers: new Map(),
  ...over,
});

describe('foldEntryGroups', () => {
  it('sums per task, keeps missing-rate cost out of the total, counts excluded', () => {
    const m = foldEntryGroups([
      g({ hours: 2, costCents: 10000 }),
      g({ userId: 'u2', userName: 'Sayem', hours: 1.5, isChargeable: false, costCents: 0, status: 'NOT_CHARGEABLE' }),
      g({ userId: 'u3', status: 'NO_RATE_FOUND', hours: 3, costCents: 999 }),
      g({ userId: 'u4', status: 'COST_EXCLUDED', hours: 1, costCents: 0 }),
    ], '__none__');
    const b = m.get('t1')!;
    expect(b.entryCount).toBe(4);
    expect(b.hours).toBe(7.5);
    expect(b.chargeableHours).toBe(6);
    expect(b.nonChargeableCount).toBe(1);
    expect(b.costCents).toBe(10000);
    expect(b.missingRateCount).toBe(1);
    expect(b.excludedCount).toBe(1);
    expect([...b.loggers.keys()].sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('keys task-less entries under the sentinel', () => {
    const m = foldEntryGroups([g({ taskId: null })], '__none__');
    expect(m.has('__none__')).toBe(true);
  });

  it('keeps the latest start as lastActivity', () => {
    const m = foldEntryGroups([
      g({ lastStart: new Date('2026-09-02T00:00:00Z') }),
      g({ userId: 'u2', lastStart: new Date('2026-09-09T00:00:00Z') }),
    ], '__none__');
    expect(m.get('t1')!.lastActivity).toEqual(new Date('2026-09-09T00:00:00Z'));
  });
});

describe('rowChargeable', () => {
  it('entries source: all chargeable -> yes, none -> no, mixed -> partial', () => {
    expect(rowChargeable(bucket({ entryCount: 3, nonChargeableCount: 0 }), undefined)).toEqual({ chargeable: 'yes', source: 'entries' });
    expect(rowChargeable(bucket({ entryCount: 3, nonChargeableCount: 3 }), undefined)).toEqual({ chargeable: 'no', source: 'entries' });
    expect(rowChargeable(bucket({ entryCount: 3, nonChargeableCount: 1 }), undefined)).toEqual({ chargeable: 'partial', source: 'entries' });
  });

  it('task source follows the Tasks page: flag, disagreeing rule, overridden entries', () => {
    const t = { taskChargeable: true, rules: [] as boolean[], entryCount: 0, nonChargeableCount: 0 };
    expect(rowChargeable(undefined, t)).toEqual({ chargeable: 'yes', source: 'task' });
    expect(rowChargeable(undefined, { ...t, taskChargeable: false })).toEqual({ chargeable: 'no', source: 'task' });
    expect(rowChargeable(undefined, { ...t, rules: [false] })).toEqual({ chargeable: 'partial', source: 'task' });
    // Every (out-of-range) entry overridden against the flag: partial, as on the Tasks page.
    expect(rowChargeable(undefined, { ...t, entryCount: 2, nonChargeableCount: 2 })).toEqual({ chargeable: 'partial', source: 'task' });
  });

  it('refuses to guess when a no-entry row has no task inputs', () => {
    expect(() => rowChargeable(undefined, undefined)).toThrow(/task inputs required/);
  });
});

describe('inRangeBecause', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-14T23:59:59Z');
  const c = { taskId: 't1', taskName: 'x', updatedDate: new Date('2026-09-05T00:00:00Z'), isDeleted: false, isChargeable: true };
  it('updated / logged / both', () => {
    expect(inRangeBecause(c, undefined, from, to)).toBe('updated');
    expect(inRangeBecause({ ...c, updatedDate: new Date('2026-08-01T00:00:00Z') }, bucket({}), from, to)).toBe('logged');
    expect(inRangeBecause(c, bucket({}), from, to)).toBe('both');
  });
  it('a deleted task never counts as updated', () => {
    expect(inRangeBecause({ ...c, isDeleted: true }, bucket({}), from, to)).toBe('logged');
  });
});

describe('sortRows / parseWorkSort / sumTotals', () => {
  const row = (taskId: string, hours: number, name: string): ResolvedRow => ({
    taskId, taskName: name, updatedDate: null, isDeleted: false, isChargeable: true,
    bucket: hours ? bucket({ hours, entryCount: 1, costCents: hours * 100, chargeableHours: hours }) : undefined,
    inRangeBecause: hours ? 'logged' : 'updated',
  });

  it('logged desc with a stable taskId tie-break', () => {
    const out = sortRows([row('b', 2, 'B'), row('a', 2, 'A'), row('c', 5, 'C'), row('d', 0, 'D')], 'logged', 'desc');
    expect(out.map((r) => r.taskId)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('name asc is case-insensitive', () => {
    const out = sortRows([row('1', 1, 'beta'), row('2', 1, 'Alpha')], 'name', 'asc');
    expect(out.map((r) => r.taskName)).toEqual(['Alpha', 'beta']);
  });

  it('unknown sort falls back to logged', () => {
    expect(parseWorkSort('bogus')).toBe('logged');
    expect(parseWorkSort('cost')).toBe('cost');
  });

  it('totals sum every row given (no-entry rows count as tasks with 0h)', () => {
    const t = sumTotals([row('a', 2, 'A'), row('b', 0, 'B'), row('c', 3, 'C')]);
    expect(t).toEqual({ tasks: 3, entries: 2, hours: 5, chargeableHours: 5, costCents: 500, missingRateCount: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/reports/work.assemble.spec.ts`
Expected: FAIL with `Cannot find module './work.assemble'`.

- [ ] **Step 3: Implement `src/reports/work.assemble.ts`**

```ts
import { isPartiallyChargeable } from '../time-entries/chargeability';

/**
 * Pure assembly for `/reports/work`. Everything here is Prisma-free so the
 * rules the spec cares about — the pill, the date reason, sort, totals — are
 * tested directly. See docs/superpowers/specs/2026-09-14-tasks-and-time-one-table-design.md.
 */

export type WorkSort = 'logged' | 'updated' | 'name' | 'cost' | 'lastActivity';
export type RowChargeable = 'yes' | 'no' | 'partial';
export type ChargeableSource = 'entries' | 'task';

/** One `groupBy` row over time entries, already converted from Prisma types. */
export interface EntryGroupRow {
  taskId: string | null;
  userId: string | null;
  userName: string | null;
  status: string;
  currency: string | null;
  isChargeable: boolean;
  count: number;
  hours: number;
  costCents: number;
  lastStart: Date | null;
}

/** The in-range entries of one task, summed. */
export interface EntryBucket {
  entryCount: number;
  hours: number;
  chargeableHours: number;
  nonChargeableCount: number;
  /** Rated entries only — a NO_RATE_FOUND entry is counted, never costed. */
  costCents: number;
  missingRateCount: number;
  excludedCount: number;
  lastActivity: Date | null;
  currency: string | null;
  loggers: Map<string, string | null>;
}

export function foldEntryGroups(rows: EntryGroupRow[], noTaskKey: string): Map<string, EntryBucket> {
  const out = new Map<string, EntryBucket>();
  for (const r of rows) {
    const key = r.taskId ?? noTaskKey;
    let b = out.get(key);
    if (!b) {
      b = {
        entryCount: 0, hours: 0, chargeableHours: 0, nonChargeableCount: 0, costCents: 0,
        missingRateCount: 0, excludedCount: 0, lastActivity: null, currency: null, loggers: new Map(),
      };
      out.set(key, b);
    }
    b.entryCount += r.count;
    b.hours += r.hours;
    // Counts, not an hours sum, decide chargeability — see `rowChargeable`.
    if (r.isChargeable) b.chargeableHours += r.hours;
    else b.nonChargeableCount += r.count;
    // Same rule as `timeEntriesByTask`: an entry with no rate contributes no
    // cost and is surfaced as a count instead.
    if (r.status === 'NO_RATE_FOUND') b.missingRateCount += r.count;
    else b.costCents += r.costCents;
    if (r.status === 'COST_EXCLUDED') b.excludedCount += r.count;
    if (r.userId) b.loggers.set(r.userId, r.userName);
    if (r.lastStart && (!b.lastActivity || r.lastStart > b.lastActivity)) b.lastActivity = r.lastStart;
    b.currency ??= r.currency;
  }
  return out;
}

/** The Tasks page's pill inputs for one task (all-time, not range-scoped). */
export interface TaskChargeInputs {
  taskChargeable: boolean;
  rules: boolean[];
  entryCount: number;
  nonChargeableCount: number;
}

/**
 * The ONE function behind both the row pill and the `chargeable` filter on
 * /work, so the two cannot disagree and the buckets stay exhaustive.
 *
 * - A row with counted entries answers from those entries (range-scoped, like
 *   `timeEntriesByTask`, which passes `rules: []` for the same reason).
 * - A row with none (listed because it was updated) answers with the task's
 *   standing answer, from exactly the inputs `tasksList` uses.
 */
export function rowChargeable(
  bucket: EntryBucket | undefined,
  task: TaskChargeInputs | undefined,
): { chargeable: RowChargeable; source: ChargeableSource } {
  if (bucket && bucket.entryCount > 0) {
    if (bucket.nonChargeableCount === 0) return { chargeable: 'yes', source: 'entries' };
    if (bucket.nonChargeableCount === bucket.entryCount) return { chargeable: 'no', source: 'entries' };
    return { chargeable: 'partial', source: 'entries' };
  }
  if (!task) {
    // Guessing "yes" here is exactly the silent wrong answer the spec forbids.
    throw new Error('rowChargeable: task inputs required for a row with no counted entries');
  }
  if (isPartiallyChargeable({
    taskChargeable: task.taskChargeable,
    rules: task.rules,
    entryCount: task.entryCount,
    nonChargeableCount: task.nonChargeableCount,
  })) {
    return { chargeable: 'partial', source: 'task' };
  }
  return { chargeable: task.taskChargeable ? 'yes' : 'no', source: 'task' };
}

/** A task that passed the task filters and the date rule. */
export interface WorkCandidate {
  taskId: string;
  taskName: string | null;
  updatedDate: Date | null;
  isDeleted: boolean;
  isChargeable: boolean;
}

export interface ResolvedRow extends WorkCandidate {
  bucket: EntryBucket | undefined;
  inRangeBecause: 'updated' | 'logged' | 'both';
}

export function inRangeBecause(
  c: WorkCandidate,
  bucket: EntryBucket | undefined,
  from: Date,
  to: Date,
): 'updated' | 'logged' | 'both' {
  // A deleted task is only ever listed for its time (see the spec's "Special rows").
  const updated = !c.isDeleted && c.updatedDate != null && c.updatedDate >= from && c.updatedDate <= to;
  const logged = !!bucket && bucket.entryCount > 0;
  if (updated && logged) return 'both';
  return logged ? 'logged' : 'updated';
}

export function parseWorkSort(v: string | undefined): WorkSort {
  return v === 'updated' || v === 'name' || v === 'cost' || v === 'lastActivity' ? v : 'logged';
}

export function sortRows<T extends ResolvedRow>(rows: T[], sort: WorkSort, dir: 'asc' | 'desc'): T[] {
  const num = (r: T): number => {
    switch (sort) {
      case 'cost': return r.bucket?.costCents ?? 0;
      case 'lastActivity': return r.bucket?.lastActivity?.getTime() ?? 0;
      case 'updated': return r.updatedDate?.getTime() ?? 0;
      default: return r.bucket?.hours ?? 0;
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = sort === 'name'
      ? (a.taskName ?? '').localeCompare(b.taskName ?? '', undefined, { sensitivity: 'base' })
      : num(a) - num(b);
    // Stable tie-break so equal rows don't shuffle between pages.
    return cmp * sign || a.taskId.localeCompare(b.taskId);
  });
}

export interface WorkTotals {
  tasks: number;
  entries: number;
  hours: number;
  chargeableHours: number;
  costCents: number;
  missingRateCount: number;
}

/** Summed over the rows passed in — callers pass EVERY matching row, never a page. */
export function sumTotals(rows: ResolvedRow[]): WorkTotals {
  const t: WorkTotals = { tasks: rows.length, entries: 0, hours: 0, chargeableHours: 0, costCents: 0, missingRateCount: 0 };
  for (const r of rows) {
    if (!r.bucket) continue;
    t.entries += r.bucket.entryCount;
    t.hours += r.bucket.hours;
    t.chargeableHours += r.bucket.chargeableHours;
    t.costCents += r.bucket.costCents;
    t.missingRateCount += r.bucket.missingRateCount;
  }
  return t;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/reports/work.assemble.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/work.assemble.ts src/reports/work.assemble.spec.ts
git commit -m "feat(reports): pure assembly helpers for the /work page"
```

---

### Task 3: `WorkReportService`

**Files:**
- Create: `src/reports/work-report.service.ts`
- Test: `test/work-report.service.spec.ts`

**Interfaces:**
- Consumes:
  - Task 1: `buildTaskWhere`, `TASK_LIST_SELECT`
  - Task 2: all exports
  - Existing: `buildTimeEntryWhere`, `NO_TASK_ID`, `taskSearchOr` (`report-filter.util.ts`), and `parseDate`, `defaultFrom` (`report-date.util.ts`)
- Produces:
  - `WorkParams` (every query param as `string | undefined`, plus `limit`/`offset` numbers)
  - `WorkReportService.work(p): Promise<{ items; total; limit; offset; totals }>` (the item shape is exactly the spec's response block)
  - `WorkReportService.workEntries(p): Promise<{ items: WorkEntryOut[]; truncated: boolean }>`

- [ ] **Step 1: Write the failing tests**

Create `test/work-report.service.spec.ts`:

```ts
import { WorkReportService } from '../src/reports/work-report.service';

const dec = (n: number) => ({ toNumber: () => n });

/** A Prisma `groupBy` row for time entries, as the service receives it. */
function grp(taskId: string | null, over: Partial<{ userId: string; isChargeable: boolean; status: string; count: number; hours: number; cost: bigint }> = {}) {
  return {
    taskId, userId: over.userId ?? 'u1', userName: 'Rashedul', status: over.status ?? 'COST_CALCULATED',
    currency: 'USD', isChargeable: over.isChargeable ?? true,
    _count: over.count ?? 1,
    _sum: { durationHours: dec(over.hours ?? 1), costCents: over.cost ?? 100n },
    _max: { startTime: new Date('2026-09-10T00:00:00Z') },
  };
}

function cand(taskId: string, over: Partial<{ updatedDate: Date | null; isDeleted: boolean; isChargeable: boolean; taskName: string }> = {}) {
  return {
    taskId, taskName: over.taskName ?? taskId, updatedDate: over.updatedDate ?? new Date('2026-09-05T00:00:00Z'),
    isDeleted: over.isDeleted ?? false, isChargeable: over.isChargeable ?? true,
  };
}

/**
 * Call order inside the service is fixed, so the mocks answer positionally:
 * clickupTimeEntry.groupBy -> [0] in-range entries, [1] all-time counts (only when needed);
 * clickupTask.findMany     -> [0] candidates, [1] full columns for the page.
 */
function makePrisma(opts: {
  groups?: unknown[]; candidates?: unknown[]; pageTasks?: unknown[]; counts?: unknown[]; rules?: unknown[];
}) {
  const groupBy = jest.fn()
    .mockResolvedValueOnce(opts.groups ?? [])
    .mockResolvedValue(opts.counts ?? []);
  const taskFind = jest.fn()
    .mockResolvedValueOnce(opts.candidates ?? [])
    .mockImplementation((args: { where: { taskId: { in: string[] } } }) =>
      Promise.resolve((opts.pageTasks ?? []).filter((t) => args.where.taskId.in.includes((t as { taskId: string }).taskId))));
  return {
    clickupTimeEntry: { groupBy, findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    clickupTask: { findMany: taskFind },
    taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue(opts.rules ?? []) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as any;
}

const base = { from: '2026-09-01T00:00:00Z', to: '2026-09-14T23:59:59Z' };

describe('WorkReportService.work', () => {
  it('lists updated-only, logged-only and both; totals cover every row', async () => {
    const prisma = makePrisma({
      groups: [grp('t2', { hours: 2 }), grp('t3', { hours: 3 })],
      candidates: [cand('t1'), cand('t2', { updatedDate: new Date('2026-08-01T00:00:00Z') }), cand('t3')],
      pageTasks: [cand('t1'), cand('t2'), cand('t3')],
    });
    const res = await new WorkReportService(prisma).work({ ...base });
    const byId = Object.fromEntries(res.items.map((r) => [r.taskId, r]));
    expect(byId.t1.inRangeBecause).toBe('updated');
    expect(byId.t1.logged).toBeNull();
    expect(byId.t2.inRangeBecause).toBe('logged');
    expect(byId.t3.inRangeBecause).toBe('both');
    expect(res.total).toBe(3);
    expect(res.totals.hours).toBe(5);
    // Candidate query: task filters AND (updated in range & not deleted OR has entries).
    const where = prisma.clickupTask.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"taskId":{"in":["t2","t3"]}');
    expect(JSON.stringify(where)).toContain('"isDeleted":false');
  });

  it('with an entry filter, only tasks with matching entries are candidates', async () => {
    const prisma = makePrisma({ groups: [grp('t2')], candidates: [cand('t2')], pageTasks: [cand('t2')] });
    await new WorkReportService(prisma).work({ ...base, loggedBy: 'u1' });
    const where = prisma.clickupTask.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('updatedDate');
    expect(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where.userId).toEqual({ in: ['u1'] });
  });

  it('space filter: entry side scopes by the task space without excluding deleted tasks', async () => {
    const prisma = makePrisma({ groups: [grp('t9')], candidates: [cand('t9', { isDeleted: true })], pageTasks: [cand('t9', { isDeleted: true })] });
    const res = await new WorkReportService(prisma).work({ ...base, spaceId: 's1' });
    const entryWhere = JSON.stringify(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where);
    expect(entryWhere).toContain('"spaceId":"s1"');
    expect(entryWhere).not.toContain('"isDeleted":false');
    expect(res.items[0].isDeleted).toBe(true);
    expect(res.totals.hours).toBe(1);
  });

  it('archived defaults to include on BOTH sides', async () => {
    const prisma = makePrisma({});
    await new WorkReportService(prisma).work({ ...base });
    expect(JSON.stringify(prisma.clickupTask.findMany.mock.calls[0][0].where)).not.toContain('"archived"');
    expect(JSON.stringify(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where)).not.toContain('archived');
  });

  it('chargeable=partial is applied BEFORE paging (total and every page agree)', async () => {
    const groups = [
      grp('p1', { isChargeable: true }), grp('p1', { userId: 'u2', isChargeable: false }),
      grp('p2', { isChargeable: true }), grp('p2', { userId: 'u2', isChargeable: false }),
      grp('p3', { isChargeable: true }), grp('p3', { userId: 'u2', isChargeable: false }),
      grp('y1', { isChargeable: true }), grp('n1', { isChargeable: false }),
    ];
    const ids = ['p1', 'p2', 'p3', 'y1', 'n1'];
    const mk = () => makePrisma({ groups, candidates: ids.map((i) => cand(i)), pageTasks: ids.map((i) => cand(i)) });
    const page1 = await new WorkReportService(mk()).work({ ...base, chargeable: 'partial', limit: 2, offset: 0 });
    const page2 = await new WorkReportService(mk()).work({ ...base, chargeable: 'partial', limit: 2, offset: 2 });
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect([...page1.items, ...page2.items].map((r) => r.chargeable)).toEqual(['partial', 'partial', 'partial']);
    expect(page1.totals.entries).toBe(6);
  });

  it('updated-only row uses the task inputs: every entry overridden against the flag -> partial', async () => {
    const prisma = makePrisma({
      candidates: [cand('t1', { isChargeable: true })],
      pageTasks: [cand('t1')],
      counts: [{ taskId: 't1', isChargeable: false, _count: 2 }],
    });
    const res = await new WorkReportService(prisma).work({ ...base });
    expect(res.items[0]).toMatchObject({ chargeable: 'partial', chargeableSource: 'task' });
  });

  it('"(No task)" row appears only when no task-only filter is set', async () => {
    const mk = () => makePrisma({ groups: [grp(null)], candidates: [], pageTasks: [] });
    const plain = await new WorkReportService(mk()).work({ ...base });
    expect(plain.items.map((r) => r.taskId)).toEqual(['__none__']);
    const filtered = await new WorkReportService(mk()).work({ ...base, status: 'complete' });
    expect(filtered.items).toEqual([]);
  });

  it('sorts logged desc by default and pages after sorting', async () => {
    const prisma = makePrisma({
      groups: [grp('a', { hours: 1 }), grp('b', { hours: 5 })],
      candidates: [cand('a'), cand('b')], pageTasks: [cand('a'), cand('b')],
    });
    const res = await new WorkReportService(prisma).work({ ...base, limit: 1 });
    expect(res.items.map((r) => r.taskId)).toEqual(['b']);
    expect(res.totals.hours).toBe(6);
  });
});

describe('WorkReportService.workEntries', () => {
  it('uses the same entry where as the aggregation, limited to the listed tasks', async () => {
    const prisma = makePrisma({ groups: [grp('t2')], candidates: [cand('t2')] });
    await new WorkReportService(prisma).workEntries({ ...base, loggedBy: 'u1' });
    const aggWhere = prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where;
    const listWhere = prisma.clickupTimeEntry.findMany.mock.calls[0][0].where;
    expect(listWhere.AND[0]).toEqual(aggWhere);
    expect(listWhere.AND[1]).toEqual({ OR: [{ taskId: { in: ['t2'] } }] });
  });

  it('over the 5000 cap returns no entries and truncated:true (never a partial sheet)', async () => {
    const prisma = makePrisma({ groups: [grp('t2')], candidates: [cand('t2')] });
    const entry = {
      timeEntryId: 'e', taskId: 't2', userId: 'u1', userName: 'R', userEmail: null,
      startTime: new Date(), endTime: null, durationHours: dec(1), hourlyRateCents: 0n,
      costCents: 0n, currency: 'USD', status: 'COST_CALCULATED', isChargeable: true,
      chargeableOverride: null, description: null, task: { taskName: 't2' },
    };
    prisma.clickupTimeEntry.findMany.mockResolvedValue(Array.from({ length: 5001 }, (_, i) => ({ ...entry, timeEntryId: `e${i}` })));
    const res = await new WorkReportService(prisma).workEntries({ ...base });
    expect(res).toEqual({ items: [], truncated: true });
    expect(prisma.clickupTimeEntry.findMany.mock.calls[0][0].take).toBe(5001);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/work-report.service.spec.ts`
Expected: FAIL with `Cannot find module '../src/reports/work-report.service'`.

- [ ] **Step 3: Implement `src/reports/work-report.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { defaultFrom, parseDate } from './report-date.util';
import { buildTimeEntryWhere, NO_TASK_ID, taskSearchOr } from './report-filter.util';
import { buildTaskWhere, TASK_LIST_SELECT } from './task-filter.util';
import {
  foldEntryGroups, inRangeBecause, parseWorkSort, rowChargeable, sortRows, sumTotals,
  type ChargeableSource, type EntryBucket, type ResolvedRow, type RowChargeable,
  type TaskChargeInputs, type WorkCandidate,
} from './work.assemble';

/** Query params of `/reports/work` and `/reports/work/entries`. */
export interface WorkParams {
  from?: string;
  to?: string;
  spaceId?: string;
  search?: string;
  // Task-only filters: choose rows, never change a row's Logged.
  status?: string;
  priority?: string;
  type?: string;
  /** Task assignee NAMES, like the Tasks page `assigneeId`. */
  assignedTo?: string;
  // Entry filters: choose which entries are counted.
  /** Entry `userId`s (who logged the time). */
  loggedBy?: string;
  costStatus?: string;
  missingOnly?: string;
  // Task attributes: applied to both sides.
  client?: string;
  subProject?: string;
  listId?: string;
  folderId?: string;
  archived?: string;
  sprintStatus?: string;
  /** Row pill filter: 'true' | 'false' | 'partial'. */
  chargeable?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

type PillRow = ResolvedRow & { pill?: { chargeable: RowChargeable; source: ChargeableSource } };

const MS_PER_H = 3_600_000;
/** Same cap as the Time Entries export. */
const MAX_EXPORT_ENTRIES = 5000;
const PILL_FOR: Record<string, RowChargeable> = { true: 'yes', false: 'no', partial: 'partial' };

/**
 * Backs the /work page: every task with activity in the range (updated OR time
 * logged), each carrying the in-range time on it. See the spec for why this is
 * two reused where-builders plus an in-memory merge rather than one SQL query.
 *
 * Sorting and paging happen in application code over every matching task.
 * That is safe only because this page always has a bounded range (same
 * argument as `timeEntriesByTask`). Do not add an all-time mode here without
 * moving sort + paging into SQL first.
 */
@Injectable()
export class WorkReportService {
  constructor(private readonly prisma: PrismaService) {}

  async work(p: WorkParams) {
    const limit = Math.min(p.limit ?? 50, 5000);
    const offset = p.offset ?? 0;
    const { rows, candidatesById } = await this.resolveRows(p);
    const page = rows.slice(offset, offset + limit);

    // Without a chargeable filter the pill was not needed to filter, so its
    // task inputs are loaded for this page only (as `tasksList` does).
    const needInputs = page.filter((r) => !r.pill && !(r.bucket && r.bucket.entryCount > 0)).map((r) => r.taskId);
    const inputs = await this.taskChargeInputs(needInputs, candidatesById);
    for (const r of page) r.pill ??= rowChargeable(r.bucket, inputs.get(r.taskId));

    const pageIds = page.map((r) => r.taskId).filter((id) => id !== NO_TASK_ID);
    const full = pageIds.length
      ? await this.prisma.clickupTask.findMany({ where: { taskId: { in: pageIds } }, select: TASK_LIST_SELECT })
      : [];
    const fullById = new Map(full.map((t) => [t.taskId, t]));

    return {
      items: page.map((r) => this.toItem(r, fullById.get(r.taskId))),
      total: rows.length,
      limit,
      offset,
      totals: sumTotals(rows),
    };
  }

  /** Every counted entry behind the rows `work(p)` would list (export). */
  async workEntries(p: WorkParams) {
    const { rows, entryWhere } = await this.resolveRows(p);
    const taskIds = rows.map((r) => r.taskId).filter((id) => id !== NO_TASK_ID);
    const or: Prisma.ClickupTimeEntryWhereInput[] = [];
    if (taskIds.length) or.push({ taskId: { in: taskIds } });
    if (rows.some((r) => r.taskId === NO_TASK_ID)) or.push({ taskId: null });
    if (!or.length) return { items: [], truncated: false };
    const found = await this.prisma.clickupTimeEntry.findMany({
      where: { AND: [entryWhere, { OR: or }] },
      orderBy: [{ startTime: 'desc' }],
      take: MAX_EXPORT_ENTRIES + 1,
      select: {
        timeEntryId: true, taskId: true, userId: true, userName: true, userEmail: true,
        startTime: true, endTime: true, durationHours: true, hourlyRateCents: true,
        costCents: true, currency: true, status: true, isChargeable: true,
        chargeableOverride: true, description: true, task: { select: { taskName: true } },
      },
    });
    // Over the cap, return nothing rather than a partial list: a workbook whose
    // Entries sheet silently misses some of the Tasks sheet's hours is worse
    // than no workbook. The page tells the user to narrow the filters.
    if (found.length > MAX_EXPORT_ENTRIES) return { items: [], truncated: true };
    return {
      items: found.map((e) => ({
        timeEntryId: e.timeEntryId,
        taskId: e.taskId,
        taskName: e.task?.taskName ?? null,
        userId: e.userId,
        userName: e.userName,
        userEmail: e.userEmail,
        startTime: e.startTime,
        endTime: e.endTime,
        durationHours: e.durationHours.toNumber(),
        hourlyRateCents: Number(e.hourlyRateCents),
        costCents: Number(e.costCents),
        currency: e.currency,
        status: e.status,
        chargeable: e.isChargeable,
        chargeableOverride: e.chargeableOverride,
        description: e.description,
      })),
      truncated: false,
    };
  }

  private static entryFiltersActive(p: WorkParams): boolean {
    return !!(p.loggedBy || p.costStatus || p.missingOnly === 'true');
  }

  private static taskOnlyFiltersActive(p: WorkParams): boolean {
    return !!(p.status || p.priority || p.type || p.assignedTo || p.search?.trim());
  }

  /**
   * Candidate rows with buckets, the chargeable filter applied (if set), sorted.
   * Shared by `work` and `workEntries` so the export can never list a different
   * task set than the page.
   */
  private async resolveRows(raw: WorkParams) {
    // Include is the page default and must mean the same thing on both sides
    // (buildTaskWhere treats undefined as "exclude", buildTimeEntryWhere as "include").
    const p: WorkParams = { ...raw, archived: raw.archived || 'include' };
    const from = parseDate(p.from, defaultFrom());
    const to = parseDate(p.to, new Date());

    const entryWhere = await this.entryWhere(p, from, to);
    const groups = await this.prisma.clickupTimeEntry.groupBy({
      by: ['taskId', 'userId', 'userName', 'status', 'currency', 'isChargeable'],
      where: entryWhere,
      _count: true,
      _sum: { durationHours: true, costCents: true },
      _max: { startTime: true },
    });
    const buckets = foldEntryGroups(groups.map((g) => ({
      taskId: g.taskId,
      userId: g.userId,
      userName: g.userName,
      status: g.status,
      currency: g.currency,
      isChargeable: g.isChargeable,
      count: typeof g._count === 'number' ? g._count : 0,
      hours: g._sum.durationHours?.toNumber() ?? 0,
      costCents: Number(g._sum.costCents ?? 0n),
      lastStart: g._max.startTime,
    })), NO_TASK_ID);

    const candidates = await this.candidates(p, from, to, buckets);
    const candidatesById = new Map(candidates.map((c) => [c.taskId, c]));
    let rows: PillRow[] = candidates.map((c) => {
      const bucket = buckets.get(c.taskId);
      return { ...c, bucket, inRangeBecause: inRangeBecause(c, bucket, from, to) };
    });

    const wanted = p.chargeable ? PILL_FOR[p.chargeable] : undefined;
    if (wanted) {
      // Filter the WHOLE candidate set before paging, so `total` and the pager
      // count only rows that pass. That needs every no-entry row's task inputs.
      const ids = rows.filter((r) => !(r.bucket && r.bucket.entryCount > 0)).map((r) => r.taskId);
      const inputs = await this.taskChargeInputs(ids, candidatesById);
      for (const r of rows) r.pill = rowChargeable(r.bucket, inputs.get(r.taskId));
      rows = rows.filter((r) => r.pill!.chargeable === wanted);
    }

    const sorted = sortRows(rows, parseWorkSort(p.sort), p.dir === 'asc' ? 'asc' : 'desc');
    return { rows: sorted, candidatesById, entryWhere };
  }

  /** The entry side. Spec, "Space filter decision": never pass spaceId down. */
  private async entryWhere(p: WorkParams, from: Date, to: Date): Promise<Prisma.ClickupTimeEntryWhereInput> {
    const where = await buildTimeEntryWhere(this.prisma, {
      from, to,
      userId: p.loggedBy,
      status: p.costStatus,
      missingOnly: p.missingOnly,
      client: p.client,
      subProject: p.subProject,
      listId: p.listId,
      folderId: p.folderId,
      archived: p.archived,
      sprintStatus: p.sprintStatus,
    });
    // buildTimeEntryWhere's own space clause adds `isDeleted: false`, which
    // would drop deleted tasks' time only when a space is picked.
    return p.spaceId ? { AND: [where, { task: { spaceId: p.spaceId } }] } : where;
  }

  private async candidates(
    p: WorkParams,
    from: Date,
    to: Date,
    buckets: Map<string, EntryBucket>,
  ): Promise<WorkCandidate[]> {
    const taskBase = await buildTaskWhere(this.prisma, {
      spaceId: p.spaceId, status: p.status, priority: p.priority, type: p.type,
      assigneeNames: p.assignedTo, client: p.client, subProject: p.subProject,
      listId: p.listId, folderId: p.folderId, archived: p.archived, sprintStatus: p.sprintStatus,
    }, { dateWindow: false, excludeDeleted: false });

    const bucketIds = [...buckets.keys()].filter((id) => id !== NO_TASK_ID);
    const inclusion: Prisma.ClickupTaskWhereInput = WorkReportService.entryFiltersActive(p)
      ? { taskId: { in: bucketIds } }
      : { OR: [{ updatedDate: { gte: from, lte: to }, isDeleted: false }, { taskId: { in: bucketIds } }] };

    const and: Prisma.ClickupTaskWhereInput[] = [taskBase, inclusion];
    const q = p.search?.trim();
    if (q) {
      // Task search, plus an exact time-entry-ID match (spec, Rule 2).
      const hit = await this.prisma.clickupTimeEntry.findFirst({ where: { timeEntryId: q }, select: { taskId: true } });
      and.push({ OR: [...taskSearchOr(q), ...(hit?.taskId ? [{ taskId: hit.taskId }] : [])] });
    }

    const found = await this.prisma.clickupTask.findMany({
      where: { AND: and },
      select: { taskId: true, taskName: true, updatedDate: true, isDeleted: true, isChargeable: true },
    });
    const out: WorkCandidate[] = found;
    // Entries with no task: one synthetic row, only when no task-only filter
    // could have excluded it (a task-less entry has no status/priority/name).
    if (buckets.has(NO_TASK_ID) && !WorkReportService.taskOnlyFiltersActive(p)) {
      out.push({ taskId: NO_TASK_ID, taskName: null, updatedDate: null, isDeleted: false, isChargeable: true });
    }
    return out;
  }

  /** The Tasks page's pill inputs (flag, rules, all-time entry counts) for `ids`. */
  private async taskChargeInputs(
    ids: string[],
    candidatesById: Map<string, WorkCandidate>,
  ): Promise<Map<string, TaskChargeInputs>> {
    const real = ids.filter((id) => id !== NO_TASK_ID);
    const out = new Map<string, TaskChargeInputs>();
    if (!real.length) return out;
    const [rules, counts] = await Promise.all([
      this.prisma.taskAssigneeChargeability.findMany({ where: { taskId: { in: real } }, select: { taskId: true, chargeable: true } }),
      this.prisma.clickupTimeEntry.groupBy({ by: ['taskId', 'isChargeable'], where: { taskId: { in: real } }, _count: true }),
    ]);
    for (const id of real) {
      out.set(id, { taskChargeable: candidatesById.get(id)?.isChargeable ?? true, rules: [], entryCount: 0, nonChargeableCount: 0 });
    }
    for (const r of rules) out.get(r.taskId)?.rules.push(r.chargeable);
    for (const g of counts) {
      const t = g.taskId ? out.get(g.taskId) : undefined;
      if (!t) continue;
      const n = typeof g._count === 'number' ? g._count : 0;
      t.entryCount += n;
      if (!g.isChargeable) t.nonChargeableCount += n;
    }
    return out;
  }

  private toItem(r: PillRow, t: Prisma.ClickupTaskGetPayload<{ select: typeof TASK_LIST_SELECT }> | undefined) {
    const b = r.bucket;
    // Drop the raw BigInt/Decimal columns; their converted forms are added below.
    const { timeEstimate, timeSpent, cost: _cost, estimation: _estimation, ...rest } = t ?? ({} as Partial<NonNullable<typeof t>>);
    return {
      ...rest,
      taskId: r.taskId,
      taskName: t?.taskName ?? null,
      isDeleted: r.isDeleted,
      timeEstimateHours: timeEstimate != null ? Number(timeEstimate) / MS_PER_H : null,
      lifetimeSpentHours: timeSpent != null ? Number(timeSpent) / MS_PER_H : null,
      inRangeBecause: r.inRangeBecause,
      chargeable: r.pill!.chargeable,
      chargeableSource: r.pill!.source,
      logged: b ? {
        entryCount: b.entryCount,
        hours: b.hours,
        chargeableHours: b.chargeableHours,
        costCents: b.costCents,
        currency: b.currency ?? 'USD',
        missingRateCount: b.missingRateCount,
        excludedCount: b.excludedCount,
        lastActivity: b.lastActivity,
        loggers: [...b.loggers.entries()]
          .map(([userId, userName]) => ({ userId, userName }))
          .sort((x, y) => (x.userName ?? '').localeCompare(y.userName ?? '')),
      } : null,
    };
  }
}
```

If lint flags `_cost` / `_estimation` as unused, keep them and add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` on that line. `tasks-report.service.ts:419` destructures the same way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/work-report.service.spec.ts`
Expected: PASS. If a test fails on call order, fix the service to match the order documented in `makePrisma`, not the test.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/reports/work-report.service.ts test/work-report.service.spec.ts
git commit -m "feat(reports): WorkReportService for the /work page

Tasks with activity in range (updated OR time logged), each with its
in-range time. Chargeable filter runs before paging; the entry side
scopes space through the task so deleted tasks' time still counts."
```

---

### Task 4: Routes `GET /reports/work` and `GET /reports/work/entries`

**Files:**
- Modify: `src/reports/reports.module.ts` (provider), `src/reports/reports.controller.ts` (constructor + 2 routes)
- Test: `test/reports.controller.spec.ts`

**Interfaces:**
- Consumes: `WorkReportService`, `WorkParams` (Task 3); `normalizeSprintStatus` (already in the controller file)
- Produces: the HTTP routes the frontend calls in Task 5

- [ ] **Step 1: Write the failing test**

In `test/reports.controller.spec.ts`:
1. Add `import { WorkReportService } from '../src/reports/work-report.service';` next to the other service imports. It's only needed if you type the stub; otherwise skip it.
2. Extend `makeCtrl`:
   - add `work: any` to the `over` type
   - pass `over.work ?? {}` as the **last** constructor argument, after `over.sprints ?? makeSprints()`
3. Add this block inside `describe('ReportsController', …)`:

```ts
  describe('work', () => {
    it('passes filters through, normalizes sprintStatus and numbers', async () => {
      const work = { work: jest.fn().mockResolvedValue({ items: [] }), workEntries: jest.fn() };
      const ctrl = makeCtrl({ work });
      await ctrl.work('2026-09-01', '2026-09-14', 's1', 'checkout', 'complete', undefined, undefined, 'Sam', 'u1', undefined, 'true', 'Acme', undefined, undefined, undefined, 'include', 'bogus', 'partial', 'cost', 'asc', '25', '50');
      expect(work.work).toHaveBeenCalledWith(expect.objectContaining({
        from: '2026-09-01', to: '2026-09-14', spaceId: 's1', search: 'checkout', status: 'complete',
        assignedTo: 'Sam', loggedBy: 'u1', missingOnly: 'true', client: 'Acme', archived: 'include',
        sprintStatus: 'all', chargeable: 'partial', sort: 'cost', dir: 'asc', limit: 25, offset: 50,
      }));
    });

    it('entries route reuses the same params', async () => {
      const work = { work: jest.fn(), workEntries: jest.fn().mockResolvedValue({ items: [], truncated: false }) };
      const ctrl = makeCtrl({ work });
      await ctrl.workEntries('2026-09-01', '2026-09-14');
      expect(work.workEntries).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-09-01', sprintStatus: 'all' }));
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/reports.controller.spec.ts`
Expected: FAIL: `ctrl.work is not a function` (or a TS error about the constructor arity).

- [ ] **Step 3: Implement**

`src/reports/reports.module.ts`: import `WorkReportService` and add it to `providers`.

`src/reports/reports.controller.ts`:
- import `{ WorkReportService, type WorkParams } from './work-report.service';`
- add `private readonly workReports: WorkReportService,` as the **last** constructor parameter
- add below the `time-entries` route:

```ts
  /** Both /work routes take the same params; one mapper keeps them identical. */
  private static workParams(
    from?: string, to?: string, spaceId?: string, search?: string, status?: string, priority?: string,
    type?: string, assignedTo?: string, loggedBy?: string, costStatus?: string, missingOnly?: string,
    client?: string, subProject?: string, listId?: string, folderId?: string, archived?: string,
    sprintStatus?: string, chargeable?: string, sort?: string, dir?: string, limit?: string, offset?: string,
  ): WorkParams {
    return {
      from, to, spaceId, search, status, priority, type, assignedTo, loggedBy, costStatus, missingOnly,
      client, subProject, listId, folderId, archived,
      sprintStatus: normalizeSprintStatus(sprintStatus, 'all'),
      chargeable, sort, dir,
      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    };
  }

  @Get('work')
  @ApiOperation({ summary: 'The Tasks & time (/work) page: every task with activity in [from, to] — updated in range OR with time logged in range — each carrying the in-range time on it (`logged`, null when none). Task filters (status, priority, type, assignedTo=task assignee names, search) choose rows. Entry filters (loggedBy=entry userIds, costStatus, missingOnly) choose which entries are counted and hide tasks left with none. Task attributes (client, subProject, listId, folderId, archived — default include, sprintStatus) apply to both. `chargeable=true|false|partial` filters on the row pill before paging. `sort=logged|updated|name|cost|lastActivity` (default logged), `dir=asc|desc` (default desc). `totals` sums every matching row, not the page. Entries with no task appear as `__none__` only when no task filter is set.' })
  work(
    @Query('from') from?: string, @Query('to') to?: string, @Query('spaceId') spaceId?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('priority') priority?: string,
    @Query('type') type?: string, @Query('assignedTo') assignedTo?: string, @Query('loggedBy') loggedBy?: string,
    @Query('costStatus') costStatus?: string, @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string, @Query('subProject') subProject?: string, @Query('listId') listId?: string,
    @Query('folderId') folderId?: string, @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string, @Query('chargeable') chargeable?: string,
    @Query('sort') sort?: string, @Query('dir') dir?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.workReports.work(ReportsController.workParams(
      from, to, spaceId, search, status, priority, type, assignedTo, loggedBy, costStatus, missingOnly,
      client, subProject, listId, folderId, archived, sprintStatus, chargeable, sort, dir, limit, offset,
    ));
  }

  @Get('work/entries')
  @ApiOperation({ summary: 'Every counted time entry behind the rows /reports/work lists for the same params (used by the two-sheet export). Newest first, capped at 5000: over the cap it returns no items and `truncated: true` rather than a partial list, so an export can never disagree with its Tasks sheet.' })
  workEntries(
    @Query('from') from?: string, @Query('to') to?: string, @Query('spaceId') spaceId?: string,
    @Query('search') search?: string, @Query('status') status?: string, @Query('priority') priority?: string,
    @Query('type') type?: string, @Query('assignedTo') assignedTo?: string, @Query('loggedBy') loggedBy?: string,
    @Query('costStatus') costStatus?: string, @Query('missingOnly') missingOnly?: string,
    @Query('client') client?: string, @Query('subProject') subProject?: string, @Query('listId') listId?: string,
    @Query('folderId') folderId?: string, @Query('archived') archived?: string,
    @Query('sprintStatus') sprintStatus?: string, @Query('chargeable') chargeable?: string,
    @Query('sort') sort?: string, @Query('dir') dir?: string,
  ) {
    return this.workReports.workEntries(ReportsController.workParams(
      from, to, spaceId, search, status, priority, type, assignedTo, loggedBy, costStatus, missingOnly,
      client, subProject, listId, folderId, archived, sprintStatus, chargeable, sort, dir, undefined, undefined,
    ));
  }
```

Route order: Nest matches `work/entries` and `work` independently (no `:param` clash), so placement doesn't matter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/reports.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full backend check**

Run: `npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 6: Smoke-test against a local DB** (needs `npm run dev:deps` and a synced local DB)

Run: `npm run start:dev`, then in another shell (use the local `ADMIN_API_KEY` from `.env`; don't paste it into logs or commits):

```bash
curl -s -H "x-admin-key: $ADMIN_API_KEY" "http://localhost:3000/reports/work?limit=3" | head -c 1500
```

Expected: JSON with `items` (each carrying `inRangeBecause`, `chargeable`, `logged`), `total`, and `totals`.

- [ ] **Step 7: Commit**

```bash
git add src/reports/reports.controller.ts src/reports/reports.module.ts test/reports.controller.spec.ts
git commit -m "feat(reports): GET /reports/work and /reports/work/entries"
```

---

### Task 5: Frontend plumbing: API, types, params, multi-sheet export

**Files:**
- Modify: `apps/web/src/api/reports.ts`, `apps/web/src/hooks/useReports.ts`, `apps/web/src/lib/xlsx.ts`
- Create: `apps/web/src/lib/workParams.ts`

**Interfaces:**
- Consumes: the Task 4 routes
- Produces:
  - `reportsApi.work(params)`, `reportsApi.workEntries(params)`
  - `WorkRow`, `WorkLogged`, `WorkTotals`, `WorkResponse`, `WorkEntry`, `WorkEntriesResponse`, `useWork(params)`
  - `WorkParams`, `NO_TASK_ID`, `toEntryListParams(params, taskId)`
  - `xlsxSheet(sheet)`, `exportXlsxSheets(filename, sheets)`

- [ ] **Step 1: Add the API calls**

In `apps/web/src/api/reports.ts`, add the type import at the top:

```ts
import type { CostTrendBucket, WorkEntriesResponse, WorkResponse } from '../hooks/useReports';
```

(Replace the existing `import type { CostTrendBucket } ...` line.) Add inside `reportsApi`, after `timeEntriesByTask`:

```ts
  work: (params: Record<string, string | number | undefined>): Promise<WorkResponse> =>
    apiClient.get('/reports/work', { params }).then(r => r.data),
  workEntries: (params: Record<string, string | number | undefined>): Promise<WorkEntriesResponse> =>
    apiClient.get('/reports/work/entries', { params }).then(r => r.data),
```

- [ ] **Step 2: Add the types and hook**

In `apps/web/src/hooks/useReports.ts`, after `useTimeEntriesByTask`:

```ts
/** In-range time on one /work row. `null` on the row = nothing counted. */
export interface WorkLogged {
  entryCount: number;
  hours: number;
  chargeableHours: number;
  /** Rated entries only. */
  costCents: number;
  currency: string;
  missingRateCount: number;
  excludedCount: number;
  lastActivity: string | null;
  loggers: { userId: string; userName: string | null }[];
}

/** One /work row: a task (or the `__none__` bucket) with the time logged on it. */
export interface WorkRow {
  // Index signature: DataTable's row constraint, and lets the row open in the task drawer.
  [key: string]: unknown;
  taskId: string;
  taskName: string | null;
  parentTaskId?: string | null;
  status?: string | null;
  statusColor?: string | null;
  priority?: string | null;
  assigneesNames?: string | null;
  assigneesEmails?: string | null;
  client?: string | null;
  subProjects?: string[];
  listName?: string | null;
  sprintName?: string | null;
  sprintPoints?: number | null;
  updatedDate?: string | null;
  archived?: boolean;
  isDeleted: boolean;
  isChargeable?: boolean;
  url?: string | null;
  timeEstimateHours: number | null;
  /** ClickUp's lifetime rollup — ignores the date range. */
  lifetimeSpentHours: number | null;
  inRangeBecause: 'updated' | 'logged' | 'both';
  chargeable: 'yes' | 'no' | 'partial';
  chargeableSource: 'entries' | 'task';
  logged: WorkLogged | null;
}

export interface WorkTotals {
  tasks: number;
  entries: number;
  hours: number;
  chargeableHours: number;
  costCents: number;
  missingRateCount: number;
}

export interface WorkResponse {
  items: WorkRow[];
  total: number;
  limit: number;
  offset: number;
  totals: WorkTotals;
}

export interface WorkEntry {
  [key: string]: unknown;
  timeEntryId: string;
  taskId: string | null;
  taskName: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  startTime: string | null;
  endTime: string | null;
  durationHours: number;
  hourlyRateCents: number;
  costCents: number;
  currency: string;
  status: string;
  chargeable: boolean;
  chargeableOverride: boolean | null;
  description: string | null;
}

export interface WorkEntriesResponse {
  items: WorkEntry[];
  truncated: boolean;
}

/** The /work page's rows + totals. Key `work` — chargeability writes invalidate it. */
export function useWork(params: Record<string, string | number | undefined>) {
  return useQuery<WorkResponse>({
    queryKey: ['work', params],
    queryFn: () => reportsApi.work(params),
    placeholderData: keepPreviousData,
  });
}
```

In the same file, inside **both** `useSetEntryChargeableOverride` and `useSetAssigneeChargeable`, add this as the last line of `onSuccess`:

```ts
      // The /work page shows the same pills and costs.
      qc.invalidateQueries({ queryKey: ['work'] });
```

(`ChargeableConfirmModal` already calls `qc.invalidateQueries()` with no key, which covers `['work']`.)

- [ ] **Step 3: Create `apps/web/src/lib/workParams.ts`**

```ts
/** Query params for /reports/work, in wire form (comma-separated multi-selects). */
export type WorkParams = Record<string, string | number | undefined>;

/**
 * Sentinel task id for "entries with no task". Mirrors `NO_TASK_ID` in
 * src/reports/report-filter.util.ts — keep the two identical.
 */
export const NO_TASK_ID = '__none__';

/**
 * Entries listed per expanded task. Far above any real task; guards a
 * pathological one. Same value and reason as `MAX_ENTRIES` in
 * TaskTimeEntriesPanel — WorkEntryRows says "Showing the first N of M" past it.
 */
export const MAX_ENTRIES_PER_TASK = 500;

/**
 * The /reports/time-entries params that list EXACTLY the entries /reports/work
 * counted for one task. This is the frontend half of the rule "expanded entries
 * add up to the row's Logged" — it must mirror `WorkReportService.entryWhere`:
 *
 * - entry filters: loggedBy -> userId, costStatus -> status, missingOnly
 * - task attributes: client, subProject, listId, folderId, archived, sprintStatus
 * - NOT spaceId: taskId already pins the space, and buildTimeEntryWhere's own
 *   space clause would drop a deleted task's entries (the row counts them)
 * - NOT search / chargeable / task-only filters: those choose rows, not entries
 */
export function toEntryListParams(p: WorkParams, taskId: string): WorkParams {
  return {
    from: p.from,
    to: p.to,
    userId: p.loggedBy,
    status: p.missingOnly === 'true' ? undefined : p.costStatus,
    missingOnly: p.missingOnly,
    client: p.client,
    subProject: p.subProject,
    listId: p.listId,
    folderId: p.folderId,
    archived: p.archived,
    sprintStatus: p.sprintStatus,
    taskId,
    limit: MAX_ENTRIES_PER_TASK,
    offset: 0,
  };
}
```

- [ ] **Step 4: Make `lib/xlsx.ts` multi-sheet**

Replace the whole `exportXlsx` function (from `export async function exportXlsx<T>(opts: {` to its closing `}`) with the code below. `coerce`, `readValue`, `stamp`, `HEADER_FILL` and `HEADER_BORDER` stay as they are in the file.

```ts
/** A sheet with its cells already read out of the rows (types erased). */
export interface PreparedSheet {
  sheetName: string;
  columns: { header: string; type?: XlsxColumn<unknown>['type']; width?: number }[];
  cells: unknown[][];
}

/** Read one typed sheet's cells, so sheets of different row types can share a workbook. */
export function xlsxSheet<T>(s: { sheetName: string; rows: T[]; columns: XlsxColumn<T>[] }): PreparedSheet {
  return {
    sheetName: s.sheetName,
    columns: s.columns.map((c) => ({ header: c.header, type: c.type, width: c.width })),
    cells: s.rows.map((row) => s.columns.map((c) => coerce(c.type, readValue(c, row)))),
  };
}

export async function exportXlsx<T>(opts: {
  /** Filename stem; a `-YYYY-MM-DD.xlsx` suffix is appended. */
  filename: string;
  sheetName: string;
  rows: T[];
  columns: XlsxColumn<T>[];
}): Promise<void> {
  return exportXlsxSheets(opts.filename, [xlsxSheet(opts)]);
}

/** One workbook, one worksheet per entry in `sheets`. */
export async function exportXlsxSheets(filename: string, sheets: PreparedSheet[]): Promise<void> {
  // CJS/ESM interop: depending on the bundler the namespace may sit on `default`.
  const mod = await import('exceljs');
  const ExcelJS = ((mod as { default?: typeof import('exceljs') }).default ?? mod) as typeof import('exceljs');

  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.sheetName, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    ws.columns = sheet.columns.map((c, i) => ({
      header: c.header,
      // Unique positional key — column `key`s may repeat (e.g. two CSV columns
      // both tied to one table column), which ExcelJS would reject.
      key: `c${i}`,
      width: c.width ?? Math.min(Math.max(c.header.length + 4, 12), 48),
      style:
        c.type === 'date'
          ? { numFmt: 'yyyy-mm-dd hh:mm' }
          : c.type === 'money'
            ? { numFmt: '#,##0.00' }
            : c.type === 'number'
              // Fixed 2 decimals, not '#,##0.##': the optional-digit form renders
              // whole numbers with a dangling decimal point (1 -> "1.", 0 -> "0.")
              // in Excel / Sheets / LibreOffice.
              ? { numFmt: '#,##0.00' }
              : c.type === 'integer'
                ? { numFmt: '#,##0' }
                : {},
    }));

    // Header row styling — bold white text on the accent fill, frozen + filtered.
    const header = ws.getRow(1);
    header.height = 20;
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    header.alignment = { vertical: 'middle', horizontal: 'left' };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.border = { bottom: { style: 'thin', color: { argb: HEADER_BORDER } } };
    });

    for (const row of sheet.cells) ws.addRow(row);

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${stamp(new Date())}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

If `coerce`'s first parameter isn't typed to accept `XlsxColumn<unknown>['type']`, widen it to that; `readValue` already takes a column and a row.

- [ ] **Step 5: Lint + build**

Run: `cd apps/web && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 6: Check the existing exports still work**

Run `cd apps/web && npm run dev` (with the backend running). Open Tasks and click **Export Excel**, then do the same on Time Entries. Each downloads one workbook with one sheet, as before.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts apps/web/src/lib/workParams.ts apps/web/src/lib/xlsx.ts
git commit -m "feat(web): /work API, types and multi-sheet xlsx export"
```

---

### Task 6: Move the task drawer out; shared filter-option hooks (no behavior change)

**Files:**
- Create: `apps/web/src/components/tasks/TaskDetailDrawer.tsx`, `apps/web/src/hooks/useFilterOptions.tsx`
- Modify: `apps/web/src/pages/TasksPage.tsx` (remove the moved code, import it instead)

**Interfaces:**
- Produces:
  - `TaskDetailDrawer({ task, onClose, canEdit, onSetChargeable })` (the same props as today)
  - `parseAssignees(r)`, `subProjectsOf(r)`, `type Task = Record<string, unknown>`
  - `Option`, `useClientOptions`, `useSubProjectOptions`, `useListOptions`, `useFolderOptions`, `useTaskAssigneeOptions`, `useLoggedByOptions`, `useStatusOptions`

- [ ] **Step 1: Create `components/tasks/TaskDetailDrawer.tsx` by moving code from `TasksPage.tsx`**

Cut these from `pages/TasksPage.tsx` and paste them unchanged into the new file:
- `type Task = Record<string, unknown>;` (line 38). Make it `export type Task`.
- `subProjectsOf` (line 41). Make it `export const`.
- `parseAssignees` (lines 77-81). Make it `export function`.
- `MetaGrid` and `cell` (lines 105-124). They stay unexported.
- `TaskDetailDrawer` (lines 126-414). Make it `export function`.

Give the new file exactly the imports the moved code uses. Paths change from `../` to `../../` for everything outside `components/`, and to `../ui/…` / `./TaskTimeline` inside it:

```ts
import { useState, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, CheckSquare, Copy, ExternalLink, CircleCheck } from 'lucide-react';
import { useTaskAssigneeChargeability, useSetAssigneeChargeable } from '../../hooks/useReports';
import { useTaskHistory } from '../../hooks/useTaskHistory';
import { Pill } from '../ui/Pill';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { ClickupAvatar, ClickupAvatarStack } from '../ui/ClickupAvatar';
import { Drawer } from '../ui/Drawer';
import { Markdown } from '../ui/Markdown';
import { Tabs } from '../ui/Tabs';
import { Field } from '../ui/Field';
import { TaskTimeline, type TaskTimelineEvent } from './TaskTimeline';
import { fmt } from '../../lib/formatters';
import { reportsApi } from '../../api/reports';
```

- [ ] **Step 2: Import it back into `TasksPage.tsx`**

Add:

```ts
import { TaskDetailDrawer, parseAssignees, subProjectsOf, type Task } from '../components/tasks/TaskDetailDrawer';
```

Run `cd apps/web && npm run lint` and delete every import it reports as unused in `TasksPage.tsx`. Expect roughly `Copy`, `ExternalLink`, `CheckSquare`, `CircleCheck`, `useQuery`, `useTaskHistory`, `useTaskAssigneeChargeability`, `useSetAssigneeChargeable`, `Drawer`, `Markdown`, `Tabs`, `Field`, `TaskTimeline`, and `ReactNode` if unused. Remove only what lint flags.

- [ ] **Step 3: Create `hooks/useFilterOptions.tsx`**

These are the option builders both old pages copy, lifted as-is. The old pages are **not** switched to them during the trial (spec: freeze).

```tsx
import { useMemo, type ReactNode } from 'react';
import { ClickupAvatar } from '../components/ui/ClickupAvatar';

export interface Option { value: string; label: string; icon?: ReactNode }

/** Keep a selection that scoped out of the list visible and clearable, as "(0)". */
function keepSelected(opts: Option[], seen: Set<string>, selected: string[]): Option[] {
  for (const s of selected) if (!seen.has(s)) opts.push({ value: s, label: `${s} (0)` });
  return opts;
}

export function useClientOptions(data: unknown, selected: string[]): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { client: string; taskCount?: number }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      if (!r.client) continue;
      seen.add(r.client);
      opts.push({ value: r.client, label: typeof r.taskCount === 'number' ? `${r.client} (${r.taskCount})` : r.client });
    }
    return keepSelected(opts, seen, selected);
  }, [data, selected]);
}

export function useSubProjectOptions(data: unknown, selected: string[]): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { subProject: string; taskCount: number }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      if (!r.subProject) continue;
      seen.add(r.subProject);
      opts.push({ value: r.subProject, label: `${r.subProject} (${r.taskCount})` });
    }
    return keepSelected(opts, seen, selected);
  }, [data, selected]);
}

export function useListOptions(data: unknown, showSpace: boolean): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { listId: string; listName: string; spaceName?: string | null; taskCount?: number }[];
    return rows.filter((r) => r.listId).map((r) => {
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      return { value: r.listId, label: showSpace && r.spaceName ? `${r.spaceName} · ${r.listName}${count}` : `${r.listName}${count}` };
    });
  }, [data, showSpace]);
}

export function useFolderOptions(data: unknown, showSpace: boolean): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { folderId: string; folderName: string; spaceName?: string | null; taskCount?: number }[];
    return rows.filter((r) => r.folderId).map((r) => {
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      return { value: r.folderId, label: showSpace && r.spaceName ? `${r.spaceName} · ${r.folderName}${count}` : `${r.folderName}${count}` };
    });
  }, [data, showSpace]);
}

/** Task assignees by NAME (`/reports/tasks/assignees`) — the "Assigned to" filter. */
export function useTaskAssigneeOptions(data: unknown): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { name: string; taskCount?: number }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      if (!r.name || seen.has(r.name)) continue;
      seen.add(r.name);
      const count = typeof r.taskCount === 'number' ? ` (${r.taskCount})` : '';
      opts.push({ value: r.name, label: `${r.name}${count}`, icon: <ClickupAvatar name={r.name} size={18} /> });
    }
    return opts;
  }, [data]);
}

/** People who logged time, by USER ID (`/reports/time-entries/by-user`) — the "Logged by" filter. */
export function useLoggedByOptions(data: unknown): Option[] {
  return useMemo(() => {
    const rows = (Array.isArray(data) ? data : []) as { userId?: string; userName: string }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      const id = r.userId ?? r.userName;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      opts.push({ value: id, label: r.userName, icon: <ClickupAvatar userId={r.userId} name={r.userName} size={18} /> });
    }
    return opts;
  }, [data]);
}

/** Statuses actually stored (from the tasks summary), so a pick always matches. */
export function useStatusOptions(summary: unknown): Option[] {
  return useMemo(() => {
    const rows = ((summary as { byStatus?: unknown } | undefined)?.byStatus ?? []) as { status: string | null }[];
    const seen = new Set<string>();
    const opts: Option[] = [];
    for (const r of rows) {
      const s = (r.status ?? '').trim();
      if (!s || seen.has(s.toLowerCase())) continue;
      seen.add(s.toLowerCase());
      opts.push({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) });
    }
    return opts;
  }, [summary]);
}
```

- [ ] **Step 4: Lint + build**

Run: `cd apps/web && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 5: Manual check (no behavior change)**

With the dev server running, open **Tasks**, click a row, and check:
- the drawer opens with Overview / Timeline / Sync history / Raw fields
- "Mark chargeable" still opens the confirm modal
- the per-assignee controls still work

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/tasks/TaskDetailDrawer.tsx apps/web/src/hooks/useFilterOptions.tsx apps/web/src/pages/TasksPage.tsx
git commit -m "refactor(web): move TaskDetailDrawer to its own file; shared filter-option hooks

No behavior change. The /work page reuses both."
```

---

### Task 7: `DataTable` server-side sort

**Files:**
- Modify: `apps/web/src/components/ui/DataTable.tsx`

**Interfaces:**
- Produces: two optional props on `DataTable`, `sort?: { key: string; dir: 'asc' | 'desc' }` and `onSortChange?: (next: { key: string; dir: 'asc' | 'desc' }) => void`. Existing callers pass neither, so they keep today's behavior.

- [ ] **Step 1: Add the props**

In `interface DataTableProps<T>`, next to `initialSort`:

```ts
  /**
   * Controlled server-side sort. When `onSortChange` is set, a header click
   * reports the next sort instead of reordering the page locally, and the
   * arrows show `sort`. This works while server-paginated — the reason local
   * sort is disabled there (it would only reorder one page) doesn't apply when
   * the server sorts. A second click on the active column flips direction; a
   * new column starts descending.
   */
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (next: { key: string; dir: 'asc' | 'desc' }) => void;
```

Add `sort,` and `onSortChange,` to the destructured props next to `initialSort,`.

- [ ] **Step 2: Use them**

1. Below the `sortKey`/`sortDir` `useState` lines (133-134), add:
   ```ts
   const serverSort = onSortChange != null;
   // What the arrows and aria-sort show: the server's sort when controlled.
   const activeKey = serverSort ? (sort?.key ?? null) : sortKey;
   const activeDir = serverSort ? (sort?.dir ?? 'desc') : sortDir;
   ```
2. In the `sorted` expression (line 165), change the condition from `sortKey && !isServerPaginated` to `sortKey && !isServerPaginated && !serverSort`.
3. In `handleSort` (line 230), make the first lines:
   ```ts
   function handleSort(key: string) {
     const col = initialColumns.find(c => c.key === key);
     if (col?.sortable === false) return;
     if (serverSort) {
       onSortChange({ key, dir: sort?.key === key && sort.dir === 'desc' ? 'asc' : 'desc' });
       return;
     }
     if (isServerPaginated) return;
   ```
   Then delete the now-duplicated `const col = …` / `if (col?.sortable === false) return;` lines below.
4. Everywhere the header decides clickability or shows sort state, in both the design layout (~lines 315-320, 384) and the default layout (~lines 665-690, find them with `grep -n "isServerPaginated\|sortKey === col.key" src/components/ui/DataTable.tsx`):
   - replace `!isServerPaginated && col.sortable !== false` with `(serverSort || !isServerPaginated) && col.sortable !== false`
   - replace `col.sortable === false || isServerPaginated` with `col.sortable === false || (isServerPaginated && !serverSort)`
   - replace `sortKey === col.key` with `activeKey === col.key`, and `sortDir === 'asc'` with `activeDir === 'asc'`, **only in those header lines**. Leave `handleSort`'s local branch using `sortKey` / `sortDir`.

- [ ] **Step 3: Lint + build**

Run: `cd apps/web && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Manual check (existing tables unchanged)**

- **Time Entries, flat view, one page of results** (narrow the filters until the total is ≤ the page size): header clicks still sort locally.
- **Time Entries with more rows than one page:** headers are still not clickable.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/DataTable.tsx
git commit -m "feat(web): optional server-side sort on DataTable"
```

---

### Task 8: `WorkEntryRows` + `WorkPage`

**Files:**
- Create: `apps/web/src/components/work/WorkEntryRows.tsx`, `apps/web/src/pages/WorkPage.tsx`

**Interfaces:**
- Consumes: everything from Tasks 5-7; `useTimeEntriesList(params, enabled)`; `useRowSelection<T>(scope)`; `SelectionBar({ count, noun, nounPlural?, stats, onClear, actions? })`; `ChargeableConfirmModal({ taskIds, chargeable, onClose })`; `TimeEntryDrawer({ entry, onClose })`, `TimeEntryItem`
- Produces: `WorkPage` (exported function, lazily loaded in Task 9)

- [ ] **Step 1: Create `components/work/WorkEntryRows.tsx`**

```tsx
import { AlertTriangle, CircleCheck } from 'lucide-react';
import { useTimeEntriesList } from '../../hooks/useReports';
import { fmt } from '../../lib/formatters';
import { toEntryListParams, type WorkParams } from '../../lib/workParams';
import { ClickupAvatar } from '../ui/ClickupAvatar';
import { Pill } from '../ui/Pill';
import { Skeleton } from '../ui/Skeleton';
import type { TimeEntryItem } from '../TimeEntryDrawer';

/**
 * One /work task's entries, shown when its row is expanded. Fetched with
 * `toEntryListParams`, so the entries listed here are exactly the ones the row's
 * Logged value counted. Selection goes through the page (one kind at a time);
 * there are no per-row buttons here on purpose — the selection bar owns edits.
 */
interface Props {
  taskId: string;
  params: WorkParams;
  selectedIds: Set<string>;
  onToggle: (entry: TimeEntryItem) => void;
  onOpen: (entry: TimeEntryItem) => void;
}

export function WorkEntryRows({ taskId, params, selectedIds, onToggle, onOpen }: Props) {
  const { data, isLoading, isError } = useTimeEntriesList(toEntryListParams(params, taskId));
  const items: TimeEntryItem[] = (data as { items?: TimeEntryItem[] } | undefined)?.items ?? [];
  const total: number = (data as { total?: number } | undefined)?.total ?? 0;

  const cell: React.CSSProperties = { padding: '5px 10px', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap', fontSize: 12 };
  const head: React.CSSProperties = { ...cell, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em' };

  if (isLoading) {
    return (
      <div style={{ padding: '10px 14px 10px 46px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={12} width={`${70 - i * 12}%`} />)}
      </div>
    );
  }
  if (isError) {
    return <div style={{ padding: '10px 14px 10px 46px', fontSize: 12, color: 'var(--text-muted)' }}>Couldn&apos;t load this task&apos;s entries. Reload the page to try again.</div>;
  }

  return (
    <div style={{ padding: '2px 14px 8px 46px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...head, width: 28 }} aria-label="Select" />
            <th style={{ ...head, textAlign: 'left' }}>Logged by</th>
            <th style={{ ...head, textAlign: 'left' }}>Start</th>
            <th style={{ ...head, textAlign: 'right' }}>Duration</th>
            <th style={{ ...head, textAlign: 'left' }}>Charge</th>
            <th style={{ ...head, textAlign: 'right' }}>Rate</th>
            <th style={{ ...head, textAlign: 'right' }}>Cost</th>
            <th style={{ ...head, textAlign: 'left' }}>Status</th>
            <th style={{ ...head, textAlign: 'left', width: '28%' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const cur = e.currency ?? 'USD';
            const checked = selectedIds.has(e.timeEntryId);
            return (
              <tr key={e.timeEntryId} onClick={() => onOpen(e)} style={{ cursor: 'pointer', background: checked ? 'var(--accent-soft, var(--hover))' : undefined }}>
                <td style={cell}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.userName}'s entry on ${fmt.dateTime(e.startTime)}`}
                    checked={checked}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={() => onToggle(e)}
                    style={{ borderRadius: 999, cursor: 'pointer' }}
                  />
                </td>
                <td style={cell}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ClickupAvatar userId={e.userId} email={e.userEmail} name={e.userName} size={18} />
                    <span>{e.userName}</span>
                  </span>
                </td>
                <td style={{ ...cell, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt.dateTime(e.startTime)}</td>
                <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.duration(e.durationHours)}</td>
                <td style={cell}>
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    {e.chargeable ? <Pill tone="green" size="xs">chargeable</Pill> : <Pill tone="gray" size="xs">non-chargeable</Pill>}
                    {e.chargeableOverride !== null && <Pill tone="blue" size="xs">override</Pill>}
                  </span>
                </td>
                <td style={{ ...cell, textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {e.hourlyRateCents > 0 ? `${fmt.money(e.hourlyRateCents, cur)}/h` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {e.status === 'COST_EXCLUDED' ? <span style={{ color: 'var(--text-faint)' }}>Excluded</span> : e.costAud > 0 ? fmt.money(e.costAud * 100, cur) : '—'}
                </td>
                <td style={cell}>
                  {e.status === 'COST_CALCULATED'
                    ? <Pill tone="green" size="xs" icon={<CircleCheck size={10} strokeWidth={2} />}>cost calculated</Pill>
                    : e.status === 'COST_EXCLUDED'
                      ? <Pill tone="gray" size="xs">excluded</Pill>
                      : e.status === 'NOT_CHARGEABLE'
                        ? <Pill tone="gray" size="xs">not chargeable</Pill>
                        : <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>no rate found</Pill>}
                </td>
                <td style={{ ...cell, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0 }} title={e.description ?? ''}>
                  {e.description || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {total > items.length && (
        <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
          Showing the first {fmt.number(items.length)} of {fmt.number(total)} entries for this task.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `pages/WorkPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Clock, DollarSign, Download, Inbox, ListTree, Search, X } from 'lucide-react';
import {
  useClients, useFolders, useLists, useSetEntryChargeableOverride, useSubProjects,
  useTasksAssignees, useTasksSummary, useTimeEntriesByUser, useWork,
  type WorkEntry, type WorkRow,
} from '../hooks/useReports';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { useRowSelection } from '../hooks/useRowSelection';
import { useAuth } from '../hooks/useAuth';
import {
  useClientOptions, useFolderOptions, useListOptions, useLoggedByOptions,
  useStatusOptions, useSubProjectOptions, useTaskAssigneeOptions,
} from '../hooks/useFilterOptions';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { MultiSelect } from '../components/ui/MultiSelect';
import { Switch } from '../components/ui/Switch';
import { MetricCard } from '../components/ui/MetricCard';
import { DataTable, type Column } from '../components/ui/DataTable';
import { QueryError } from '../components/ui/QueryError';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ClickupAvatarStack } from '../components/ui/ClickupAvatar';
import { SelectionBar, type SelectionStat } from '../components/SelectionBar';
import { TaskDetailDrawer, parseAssignees, subProjectsOf } from '../components/tasks/TaskDetailDrawer';
import { TimeEntryDrawer, type TimeEntryItem } from '../components/TimeEntryDrawer';
import { ChargeableConfirmModal } from '../components/ChargeableConfirmModal';
import { WorkEntryRows } from '../components/work/WorkEntryRows';
import { reportsApi } from '../api/reports';
import { exportXlsxSheets, xlsxSheet, type XlsxColumn } from '../lib/xlsx';
import { fmt } from '../lib/formatters';
import { NO_TASK_ID, type WorkParams } from '../lib/workParams';

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' },
];
const TYPE_OPTIONS = [
  { value: '', label: 'Parent + subtasks' }, { value: 'parent', label: 'Parent only' }, { value: 'subtask', label: 'Subtasks only' },
];
const ARCHIVED_OPTIONS = [
  { value: 'include', label: 'Include archived' }, { value: 'exclude', label: 'Hide archived' }, { value: 'only', label: 'Archived only' },
];
const SPRINT_STATUS_OPTIONS = [
  { value: 'all', label: 'All sprints' }, { value: 'active', label: 'Active sprints' }, { value: 'completed', label: 'Completed (archived) sprints' },
];
const CHARGEABLE_OPTIONS = [
  { value: 'all', label: 'All chargeability' }, { value: 'true', label: 'Chargeable' },
  { value: 'partial', label: 'Partially chargeable' }, { value: 'false', label: 'Non-chargeable' },
];
const COST_STATUS_OPTIONS = [
  { value: 'COST_CALCULATED', label: 'Cost calculated' }, { value: 'NO_RATE_FOUND', label: 'No rate found' },
  { value: 'COST_EXCLUDED', label: 'Excluded' }, { value: 'NOT_CHARGEABLE', label: 'Not chargeable' },
];
/** Hidden by default (spec): available from the Columns menu. */
const DEFAULT_HIDDEN = ['lifetime', 'client', 'sub_projects', 'list', 'sprint', 'points', 'updated'];
const REASON: Record<WorkRow['inRangeBecause'], string> = {
  updated: 'Listed because it was updated in the range (no time logged in the range)',
  logged: 'Listed because time was logged on it in the range',
  both: 'Listed because it was updated and had time logged in the range',
};
const FEEDBACK_URL = import.meta.env.VITE_WORK_FEEDBACK_URL as string | undefined;

const csv = (v: string[]) => (v.length ? v.join(',') : undefined);
const blank = (v: unknown) => <span style={{ color: 'var(--text-faint)' }}>{v == null || v === '' ? '—' : String(v)}</span>;

export function WorkPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const { space, fromDate, toDate } = useGlobalFilters();

  // ── Filters ───────────────────────────────────────────────────────────────
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [loggedBy, setLoggedBy] = useState<string[]>([]);
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [client, setClient] = useState<string[]>([]);
  const [subProject, setSubProject] = useState<string[]>([]);
  const [listIds, setListIds] = useState<string[]>([]);
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [archived, setArchived] = useState('include');
  const [sprintStatus, setSprintStatus] = useState('all');
  const [chargeable, setChargeable] = useState('all');
  const [costStatus, setCostStatus] = useState<string[]>([]);
  const [missingOnly, setMissingOnly] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'logged', dir: 'desc' });
  const [hiddenCols, setHiddenCols] = useState<string[]>(DEFAULT_HIDDEN);

  /** Wrap a setter so every filter change returns to page 1. */
  const on = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchRaw); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  // A ClickUp list/folder belongs to one space — a selection is meaningless after the topbar space changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListIds([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolderIds([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [space]);

  // ── Dropdown data ─────────────────────────────────────────────────────────
  const spaceId = space !== 'all' ? space : undefined;
  const { data: summary } = useTasksSummary();
  const { data: taskAssignees } = useTasksAssignees();
  const { data: byUser } = useTimeEntriesByUser();
  const { data: clientsData } = useClients({ spaceId, from: fromDate || undefined, to: toDate || undefined, archived });
  const { data: subProjectsData } = useSubProjects({ spaceId, from: fromDate || undefined, to: toDate || undefined, archived });
  const { data: listsData } = useLists(spaceId);
  const { data: foldersData } = useFolders(spaceId);
  const statusOptions = useStatusOptions(summary);
  const assignedToOptions = useTaskAssigneeOptions(taskAssignees);
  const loggedByOptions = useLoggedByOptions(byUser);
  const clientOptions = useClientOptions(clientsData, client);
  const subProjectOptions = useSubProjectOptions(subProjectsData, subProject);
  const listOptions = useListOptions(listsData, space === 'all');
  const folderOptions = useFolderOptions(foldersData, space === 'all');

  // ── Query ─────────────────────────────────────────────────────────────────
  const params: WorkParams = useMemo(() => ({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    from: fromDate || undefined,
    to: toDate || undefined,
    spaceId,
    search: search || undefined,
    status: csv(status),
    priority: csv(priority),
    type: type || undefined,
    assignedTo: csv(assignedTo),
    loggedBy: csv(loggedBy),
    client: csv(client),
    subProject: csv(subProject),
    listId: csv(listIds),
    folderId: csv(folderIds),
    archived,
    sprintStatus: sprintStatus !== 'all' ? sprintStatus : undefined,
    chargeable: chargeable !== 'all' ? chargeable : undefined,
    costStatus: missingOnly ? undefined : csv(costStatus),
    missingOnly: missingOnly ? 'true' : undefined,
    sort: sort.key,
    dir: sort.dir,
  }), [pageSize, page, fromDate, toDate, spaceId, search, status, priority, type, assignedTo, loggedBy, client, subProject, listIds, folderIds, archived, sprintStatus, chargeable, costStatus, missingOnly, sort]);

  const workQuery = useWork(params);
  const items = workQuery.data?.items ?? [];
  const total = workQuery.data?.total ?? 0;
  const totals = workQuery.data?.totals;

  /** Filter-set identity without paging — scopes selection and expansion. */
  const filterKey = useMemo(() => JSON.stringify({ ...params, limit: undefined, offset: undefined, sort: undefined, dir: undefined }), [params]);
  const pageKey = useMemo(() => JSON.stringify(params), [params]);

  const entryFiltersActive = loggedBy.length > 0 || costStatus.length > 0 || missingOnly;

  // ── Expansion: auto-open matching tasks while entry filters are on ────────
  const [expanded, setExpanded] = useState<{ key: string; ids: (string | number)[] }>({ key: '', ids: [] });
  const autoOpen = useMemo(
    () => (entryFiltersActive ? items.filter((r) => r.logged).map((r) => r.taskId) : []),
    [entryFiltersActive, items],
  );
  const expandedKeys = expanded.key === pageKey ? expanded.ids : autoOpen;
  const expandable = items.filter((r) => r.logged).map((r) => r.taskId);
  const allOpen = expandable.length > 0 && expandable.every((id) => expandedKeys.includes(id));

  // ── Selection: one kind at a time (spec, Rule 3) ──────────────────────────
  const taskSel = useRowSelection<WorkRow>(filterKey);
  const entrySel = useRowSelection<TimeEntryItem>(filterKey);
  const selectableTask = (r: WorkRow) => r.taskId !== NO_TASK_ID && !r.isDeleted;
  const toggleTask = (key: string | number, row: WorkRow) => {
    if (!selectableTask(row)) return;
    entrySel.clear();
    taskSel.toggleRow(key, row);
  };
  const toggleTaskPage = (entries: { key: string | number; row: WorkRow }[], select: boolean) => {
    entrySel.clear();
    taskSel.togglePage(entries.filter((e) => selectableTask(e.row)), select);
  };
  const toggleEntry = (e: TimeEntryItem) => {
    taskSel.clear();
    entrySel.toggleRow(e.timeEntryId, e);
  };
  const selectedEntryIds = useMemo(() => new Set(entrySel.selectedKeys.map(String)), [entrySel.selectedKeys]);

  // ── Drawers / modal / mutations ───────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<WorkRow | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<TimeEntryItem | null>(null);
  const [chargeableTarget, setChargeableTarget] = useState<{ taskIds: string[]; chargeable: boolean; clearSelectionOnApply: boolean } | null>(null);
  const setOverride = useSetEntryChargeableOverride();
  const applyOverride = (value: boolean | null) => {
    const ids = entrySel.selectedRows.map((r) => r.timeEntryId);
    if (ids.length) setOverride.mutate({ timeEntryIds: ids, chargeable: value }, { onSuccess: () => entrySel.clear() });
  };

  // ── Reset ─────────────────────────────────────────────────────────────────
  const clearEntryFilters = () => { setLoggedBy([]); setCostStatus([]); setMissingOnly(false); setPage(1); };
  const hasFilters = !!(searchRaw || status.length || priority.length || type || assignedTo.length || loggedBy.length
    || client.length || subProject.length || listIds.length || folderIds.length || archived !== 'include'
    || sprintStatus !== 'all' || chargeable !== 'all' || costStatus.length || missingOnly);
  function reset() {
    setSearchRaw(''); setSearch(''); setStatus([]); setPriority([]); setType(''); setAssignedTo([]);
    setClient([]); setSubProject([]); setListIds([]); setFolderIds([]); setArchived('include');
    setSprintStatus('all'); setChargeable('all');
    clearEntryFilters();
  }

  // ── Entry-filter banner text ──────────────────────────────────────────────
  const bannerText = useMemo(() => {
    const parts: string[] = [];
    if (loggedBy.length) {
      const names = loggedBy.map((id) => loggedByOptions.find((o) => o.value === id)?.label ?? id);
      parts.push(`${names.join(', ')}'s time`);
    }
    if (missingOnly) parts.push('entries missing a rate');
    else if (costStatus.length) parts.push(`entries with status ${costStatus.map((s) => COST_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s).join(', ')}`);
    return `Totals count only ${parts.join(' and only ')} in the range.`;
  }, [loggedBy, loggedByOptions, missingOnly, costStatus]);

  // ── Export: Tasks + Entries sheets from the same filters ──────────────────
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportExcel = useMutation({
    mutationFn: async () => {
      setExportNote(null);
      const full = { ...params, limit: 5000, offset: 0 };
      const tasks = taskSel.count > 0 ? taskSel.selectedRows : (await reportsApi.work(full)).items;
      let entries: WorkEntry[];
      if (entrySel.count > 0) {
        entries = entrySel.selectedRows.map((e) => ({
          timeEntryId: e.timeEntryId, taskId: e.taskId, taskName: e.taskName, userId: e.userId, userName: e.userName,
          userEmail: e.userEmail, startTime: e.startTime, endTime: e.endTime, durationHours: e.durationHours,
          hourlyRateCents: e.hourlyRateCents, costCents: Math.round(e.costAud * 100), currency: e.currency ?? 'USD',
          status: e.status, chargeable: e.chargeable, chargeableOverride: e.chargeableOverride, description: e.description,
        }));
      } else {
        const res = await reportsApi.workEntries(full);
        if (res.truncated) {
          // Refuse rather than write a workbook whose two sheets disagree.
          setExportNote('Too many entries to export (over 5,000). Narrow the date range or filters, then export again.');
          return;
        }
        const ids = new Set(tasks.map((t) => t.taskId));
        entries = res.items.filter((e) => ids.has(e.taskId ?? NO_TASK_ID));
      }
      const taskCols: XlsxColumn<WorkRow>[] = [
        { header: 'Task ID', value: 'taskId' },
        { header: 'Task name', value: (r) => r.taskName ?? '(No task)', width: 42 },
        { header: 'Status', value: 'status' },
        { header: 'Chargeable', value: (r) => (r.chargeable === 'yes' ? 'Yes' : r.chargeable === 'no' ? 'No' : 'Partial') },
        { header: 'Assignees', value: 'assigneesNames', width: 30 },
        { header: 'Client', value: 'client' },
        { header: 'Sub-project', value: (r) => subProjectsOf(r).join(', ') },
        { header: 'List', value: 'listName' },
        { header: 'Est. hours', value: 'timeEstimateHours', type: 'number' },
        { header: 'Logged hours (in range)', value: (r) => r.logged?.hours ?? 0, type: 'number' },
        { header: 'Chargeable hours (in range)', value: (r) => r.logged?.chargeableHours ?? 0, type: 'number' },
        { header: 'Cost (rated entries)', value: (r) => (r.logged?.costCents ?? 0) / 100, type: 'money' },
        { header: 'Currency', value: (r) => r.logged?.currency ?? '' },
        { header: 'Entries missing a rate', value: (r) => r.logged?.missingRateCount ?? 0, type: 'integer' },
        { header: 'Lifetime hours (ClickUp, ignores range)', value: 'lifetimeSpentHours', type: 'number' },
        { header: 'In range because', value: 'inRangeBecause' },
        { header: 'Deleted', value: (r) => (r.isDeleted ? 'Yes' : '') },
        { header: 'Updated', value: 'updatedDate', type: 'date' },
      ];
      const entryCols: XlsxColumn<WorkEntry>[] = [
        { header: 'Time entry ID', value: 'timeEntryId' },
        { header: 'Task ID', value: 'taskId' },
        { header: 'Task name', value: (e) => e.taskName ?? '(No task)', width: 42 },
        { header: 'Logged by', value: 'userName', width: 24 },
        { header: 'Email', value: 'userEmail', width: 28 },
        { header: 'Start', value: 'startTime', type: 'date' },
        { header: 'End', value: 'endTime', type: 'date' },
        { header: 'Duration (h)', value: 'durationHours', type: 'number' },
        { header: 'Chargeable', value: (e) => (e.chargeable ? 'Yes' : 'No') },
        { header: 'Override', value: (e) => (e.chargeableOverride === null ? '' : e.chargeableOverride ? 'Chargeable' : 'Non-chargeable') },
        { header: 'Hourly rate', value: (e) => e.hourlyRateCents / 100, type: 'money' },
        { header: 'Cost', value: (e) => (e.status === 'NO_RATE_FOUND' ? null : e.costCents / 100), type: 'money' },
        { header: 'Currency', value: 'currency' },
        { header: 'Status', value: 'status' },
        { header: 'Description', value: 'description', width: 42 },
      ];
      await exportXlsxSheets('tasks-and-time', [
        xlsxSheet({ sheetName: 'Tasks', rows: tasks, columns: taskCols }),
        xlsxSheet({ sheetName: 'Entries', rows: entries, columns: entryCols }),
      ]);
    },
  });

  // ── Columns ───────────────────────────────────────────────────────────────
  const columns: Column<WorkRow>[] = useMemo(() => [
    {
      key: 'name', header: 'Task', width: 340,
      render: (r) => {
        const noTask = r.taskId === NO_TASK_ID;
        const isSubtask = !!r.parentTaskId;
        return (
          <div title={noTask ? 'Time entries with no task' : REASON[r.inRangeBecause]} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, maxWidth: 290, overflow: 'hidden', paddingLeft: isSubtask ? 14 : 0 }}>
            {isSubtask && <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--text-faint)', flexShrink: 0 }} />}
            <span style={{ width: 4, height: 16, borderRadius: 2, background: String(r.statusColor ?? '#94a3b8'), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, fontStyle: noTask ? 'italic' : 'normal', color: noTask || r.isDeleted ? 'var(--text-muted)' : 'var(--text)' }}>
              {noTask ? '(No task)' : r.taskName}
            </span>
            {r.isDeleted && <Pill tone="gray" size="xs">deleted</Pill>}
            {r.archived && <Pill tone="gray" size="xs">archived</Pill>}
          </div>
        );
      },
    },
    { key: 'status', header: 'Status', width: 120, sortable: false, render: (r) => (r.status ? <StatusBadge status={r.status} color={r.statusColor ?? undefined} /> : blank(null)) },
    {
      key: 'charge', header: 'Charge', width: 120, sortable: false,
      render: (r) => {
        const title = r.chargeableSource === 'entries' ? 'From the time logged in the range' : 'From the task flag and its rules (no time logged in the range)';
        return (
          <span title={title}>
            {r.chargeable === 'partial' ? <Pill tone="blue" size="xs">partial</Pill>
              : r.chargeable === 'no' ? <Pill tone="gray" size="xs">non-chargeable</Pill>
                : <Pill tone="green" size="xs">chargeable</Pill>}
          </span>
        );
      },
    },
    {
      key: 'assignees', header: 'Assignees', width: 110, sortable: false,
      render: (r) => { const users = parseAssignees(r); return users.length ? <ClickupAvatarStack users={users} max={3} /> : blank(null); },
    },
    { key: 'est', header: 'Est', width: 70, align: 'right', sortable: false, render: (r) => (r.timeEstimateHours != null ? <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{fmt.shortHours(r.timeEstimateHours)}</span> : blank(null)) },
    { key: 'logged', header: 'Logged', width: 90, align: 'right', render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.duration(r.logged?.hours ?? 0)}</span> },
    { key: 'lifetime', header: 'Lifetime (ClickUp)', width: 130, align: 'right', sortable: false, render: (r) => (r.lifetimeSpentHours != null ? <span title="ClickUp's own total — ignores the date range" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{fmt.shortHours(r.lifetimeSpentHours)}</span> : blank(null)) },
    { key: 'cost', header: 'Cost', width: 100, align: 'right', render: (r) => (r.logged && r.logged.costCents > 0 ? <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.money(r.logged.costCents, r.logged.currency)}</span> : blank(null)) },
    {
      key: 'rates', header: 'Rates', width: 120, sortable: false,
      render: (r) => {
        const l = r.logged;
        if (!l) return blank(null);
        if (r.chargeable === 'no') return <span style={{ color: 'var(--text-faint)' }}>n/a</span>;
        if (l.missingRateCount > 0) return <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>{l.missingRateCount} missing</Pill>;
        if (l.excludedCount >= l.entryCount) return <Pill tone="gray" size="xs">excluded</Pill>;
        if (l.excludedCount > 0) return <Pill tone="gray" size="xs">{l.excludedCount} excluded</Pill>;
        return <Pill tone="green" size="xs">all costed</Pill>;
      },
    },
    { key: 'lastActivity', header: 'Last logged', width: 100, align: 'right', render: (r) => (r.logged?.lastActivity ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt.relative(r.logged.lastActivity)}</span> : blank(null)) },
    { key: 'client', header: 'Client', width: 130, sortable: false, render: (r) => (r.client ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.client}</span> : blank(null)) },
    { key: 'sub_projects', header: 'Sub-project', width: 140, sortable: false, render: (r) => { const s = subProjectsOf(r); return s.length ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.join(', ')}</span> : blank(null); } },
    { key: 'list', header: 'List', width: 120, sortable: false, render: (r) => (r.listName ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.listName}</span> : blank(null)) },
    { key: 'sprint', header: 'Sprint', width: 100, sortable: false, render: (r) => (r.sprintName ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.sprintName}</span> : blank(null)) },
    { key: 'points', header: 'Pts', width: 60, align: 'right', sortable: false, render: (r) => (r.sprintPoints ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.sprintPoints}</span> : blank(null)) },
    { key: 'updated', header: 'Updated', width: 100, align: 'right', render: (r) => (r.updatedDate ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt.relative(r.updatedDate)}</span> : blank(null)) },
  ], []);

  // ── Selection bar content ─────────────────────────────────────────────────
  const selectionStats: SelectionStat[] = useMemo(() => {
    if (taskSel.count > 0) {
      const rows = taskSel.selectedRows;
      return [
        { label: 'logged', value: fmt.hours(rows.reduce((n, r) => n + (r.logged?.hours ?? 0), 0)) },
        { label: 'cost', value: fmt.money(rows.reduce((n, r) => n + (r.logged?.costCents ?? 0), 0)) },
      ];
    }
    const rows = entrySel.selectedRows;
    return [
      { label: 'total', value: fmt.hours(rows.reduce((n, r) => n + r.durationHours, 0)) },
      { label: 'chargeable', value: fmt.hours(rows.filter((r) => r.chargeable).reduce((n, r) => n + r.durationHours, 0)) },
    ];
  }, [taskSel.count, taskSel.selectedRows, entrySel.selectedRows]);

  // What "Use task setting" will fall back to, when every selected entry is on one task.
  const useTaskSettingTitle = useMemo(() => {
    const taskIds = new Set(entrySel.selectedRows.map((e) => e.taskId));
    const base = 'Removes the manual setting. Each entry then follows its per-assignee rule, or else the task flag.';
    if (taskIds.size !== 1) return base;
    const row = items.find((r) => r.taskId === [...taskIds][0]);
    if (!row || row.isChargeable == null) return base;
    return `${base} This task is ${row.isChargeable ? 'chargeable' : 'non-chargeable'}.`;
  }, [entrySel.selectedRows, items]);

  const selectionActions = !canEdit ? undefined : taskSel.count > 0 ? (
    <>
      <Button size="sm" variant="subtle" onClick={() => setChargeableTarget({ taskIds: taskSel.selectedRows.map((r) => r.taskId), chargeable: true, clearSelectionOnApply: true })}>Mark chargeable</Button>
      <Button size="sm" variant="subtle" onClick={() => setChargeableTarget({ taskIds: taskSel.selectedRows.map((r) => r.taskId), chargeable: false, clearSelectionOnApply: true })}>Mark non-chargeable</Button>
    </>
  ) : entrySel.count > 0 ? (
    <>
      <Button size="sm" variant="default" disabled={setOverride.isPending} onClick={() => applyOverride(true)}>Mark chargeable</Button>
      <Button size="sm" variant="default" disabled={setOverride.isPending} onClick={() => applyOverride(false)}>Mark non-chargeable</Button>
      <span title={useTaskSettingTitle}>
        <Button size="sm" variant="ghost" disabled={setOverride.isPending} onClick={() => applyOverride(null)}>Use task setting</Button>
      </span>
    </>
  ) : undefined;

  const chargeablePct = totals && totals.hours > 0 ? Math.round((totals.chargeableHours / totals.hours) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Tasks & time"
        description="Every task with activity in the date range, and the time logged on it."
        badge={<Pill tone="purple">Beta</Pill>}
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {FEEDBACK_URL && <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Give feedback</a>}
            <Button variant="subtle" size="md" onClick={() => setExpanded({ key: pageKey, ids: allOpen ? [] : expandable })} disabled={!expandable.length}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
            <Button variant="subtle" size="md" icon={<Download size={13} strokeWidth={1.75} />} loading={exportExcel.isPending} disabled={exportExcel.isPending || workQuery.isLoading} onClick={() => exportExcel.mutate()}>
              {taskSel.count > 0 ? `Export selected (${taskSel.count})` : entrySel.count > 0 ? `Export selected (${entrySel.count})` : 'Export Excel'}
            </Button>
          </div>
        }
      />

      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', maxWidth: '80ch' }}>
        A task is listed if it was updated or had time logged in the range. Logged and Cost count only time logged in the range, so they can differ from the Tasks page&apos;s Spent column. Deleted tasks&apos; time is counted in every space.
      </p>
      {exportNote && <Pill tone="amber">{exportNote}</Pill>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <MetricCard dense label="Tasks" value={fmt.number(total)} sublabel="with activity in range" icon={<ListTree size={13} strokeWidth={1.75} />} />
        <MetricCard dense label="Logged in range" value={fmt.hours(totals?.hours ?? 0)} sublabel={`${fmt.number(totals?.entries ?? 0)} entries`} icon={<Clock size={13} strokeWidth={1.75} />} />
        <MetricCard dense label="Chargeable" value={fmt.hours(totals?.chargeableHours ?? 0)} sublabel={`${chargeablePct}%`} icon={<DollarSign size={13} strokeWidth={1.75} />} />
        <MetricCard dense label="Cost" value={fmt.money(totals?.costCents ?? 0)} sublabel="rated entries only" icon={<DollarSign size={13} strokeWidth={1.75} />} />
        <MetricCard dense label="Missing rates" value={fmt.number(totals?.missingRateCount ?? 0)} sublabel="entries need a rate" icon={<AlertTriangle size={13} strokeWidth={1.75} />} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Input icon={<Search size={14} strokeWidth={1.75} />} value={searchRaw} onChange={(e) => setSearchRaw(e.target.value)} placeholder="Search task, ID, client, list, sprint, entry ID…" aria-label="Search tasks and entries" />
        </div>
        <MultiSelect ariaLabel="Filter by who logged the time" size="md" allLabel="Logged by: anyone" value={loggedBy} onChange={on(setLoggedBy)} options={loggedByOptions} />
        <MultiSelect ariaLabel="Filter by client" size="md" allLabel="Any client" value={client} onChange={on(setClient)} options={clientOptions} />
        <MultiSelect ariaLabel="Filter by sub-project" size="md" allLabel="Any sub-project" value={subProject} onChange={on(setSubProject)} options={subProjectOptions} />
        <MultiSelect ariaLabel="Filter by folder" size="md" allLabel="Any folder" value={folderIds} onChange={on(setFolderIds)} options={folderOptions} />
        <MultiSelect ariaLabel="Filter by list" size="md" allLabel="Any list" value={listIds} onChange={on(setListIds)} options={listOptions} />
        <MultiSelect ariaLabel="Filter by status" size="md" allLabel="Any status" value={status} onChange={on(setStatus)} options={statusOptions} />
        <Select ariaLabel="Filter by chargeability" size="md" value={chargeable} onChange={on(setChargeable)} options={CHARGEABLE_OPTIONS} />
        <MultiSelect ariaLabel="Filter by cost status" size="md" allLabel="Any cost status" value={costStatus} onChange={on(setCostStatus)} options={COST_STATUS_OPTIONS} disabled={missingOnly} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch ariaLabel="Show only entries missing a rate" checked={missingOnly} onChange={on(setMissingOnly)} />
          <span>Missing rate only</span>
        </label>
        <Button size="md" variant="ghost" onClick={() => setMoreFilters((v) => !v)} aria-expanded={moreFilters}>{moreFilters ? 'Fewer filters' : 'More filters'}</Button>
        {moreFilters && (
          <>
            <MultiSelect ariaLabel="Filter by task assignee" size="md" allLabel="Assigned to: anyone" value={assignedTo} onChange={on(setAssignedTo)} options={assignedToOptions} />
            <MultiSelect ariaLabel="Filter by priority" size="md" allLabel="Any priority" value={priority} onChange={on(setPriority)} options={PRIORITY_OPTIONS} />
            <Select ariaLabel="Filter by task type" size="md" value={type} onChange={on(setType)} options={TYPE_OPTIONS} />
            <Select ariaLabel="Filter by sprint status" size="md" value={sprintStatus} onChange={on(setSprintStatus)} options={SPRINT_STATUS_OPTIONS} />
            <Select ariaLabel="Filter by archived state" size="md" value={archived} onChange={on(setArchived)} options={ARCHIVED_OPTIONS} />
          </>
        )}
        {hasFilters && <Button size="md" variant="ghost" icon={<X size={13} strokeWidth={1.75} />} onClick={reset}>Reset</Button>}
      </div>

      {entryFiltersActive && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--muted-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}>
          <Pill tone="blue" size="xs">entry filter</Pill>
          <span style={{ color: 'var(--text)' }}>{bannerText}</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon={<X size={12} strokeWidth={1.75} />} onClick={clearEntryFilters}>Clear</Button>
        </div>
      )}

      <SelectionBar
        count={taskSel.count || entrySel.count}
        noun={taskSel.count > 0 ? 'task' : 'entry'}
        nounPlural={taskSel.count > 0 ? 'tasks' : 'entries'}
        stats={selectionStats}
        onClear={() => { taskSel.clear(); entrySel.clear(); }}
        actions={selectionActions}
      />

      <QueryError query={workQuery} what="tasks and time" />

      <DataTable<WorkRow>
        layout="design"
        stickyFirstColumn
        rowKey="taskId"
        columns={columns}
        data={items}
        loading={workQuery.isLoading}
        emptyTitle="No task activity matches these filters"
        emptyBody="Widen the date range or clear some filters."
        emptyIcon={<Inbox size={20} strokeWidth={1.75} />}
        emptyAction={hasFilters ? <Button variant="default" size="md" onClick={reset}>Clear all filters</Button> : undefined}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={[25, 50, 100]}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPage(1); }}
        hiddenColumns={hiddenCols}
        onHiddenColumnsChange={setHiddenCols}
        onRowClick={(r) => { if (r.taskId !== NO_TASK_ID) setSelectedTask(r); }}
        selectedKeys={taskSel.selectedKeys}
        onToggleRow={toggleTask}
        onTogglePage={toggleTaskPage}
        expandedKeys={expandedKeys}
        onToggleExpand={(key) => setExpanded({
          key: pageKey,
          ids: expandedKeys.includes(key) ? expandedKeys.filter((k) => k !== key) : [...expandedKeys, key],
        })}
        renderExpanded={(row) => (row.logged
          ? <WorkEntryRows taskId={row.taskId} params={params} selectedIds={selectedEntryIds} onToggle={toggleEntry} onOpen={setSelectedEntry} />
          : <div style={{ padding: '10px 14px 10px 46px', fontSize: 12, color: 'var(--text-muted)' }}>No time logged on this task in the range.</div>)}
      />

      <TaskDetailDrawer
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        // A deleted task is listed for its time only — no task-level actions (spec, "Special rows").
        canEdit={canEdit && !selectedTask?.isDeleted}
        onSetChargeable={(taskId, next) => setChargeableTarget({ taskIds: [taskId], chargeable: next, clearSelectionOnApply: false })}
      />
      <TimeEntryDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />

      {chargeableTarget && (
        <ChargeableConfirmModal
          taskIds={chargeableTarget.taskIds}
          chargeable={chargeableTarget.chargeable}
          onClose={(changed) => {
            const { taskIds, chargeable: next, clearSelectionOnApply } = chargeableTarget;
            setChargeableTarget(null);
            if (!changed) return;
            if (clearSelectionOnApply) taskSel.clear();
            setSelectedTask((prev) => (prev && taskIds.includes(prev.taskId) ? { ...prev, isChargeable: next } : prev));
          }}
        />
      )}
    </div>
  );
}
```

Notes for the implementer:
- **`<Pill tone="purple">`:** if `Pill` has no `purple` tone, use `blue`. Check `components/ui/Pill.tsx`; the CSS tokens `--pill-purple-*` exist.
- **`TaskDetailDrawer` props:** if its `task` prop is typed `Task | null` (`Record<string, unknown>`), `WorkRow` is assignable because of its index signature.
- **Missing props:** if `Switch`, `Select`, `MultiSelect` or `MetricCard` lack a prop used here, match the exact props `TimeEntriesPage.tsx` passes. Every prop above is copied from there or from `TasksPage.tsx`.

- [ ] **Step 3: Lint + build**

Run: `cd apps/web && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/work/WorkEntryRows.tsx apps/web/src/pages/WorkPage.tsx
git commit -m "feat(web): Tasks & time (/work) page

One table of tasks with activity in range, each expandable into its
entries. One kind of selection at a time; entry filters show a banner
and open matching tasks; two-sheet export."
```

---

### Task 9: Route, nav, palette, env, and manual verification

**Files:**
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/layout/Sidebar.tsx`, `apps/web/src/components/layout/CommandPalette.tsx`, `apps/web/.env.example`

**Interfaces:**
- Consumes: `WorkPage` (Task 8)

- [ ] **Step 1: Route**

In `App.tsx`, next to the other lazy pages:

```tsx
const WorkPage = React.lazy(() =>
	import('./pages/WorkPage').then((m) => ({ default: m.WorkPage })),
);
```

and next to the `/tasks` route:

```tsx
<Route path="/work" element={<SuspenseRoute><WorkPage /></SuspenseRoute>} />
```

- [ ] **Step 2: Sidebar item with a Beta tag**

In `Sidebar.tsx`:
- Add `tag?: string;` to `interface NavItem`, below `badge?: number;`.
- Add `ListTree` to the `lucide-react` import.
- Insert between the Tasks and Sprints items:
  ```tsx
  { to: "/work", label: "Tasks & time", icon: ListTree, tag: "Beta" },
  ```
- Right after the `{!collapsed && item.badge && …}` block, add:
  ```tsx
  {!collapsed && item.tag && (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 999,
        background: "var(--pill-purple-bg)",
        color: "var(--pill-purple-text)",
      }}
    >
      {item.tag}
    </span>
  )}
  ```

- [ ] **Step 3: Command palette**

In `CommandPalette.tsx`, add `ListTree` to the icon import and insert after the Tasks entry:

```ts
  { label: 'Tasks & time (beta)', to: '/work', sub: '/work', icon: ListTree },
```

- [ ] **Step 4: Env var**

Append to `apps/web/.env.example`:

```
# Optional. "Give feedback" link on the Tasks & time (/work) page — a Slack channel URL or a mailto: link. Hidden when empty.
VITE_WORK_FEEDBACK_URL=
```

- [ ] **Step 5: Lint + build (both apps)**

Run: `npm run lint && npm run test && npm run build && cd apps/web && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 6: Manual verification** (backend `npm run start:dev` + web `cd apps/web && npm run dev`, logged in as an Admin, on a local DB with synced data)

Use the **superpowers:verification-before-completion** skill. Tick each check below only after seeing it:

- [ ] "Tasks & time" with a Beta tag appears between Tasks and Sprints, and opens `/work`.
- [ ] **Card totals equal the row sums.** With a narrow range (e.g. this week) and everything fitting on one page, the Logged in range card equals the sum of the Logged column.
- [ ] **Expanded entries add up to the row.** Expand three tasks; each one's entry durations sum to its Logged value. Repeat with **Logged by** set, and again with a space selected in the topbar.
- [ ] **Updated-only tasks show 0h.** A task updated in range with no time shows `0h`, and its name tooltip says it was listed because it was updated.
- [ ] **Entry filters.** With **Missing rate only** on:
  - tasks without missing-rate entries disappear
  - the rest open automatically, showing only no-rate entries
  - the banner appears, and its Clear button removes it
- [ ] **One selection kind at a time.** Check a task, then check an entry: the task selection clears, and the bar says "1 entry". The reverse also works.
- [ ] **Entry override round trip.** Select one entry and click **Mark non-chargeable**: the row pill and cost update after the recalc. **Use task setting** reverts it, and its tooltip names the task's flag.
- [ ] **Task flag.** **Mark non-chargeable** on a selected task opens the existing confirm modal and applies.
- [ ] **`chargeable=partial` paging.** Every row on page 2 is partial, and the header count matches.
- [ ] **Sorting.** Clicking Logged / Cost / Last logged / Task / Updated headers sorts server-side across pages. Clicking again flips direction.
- [ ] **Export.** The workbook has a **Tasks** sheet and an **Entries** sheet, and the Entries sheet's durations sum to the Tasks sheet's Logged hours.
- [ ] **Member role.** As a Member, the page loads and shows no edit buttons.
- [ ] **Old pages unchanged.** Tasks and Time Entries (grouped and flat) load and export exactly as before.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/CommandPalette.tsx apps/web/.env.example
git commit -m "feat(web): route and Beta nav entry for Tasks & time"
```

---

## Spec coverage (self-review)

| Spec section | Task |
|---|---|
| Trial: route `/work`, Beta tag, palette, feedback link, visible to all roles | 9, 8 |
| Rule 1: updated OR logged; Lifetime column hidden by default; reason tooltip | 3, 8 |
| Rule 2: task vs entry filters, Assigned to / Logged by split, banner, auto-open, task filters don't narrow entries | 3, 8 |
| Rule 3: one selection kind; typed actions; "Use task setting" + tooltip; no per-task entry override | 8 |
| Chargeability: entries vs task source; filter before paging; task inputs for all candidates when filtering | 2, 3 |
| Numbers: `totals` over every row; count labels | 2, 3, 8 |
| Task rows: columns/defaults, server sort, page sizes, drawer | 6, 7, 8 |
| Entry rows: same params as aggregation; lazy; newest first (the time-entries endpoint orders `startTime desc`) | 5, 8 |
| Special rows: deleted tasks with time; space decision; "(No task)" | 3, 8 |
| Backend endpoint + response shape; `costCents` | 3, 4 |
| Frontend file list | 5-9 |
| Export: two sheets | 3, 5, 8 |
| Testing list | 1-4 (backend); 9 (manual, no web test runner) |
| Out-of-date comment fix | 1 |

**Deliberately not in this plan (spec: "After the trial"):**
- deep-link params on `/work`
- redirects
- deleting the old pages
- moving sort and paging into SQL for all-time links

**Where the plan picks details the spec left open:**
- `sort` defaults to `logged desc`
- task filters don't narrow entries
- the feedback link is an env var
- the selection bar keeps `SelectionBar`'s existing wording ("2 tasks …") instead of the spec's "Editing 2 tasks"; the noun plus the actions shown make clear what's being edited

These match the spec's current answers to its open questions. Change them here if those answers change.

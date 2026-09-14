# Tasks & time: one table (trial)

**Date:** 2026-09-14
**Status:** Draft (design) — not yet approved
**Mockup:** https://claude.ai/code/artifact/bd9f4e3f-58d4-4c0c-953d-d2816be723d7 (Option B)

## Problem

Tasks and Time Entries are two pages that answer halves of one question: *what
work happened, and what did the time on it cost?*

- They repeat most of the same filters (assignee, client, sub-project, folder,
  list, archived, sprint status, chargeable), each with its own copy of the
  option-building code.
- "Who logged time on this task?" means leaving Tasks, opening Time Entries and
  searching for the task.
- The two pages show numbers that look comparable and aren't (see the
  `tasks-spent-vs-time-entries-measure-different-things` memory):

| | Tasks page | Time Entries page |
|---|---|---|
| Date range filters | `updated_date` (`tasks-report.service.ts:304`) | `start_time` (`report-filter.util.ts:157`) |
| Hours | `time_spent`: ClickUp's lifetime rollup, ignores the range | sum of entry durations inside the range |
| Soft-deleted tasks | hidden (`isDeleted = false`) | their entries are included |

## Goal

One page, **one table**: each row is a task, and each task expands into its time
entries. The date range means one thing on this page.

We run it **next to** the existing pages as a trial. If the people who use these
pages accept it, the two old pages are removed. If not, the new page is removed.

## Non-goals

- Changing the Tasks or Time Entries pages (bug fixes only during the trial).
- The "three lenses" alternative (Option A in the mockup).
- Any change to how chargeability or cost is calculated or written. This page
  reads the same data and calls the same write endpoints.
- Timesheet. It is a different job (one person, day by day) and stays.

## Trial

- **Route:** `/work`. Nav label **Tasks & time**, with a **Beta** tag, placed
  between Tasks and Time Entries. Also added to the command palette.
- **Visible to all roles.** Edit actions follow the existing rule
  (`hasRole('ADMIN')`), as on the old pages.
- **Duration:** 3 weeks from release.
- **Decided by:** the people who review cost and chargeability, not whoever
  tries it first.
- **Pass:** they can do these without going back to the old pages:
  1. "How much did client X cost this month?"
  2. "Who logged time on task Y, and how much?"
  3. "Make one person's entry on task Y non-chargeable."
  4. "Find and fix entries missing a rate."
- **Fail signal:** people keep going back to the flat Time Entries list, most
  likely to sort *all* entries by cost, rate or date across tasks. This page
  can't do that (see "Known trade-offs").
- **Feedback:** a "Give feedback" link in the page header (`mailto:` or the team
  Slack channel; owner's choice).
- **Freeze:** no new features on the old pages during the trial. Bug fixes only.

## The three rules

### Rule 1: the date range means "activity in range"

A task is listed if **either** its `updated_date` **or** at least one of its time
entries' `start_time` falls inside the range.

- **Logged** (and every entry row) counts only entries with `start_time` in the
  range.
- **Lifetime (ClickUp)** is `time_spent`, shown in its own column whose header
  says it ignores the range. It is hidden by default (column menu).
- Every row carries `inRangeBecause: 'updated' | 'logged' | 'both'`, shown as a
  tooltip on the task name, not a column.
- A task updated in range with no time logged is listed with `0h`.

### Rule 2: task filters and entry filters

| Filter | Kind | Effect |
|---|---|---|
| Status, Priority, Parent/subtask, **Assigned to** | task | Chooses which tasks are listed. Doesn't change a listed task's Logged total. |
| Client, Sub-project, Folder, List, Space, Archived, Sprint status | task attribute | Applied to tasks **and** to the entry aggregation (through the joined task), exactly as each old page does today |
| **Logged by**, Cost status, Missing rate only | entry | Chooses which entries are listed **and counted**. Tasks left with no matching entries are hidden. Tasks that still match open automatically. |
| Chargeable | row | See "Chargeability on this page" |
| Search | task | `taskSearchOr` (the Tasks page field list) plus an exact time-entry-ID match |

- "Assignee" is split into **Assigned to** (task assignees, the Tasks page
  filter) and **Logged by** (entry user, the Time Entries filter). **Logged by**
  shows in the bar by default, because the hours and cost use it. **Assigned
  to** sits under "More filters".
- While any entry filter is active, a banner above the table says what the
  totals now count, e.g. *"Totals count only Rashedul's time in range · Clear"*,
  and the Logged header hint reads "in range · matching entry filters".
- Decision: **task filters don't narrow entries.** "Status: complete" lists
  complete tasks, and all their in-range entries count. A task filter chooses
  rows, not time. (Open question 1.)

### Rule 3: one kind of selection at a time

- Task rows and entry rows both have checkboxes. **A selection holds only one
  kind.** Checking an entry while tasks are selected clears the task selection,
  and the reverse.
- The selection bar names what's being edited:
  - Tasks: **"Editing 2 tasks"**, with Mark chargeable / Mark non-chargeable →
    the existing `ChargeableConfirmModal` → `PATCH /admin/tasks/chargeable`.
  - Entries: **"Editing 3 entries"**, with Mark chargeable / Mark non-chargeable
    / **Use task setting** → `PATCH /admin/time-entries/chargeable-override`.
    "Use task setting" is this page's label for today's "Clear override"
    (`chargeable: null`). Its tooltip says what the entry will become, e.g.
    "Will become non-chargeable: the task is non-chargeable".
- Checking a task never selects its entries. There is still no action that
  overrides every entry under a task (same reason as
  `TimeEntriesPage.tsx:1006-1009`).
- Selection is scoped to the filter set (`useRowSelection`), so it clears when
  filters change.

## Chargeability on this page

The pill and the `chargeable=true|false|partial` filter must use **the same
predicate**, and the three buckets must stay exhaustive (CLAUDE.md,
"Chargeability").

- **Rows with ≥1 counted entry:** the answer comes from those entries, the same
  way as `timeEntriesByTask`: `true` when no counted entry is non-chargeable,
  `false` when none is chargeable, otherwise `partial`
  (`isPartiallyChargeable` with `rules: []`, because the row's numbers are
  scoped to the range).
- **Rows with no counted entry (updated only):** the answer is the task's
  standing answer, computed with exactly the Tasks page's inputs:
  - the task flag
  - its per-assignee rules
  - its **all-time** entry counts

  Those are the inputs `tasksList` passes to `isPartiallyChargeable`
  (`tasks-report.service.ts:383-426`), and they already include per-entry
  overrides. `yes` / `no` follow the flag when the task isn't partial.
  - The comment at `tasks-report.service.ts:329-336` says the override arm is
    "inert today"; that's out of date, since overrides now ship. The code is
    right. Fix the comment in task 1.
- The response carries `chargeableSource: 'entries' | 'task'`, shown in the
  pill's tooltip.
- **The filter is applied to the whole candidate set, not the page:**
  - It is applied after the pill is computed, using the same function, so
    they cannot disagree.
  - It runs **before** paging, so `total` and the pager count only rows that
    pass it.
  - Every candidate therefore needs its pill inputs. Step 2 below loads the
    task flag for all candidates. When `chargeable` is set, the rules and
    all-time entry counts are loaded for every candidate with no counted
    entry, not just the page.

## Numbers

- The summary cards are **Tasks**, **Logged in range**, **Chargeable** (hours
  and %), **Cost** (rated entries only), and **Missing rates**.
- They come from the same response as the rows (`totals`), summed over **every**
  matching row, not just the current page.
- Cards therefore equal the sum of the rows by construction. That is a test,
  not a hope.
- The row count in the header says **tasks**. The Logged card sub-label says
  **entries**.

## Rows

### Task rows

- **Default columns:** select, task (status bar, subtask indent, `deleted` /
  `archived` pills), status, charge, assignees, est, **logged**, cost, rates,
  last logged.
- **Hidden by default:** Lifetime (ClickUp), client, sub-project, list, sprint,
  points, updated.
- **Sort:** server-side via `sort` and `dir`. The default is `logged desc`, with
  ties broken by `taskId`.
- Today's `DataTable` disables header sorting when server-paginated (the
  `isServerPaginated` branch). This page needs header clicks to set `sort` and
  `dir`, so `DataTable` gets an `onSortChange` prop.
- **Page size:** 25 / 50 / 100 tasks.
- **Click a task:** opens the existing task drawer. `TaskDetailDrawer` is
  currently private to `TasksPage.tsx`, so it moves to
  `components/tasks/TaskDetailDrawer.tsx` (a move, no behavior change).

### Entry rows

- **Loading:** entries load when a task is expanded, from
  `GET /reports/time-entries` with **the page's entry-filter params** plus
  `taskId` (the same pattern as `TaskTimeEntriesPanel`).
- **Same where-clause:** the expanded entries use the same `buildTimeEntryWhere`
  call as the aggregation, so they always add up to the row's Logged value. This
  is tested.
- **Component:** `WorkEntryRows` (new, modeled on `TaskTimeEntriesPanel`) adds
  checkboxes. It is rendered through `DataTable`'s existing
  `expandedKeys` / `renderExpanded`.
- **Layout:** lining entry cells up under the parent's columns is nice-to-have,
  not required for the trial.
- **Order:** entries sort newest first within their task.
- **Click an entry:** opens `TimeEntryDrawer`.
- **Expand all:** opens the tasks on the current page only.

### Special rows

- **Soft-deleted tasks:** listed only when they have counted entries, so the
  cards still match the entries. They show a `deleted` pill and have no
  task-level actions.
  - **Space filter decision:**
    - `buildTimeEntryWhere` adds `isDeleted: false` when a space is selected
      (`report-filter.util.ts:159`). Inherited as-is, that would make a deleted
      task's time vanish only when a space is picked, so the same filters with
      and without a space would disagree on hours for no visible reason.
    - This page avoids that: the work service **doesn't pass `spaceId` to
      `buildTimeEntryWhere`**. It adds its own `{ task: { spaceId } }` clause,
      with no `isDeleted` condition.
    - `WorkEntryRows` doesn't send `spaceId` either; `taskId` already pins the
      task. Expanded rows still add up to the row.
    - The shared util is unchanged, so Time Entries keeps its current behavior.
      The header note says this page counts deleted tasks' time in every
      space.
- **Entries with no task:** one synthetic "(No task)" row, using the existing
  `NO_TASK_ID` sentinel. It can't be selected for task actions.

## Backend: `GET /reports/work`

New method `WorkReportService.work(params)` in `src/reports/`, with its route on
the reports controller. The endpoint only reads data.

**Params:** `from`, `to`, `spaceId`, `search`, `status`, `priority`, `type`,
`assignedTo`, `loggedBy`, `client`, `subProject`, `listId`, `folderId`,
`archived`, `sprintStatus`, `chargeable`, `costStatus`, `missingOnly`, `sort`,
`dir`, `limit`, `offset`. Multi-select params stay comma-separated, as they are
everywhere else.

**Query:** two steps, so each side reuses the filter code that already defines
it.

1. **Entries:** one `groupBy` over
   `buildTimeEntryWhere({ ...entryAndAttributeFilters, from, to })`, keyed by
   `taskId`. It collects count, hours, chargeable hours, non-chargeable count,
   cost of rated entries, missing-rate count, excluded count, last activity,
   currency and loggers. This is the same fold as `timeEntriesByTask`.
2. **Tasks:** extract the where-builder from `tasksList` into
   `buildTaskWhere(params)` (`tasksList` then calls it, with no behavior change).
   The query is `buildTaskWhere(taskFilters, without the updated_date window and
   without isDeleted)` AND:
   - no entry filter active:
     `(updatedDate in range AND isDeleted = false) OR taskId IN keys(step 1)`
   - entry filter active: `taskId IN keys(step 1)`

   Select only the columns needed to sort **plus `isChargeable`**.
3. **Chargeable inputs (only when a `chargeable` filter is set):** for
   candidates with no counted entry, load `task_assignee_chargeability` rows
   and an all-time `groupBy(['taskId', 'isChargeable'])` of their entries.
   - With no filter set, this is done for the page's rows only, as `tasksList`
     does.
4. **Merge:** merge everything, then:
   - compute the pill and `inRangeBecause`
   - apply the `chargeable` filter
   - compute `totals` and `total` from what's left
   - sort, then page
5. **Page columns:** fetch the full task columns for the page's ids only.

**Performance:** the sort and paging in step 4 happen in application code. That
is acceptable because this page always has a bounded date range, the same
argument `timeEntriesByTask` makes in its doc comment. The existing indexes are
`clickup_tasks.updated_date` and `clickup_time_entries.start_time` / `task_id`.
**Don't add an all-time mode to this endpoint without moving sort and paging
into SQL first.** This matters at switch-over (see below).

**Response:**

```ts
{
  items: Array<{
    taskId: string;                 // or NO_TASK_ID
    taskName: string | null;
    parentTaskId: string | null;
    status: string | null; statusColor: string | null; priority: string | null;
    assigneesNames: string | null;
    client: string | null; subProjects: string[]; listName: string | null;
    sprintName: string | null; sprintPoints: number | null;
    timeEstimateHours: number | null;
    lifetimeSpentHours: number | null;   // clickup_tasks.time_spent — ignores the range
    updatedDate: string | null;
    archived: boolean; isDeleted: boolean; url: string | null;
    inRangeBecause: 'updated' | 'logged' | 'both';
    chargeable: 'yes' | 'no' | 'partial';
    chargeableSource: 'entries' | 'task';
    logged: {
      entryCount: number; hours: number; chargeableHours: number;
      costCents: number;               // rated entries only
      currency: string;
      missingRateCount: number; excludedCount: number;
      lastActivity: string | null;
      loggers: { userId: string; userName: string | null }[];
    } | null;                          // null = no counted entries
  }>;
  total: number;                       // tasks, after every filter
  limit: number; offset: number;
  totals: {
    tasks: number; entries: number;
    hours: number; chargeableHours: number;
    costCents: number; missingRateCount: number;
  };
}
```

Money is `costCents` plus `currency`. The new endpoint doesn't carry the
`*Aud` misnomer forward (see the `currency-aud-usd-debt` memory).

## Frontend

| File | Change |
|---|---|
| `pages/WorkPage.tsx` | new |
| `components/work/WorkEntryRows.tsx` | new |
| `components/tasks/TaskDetailDrawer.tsx` | moved out of `TasksPage.tsx`, no behavior change |
| `hooks/useFilterOptions.ts` | new: the client / sub-project / list / folder / assignee option builders, currently copied in both pages. The new page uses them; switching the old pages to them is optional. |
| `api/reports.ts`, `hooks/useReports.ts` | `work()` / `useWork()` |
| `components/ui/DataTable.tsx` | `onSortChange` for server-side sort |
| `components/layout/Sidebar.tsx` | nav item; add a text `tag?: string` next to the numeric `badge` for "Beta" |
| `components/layout/CommandPalette.tsx` | entry |
| `App.tsx` | route |

**Export:** one workbook with two sheets from the same filters. The **Tasks**
sheet has one row per task. The **Entries** sheet has every counted entry on
those tasks. A selection exports itself, as on the old pages.

## Known trade-offs

- **No flat list of all entries.** You can't sort every entry across tasks by
  cost, rate or date. Entries sort only within their task. If the trial shows
  this is needed, the fix is a "flat list" toggle, or keeping Time Entries.
- **Wide on mobile.** The table scrolls horizontally, like the old pages.
- **Numbers differ from the old Tasks page.** That page uses `updated_date` and
  lifetime Spent. A note under the page header says so, to head off "the numbers
  don't match" reports.

## Testing

**Backend** (`work-report.service.spec.ts`):

- Inclusion: updated-only, logged-only, both, and neither (excluded).
- An entry filter hides tasks with no matching entries, including updated-only
  tasks.
- `totals` equals the sum over every matching row, not the page.
- The chargeable pill and filter:
  - The three buckets are exhaustive and mutually exclusive, for both
    `entries` and `task` sources.
  - The filter result equals rows whose pill matches.
  - **Paging:** with `chargeable=partial` and the fixtures spread over more
    than one page, `total` equals the number of rows whose pill is partial,
    and no page contains a non-partial row. A single-page test can't catch a
    filter applied after paging.
  - An updated-only task whose only entries (outside the range) were all
    overridden against its flag reads `partial`, the same as on the Tasks page.
- A soft-deleted task is listed only with counted entries. The "(No task)" row
  appears only with entries.
- **Space:** a deleted task with in-range time is listed and counted both with
  and without its space selected, and the hours are equal in both cases.
- Consistency: for a given `taskId`, the `timeEntriesList` sum with the same
  params equals that row's `logged.hours`.
- `buildTaskWhere` extraction: the existing `tasksList` tests pass unchanged.

**Frontend:**

- Selecting an entry clears selected tasks, and the reverse.
- The entry-filter banner appears and disappears with the filters.
- Expanded entry rows add up to the row's Logged value.

## Tasks

1. Extract `buildTaskWhere` from `tasksList` (no behavior change, existing tests
   green). Fix the out-of-date "inert today" comment at
   `tasks-report.service.ts:329-336`.
2. `GET /reports/work` + service + tests.
3. `useFilterOptions` hook; move `TaskDetailDrawer` to its own file.
4. `DataTable` `onSortChange`.
5. `WorkPage` with filters, cards, task rows, sort, paging, and the entry-filter
   banner.
6. `WorkEntryRows`, expand / expand all, and one-kind-at-a-time selection with
   the selection bar and actions.
7. Two-sheet export.
8. Nav item with Beta tag, command palette, feedback link, and a note under the
   header about how the numbers differ from Tasks.

Tasks 1–4 are safe to merge on their own. Task 5 onward is the new page.

## After the trial

**If approved:**

1. **Deep links.** `WorkPage` learns every incoming deep-link param the old pages
   consume:

   | Param | Today sent by |
   |---|---|
   | `taskIds` | Missing Rates, Chargeability Rules |
   | `userId` + `missingOnly` / `status=NO_RATE_FOUND` (all-time) | Missing Rates |
   | `from` + `to` + `search` | Cost Bucket drawer, Timesheet |
   | `spaceScope=all`, `client`, `subProject` | Analytics |
   | `spaceId` | Spaces (today silently ignored by `TasksPage`) |

   It also shows the same "deep link / linked view" banners.
2. **All-time links.** The Missing Rates entries link is all-time, so before it
   can land here, the endpoint's sort and paging must move into SQL, or the link
   must always carry `loggedBy`. A user filter bounds the result, but make that
   a rule in code, not an assumption.
3. **Redirects.** `/tasks` and `/time-entries` redirect to `/work`, keeping the
   query string. Point the in-app links at `/work` directly.
4. **Removal.** Delete `TasksPage`, `TimeEntriesPage`, `TaskTimeEntriesPanel`,
   and the two nav items. Rename the route label from "Tasks & time (Beta)" to
   "Tasks & time".
5. **Old endpoints.** Keep `/reports/tasks` and `/reports/time-entries*`. Other
   pages and the exports use them.

**If rejected:**

- Delete `WorkPage`, `WorkEntryRows`, the endpoint, and the nav item.
- Keep tasks 1, 3 and 4. They are useful on their own.

## Open questions

1. **Task filters and entries.** Should task filters (status, priority) also
   narrow which entries count? The current decision is no. Confirm with whoever
   reads the cost numbers.
2. **Default sort.** Logged desc (where the time went) or updated desc (what
   changed)? The current decision is logged desc.
3. **Feedback channel.** `mailto:` or Slack?
4. **Trial owner.** Who makes the call at the end of the 3 weeks?

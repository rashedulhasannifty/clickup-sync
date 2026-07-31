# Sprint filter & sprint report

Date: 2026-07-31
Status: Approved (design)

## Problem

The dashboard has no notion of a **sprint**. In ClickUp, sprints are organized
as `<Client> Sprint` folders, each holding many time-boxed lists named like
`Sprint 180 (27/7/26 - 2/8/26)`. Verified against production (49,401 tasks):

- **Sprint == list.** Every task has a `list_id`/`list_name` (100% coverage);
  ~90% sit under a folder whose name contains "sprint". The big folders each
  hold hundreds of lists: GlobeCore Sprint = 245 lists, Serenergy Sprint = 189,
  AusCore Sprint = 171. **600+ sprint-lists exist.**
- **The `sprint_name` custom field is dead** — populated on 70 of 49,401 tasks.
  It is noise and will be ignored. Every sprint metric is therefore
  **task-count and hours/cost based**, never story points (`sprint_points` is
  equally unused).
- **"Completed / archived sprint" is not stored.** When a sprint ends, ClickUp
  archives the *list* (or its folder), not the tasks — so task-level `archived`
  (174 rows total) is unrelated. We persist only `list_id`/`list_name` on tasks,
  with no list-archived flag and no sprint start/end dates (those live only
  inside the list name string).

Consequently: no way to filter tasks/time by sprint, no way to see only
active vs completed sprints, and no per-sprint reporting.

## Goal

1. A **sprint (list) filter** — folder-scoped, searchable, with an
   **Active / Completed / All** selector — on the Tasks and Time Entries pages.
   This is the "archived sprint filter".
2. A **`/sprints` analytics page**: per-sprint completion, hours, cost,
   assignees, cycle time, plus a folder-level **velocity trend**.
3. A persisted, authoritative **sprint/list catalog** with a real archived flag
   and sprint start/due dates, so the above is accurate rather than inferred.

## Decisions (agreed)

- **Source of truth for a sprint is the list** (`list_id`), not the
  `sprint_name` custom field. No fallback logic — the custom field is ignored.
- **"Completed / archived" comes from a persisted `clickup_lists.archived`
  flag**, sourced from the existing `getSpaceLists` `archivedContainer` signal
  (list archived OR its folder archived). Not inferred from task done-ratio.
- **`/sprints` is a full analytics page**, including the velocity trend.
- **No noise-list classification in v1.** Recurring lists that live inside
  Sprint folders (e.g. `[BPO] Daily scrum meetings`, `HR & Admin OKR`) are shown
  like any other list; folder grouping + search is the mitigation. A heuristic
  "sprints only" filter is noted as future work.

## ClickUp API assumptions

- `GET /space/{id}/list`, `GET /folder/{id}/list`, `GET /space/{id}/folder`
  (each with `?archived=true|false`) already back `getSpaceLists`. Their list
  objects carry `name`, `archived`, `start_date`, `due_date`, `folder`, `space`
  in addition to `id`. Today the client reads only `id`; we read the rest.
  Spot-check the list-object shape (esp. `start_date`/`due_date` presence) with
  a real call during implementation; missing dates degrade to `null`, not an
  error.
- No new endpoints are called — the catalog sync reuses the exact folder/list
  requests `getSpaceLists` already makes (cheap: no task pages), keeping the
  2 GB host safe.

## Design

### 1. Data model — `prisma/schema.prisma`

New model + migration:

```prisma
model ClickupList {
  listId     String    @id @map("list_id")
  name       String
  folderId   String?   @map("folder_id")
  folderName String?   @map("folder_name")
  spaceId    String?   @map("space_id")
  spaceName  String?   @map("space_name")
  archived   Boolean   @default(false)   // list OR folder archived == completed sprint
  startDate  DateTime? @map("start_date")
  dueDate    DateTime? @map("due_date")
  syncedAt   DateTime  @default(now())   @map("synced_at")
  @@index([folderId])
  @@index([spaceId])
  @@index([archived])
  @@map("clickup_lists")
}
```

`list_id` is the conflict key. No cached task counts — aggregates are computed
in the report queries (joined to `clickup_tasks` / `clickup_time_entries` by
`list_id`).

### 2. Client — capture full list objects (`src/clickup/clickup.client.ts`)

`getSpaceLists` currently returns `Array<{ id, archivedContainer }>`. Extend the
same folder/space list requests to also read `name`, `folder`, `space`,
`start_date`, `due_date` from each list object, returning
`Array<{ id, name, folderId, folderName, spaceId, spaceName, archived, startDate, dueDate }>`
where `archived` is the OR-accumulated `archivedContainer`. The enumeration
logic (folderless + per-folder, both states, OR-accumulated) is unchanged; only
the projected fields grow. Keep the existing `id`/`archivedContainer` shape
available (or adapt the one caller, `streamAllTasksBySpace`).

### 3. Repository — `src/tasks/` (new `lists.repository.ts`)

- `upsertMany(rows)` — bulk upsert catalog rows by `list_id` (authoritative:
  writes `archived`, `startDate`, `dueDate`, names, `syncedAt`).
- `upsertMinimalFromTask({ listId, name, folderId, folderName, spaceId, spaceName })`
  — opportunistic: `INSERT ... ON CONFLICT (list_id) DO UPDATE` that updates
  **only** name/folder/space (never `archived`/dates), so live webhook task
  upserts keep the catalog fresh without clobbering authoritative fields.

### 4. Population wiring

- **Authoritative — backfill:** in `BackfillService`, after (or alongside) the
  archived list enumeration, call `listsRepository.upsertMany(...)` with the
  full list objects from §2. Runs on every manual space backfill.
- **Authoritative — new scheduled catalog sync:** add a lightweight periodic
  job (e.g. daily) in the sync scheduler that, per configured space, calls the
  folder/list enumeration and upserts the catalog. No task fetching → cheap and
  memory-safe; this is what keeps `archived`/dates current between backfills
  (task backfills are manual and the 12 h reconcile skips the archived pass).
- **Opportunistic:** where tasks are persisted (`TasksRepository` upsert path),
  also call `upsertMinimalFromTask` for the task's list. Idempotent.

### 5. Backend reports (`src/reports/`)

New `sprints-report.service.ts` + controller routes:

- `GET /reports/sprints` — sprint catalog list.
  Query params: `spaceId?`, `folderId?`, `status=active|completed|all`
  (default `active`; maps to `archived=false|true|any`), `search?`, `limit?`,
  `offset?`. Each row: `listId, name, folderName, spaceName, archived,
  startDate, dueDate, taskTotal, taskDone, pctDone, hours, cost`. Aggregates via
  `LEFT JOIN` to tasks (done = `status_type IN ('closed','done')`) and time
  entries, grouped by `list_id`. Paginated.
- `GET /reports/sprints/folders` — distinct sprint folders (for the picker's
  top level and the velocity grouping), with active/completed counts.
- `GET /reports/sprints/:listId` — one sprint's detail: status breakdown
  (count + color per status), hours & cost by assignee, distinct assignees,
  totals, date range, `archived` badge, and cycle-time (reuse
  `CycleTimeReportService` scoped to this `list_id`).
- `GET /reports/sprints/velocity?folderId=` — done-task count (and hours) per
  sprint across the folder's recent sprints, ordered by `dueDate` (fallback
  `syncedAt`), capped to the last N sprints — feeds the velocity trend chart.

### 6. Wire sprint into existing task/time-entry filters

The task list endpoint already accepts `listId`. Add a single
`sprintStatus=active|completed|all` param (default `all`) to the tasks and
time-entries list endpoints that joins `clickup_tasks.list_id →
clickup_lists.list_id` and filters by `clickup_lists.archived`
(`active`→`false`, `completed`→`true`, `all`→no filter). The existing
`archived` (task-level) param is untouched — this is a separate, list-level
dimension.

### 7. Frontend (`apps/web`)

- **`SprintPicker` component** — folder → list, searchable, with an
  Active / Completed / All segment. Backed by a `useSprints({ spaceId,
  folderId, status, search })` hook over `GET /reports/sprints`. Selecting a
  sprint sets the existing `listId` filter; the Active/Completed segment sets
  `sprintStatus`. Added to the Tasks and Time Entries filter bars.
- **`/sprints` page** (`SprintsPage.tsx`, new sidebar entry):
  - Folder + status selector; a table/grid of sprints (name, dates,
    active/completed badge, %done bar, tasks done/total, hours, cost).
  - Selecting a sprint opens a detail panel: completion donut, done/open,
    hours, cost, assignee breakdown, cycle-time card (reuse `CycleTimeCard`),
    date range.
  - Folder-level **velocity trend** chart (done tasks per sprint across recent
    sprints) using the existing custom chart components (`BarChart`/`LineChart`).
  - CSV export of the sprint table (reuse `src/lib/csv.ts`), consistent with
    other pages.

### 8. Testing

- Client: list-object projection (name/folder/dates/archived) from a mocked
  folder/list payload, incl. OR-accumulated archived and missing-date
  degradation to `null`.
- Repository: `upsertMany` idempotency by `list_id`; `upsertMinimalFromTask`
  does **not** overwrite `archived`/dates.
- Report service: sprint aggregation SQL (task totals/done, hours, cost),
  `status` → `archived` mapping, velocity ordering, folder grouping.
- Controller: param parsing/validation for `status`/`sprintStatus`.
- Frontend: `apps/web` build passes; SprintPicker status→param mapping.

## Non-goals (YAGNI)

- Story-point burndown / velocity — `sprint_points` is dead (70/49k).
- Daily burndown snapshots — no historical daily state is stored.
- Cross-sprint carry-over / task-move tracking.
- Auto-classifying non-sprint ("noise") lists inside Sprint folders — folder
  grouping + search is the v1 mitigation; heuristic filter is future work.
- Backfilling `start_date`/`due_date` for sprints whose ClickUp list lacks them
  (degrade to `null`; name-string date parsing is explicitly out).

## Rollout notes

- The catalog is empty until the first backfill or scheduled catalog sync runs;
  the sprint filter/report show configured spaces' sprints only after that.
  A one-time manual backfill (or manual trigger of the catalog sync) populates
  it. Document in `docs/OPERATIONS.md`.
- Migration adds one table + three indexes; no change to existing tables.

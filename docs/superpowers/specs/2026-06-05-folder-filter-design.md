# ClickUp Folder filter on Tasks and Time Entries pages

**Date:** 2026-06-05
**Status:** Approved

## Goal

Add a single-select **Folder** (ClickUp Folder) filter to both the Tasks page and
the Time Entries page, matching the existing filter-bar pattern (`<Select>`
dropdowns) and mirroring the just-shipped List filter. The Folder dropdown is
space-scoped and filters independently of the List dropdown (plain AND).

ClickUp hierarchy: **Space › Folder › List › Task**. Folder data is already
stored (`clickup_tasks.folder_id` / `folder_name`) and populated by the
normalizer (`src/clickup/clickup-normalizer.ts`), so no schema or sync change is
needed.

## Decisions (approved)

- **Single-select**, consistent with the other dropdowns on both pages.
- **Filter value is `folderId`, not `folderName`** — folder names are not unique
  across spaces; the dropdown value is the ClickUp `folderId`, the label is the
  folder name.
- **The Folder dropdown is scoped to the currently-selected Space**, same as the
  List dropdown. "All spaces" shows every folder prefixed with its space name
  (e.g. `Projects · Q3 Campaigns`).
- **Folder and List filter independently (AND).** No cascade — picking a Folder
  does not narrow the List dropdown. This matches every other filter on the page
  (status, assignee, client, list are all independent AND clauses).
- **Filter only — no Folder column.** No Folder column is added to the Tasks or
  Time Entries table, and no Folder field is added to the CSV exports. (Folderless
  lists exist, so the column would frequently be empty, and the Time Entries table
  already gained a List column.)
- **One shared `GET /reports/folders` endpoint** feeds both dropdowns.

## Backend (`src/reports`)

1. **New endpoint `GET /reports/folders`** → service method `tasksFolders(spaceId?)`.
   - Distinct `(folder_id, folder_name, space_name)` from `clickup_tasks` where
     `is_deleted = false AND folder_id IS NOT NULL AND folder_name <> ''`, with a
     per-folder task count.
   - Optional `spaceId` query param: when present, add `AND space_id = $spaceId`.
   - Ordered by `space_name ASC, folder_name ASC` (using `MAX(space_name)` to
     collapse legacy null-space rows, same as `tasksLists`).
   - Returns `{ folderId: string; folderName: string; spaceName: string | null;
     taskCount: number }[]`.
   - Mirrors `tasksLists()` exactly.
   - Controller: `@Query('spaceId') spaceId?: string`.

2. **`tasks()`** — accept `folderId?: string` (new last parameter, after
   `listId`). When present, add `where.folderId = folderId`.
   - Controller: add `@Query('folderId') folderId?: string`.

3. **`timeEntriesList()`** — accept `folderId?: string` (new last parameter,
   after `listId`). Filter via the relation: `if (folderId) and.push({ task: {
   folderId } });`. No select/mapping change (no column).
   - Controller: add `@Query('folderId') folderId?: string`.

4. **`timeEntriesAggregates()`** — accept `folderId?: string` (new last
   parameter, after `listId`) and apply the same `if (folderId) and.push({ task:
   { folderId } });`, so the metric cards reflect the folder selection.
   - Controller: add `@Query('folderId') folderId?: string`.

## Frontend (`apps/web/src`)

5. `api/reports.ts`: add
   `folders: (params?: { spaceId?: string }) => apiClient.get('/reports/folders', { params }).then(r => r.data)`.

6. `hooks/useReports.ts`: add a `useFolders(spaceId?: string)` query hook, keyed
   `['folders', spaceId ?? 'all']`, mirroring `useLists`.

7. **TasksPage.tsx**:
   - Add `folderFilter` state + a `<Select>` placed **before** the List select
     (Folder is higher in the hierarchy). Options come from
     `useFolders(space !== 'all' ? space : undefined)`.
   - Option label: folder name when a space is selected;
     `"<spaceName> · <folderName>"` when "All spaces". Append ` (<taskCount>)`.
     Value is `folderId`. Plus an `"Any folder"` empty option.
   - Add `folderId: folderFilter || undefined` to `taskParams` (+ dep).
   - Reset `folderFilter` in the existing `[space]` effect that already clears
     `listFilter`.
   - Include `folderFilter` in `reset()` and `hasFilters`.

8. **TimeEntriesPage.tsx**:
   - Add `folderFilter` state + the same `<Select>` (before the List select).
   - Add `folderId: folderFilter || undefined` to `params` (+ dep). The
     `aggParams` derivation strips only `limit`/`offset`, so `folderId`
     propagates to the aggregates query automatically.
   - Reset `folderFilter` in the existing `[space]` effect; include in `reset()`
     and `hasFilters`.
   - No table column, no CSV change.

## Testing

Extend `test/reports.service.spec.ts`:
- `tasksFolders()` returns distinct folders with `spaceName` and counts, scoped
  when `spaceId` is passed, and the SQL guards on `is_deleted = false` /
  `folder_name <> ''`.
- `tasks()` filtered by `folderId` returns only matching tasks.
- `timeEntriesList()` filtered by `folderId` pushes `{ task: { folderId } }` onto
  `where.AND`.
- `timeEntriesAggregates()` honors the `folderId` filter.

## Out of scope (YAGNI)

- Cascade (Folder → List narrowing).
- Folder column / CSV field on either page.
- Multi-select / folder search-as-you-type.
- Persisting the folder selection in the global topbar filter context.

## Correction to prior spec

The List filter spec (`2026-06-05-list-filter-design.md`) listed Folder filtering
as out of scope because "not currently stored as a queryable column." That was
incorrect — `folder_id`/`folder_name` are stored and populated. This spec
supersedes that note.

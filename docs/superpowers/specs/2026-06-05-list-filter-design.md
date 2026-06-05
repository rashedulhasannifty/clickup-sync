# ClickUp List filter on Tasks and Time Entries pages

**Date:** 2026-06-05
**Status:** Approved

## Goal

Add a single-select **List** (ClickUp List) filter to both the Tasks page and
the Time Entries page, matching the existing filter-bar pattern (`<Select>`
dropdowns) and mirroring the recently-added Client filter end-to-end. On Time
Entries, also surface a visible **List** column (table + CSV) so filtered rows
show which list they belong to.

## Decisions (approved)

- **Single-select**, consistent with the other dropdowns on both pages.
- **Filter value is `listId`, not `listName`.** List names are not unique across
  spaces (two spaces can both have a "Backlog" list); filtering by name would
  silently merge them. The dropdown value is the ClickUp `listId`; the label is
  the list name.
- **The List dropdown is scoped to the currently-selected Space.** When a space
  is selected in the topbar, only that space's lists appear. When "All spaces"
  is selected, all lists appear, each labeled with its space name as a prefix
  (e.g. `Projects · Backlog`).
- **Time Entries gets a List column** (resolved via its task) in the table and
  CSV, in addition to the filter.
- **One shared `GET /reports/lists` endpoint** feeds both dropdowns, sourced from
  distinct `clickup_tasks` (`list_id`, `list_name`) values.

## Backend (`src/reports`)

1. **New endpoint `GET /reports/lists`** → service method `tasksLists(spaceId?)`.
   - Distinct `(list_id, list_name, space_name)` from `clickup_tasks` where
     `is_deleted = false AND list_id IS NOT NULL AND list_name <> ''`, with a
     per-list task count.
   - Optional `spaceId` query param: when present, add `AND space_id = $spaceId`
     so the dropdown can be scoped to the selected space.
   - Ordered by `space_name ASC, list_name ASC`.
   - Returns `{ listId: string; listName: string; spaceName: string | null;
     taskCount: number }[]`.
   - Mirrors the existing `tasksClients()` distinct-values pattern.
   - Controller: `@Query('spaceId') spaceId?: string`.

2. **`tasks()`** — accept `listId?: string`. When present, add exact match
   `where.listId = listId`. The free-text search keeps its existing
   `listName: { contains, mode: 'insensitive' }` clause; the dropdown is a
   precise equality filter on `listId` and is independent of search.
   - Controller: add `@Query('listId') listId?: string`.

3. **`timeEntriesList()`** — accept `listId?: string`.
   - Filter via the existing relation, same shape as the `client` filter:
     `if (listId) and.push({ task: { listId } });`. Entries with `taskId = null`
     (no task) are naturally excluded when a list is selected — correct, since
     they have no list.
   - The `select` already includes `task: { select: { taskName, client } }`; add
     `listName: true` to it, and map `listName: e.task?.listName ?? null` onto
     each returned row (for the column + CSV).
   - Controller: add `@Query('listId') listId?: string`.

4. **`timeEntriesAggregates()`** — accept `listId?: string` and apply the same
   `if (listId) and.push({ task: { listId } });` relation filter, so the metric
   cards (total/billable hours, cost, counts) reflect the list selection.
   - Controller: add `@Query('listId') listId?: string`.

## Frontend (`apps/web/src`)

5. `api/reports.ts`: add
   `lists: (params?: { spaceId?: string }) => apiClient.get('/reports/lists', { params }).then(r => r.data)`.
   The `tasks`, `timeEntriesList`, and `timeEntriesAggregates` functions already
   forward an arbitrary `Record<string, string|number|undefined>`, so adding
   `listId` to the caller's param objects flows through with no signature change.

6. `hooks/useReports.ts`: add a `useLists(spaceId?: string)` query hook, keyed
   `['lists', spaceId]` so it re-fetches/re-scopes when the topbar Space changes.
   Pass `spaceId` through to the API only when `space !== 'all'`.

7. **TasksPage.tsx**:
   - Add `listFilter` state + a `<Select>` (placed next to the Client select)
     whose options come from `useLists(space !== 'all' ? space : undefined)`.
   - Option label: list name when a space is selected; `"<spaceName> · <listName>"`
     when "All spaces". Append ` (<taskCount>)`. Value is `listId`. Plus an
     `"Any list"` empty option.
   - Add `listId: listFilter || undefined` to `taskParams`.
   - Reset `listFilter` whenever the topbar `space` changes (a list from the old
     space is meaningless under the new one) and reset `page` to 1.
   - Include `listFilter` in `reset()` and `hasFilters`.
   - List column already present — no table change.

8. **TimeEntriesPage.tsx**:
   - Add `listFilter` state + the same `<Select>` (next to the Client select).
   - Add `listId: listFilter || undefined` to `params` (the `aggParams`
     derivation strips only `limit`/`offset`, so `listId` propagates to the
     aggregates query automatically).
   - Reset `listFilter` when the topbar `space` changes; include in `reset()`
     and `hasFilters`.
   - Add a **List** column to the table and a **List** column to the CSV export.
   - Extend the `TimeEntryItem` interface with `listName?: string | null`.

## Testing

Extend `test/reports.service.spec.ts`:
- `tasksLists()` returns distinct lists with `spaceName` and counts, scoped when
  `spaceId` is passed, sorted by space then list.
- `tasks()` filtered by `listId` returns only matching tasks.
- `timeEntriesList()` filtered by `listId` returns only entries whose task has
  that list, and excludes null-task entries.
- `timeEntriesAggregates()` honors the `listId` filter.

## Out of scope (YAGNI)

- Multi-select / list search-as-you-type.
- Persisting the list selection in the global topbar filter context (it stays
  page-local, like status/priority/client).
- A List filter anywhere other than these two pages.
- Filtering by ClickUp Folder (the layer between Space and List) — not currently
  stored as a queryable column.

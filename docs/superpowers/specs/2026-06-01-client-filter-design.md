# Client filter on Tasks and Time Entries pages

**Date:** 2026-06-01
**Status:** Approved

## Goal

Add a single-select **Client** filter to both the Tasks page and the Time
Entries page, matching the existing filter-bar pattern (`<Select>` dropdowns).
On Time Entries, also surface a visible **Client** column (table + CSV) so
filtered rows show which client they belong to.

## Decisions (approved)

- **Single-select**, consistent with the other dropdowns on both pages.
- **Time Entries gets a Client column** (resolved via its task) in the table
  and CSV, in addition to the filter.
- **One shared `/reports/clients` endpoint** feeds both dropdowns, sourced from
  distinct `clickup_tasks.client` values — so every real client is selectable on
  both pages (even a client with tasks but no logged time).

## Backend (`src/reports`)

1. **New endpoint `GET /reports/clients`** → service method `tasksClients()`.
   - Distinct, non-empty `client` from `clickup_tasks` where `is_deleted = false`
     and `client IS NOT NULL AND client <> ''`, with a per-client task count,
     ordered alphabetically by client.
   - Returns `{ client: string; taskCount: number }[]`.
   - Mirrors the existing `tasksAssignees()` distinct-values pattern.

2. **`tasks()`** — accept `client?: string`. When present, add exact match
   `where.client = client`. The free-text search keeps its existing
   `client: { contains, mode: 'insensitive' }` clause; the dropdown is a precise
   equality filter and is independent of search.
   - Controller: add `@Query('client') client?: string`.

3. **`timeEntriesList()`** — accept `client?: string`.
   - Filter via the existing relation: `where.task = { is: { client } }`.
     Entries with `taskId = null` (no task) are naturally excluded when a client
     is selected — correct, since they have no client.
   - Add `task: { select: { client: true } }` to the `select`, and map
     `client: e.task?.client ?? null` onto each returned row (for the column +
     CSV).
   - Controller: add `@Query('client') client?: string`.

4. **`timeEntriesAggregates()`** — accept `client?: string` and apply the same
   `where.task = { is: { client } }` relation filter, so the metric cards
   (total/billable hours, cost, counts) reflect the client selection.
   - Controller: add `@Query('client') client?: string`.

## Frontend (`apps/web/src`)

5. `api/reports.ts`: add `clients: () => apiClient.get('/reports/clients')`.
   The `tasks`, `timeEntriesList`, and `timeEntriesAggregates` functions already
   forward an arbitrary `Record<string, string|number|undefined>`, so adding
   `client` to the caller's param objects flows through with no signature change.

6. `hooks/useReports.ts`: add a `useClients()` query hook (same shape as
   `useTasksAssignees`).

7. **TasksPage.tsx**:
   - Add `clientFilter` state + a `<Select>` whose options come from
     `useClients()` (label `"<client> (<taskCount>)"`, value `<client>`, plus an
     `"Any client"` empty option).
   - Add `client: clientFilter || undefined` to `taskParams`.
   - Include in `reset()` and `hasFilters`.
   - Client column already present — no table change.

8. **TimeEntriesPage.tsx**:
   - Add `clientFilter` state + the same `<Select>`.
   - Add `client: clientFilter || undefined` to `params` (the `aggParams`
     derivation strips only `limit`/`offset`, so `client` propagates to the
     aggregates query automatically).
   - Include in `reset()` and `hasFilters`.
   - Add a **Client** column to the table and a **Client** column to the CSV
     export.
   - Extend the `TimeEntryItem` interface with `client?: string | null`.

## Testing

Extend `src/reports` service tests:
- `tasks()` filtered by `client` returns only matching tasks.
- `timeEntriesList()` filtered by `client` returns only entries whose task has
  that client, and excludes null-task entries.
- `timeEntriesAggregates()` honors the `client` filter.
- `tasksClients()` returns distinct non-empty clients with counts, sorted.

## Out of scope (YAGNI)

- Multi-select / client search-as-you-type.
- Persisting the client selection in the global topbar filter context (it stays
  page-local, like status/priority/billable).
- A Client filter anywhere other than these two pages.

# Archived-task sync (second pagination pass)

Date: 2026-07-24
Status: Approved (design)

## Problem

The space backfill/sync only fetches non-archived tasks. `getTasksBySpace`
sends `include_closed=true` (a *status* filter) but never sends `archived`,
which defaults to `false` on ClickUp's `GET /team/{team_id}/task`. So tasks
that have been **archived** in ClickUp — and the time entries logged against
them — never enter the DB. `include_closed` covers Done/Closed *statuses*;
`archived` is a separate ClickUp state and is currently excluded.

## Goal

Optionally pull archived tasks (and, as a consequence, their tracked time)
during space sync, via a second pagination pass with `archived=true`, gated by
a runtime settings toggle that defaults on.

## Decisions (agreed)

- **Archived tasks count in the Spaces rollup totals.** No change to the
  `spaces()` query — archived tasks count toward TASKS / OPEN / HOURS /
  Completed like any other task. Consequence: an archived task in a
  non-closed status shows as OPEN. Accepted.
- **Global settings toggle**, `preferences.sync.includeArchived`, default
  `true`, read at runtime (like the other `sync` prefs) so it can be disabled
  without a redeploy if the extra fetch load is a problem on the 2GB host.

## ClickUp API assumption

`GET /team/{team_id}/task?archived=true` returns archived tasks; the default
(`archived=false`) returns non-archived. To get both states, two calls are
required. The design does **not** depend on whether `archived=true` returns
*only* archived vs. archived+active: results from both passes are **deduped by
task id**, so overlap is harmless. This assumption should be spot-checked with
a real API call during implementation, but the dedupe makes the feature correct
either way.

## Design

### 1. Client — `getTasksBySpace` (`src/clickup/clickup.client.ts`)

Add `archived?: boolean` to the options. Append it to the query string:

```ts
params.append("archived", String(options.archived ?? false));
```

`?? false` preserves current behavior when the caller omits it.

### 2. Client — `getAllTasksBySpace` (`src/clickup/clickup.client.ts`)

- Extract the current page loop into a private helper
  `fetchAllPages(spaceId, options, archived): Promise<{ tasks, truncated }>`
  that runs the existing `MAX_PAGES` pagination with the given `archived`
  value.
- Add `includeArchived?: boolean` to the public options.
- Always run pass 1 (`archived=false`). If `includeArchived`, run pass 2
  (`archived=true`).
- Concatenate the two passes, **dedupe by task `id`**, and OR the two
  `truncated` flags. Both passes use the same `dateUpdatedGt`, so the archived
  pull is bounded by the lookback window (not "all archived tasks ever").

Return shape unchanged: `{ tasks: ClickUpTask[]; truncated: boolean }`.

### 3. Settings toggle (`src/settings/settings.service.ts`)

- Add `includeArchived: boolean` to `SettingsPreferences.sync`.
- Add `includeArchived: true` to `DEFAULT_PREFERENCES.sync`.
- Add a `getIncludeArchived(): boolean` accessor (mirrors `getTeamId()` usage).
- No controller/DTO change: the PATCH path already flows through
  `deepMergePrefs` + `SettingsPatch.preferences` (DeepPartial).

### 4. UI toggle (`apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/api/settings.ts`)

Add an "Include archived tasks" checkbox to the Settings → Sync section, wired
to `preferences.sync.includeArchived`, matching the existing sync-pref controls.
This is what makes the toggle runtime-adjustable (the reason a settings toggle
was chosen over always-on).

### 5. Backfill wiring (`src/sync/backfill.service.ts`)

Read `this.settings.getIncludeArchived()` and pass `includeArchived` into
`getAllTasksBySpace`. No other backfill changes: archived tasks carry
`archived: true` (already set by the normalizer at `clickup-normalizer.ts:39`),
are upserted through the same path, and each gets a time-entry sync job fanned
out like any other task — so **archived hours sync too**.

### 6. Reports/counts

No change. Archived tasks count in the Spaces rollup (agreed). The task-list
endpoint's existing `archived=exclude|include|only` filter
(`src/reports/tasks-report.service.ts`) continues to work for drill-in.

## Testing

- `getAllTasksBySpace` two-pass: mock `getTasksBySpace`; assert it paginates
  twice (once per `archived` value) when `includeArchived`, once when not;
  assert merged+deduped result and `truncated` = OR of both passes.
- `getTasksBySpace` query builder includes `archived` with the correct value.
- Settings: `DEFAULT_PREFERENCES.sync.includeArchived === true`; a PATCH of
  `{ preferences: { sync: { includeArchived: false } } }` round-trips.

## Out of scope / risks

- **Memory on the 2GB host:** the second pass adds tasks to the in-memory
  buffer and enqueues more time-entry jobs. It is bounded by the lookback
  window, but a large archived backlog in a wide window could add pressure.
  The toggle is the escape hatch. The "buffer everything in memory" refactor
  of `getAllTasksBySpace` remains a separate future item.
- **No automatic historical re-pull.** Archived tasks appear as spaces are
  synced (scheduled or manual backfill) after deploy, not retroactively on
  deploy.
- Reconciliation is unaffected: archived tasks return 200 (not 404) from
  `getTask`, so the per-task reconcile sweep will not soft-delete them.

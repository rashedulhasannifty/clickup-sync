# Settings persistence & polish — design

Date: 2026-06-15
Branch: `feat/settings-persistence-and-polish`

## Goal

Close six "half-built / polish" gaps in the dashboard + admin API. Three are
quiet data bugs (clear fixes); three are small features the user chose to build
out fully: settings persistence, a command-palette search endpoint, and a real
per-task history trail.

The items are independent. Implement and verify each one before starting the
next (build + test after each; `npm run lint` is known-broken — do not gate on
it).

---

## Item 1 — Settings persistence (full)

**Today:** `SettingsPage` holds sync-rule, notification, and space toggles in
`useState`, so they reset on reload. Only connection, spike cap, and the
tag-map persist.

**Decision (user: "full persistence", and wire workers to honor space toggles):**

Persist the toggles that represent a *real, user-changeable* preference, and
wire **only** the space toggles into worker behavior. The cost/failure
placeholder selects (`Default currency`, `Rate matching`, `Webhook retry`,
`Treat non-billable as zero`, `Pause syncing on repeated failure`) stay as
**labeled preview** — they are `disabled` in the UI and no worker honors them, so
persisting a no-op toggle would be misleading. This is the one place we narrow
"ALL toggles"; flagged here for review.

Persisted preferences:
- **Notifications → Alerts:** `syncFail`, `webhookSpike`, `missingRate`,
  `tokenExpiring` (booleans).
- **Notifications → Channels:** `email`, `slack`, `pagerduty` (booleans).
  *Persisted only — nothing delivers notifications yet. The Settings preview
  banner already says delivery is on the roadmap; it stays.*
- **Sync → Full reconciliation lookback:** `reconcileLookbackDays` (number) —
  becomes the persisted default for the "days back" input.
- **Scope filters → per-space enable/disable:** `spaces[spaceId].enabled`
  (default `true` when absent).

### Storage

Add **one** nullable JSON column `preferences` to the existing singleton
`app_settings` row (do **not** add per-space columns). Shape:

```jsonc
{
  "notifications": {
    "alerts":   { "syncFail": true, "webhookSpike": true, "missingRate": true, "tokenExpiring": true },
    "channels": { "email": true, "slack": true, "pagerduty": false }
  },
  "sync": { "reconcileLookbackDays": 365 },
  "spaces": { "3577824": { "enabled": true }, "3589129": { "enabled": false } }
}
```

`SettingsService` extends its cache + `getMasked()` to expose a typed
`preferences` object merged over defaults (so old rows with `null` read as
all-defaults). `update()` accepts a `preferences` patch (deep-merged, not
replaced, so a single toggle write doesn't clobber the rest). Add a sync getter
`isSpaceEnabled(spaceId): boolean` (default `true`).

### Wiring space toggles into workers

Only the **scheduled** sync loop honors the toggle:
`src/sync/sync.scheduler.ts:30` `for (const space of CLICKUP_SPACES)` skips
spaces where `settings.isSpaceEnabled(space.id) === false`. Manual backfill
(`admin.controller.ts:143`) and reports (`reports.service.ts:608`) are
**unchanged** — disabling a space pauses its scheduled sync but never breaks
manual ops or historical reporting. Log skipped spaces at the scheduler.

### Closing the config↔data divergence

The Scope-filters tab currently lists spaces from *synced data* (`spaceRows`).
A configured space with no data yet wouldn't appear, so it couldn't be disabled
before first sync. Fix: `GET /admin/settings` masked payload gains
`configuredSpaces: { id, name }[]` (sourced from `CLICKUP_SPACES`, cheap, no new
endpoint). The Scope-filters tab renders the **union** of configured + synced
spaces, each with a persisted enable/disable `Switch`. Disabled rows show a
muted "scheduled sync paused" hint instead of the green "active" pill.

---

## Item 2 — Tag-map DTO bug (fix)

Two quiet data bugs; both need the field threaded DTO → controller → repo:

- **`active` on create is dropped.** `SettingsPage` sends `active`, but
  `CreateTagAssigneeDto` doesn't whitelist it (Nest's whitelist pipe strips it),
  `admin.controller.ts:542` `createTagAssignee` doesn't pass it, and
  `TagAssigneeMapRepository.create` doesn't accept it. Add `active?: boolean` at
  all three. (Prisma model defaults `active` to `true`, so omission still works.)
- **Tag rename silently fails.** `UpdateTagAssigneeDto` lacks `tagName`, so
  edits to the tag name are stripped before the repo. Add `tagName?: string` to
  the DTO and to `TagAssigneeMapRepository.update`'s data type. `tagName` is
  `@unique` — renaming onto an existing tag throws Prisma `P2002`; surface it as
  a `409 Conflict` rather than a raw 500.

## Item 3 — Rates PATCH assignee metadata (fix)

`UpdateRateDto` only accepts `currency`/`rate`/dates, so the assignee
name/email the UI implies are editable can't be saved. Thread
`assigneeName?`/`assigneeEmail?` through `UpdateRateDto` →
`admin.controller.ts:469` `updateRate` → `RatesService.update` →
`RatesRepository.update`. **Semantics: per-row** (matches the `PATCH /rates/:id`
granularity). The grouped Rates page shows the *latest* rate's name as the group
header, so editing the latest row updates the visible group name. Add the two
fields to `RateModal` so the edit is reachable. (Metadata-only edits still
enqueue the existing recalc — harmless; no special-casing.)

## Item 4 — Command palette search (new endpoint)

**Today:** placeholder promises "Search tasks, assignees…" but the palette only
navigates routes.

- **Backend:** `GET /admin/search?q=` → `{ tasks: [...], assignees: [...] }`.
  - Tasks: `clickup_tasks` where `name ILIKE %q%` (or `task_id = q`), excluding
    soft-deleted, `take 8`, returning `{ taskId, name, status, client }`.
  - Assignees: distinct from `assignee_rates` (`assigneeId/Name/Email`) matching
    `q`, `take 6`, returning `{ userId, name, email }`.
  - Empty/short (`q.length < 2`) → empty arrays.
- **Frontend `CommandPalette`:** when `q.length >= 2`, debounce (~200ms) and
  fetch. Render three groups: **Tasks** → navigate `/tasks?search=<name>`
  (reuses TasksPage filter); **Assignees** → navigate
  `/assignee-rates?userId=<id>` (works once Item 6 lands); **Pages** → existing
  nav items (still shown, filtered by `q`). Keyboard nav spans the merged list.

## Item 5 — Task drawer history (real combined trail)

**Today:** the drawer's "Sync history" tab shows only `syncCount`/`syncedAt`.

Both source tables already exist and are indexed for this lookup:
`SyncJobLog [entityType, entityId]` and `ClickupTaskEvent [taskId, occurredAt]`.

- **Backend:** `GET /admin/tasks/:taskId/history` merges, newest-first:
  - `SyncJobLog` where `entityType = 'task' AND entityId = :taskId` →
    `{ kind: 'job', at, queueName, jobName, status, error }`.
  - `ClickupTaskEvent` where `taskId = :taskId` →
    `{ kind: 'event', at, eventType, changedByUserName, before, after }`.
  - Both have `BigInt` ids — serialize ids with `.toString()`, matching the
    existing dead-letter / audit-log endpoints (confirm + reuse their pattern).
  - Confirm the exact `entityType` string the task-sync worker writes
    (expected `'task'`); adjust the filter to whatever it actually persists.
- **Frontend:** the `sync` tab keeps the `syncCount`/`syncedAt` summary on top,
  then renders the merged trail as a compact timeline (icon per `kind`,
  relative time, status/event label, error/diff on hover or sub-line). Empty →
  existing minimal summary only.

## Item 6 — AssigneeRatesPage `?userId=` deep link (fix)

`TimeEntriesPage` reads `?userId=`; `AssigneeRatesPage` doesn't. On mount, read
`?userId=` via `useSearchParams` and seed the existing `search` state with it
(the page's filter already matches `assigneeId`). Minimal, reuses the existing
filter path. This also makes the Item 4 assignee deep-link land correctly.

---

## Data model & migration

- One schema change: `app_settings.preferences Json?` (`@map("preferences")`).
- Hand-author the migration SQL + `prisma:deploy` (per migration-drift memory;
  do **not** `migrate dev`). `prisma:generate` after.
- No other table changes — Items 4/5 query existing tables.

## Testing

- **Unit:** `SettingsService` preferences deep-merge + defaults +
  `isSpaceEnabled`; tag-map create-with-`active` and rename; rates metadata
  update; search query shaping; history merge/sort.
- **Existing specs:** keep `tag-assignee-map.repository.spec.ts` green.
- Per item: `npm run test` + `npm run build` before moving on.

## Out of scope (explicit)

- Notification **delivery** (email/Slack/PagerDuty) — toggles persist only.
- Wiring the cost/failure placeholder selects to behavior — stay preview.
- Honoring space toggles in manual backfill or reports — scheduled loop only.
- Opening a specific task's drawer directly from search — palette navigates to
  the filtered Tasks page, not a deep-linked drawer.

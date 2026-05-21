# Dashboard Audit & Fix Log

Started 2026-05-21. Tracks UI/backend findings and the work done against them.
Tick items as they ship. New findings go in the appropriate priority section
with a `- [ ]` checkbox.

---

## Shipped (this session)

### Tasks page filters
- [x] Date filter wired (global topbar range now applies to `updated_date`)
      — `apps/web/src/pages/TasksPage.tsx`
- [x] Status dropdown driven by `tasksSummary.byStatus` (real values, not the
      hardcoded list that missed `'Closed'`/`'done'`)
- [x] Priority filter exact-match works against normalised values
- [x] Search expanded server-side to 10 short fields (task name, ID, assignees,
      emails, client, list, space, sprint, dept, executive) via `AND`/`OR`
      composition — `src/reports/reports.service.ts`
- [x] Search debounced (300 ms) like TimeEntries

### TopBar + Spaces page
- [x] TopBar space dropdown built from `useSpaces()` merged with configured
      spaces; unknown space `19272428` now appears as "Space 19272428"
      — `apps/web/src/components/layout/TopBar.tsx`
- [x] SpacesPage display-name fallback now reads "Space {id}" instead of bare
      ID rendered twice — `apps/web/src/pages/SpacesPage.tsx`
- [x] SpacesPage Open count uses `status_type NOT IN ('closed','done')` (not
      brittle `status NOT IN ('complete','closed')`) — `src/reports/reports.service.ts`
- [x] SpacesPage Members count = distinct `user_id` from time entries on that
      space's tasks

### TimeEntries page
- [x] New backend aggregate endpoint `GET /reports/time-entries/aggregates`
      that accepts the same filter set as the list endpoint
      — `src/reports/reports.controller.ts`, `src/reports/reports.service.ts`
- [x] Metric cards (Total hours / Billable / Non-billable / Total cost / With
      cost / Missing rates) now driven by the new endpoint — no longer frozen
      at the 50-row page sum
- [x] `limit`/`offset` stripped from aggregate query key so pagination doesn't
      churn the cache

### Tag-based assignee replacement (rewrote semantics)
- [x] `time-entries.service.ts` trigger now fires on **time-entry tags** for
      **any logger**, not just `userId === CLICKUP_AGENCY_USER_ID`
- [x] `assignee-replacement.service.ts` resolves mapping from `data.tags`
      (passed on the job), not from a `getTask()` fetch — and records the
      actual logger as `originalUserId`
- [x] `findUnreplacedTaggedEntries(limit)` repo method scans `raw->'tags'`
      and returns rows with materialised `tag_names`
- [x] `/admin/time-entries/backfill-replacement` rewritten to use the new query
- [x] 11 spec cases rewritten to match new payload + case-insensitive match
- [ ] **Run the backfill once** against live data to process the 2 existing
      tagged entries (see "Awaiting your action" below — mutates ClickUp)

### Deep UI review — Batch P0 (all 7 shipped)
- [x] #1 DataTable: client-side sort disabled when `total > visible.length`
      (no more lying "top 50 of 3,326" reorders) — `apps/web/src/components/ui/DataTable.tsx`
- [x] #2 Overview "Total tasks" sparkline + `"+8.2% vs last 30d"` removed
      — `apps/web/src/pages/OverviewPage.tsx`
- [x] #3 Overview "Missing rates trend" chart removed (was `Math.sin(i*0.6)*4`)
- [x] #4 Overview Open/Closed KPIs driven by new `byStatusType` from
      `/reports/tasks/summary` (live: 437 open / 2,889 closed of 3,326)
- [x] #5 `fmt.money` default currency `USD → AUD` — `apps/web/src/lib/formatters.ts`
- [x] #6 Overview "Cost by client" bars render cost (not hours)
- [x] #7 `fmt.relative` handles future dates ("in 3d" instead of "just now")

### Overview page polish (post-batch fixes)
- [x] Time tracked / Calculated cost card sublabels now reflect actual topbar
      range ("last 24h", "last 7d", custom range, etc.) — used to hardcode
      "last 30d" regardless. `dateRangeLabel` exposed from `useGlobalFilters`
      — `apps/web/src/hooks/useGlobalFilters.ts`, `apps/web/src/pages/OverviewPage.tsx`
- [x] "Tasks by space" chart now sourced from `tasksSummary.bySpace` with
      `Space {id}` fallback for unconfigured spaces (was leaving blank labels)
- [x] Backend `tasksSummary.bySpace` switched from `groupBy ['spaceId','spaceName']`
      to raw SQL `GROUP BY space_id` with `MAX(space_name)` — was producing
      duplicate rows when some tasks had `space_name=NULL` for a space and
      others had the name. Output went 6 rows → 4 (the real count).
      `src/reports/reports.service.ts`
- [x] "Time tracked by assignee" chart now renders full assignee names
      instead of `userName.split(' ')[0]` (which collapsed Bangladeshi names
      starting with "Md." to a single bar)
- [x] `fmt.money` adds `currencyDisplay: 'narrowSymbol'` so AUD renders as
      `$` instead of en-US's regional `A$` prefix — `apps/web/src/lib/formatters.ts`

### Sync Logs page polish (post-batch fixes)
- [x] "Last success" / "Last failure" cards now use `useJobLogs({ status, limit: 1 })`
      to fetch the absolute most-recent row of each kind. Old code derived
      them from a 50-row recent slice; with 20k+ successes against 73
      failures in this DB, the slice never contained a failure → card read
      "Never" while Overview correctly showed 5 in last 24h.
      `apps/web/src/pages/SyncLogsPage.tsx`

### Deep UI review — Batch 2 (Inert buttons → wired)
- [x] #8a Tasks CSV export wired — full filtered set up to 5,000 rows
- [x] #8b TimeEntries CSV export wired
- [x] #8c AssigneeRates CSV export wired
- [x] #8d MissingRates CSV export wired
- [x] #9 Retry-all-failed webhooks: new backend endpoint
      `POST /admin/webhooks/retry-failed`, frontend hook + button wired with
      auto-dismiss banner — `src/admin/admin.controller.ts`
- [x] #24 TimeEntries `alert(…)` replaced with auto-dismissing `Callout` banner
- [x] Supporting: `apps/web/src/lib/csv.ts` (RFC4180 helper, dependency-free)
- [x] Supporting: backend `safeLimit` raised 200→5000 on tasks + time-entries
      list endpoints so exports can pull whole filtered set

---

## ⚠️ Awaiting your action

- [ ] **Trigger tag-replacement backfill** against the 2 existing tagged
      entries (Shaon Saha / Rashedul Hasan, both tagged `ahmad`). This mutates
      ClickUp (creates 2 new entries, deletes the originals) so I won't fire
      it unprompted.

      ```bash
      curl -X POST "http://localhost:5173/api/admin/time-entries/backfill-replacement" \
        -H "x-admin-key: pk_3584055_HX7CAOS967ULVNI6MXHJQOT851ULP8X7" \
        -H "Content-Type: application/json" -d '{"limit":100}'
      ```

      Expected response: `{"queued":2,"scanned":2,"limit":100}`.

---

## Open backlog

### Batch 3 — Settings cleanup
Settings page had ~13 disabled or local-only controls. Cleanup applied:
truly dead buttons removed, write-only-local-state controls visually
demoted and labelled honestly, one wired up for real (Test connection).

- [x] #12a `Test connection` — wired. Now calls
      `/api/admin/workspace-members` as a live ClickUp probe and shows an
      inline banner with the member count returned. Verified live (37
      members for this workspace).
- [x] #12b `Rotate token` — removed. No backend path exists; token rotation
      is an out-of-band env+restart op today. Inline comment explains why
      the button is gone.
- [x] #12c `Disconnect` — removed. Same reason as Rotate.
- [x] #12d `Invite member` — removed. Multi-tenant invites aren't
      implemented; access is gated by `ADMIN_API_KEY` only. Members tab
      now opens with an amber callout explaining single-tenant access.
- [x] #12e Reconciliation cadence Select — kept visible but disabled, desc
      updated to "Not scheduled yet — only manual backfills via the Spaces
      page run today".
- [x] #12f Default currency Select — disabled, desc updated to clarify
      currency comes from ClickUp per row, no workspace-wide override.
- [x] #12g Rate matching Select — disabled, desc clarifies that
      start_time matching is the only mode today.
- [x] #12h Webhook retry count Select — disabled, desc clarifies BullMQ
      defaults are used; configurable retry count isn't wired.
- [x] #12i All 4 notification switches — kept, but the whole Notifications
      tab now opens with an amber "preview only — no notifications are
      delivered" callout.
- [x] #12j All 3 channel switches — same as #12i.
- [x] #12k Scope-filter space toggles — Switch removed. Spaces now render
      as read-only info rows with a small `active` pill and a callout at
      the top of the tab pointing at `clickup-spaces.config.ts` for how
      to actually change the set.
- [x] #12l Status-filter chips — section removed entirely. Was
      decorative; bringing back when a `scope_filters` table exists.
- [x] #12m "Add status" button — gone with the section above.
- [x] **Bonus**: Webhook Register-button result now flows through the
      same inline banner pattern instead of a tiny inline span.

Also tidied: `Edit`, `Key`, `Plus`, `Unlink`, `Clock`, `X` lucide-react
imports removed from `SettingsPage.tsx` along with the removals.

### Batch 4 — Cross-cutting quality (all 5 shipped)
- [x] #14 Error banners on query failures — new `<QueryError>` helper
      (`apps/web/src/components/ui/QueryError.tsx`) that takes a single
      React-Query result or an array of them, renders nothing on success,
      renders a Callout with the API/HTTP message + Retry button on
      `isError`. Wired onto every list/dashboard page: Tasks, TimeEntries,
      SyncLogs (Runs + Webhooks tabs), MissingRates, AssigneeRates, Spaces,
      Overview (fans across 9 dashboard queries). Settings page skipped —
      its calls are mutation-driven and already surface inline banners.
- [x] #16 Drawer a11y: `role="dialog"`, `aria-modal="true"`,
      `aria-labelledby={titleId}` from `useId`, focus moves into the panel
      on open (first focusable, falling back to the panel itself with
      `tabIndex=-1`), focus trap on Tab/Shift+Tab cycles within the
      drawer, focus restores to the opener on close, close button gets
      `aria-label="Close"`. — `apps/web/src/components/ui/Drawer.tsx`
- [x] #17 `placeholderData: keepPreviousData` (React-Query v5 API — was
      `keepPreviousData: true` in v4) on paginated/filter-driven hooks:
      `useTasks`, `useTimeEntriesList`, `useTimeEntriesAggregates`,
      `useWebhookEvents`, `useJobLogs`, `useDeadLetters`. Previous page
      now stays rendered through the next page's fetch — no more
      "Loading…" flash on filter or page change.
      — `apps/web/src/hooks/useReports.ts`
- [x] #19 `queryClient` retry policy: replaced `retry: 1` with a custom
      `shouldRetry(failureCount, error)` that retries network errors and
      5xx (plus 408/429) once, and never retries other 4xx. Same policy
      applied to mutations. — `apps/web/src/lib/queryClient.ts`
- [x] #22 DataTable now takes an optional `initialSort?: { key, dir }`
      prop. Seeds the sort indicator so server-paginated tables render
      the arrow on first paint instead of waiting for a user click.
      Wired on TasksPage (`updated_date desc`) and TimeEntriesPage
      (`startTime desc`) — matches the server's `ORDER BY` clauses.
      — `apps/web/src/components/ui/DataTable.tsx`

Verification: `cd apps/web && npm run build` succeeds. `eslint` shows
only pre-existing errors (ternary-as-side-effect on DataTable.tsx lines
120/312/350, plus pre-existing setState-in-effect warnings on
TasksPage/TimeEntriesPage); no new errors introduced.

### Individual P1/P2 items (not started)
- [ ] #10 TimeEntries pagination silently resets to page 1 on `missingOnly`
      toggle — surface a toast or preserve page
- [ ] #11 MissingRates "Show affected tasks (0)" expander reveals nothing —
      `affectedTasks: string[] = []` is hardcoded. Either drop the expander or
      fetch the task list (`/reports/time-entries?userId=X&status=NO_RATE_FOUND`)
- [ ] #13 TopBar `Bell` shows unread dot but isn't wired
- [ ] #15 TasksPage assignee dropdown only includes users with logged time —
      doesn't include task-only assignees. Build from `assignees_names` distinct
- [ ] #18 DataTable's `default` (Tailwind) layout is dead code — every page
      uses `layout="design"`. Remove.
- [ ] #20 OverviewPage `useStats` typed as `Record<string, number>` — add a
      proper `Stats` interface in `hooks/useReports.ts`. (Partially fixed in
      Batch 1 — only inside OverviewPage; hook still returns loose type.)
- [ ] #21 Filter persistence inconsistent: sidebar uses `localStorage`, global
      filters use `sessionStorage`
- [ ] #23 Hardcoded workspace strings: Sidebar "Workspace" / "Admin · API
      key auth", Settings "Nifty IT Solution" / `workspace_id: 3450636`
- [ ] MissingRates `$42/h` placeholder rate (#15 in original review): use
      workspace median active rate, or drop the column

### Side-bugs flagged during work (not started)
- [ ] **`markFailed()` never called** in `clickup-event.processor.ts` — no
      webhook event ever transitions to `status='failed'`, so the new
      "Retry all failed" button I wired will always find 0 candidates. ~10
      line fix: wrap the `process()` body in try/catch and call
      `this.events.markFailed(fingerprint, err.message)` before rethrowing.
- [ ] **Sync job completion detection race** on SpacesPage (`SpacesPage.tsx`
      around the queuedIds + `prevHoursRef` polling loop): if a sync runs
      but hoursLogged doesn't change between polls, the row stays
      "syncing…" indefinitely. Needs an explicit timeout or a real job-
      status callback.
- [x] **Worker error producing 5 failed jobs in last 24h** — diagnosed as
      `clickup_time_entries_task_id_fkey` violations: `taskTimeTrackedUpdated`
      webhooks for tasks in unconfigured spaces (e.g. task `86exjakgc` in
      space `19272428`) triggered a time-entry sync before any task sync
      had inserted the task row. Fixed two-layer:
      • Time-entry worker now self-heals — calls `tasksService.syncTask` if
        `tasksRepo.exists` returns false (`time-entries.service.ts`).
      • Event processor now also enqueues `SYNC_CLICKUP_TASK` for
        `taskTimeTrackedUpdated` events (`clickup-event.processor.ts`).
      3 new unit tests cover the self-heal in `test/time-entries.service.spec.ts`.
- [x] **Time-entry FK failures kept bleeding new `failed` rows when ClickUp
      itself can't resolve the task** — the original self-heal swallowed the
      `syncTask` exception, then proceeded to upsert time entries anyway, so
      every new webhook for `86exjakgc` produced one more `failed` row in
      `sync_job_logs`. The audit's earlier claim that "failures will clear on
      the next webhook" was wrong — they accumulated.
      Patched in `time-entries.service.ts`: after the pre-sync catch, re-check
      `tasksRepo.exists(taskId)`. If still false, log a warning and `return 0`
      — no `getTimeEntries`, no upsert, the job log lands as `completed`. The
      time entries aren't useful without a task row anyway. New test in
      `test/time-entries.service.spec.ts`: "skips time-entry sync entirely
      when the task is still unresolved after pre-sync". 111/111 tests pass.

---

## Reference — full UI audit (2026-05-21)

The numbered findings (#1–#24) above came from a deep code review of every
page and shared component under `apps/web/src/`. Severity buckets used:

- **P0** = actively wrong or misleading (frozen metrics, fake data, broken
  counts, currency mislabelling, inert sorting). All shipped in this session.
- **P1** = inert buttons, missing error UI, accessibility gaps that affect
  real users. Mostly open (Batch 2 covered the inert buttons + alert).
- **P2** = polish/consistency (dead code paths, hardcoded strings, typing,
  persistence consistency, dim-on-refetch). All open.

Verified against actual code with `file:line` precision — line numbers in
this doc may drift as edits happen, but symbol/function names remain valid.

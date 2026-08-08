# Windowed time-entry reconcile

**Date:** 2026-08-08
**Status:** Design — approved, pending implementation plan

## Problem

Reconciling tracked time today means one BullMQ job **per task**. The admin
"Reconcile time entries" control (Settings → Sync) hits
`POST /admin/time-entries/sync-all`, which enqueues a `SYNC_TASK_TIME_ENTRIES`
job for **every** task in the database (`findAllIds()`), each job calling
`GET /team/{team}/time_entries?task_id=…`. On the Projects space alone that is
~45k+ jobs, and at ClickUp's effective rate ceiling (~16 time-entry jobs/min —
each job fans out to ≈6 one-year-slice calls) a full reconcile takes **80+
hours** to drain. See the `clickup-rate-limit-call-amplification` and
`backfill-oom-2gb-host` notes.

Yet ClickUp's `GET /team/{team}/time_entries` returns the **whole**
`[start_date, end_date]` window across all tasks in a single response when
`task_id` is omitted (see the header comment in `clickup.client.ts:17`). So the
same reconcile can be done in a handful of windowed calls instead of tens of
thousands of per-task calls.

## Goal

Add a **windowed** reconcile: one job per **(configured space × date-slice)**
instead of one per task. For a 90-day lookback with 30-day slices across 3
configured spaces that is **9 jobs**, not ~50k — while preserving the two
guarantees the heavy version gives:

1. **Completeness** — every tracked-time entry in the window is upserted, for
   every workspace member (not just the token owner).
2. **Delete detection** — entries deleted in ClickUp are pruned locally.

## Non-goals

- Replacing the **task-existence** full reconcile (`POST /admin/tasks/reconcile`
  → `RECONCILE_CLICKUP_TASK`). That sweep also detects whole-task deletes and
  re-syncs descriptions; it stays as-is (Settings → "Full reconciliation").
- Removing the per-task `POST /admin/time-entries/sync-all` **endpoint**. Per the
  approved decision it stays reachable as an API-only escape hatch for a true
  every-task rebuild. Only its **frontend** wiring is retired (see §6).
- A dedicated progress bar. Nine jobs are visible in Sync Logs like any other
  job; the per-task flood's progress UI is not needed here (YAGNI).

## Architecture

Five units, four new, reusing the existing normalize → cost → upsert → tag
pipeline verbatim.

### 1. ClickUp client — windowed fetch

Generalize the query builder and add a team-level (no `task_id`) fetch.

`src/clickup/time-entries.util.ts`
- Change `buildTimeEntriesQuery(taskId, options)` →
  `buildTimeEntriesQuery(options)` where `options` gains optional `taskId` and
  `spaceId`. Emit `task_id` only when present, `space_id` only when present;
  keep `assignee` + `start_date` + `end_date` behavior unchanged.
- Existing per-task caller passes `{ taskId, … }`; the new caller passes
  `{ spaceId, … }`.

`src/clickup/clickup.client.ts`
- Add `getTimeEntriesWindow(teamId, { spaceId?, assigneeIds?, startDate, endDate })`.
  Same request shape as `getTimeEntries`, but the query omits `task_id` and
  (when `spaceId` is set) adds `space_id`. Slice the window into
  `TIME_ENTRIES_SLICE_MS` chunks exactly like `getTimeEntries` (one request per
  slice, dedupe by entry id on slice boundaries) so no single response is
  unbounded.

**`space_id` verification (implementation-time):** confirm ClickUp's
`time_entries` endpoint honors `space_id`. If it does **not**, the windowed
fetch becomes workspace-wide. This is NOT caught by the FK-skip in
`persistEntries`: `ensureTaskExists` self-heals any referenced task (fetches
and inserts it from ClickUp if missing locally) regardless of which space it
belongs to, so the FK-skip only drops tasks genuinely deleted in ClickUp — it
does **not** filter out other-space tasks. A workspace-wide fetch would
therefore UPSERT other spaces' entries (and self-heal their tasks), an
insertion-pollution risk, not just a deletion one. Deletion safety instead
comes entirely from the space-scoped `pruneWindowOutsideSet` (joins through
`task.spaceId`), which only ever deletes rows within its own job's space —
that part stays correct regardless of whether `space_id` is honored. The
`space_id` probe therefore gates overall correctness (insertion scope), not
only delete-pruning. The service API below is identical either way; only the
client query changes.

### 2. Service — `reconcileWindow`

`src/time-entries/time-entries.service.ts`
- Add `async reconcileWindow(spaceId: string, startDate: number, endDate: number)`.
- Resolve the assignee set once: `assigneeIds ?? this.members.getMemberIds()`
  (all workspace members — captures everyone's time, matching the per-task path).
- Resolve `{ startMs, endMs }` once via `resolveTimeEntriesWindow` and reuse it
  for both fetch and prune (the same anti-drift discipline the per-task path
  uses).
- Fetch: `this.clickup.getTimeEntriesWindow(teamId, { spaceId, assigneeIds: ids, startDate: startMs, endDate: endMs })`.
- **Upsert loop — reused unchanged** from `syncTaskTimeEntries`: per entry,
  `normalizeTimeEntry` → FK guard via `ensureTaskExists` for each distinct
  referenced `task.id` (skip unresolvable) → `costs.calculate` (shared rate
  cache) → `repo.upsert(normalized, cost)`; collect `keepIds` and `rawTags` for
  the tag-replacement step. Optional due-date prefetch identical to the per-task
  path when `rateMatching === 'due'`.
- **Delete-reconciliation at window granularity:** call the new
  `repo.pruneWindowOutsideSet({ spaceId, userIds: ids, startMs, endMs, keepIds })`.
  Apply the same truncation guard: if the fetched entry count for a slice is
  `>= PRUNE_SAFETY_MAX_ENTRIES` (1000), **upsert only, skip the prune** for that
  slice and log a warning. (Because the client slices internally, the guard is
  evaluated per slice; a service-level reconcileWindow that spans multiple
  client slices must therefore either receive per-slice counts or the job must
  itself be one slice — see §4, which makes each **job** exactly one slice so
  the guard is unambiguous.)
- **Tag replacement — reused unchanged:** feed `upserted` into the existing
  active-tag-map replacement enqueue.
- Return the number of entries synced (for the job log).

### 3. Repository — window-scoped prune

`src/time-entries/time-entries.repository.ts`
- Add `pruneWindowOutsideSet({ spaceId, userIds, startMs, endMs, keepIds })`,
  modeled on `pruneTaskEntriesOutsideSet` but scoped by **space** instead of a
  single task:

  ```ts
  deleteMany({
    where: {
      task: { is: { spaceId } },          // space reached via the task join
      userId: { in: userIds },
      startTime: { gte: new Date(startMs), lte: new Date(endMs) },
      timeEntryId: { notIn: keepIds },
    },
  })
  ```

  **Correctness note:** `clickup_time_entries` has no `spaceId` column — space is
  reached through `task.spaceId`. Scoping the prune to `spaceId` is **required**,
  not optional: the fetch (and therefore `keepIds`) is space-scoped, so an
  unscoped window prune would delete other spaces' in-window entries that were
  never in this job's `keepIds`. Entries with a null `task_id` cannot be
  attributed to a space and are therefore never pruned — conservative and safe
  (mirrors the departed-user safety below).

### 4. Job + worker

`src/queues/queue.constants.ts`
- Add `RECONCILE_TIME_ENTRIES_WINDOW: 'reconcile-time-entries-window'` to `JOBS`.

`src/workers/time-entry-sync.processor.ts` (or a sibling processor on the same
queue)
- Handle `RECONCILE_TIME_ENTRIES_WINDOW` jobs with payload
  `{ spaceId, startDate, endDate }`, calling
  `timeEntries.reconcileWindow(spaceId, startDate, endDate)`, wrapped in the same
  `jobLogs.started/finished/failed` + `deadLetters.recordIfExhausted` handling
  the existing processor uses. `entityType: 'space'`, `entityId: spaceId`.
- Enqueue on `QUEUES.CLICKUP_TIME_ENTRIES` with `BACKFILL_TIME_ENTRY_PRIORITY`
  (deprioritized, so it never head-of-line-blocks live webhook jobs — see the
  `bullmq-priority-inversion` note).
- **One job = one date-slice** so the truncation guard in §2 is evaluated over a
  single ClickUp response, and so a single slow slice can't stall the others.

### 5. Admin endpoint

`src/admin/admin-sync.controller.ts`
- Add `POST /admin/time-entries/reconcile-window` with body
  `{ spaceId?: string; lookbackDays?: number }`.
- Resolve the space list: the one requested `spaceId` if given (validated
  against `CLICKUP_SPACES`), else all configured spaces.
- Resolve `lookbackDays` (default 90) → `[start, end]`, split into
  `TIME_ENTRIES_SLICE_MS`-aligned slices (default 30-day slices — a constant).
- Enqueue one `RECONCILE_TIME_ENTRIES_WINDOW` job per (space × slice). Return
  `{ queued }` = total jobs enqueued.

### 6. Frontend

`apps/web`
- Add `adminApi.reconcileTimeEntriesWindow(lookbackDays?)` →
  `POST /admin/time-entries/reconcile-window`, and a
  `useReconcileTimeEntriesWindow()` hook.
- Repoint the Settings → Sync **"Reconcile time entries"** control (added in
  commit `be9c3b8`) from `useSyncAllTimeEntries` to
  `useReconcileTimeEntriesWindow`. The confirm-dialog copy changes from
  "one job per task / tens of thousands of jobs" to "a windowed reconcile — a
  few jobs per space" (the scary warning is no longer warranted).
- Remove the now-unused `useSyncAllTimeEntries` hook and
  `adminApi.syncAllTimeEntries` client method (the **backend** endpoint stays;
  only the dead frontend wiring is removed). Verify `noUnusedLocals` stays green.

## Data flow

```
Admin clicks "Reconcile time entries" (Settings, lookback N days)
  → POST /admin/time-entries/reconcile-window { lookbackDays: N }
    → for each configured space S:
        for each 30-day slice [s,e] within [now-N, now]:
          enqueue RECONCILE_TIME_ENTRIES_WINDOW { spaceId: S, startDate: s, endDate: e }
  → worker.reconcileWindow(S, s, e):
      ids = getMemberIds()
      entries = client.getTimeEntriesWindow(team, { spaceId: S, assigneeIds: ids, s, e })
      for entry in entries: normalize → ensureTaskExists(task) → cost → upsert; collect keepIds
      if entries < PRUNE_SAFETY_MAX_ENTRIES:
        repo.pruneWindowOutsideSet({ spaceId: S, userIds: ids, s, e, keepIds })
      enqueue tag-replacements for tagged entries
```

## Error handling & edge cases

- **Idempotent:** upsert keyed on `time_entry_id`; every job (and the whole
  reconcile) is safe to re-run. Slices are independent.
- **Truncation guard:** a slice returning `>= PRUNE_SAFETY_MAX_ENTRIES` upserts
  only and skips its prune — never prune off a possibly-partial read. One job =
  one slice keeps this unambiguous.
- **Departed users:** the prune is scoped to `userIds` (currently-resolved
  member ids). A user who left the workspace is absent from that set, so their
  historical rows are outside the prune scope and never deleted — same guarantee
  as the per-task path.
- **FK skip:** an entry referencing a task not yet in the DB (a subtask, or a
  task in a space not yet backfilled) gets `ensureTaskExists` once and is skipped
  if unresolvable — existing behavior, reused.
- **Cross-space entries:** the space-scoped prune (via `task.spaceId`) guarantees
  a job only ever prunes within its own space, matching its space-scoped fetch.
- **Empty fetch:** a legitimate "all deleted in this window/space" signal, not an
  error (a failed fetch throws and never reaches the prune) — same as per-task.

## Testing

- **`reconcileWindow` (service):** upserts fetched entries; prunes in-window rows
  ClickUp omitted; respects the truncation guard (no prune when
  `>= PRUNE_SAFETY_MAX_ENTRIES`); passes the same `[startMs,endMs]` to fetch and
  prune (regression guard against drift); skips FK-unresolvable entries; enqueues
  tag replacements.
- **`pruneWindowOutsideSet` (repo):** deletes only rows matching
  `window ∩ space ∩ userIds ∧ ∉ keepIds`; leaves out-of-window, other-space,
  departed-user, and null-task_id rows intact.
- **`buildTimeEntriesQuery`:** with `{ spaceId }` emits `space_id` and omits
  `task_id`; with `{ taskId }` emits `task_id` and omits `space_id`; both still
  send `assignee` + window.
- **Endpoint:** enqueues exactly `configuredSpaces × ceil(lookback / sliceDays)`
  jobs; validates an explicit `spaceId` against `CLICKUP_SPACES`.

## Files touched

| Area | File | Change |
|---|---|---|
| Client query | `src/clickup/time-entries.util.ts` | generalize `buildTimeEntriesQuery` (optional `taskId`/`spaceId`) |
| Client fetch | `src/clickup/clickup.client.ts` | add `getTimeEntriesWindow` |
| Service | `src/time-entries/time-entries.service.ts` | add `reconcileWindow` (reuse pipeline) |
| Repo | `src/time-entries/time-entries.repository.ts` | add `pruneWindowOutsideSet` (space-scoped) |
| Queue | `src/queues/queue.constants.ts` | add `RECONCILE_TIME_ENTRIES_WINDOW` job name |
| Worker | `src/workers/time-entry-sync.processor.ts` | handle the new job |
| Endpoint | `src/admin/admin-sync.controller.ts` | add `POST /admin/time-entries/reconcile-window` |
| Frontend API | `apps/web/src/api/admin.ts` | add `reconcileTimeEntriesWindow`; remove `syncAllTimeEntries` |
| Frontend hook | `apps/web/src/hooks/useAdmin.ts` | add `useReconcileTimeEntriesWindow`; remove `useSyncAllTimeEntries` |
| Frontend UI | `apps/web/src/pages/SettingsPage.tsx` | repoint the control + reword confirm copy |

## Open question deferred to implementation

- Whether ClickUp's `time_entries` endpoint honors `space_id` (see §1).
  **Status: NOT yet probed** — the probe requires a live ClickUp call with the
  production service token, so it is deferred to the first real run against
  staging/prod rather than executed during this build. The code passes
  `space_id` on the assumption it is honored. If the probe comes back
  negative, the fetch is workspace-wide: `pruneWindowOutsideSet` (space-scoped
  via `task.spaceId`) keeps deletion correct regardless, but the FK-skip in
  `persistEntries` does **not** filter other-space entries — `ensureTaskExists`
  self-heals any referenced task irrespective of space — so a negative result
  means other spaces' entries (and their tasks) get upserted, an
  insertion-pollution risk on top of the reduced pruning efficacy from larger
  per-slice counts tripping the truncation guard. **Action before trusting
  this endpoint in prod:** run the `curl` probe in §9 Step 4 of the plan and
  confirm results are space-limited; if not, this needs a structural fix (e.g.
  filtering to configured spaces before upsert), not just a one-line fallback.

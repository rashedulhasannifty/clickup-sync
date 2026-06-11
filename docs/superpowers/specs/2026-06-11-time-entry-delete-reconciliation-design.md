# Time-entry delete reconciliation

**Date:** 2026-06-11
**Status:** Approved (design)

## Problem

When a ClickUp time entry is deleted, our app never removes the local row.
ClickUp emits no "time entry deleted" event; the only tracked-time webhook is
`taskTimeTrackedUpdated`, and our handler (`syncTaskTimeEntries`) is
**upsert-only** — it reconciles entries that still exist but never prunes ones
that disappeared. A whole-task delete (`taskDeleted`) soft-deletes the task row
but also leaves its time entries behind.

Result: stale entries inflate reporting/cost totals permanently.

### Empirically confirmed

Task `86exn18dx` ("Meeting and Other", `is_deleted=false`): ClickUp returns
**0** time entries; our DB holds **5** stale rows, all for user `101485026`,
`start_time` 2026-05-19 → 2026-06-05 (all within the last 365 days).

## Goal

ClickUp deletions reflect locally:

1. **Task deleted** → its time entries are removed too.
2. **Individual entries deleted** (task still alive) → those rows disappear.

Not in production; hard deletes are acceptable. Data loss is fine; *silently
deleting the wrong rows* is not.

## Design

Both paths hard-delete.

### Part 1 — Task deleted (`taskDeleted`)

Drop all time entries for the deleted task.

- Add `TimeEntriesRepository.deleteByTaskId(taskId)` →
  `deleteMany({ where: { taskId } })`.
- In `TaskSyncProcessor`, the `DELETE_CLICKUP_TASK` branch deletes time entries
  **then** soft-deletes the task. Inject `TimeEntriesRepository` into the
  processor (it already lives in the workers module) rather than coupling
  `TasksService` to the time-entries repo. No FK issue — the task row persists
  (soft delete).

### Part 2 — Individual entries deleted (`taskTimeTrackedUpdated`)

Reconcile inside `syncTaskTimeEntries`, **scoped to exactly what was fetched**.
The fetched set is authoritative only for `(assignees fetched) ∩ (window
fetched)`. After the upsert loop, delete local rows where **all** hold:

- `task_id = taskId`
- `user_id ∈ ids` (same assignee set sent to ClickUp)
- `start_time ∈ [windowStart, windowEnd]` (same window)
- `time_entry_id ∉ fetchedIds`

To keep the prune window identical to the fetch window, extract a shared
`resolveTimeEntriesWindow(options)` from `time-entries.util.ts` (returns
`{ startMs, endMs }`, default `endMs = now`, `startMs = endMs − 365d`) and use
it in both `buildTimeEntriesQuery` and the service.

#### Why this is safe per caller

- **Webhook** (1 user = `loggedUserId`, 365-day window): prunes only that
  user's stale entries in the last 365 days. Never touches other users.
- **Backfill / admin windowed** (all members, explicit window): prunes within
  that exact window across members.
- **Replacement entries are protected automatically**: a replacement lives
  under a *different* (mapped) user than the webhook's `loggedUserId`, so it
  falls outside `user_id ∈ ids` and is never pruned. The replacement flow's own
  local delete (`deleteByTimeEntryId`) is unchanged.

#### Edge cases

- **Empty fetch result**: ClickUp genuinely has zero entries in scope → all
  local rows in that box are deleted. This is the real "everything deleted"
  case (matches `86exn18dx`). `notIn: []` in Prisma deletes all rows matching
  the other filters — intended.
- **Fetch failure**: `getTimeEntries` throws on API error, so the prune is
  never reached — a failed fetch aborts the job, it does not nuke rows.
- **Entries older than 365 days deleted in ClickUp**: not pruned by a webhook
  (outside fetched scope). Accepted — backfills with their own windows catch
  the common cases; an unbounded webhook window was rejected for API load and
  blast radius.
- **Rows with `start_time = null`**: don't match the window predicate, so never
  pruned. Acceptable.

## Testing

- `time-entries.util`: `resolveTimeEntriesWindow` defaults and overrides; query
  string still includes the resolved window.
- `time-entries.service` (Part 2): a row absent from the fetched set **within
  scope** is pruned; an out-of-scope row (different user, or outside window) is
  **kept**; a replacement-user row is **kept**.
- Repository: `deleteByTaskId` removes all rows for a task; scoped prune deletes
  only in-scope rows.
- Part 1: deleting a task removes its time entries.

## Out of scope

- No schema change, no migration (pure deletes).
- No soft-delete / audit of removed time entries (acceptable: internal tool).
- Currency/`*Aud` naming untouched.

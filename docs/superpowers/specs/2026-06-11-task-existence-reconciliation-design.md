# Full task-existence + time-entry reconciliation job

**Date:** 2026-06-11
**Status:** Approved (design)
**Builds on:** `2026-06-11-time-entry-delete-reconciliation-design.md`

## Problem

The per-entry delete reconciliation (prior spec) reflects deleted *time
entries* locally. Two gaps remain for a true "everything in sync" sweep:

1. The scheduled backfill selects tasks by ClickUp `date_updated_gt`, so a task
   not "updated" within the lookback is never re-fetched.
2. A **whole task deleted in ClickUp** is only handled by the `taskDeleted`
   webhook. If that webhook is missed, the task lingers locally as
   `is_deleted=false` — a ghost row — and its time entries persist.

The existing `POST /admin/time-entries/sync-all` already sweeps **all stored
tasks** (`tasksRepo.findAllIds()`, which filters `is_deleted=false`) and, now
that `syncTaskTimeEntries` prunes, reconciles entry-level deletes across them.
It does **not** detect whole-task deletes — that is the missing piece.

## Goal

A manual sweep over every stored task that, per task: detects whole-task
deletes against ClickUp **and** reconciles the task's time entries — superset of
`sync-all` plus task-existence.

## Design

### 1. `TaskReconciliationService.reconcileTask(taskId, startMs, endMs)`

Core unit. One ClickUp `GET /task/{id}`:

- **HTTP 404** → task deleted in ClickUp:
  `timeEntriesRepo.deleteByTaskId(taskId)` then
  `tasksService.softDeleteTask(taskId)`. Return `{ taskId, deleted: true }`.
- **Success** → reuse the already-fetched task (no second API call):
  `tasksService.syncTasks([task])` (normalize + upsert) then
  `timeEntriesService.syncTaskTimeEntries(taskId, undefined, startMs, endMs)`
  (all members + window → the prune reconciles entry deletes). Return
  `{ taskId, deleted: false, timeEntriesSynced }`.
- **Any other error** (401/403/5xx) → rethrow. **Only a 404 means "gone."**
  The earlier `86exn18dx` cross-workspace `GET` returned **401 "Team not
  authorized"** — that must never trigger a delete.

404 detection: the Clickup client rethrows the axios error, so the catch checks
`err?.response?.status === 404`.

Placement: a module that can access `TasksService`, `TimeEntriesService`,
`ClickupClient`, and `TimeEntriesRepository` without a cycle — `TimeEntriesModule`
(already imports `ClickupModule` + `TasksModule` and provides the time-entries
collaborators). Exported so the worker can inject it.

### 2. Job `RECONCILE_CLICKUP_TASK`

New `JOBS.RECONCILE_CLICKUP_TASK = 'reconcile-clickup-task'` on the existing
**`clickup-tasks`** queue (reuses its `clickupWorkerOptions` rate-limiter; a
queue may have only one `@Processor`). Handled by a new branch in
`TaskSyncProcessor`, which delegates to `TaskReconciliationService`. Existing
job-log + dead-letter behaviour is preserved. Payload:
`{ taskId, startDate, endDate }`.

### 3. Admin endpoint `POST /admin/tasks/reconcile?lookbackDays=365`

Pages `tasksRepo.findAllIds()` (all `is_deleted=false`), computes the window
once (`endDate = now`, `startDate = now − lookbackDays`, default **365**), and
enqueues one `RECONCILE_CLICKUP_TASK` per task. Returns `{ queued }`. Mirrors
the existing `sync-all` endpoint. Guarded by the same admin auth as the rest of
`AdminController`.

## Why this fills the gaps

Sweeps every stored task regardless of ClickUp `date_updated`, so it catches
ghost tasks (whole-task deletes) **and** re-runs the entry-level prune — the
superset of `sync-all` plus task-existence.

## Safety / idempotency

- 404→delete is idempotent: `softDelete` is an upsert; `deleteByTaskId` is a
  `deleteMany` (no-op when already gone).
- Delete strictly gated on HTTP 404 — no other status deletes a task.
- ~2 ClickUp calls/task, rate-limited by `clickupWorkerOptions`. Manual-only, so
  run deliberately. No cron (rejected to avoid recurring API cost).

## Testing (TDD)

- `reconcileTask`: exists → `syncTasks([task])` + `syncTaskTimeEntries` with the
  window, returns `deleted:false`; 404 → `deleteByTaskId` + `softDeleteTask`, no
  time-entry sync, returns `deleted:true`; 401/500 → rethrows, no delete, no
  sync.
- `TaskSyncProcessor`: `RECONCILE_CLICKUP_TASK` routes to the service; existing
  sync/delete branches unaffected.
- Admin endpoint: enqueues one `RECONCILE_CLICKUP_TASK` per stored task with the
  resolved window; `lookbackDays` override respected.

## Out of scope

- No schedule/cron (manual endpoint only).
- No schema change / migration.
- No UI surface (admin API only).
- Spaces filter unchanged — the sweep is over stored tasks, not spaces.

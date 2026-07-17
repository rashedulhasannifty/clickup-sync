# Webhook status viewer + manual single-task sync

**Date:** 2026-07-17
**Status:** Approved (design)

## Problem

Two operational gaps on the ClickUp integration:

1. **No visibility into what's actually registered on ClickUp.** The Settings page
   shows the *desired* webhook events (checkboxes bound to `CLICKUP_WEBHOOK_EVENTS`),
   but nothing shows what ClickUp actually has subscribed. This caused real
   confusion when `taskTimeTrackedUpdated` appeared "selected" in the UI yet was
   never delivered — because the desired list and the live registration had drifted.

2. **No way to force-sync one task from the UI.** When a task's data (or its time
   entries) is missing/stale, the only recourse is a full backfill or a raw API
   call. Operators need a task-ID box that re-pulls a single task on demand.

## Goals

- Show the webhooks **actually registered on ClickUp**, their subscribed events
  (scopes), health, and any **drift** vs. the desired event list.
- Let an operator **sync a single task by ID** (task record **and** its time
  entries) from the Settings page.

## Non-goals

- Editing/deleting webhooks from the viewer (fixing events stays the existing
  "Register webhook" button, which re-subscribes in place).
- Any change to webhook registration logic itself.
- New time-entry or task sync mechanics — reuse existing endpoints/jobs.

## Design

Both features live on the **Settings page**, next to the existing ClickUp
connection / Subscribed-events section. RBAC follows existing admin endpoints
(Admin/Owner via the global `AuthGuard` + `RolesGuard`).

### Part 1 — Registered webhooks viewer (read-only)

**Backend — `GET /admin/webhooks`**
- New thin controller method delegating to a new
  `ClickupWebhooksService.listRegistered()`.
- `listRegistered()`:
  - Calls the existing `client.getWebhooks(teamId)`.
  - For each webhook returns: `id`, `endpoint`, `events` (subscribed scopes),
    `health` (`status`, `fail_count`).
  - Computes drift vs. `settings.getWebhookEvents()` (the desired list):
    `missingEvents` (desired but not registered) and `extraEvents` (registered
    but not desired).
  - Also returns the `desiredEvents` array and the configured `endpoint` so the
    UI can flag a webhook whose endpoint doesn't match the configured one.
- On ClickUp API failure (e.g. bad token) the endpoint surfaces the error
  (standard Nest exception) so the UI can render an error state.

**Frontend**
- `api/admin.ts`: `listWebhooks: () => apiClient.get('/admin/webhooks').then(r => r.data)`.
- `hooks/useAdmin.ts`: `useWebhooks()` query (standard `useQuery`, no polling).
- `SettingsPage.tsx`: a "Registered webhooks" `Card` near the Subscribed-events
  field. Per webhook: endpoint, a health badge (active/failing), and event chips.
  Any `missingEvents` render in a warning row:
  *"Registered on ClickUp is missing: `<events>` — click Register to sync."*
  Empty state when none are registered:
  *"No webhook registered — click Register."*

### Part 2 — Manual single-task sync

**Backend** — none. Reuses:
- `POST /admin/tasks/sync { taskId }`
- `POST /admin/time-entries/sync-task { taskId }`

**Frontend**
- `api/admin.ts`: add
  `syncTaskTimeEntries: (taskId) => apiClient.post('/admin/time-entries/sync-task', { taskId }).then(r => r.data)`.
- `hooks/useAdmin.ts`: `useSyncTaskFull()` mutation that fires **both** `syncTask`
  and `syncTaskTimeEntries` for the given id (both are idempotent job enqueues).
- `SettingsPage.tsx`: a "Manual sync" `Card` with a task-ID text input + "Sync
  task" button. On submit (task id trimmed, required) it calls `useSyncTaskFull`
  and toasts: *"Queued sync for `<taskId>` (task + time entries)."*

## Data flow

```
Sync button → POST /admin/tasks/sync + POST /admin/time-entries/sync-task
            → BullMQ (clickup-tasks, clickup-time-entries) → workers → DB
            → results visible in Sync Logs (async; UI says "queued")

Webhooks card → GET /admin/webhooks → ClickupWebhooksService.listRegistered()
             → client.getWebhooks(teamId) + drift vs desired → panel
```

## Error handling

- **Task ID:** trimmed, required (non-empty) client-side. Invalid IDs fail in the
  worker and are dead-lettered/visible in Sync Logs — no special client handling.
- **Webhook list:** ClickUp/token errors → endpoint error → panel error state.
- Manual-sync toasts say **"queued"**, never "done" — the work is async.

## Testing

- Backend unit test for `listRegistered()`: given mocked `getWebhooks` + a desired
  event list, asserts correct `missingEvents`/`extraEvents` drift and shape.
- Frontend: follows existing patterns (no component-test infra to add).

## Rollout

Purely additive: one new read-only endpoint, one new service method, three UI
additions (two cards + one api/hook). No schema or migration changes.

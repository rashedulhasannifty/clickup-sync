# Operations

## Start local dependencies

```bash
cp .env.example .env
npm install
npm run dev:deps
npm run prisma:deploy
npm run start:dev
```

## Register ClickUp webhook

Set `CLICKUP_WEBHOOK_ENDPOINT` to the public URL that forwards to `/webhooks/clickup`.

ClickUp events expected by the worker:

```text
taskCreated
taskUpdated
taskDeleted
taskTimeTrackedUpdated
```

## Authentication & roles

Access is per-user with RBAC under a single tenant **Organization**.

- **Bootstrap:** the first `POST /auth/signup` claims the seed org and becomes its **Owner**. After that, signup is closed and new users join by **email invitation** (Owner/Admin invites via the Members & Access tab in Settings).
- **Roles:**
  - **Owner** — org secrets (ClickUp token, webhook secret, team ID, register webhook) + everything Admins can do.
  - **Admin** — ops: rates/tag-mapping CRUD, recalc, sync/backfill, dead-letter & webhook retry, audit log, invite Members/Admins. No org secrets, no touching Owners.
  - **Member** — read-only dashboards and reports.
- **Sessions** are HTTP-only, DB-backed cookies; tokens are stored hashed. Expired sessions are swept hourly by `SessionCleanupService`.
- **`ADMIN_API_KEY`** is now a machine/automation credential (authenticates as a synthetic Owner), not a shared human login.

Auth-related env vars: `DEFAULT_ORG_NAME`, `SESSION_MAX_AGE_DAYS`, `SESSION_IDLE_TIMEOUT_DAYS`, `APP_BASE_URL` (invite links), `ALLOWED_ORIGINS` (CORS), and `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` (invitation email). With no SMTP configured, the dev mailer logs the invite link to the console.

## Manual backfill

Add a BullMQ job to `clickup-backfills` with payload:

```json
{ "spaceId": "3577824", "lookbackDays": 90 }
```

A backfill that hits the task pagination cap is **incomplete** — tasks beyond the cap are not synced. This is now recorded on the run's `sync_job_logs` row as status `partial` (rendered as an amber pill in Sync Logs; the reason shows in the run detail) instead of a clean `completed`. Re-run the backfill with a narrower window if you see it.

## Scheduled reconcile

Three recurring crons run as safety nets for events ClickUp never delivered (real-time updates still arrive via webhooks):

- **Recent updates** — `reconcileRecentUpdates()` every 12h (`@Cron('0 0 */12 * * *')`): re-syncs tasks updated in the last day + a bounded 7-day time-entry window, per enabled space. Deliberately skips the archived per-list scan (too heavy across all spaces every run).
- **List catalog** — `syncListCatalogs()` daily at 03:00 (see "Sprint / list catalog" below).
- **Archived reconcile** — `reconcileArchived()` daily at 04:00 (`@Cron('0 0 4 * * *')`): runs a full `includeArchived=true` backfill for **exactly one** enabled space per day, rotating through the enabled spaces by calendar day. This closes the gap where a task inside a just-completed (archived) sprint whose state changed after its list was archived would otherwise never re-sync until a manual backfill — while keeping the expensive archived scan bounded to one space per run on the small host. It respects the same in-flight overlap guard as the 12h reconcile.

## Sprint / list catalog

`clickup_lists` is the sprint/list catalog behind `/reports/sprints*` and the `sprintStatus` filter on `/reports/tasks` and `/reports/time-entries`. It is kept in sync four ways:

- **Every manual space backfill** (`POST /admin/backfill`) — after the task/time-entry sync succeeds, `BackfillService` best-effort refreshes the list catalog for that space (failures here are logged only; they never fail the backfill itself).
- **Daily cron** — `SyncScheduler.syncListCatalogs()` runs at 03:00 (`@Cron('0 0 3 * * *')`, job `sync-list-catalog` on the `clickup-backfills` queue), one job per space that's configured and enabled in Settings. This is the backstop for lists that change out-of-band (renamed, moved, archived) without any task in them being touched.
- **`POST /admin/lists/sync`** — body `{ "spaceId": "3577824" }` to sync one space, or an empty body to sync every configured space (regardless of the enabled/disabled setting).
- **Opportunistically from task webhooks/sync** — every normalized task write also upserts its list's `name`/`folderId`/`folderName`/`spaceId`/`spaceName` into the catalog, so new lists show up promptly.

Only the backfill/cron/`POST /admin/lists/sync` paths are authoritative for the `archived` flag and the sprint `startDate`/`dueDate` — the opportunistic webhook path deliberately never writes those fields, so a list that's only ever touched via webhook won't have its archived/date fields populated until one of the other three paths runs.

**Bootstrap:** after deploying this feature, call `POST /admin/lists/sync` once to populate the catalog before the first 03:00 cron run.

## Assignee rates

Rates are managed in the dashboard (`/assignee-rates`) via `POST|PATCH|DELETE /admin/rates`. Changing a rate automatically triggers a scoped `recalculate-costs` job on the `maintenance` queue that recomputes costs for affected `clickup_time_entries`. There is no Google Sheets sync. For a manual full recalculation, call `POST /admin/rates/recalculate`.

## Production deployment

For a full server setup (Docker Compose + Caddy with automatic HTTPS on Ubuntu), see `docs/DEPLOYMENT.md`.

## Production checklist

- Use managed PostgreSQL/Neon and Redis.
- Set `CLICKUP_API_TOKEN` as a secret.
- Keep Grafana read-only credentials separate from app credentials.
- Enable HTTPS before setting the ClickUp webhook endpoint.
- Add alerting on failed jobs, missing rates, and stale checkpoints.

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

**Every cron in `SyncScheduler` runs in `Asia/Dhaka`** (`timeZone` on the `@Cron`). The containers run UTC, where 02:00 Dhaka is 20:00 the *previous* day — hand-shifting means changing the hour *and* the weekday, so let the cron library convert. This is operational, not cosmetic: the office works **Mon–Fri 09:00–23:59 local**, so **00:00–09:00 local (and all of Sat/Sun)** is the only window where a heavy sweep isn't competing with live webhook traffic for ClickUp's rate limit. Before this was applied uniformly the two heaviest jobs were firing at 08:00 and 10:00 Dhaka — right as the office opened.

| Local (Dhaka) | Cron | Job |
|---|---|---|
| 00:30 daily | `0 30 0 * * *` | Deletion reconcile — 45-day window |
| 02:00 daily | `0 0 2 * * *` | Deep time-entry backfill — one space, rotating |
| 03:00 daily | `0 0 3 * * *` | List catalog |
| 04:00 daily | `0 0 4 * * *` | Archived reconcile — one space, rotating |
| 00/06/12/18 | `0 0 */6 * * *` | Recent updates |

Recurring crons run as safety nets for events ClickUp never delivered (real-time updates still arrive via webhooks):

- **Recent updates** — `reconcileRecentUpdates()` every 6h at 00:00/06:00/12:00/18:00 local (`@Cron('0 0 */6 * * *')`): re-syncs tasks updated in the last day + a bounded 7-day time-entry window, per enabled space. Deliberately skips the archived per-list scan (too heavy across all spaces every run). Two of the four daily runs land inside office hours by design — this is the path that recovers a webhook ClickUp dropped, and waiting until midnight would leave the dashboard wrong for a full working day.
- **List catalog** — `syncListCatalogs()` daily at 03:00 (see "Sprint / list catalog" below).
- **Archived reconcile** — `reconcileArchived()` daily at 04:00 (`@Cron('0 0 4 * * *')`): runs a full `includeArchived=true` backfill for **exactly one** enabled space per day, rotating through the enabled spaces by calendar day. This closes the gap where a task inside a just-completed (archived) sprint whose state changed after its list was archived would otherwise never re-sync until a manual backfill — while keeping the expensive archived scan bounded to one space per run on the small host. It respects the same in-flight overlap guard as the recurring reconcile.
- **Deletion reconcile** — `reconcileDeletions()` **daily at 00:30** with a **45-day** window. This is the ONLY mechanism that notices a time entry **deleted** in ClickUp, which emits no event for it.

  It runs the **per-task** sync (`task_id`-scoped), whose prune is sound because a task_id fetch returns that task's complete set. The space_id-scoped windowed path must NOT be used for deletion detection — pruning off its incomplete response destroyed 429 live entries on 2026-08-25 (see `WINDOW_PRUNE_ENABLED`).

  Candidates are *tasks we currently hold entries for* in the window, not tasks ClickUp returns: a task whose entries were all deleted upstream is absent from any ClickUp-driven list yet is exactly the one to check. Measured on production: **972 candidate tasks at 45 days ≈ 32 minutes** at the 30 jobs/min limiter (vs 50k+ tasks / ≈28 h for a blanket sweep). Jobs are deprioritized and the queue is idle at 00:30, so the cost is effectively free.

  **The window must satisfy `DELETION_RECONCILE_DAYS > EDIT_HORIZON_DAYS + DELETION_RECONCILE_MAX_GAP_DAYS` (45 > 30 + 3).** An entry is only a candidate while its `start_time` is inside the window, so the last run that can ever examine it is the last one before it ages out — a deletion after that run is **never** detected, not merely late. The original schedule (7-day window Mon–Thu, 30-day window Fri) violated this: a 30-day window on a 7-day period meant an entry's final examination could fall as early as day 24, so deleting a 25-day-old entry went unnoticed roughly six days out of seven. Running daily makes the period 1 day; `MAX_GAP = 3` allows for a deploy restarting the worker across the cron minute, a night the worker was down, and a failed run. **Do not move this cron to a longer period without widening the window**, and do not shrink `MAX_GAP` to 1 "because the cron is daily" — the failure mode is permanent and silent.
- **Deep time-entry backfill** — `deepBackfillTimeEntries()` daily at 02:00 local (`@Cron('0 0 2 * * *')`): upsert-only. It recovers entries never synced and repairs edits, but **cannot detect a deletion** — its delete-prune is disabled (see `WINDOW_PRUNE_ENABLED`). Deletion detection is the per-task cron above. The recurring and 04:00 crons both pass `timeEntryLookbackDays: 7`, and `syncTaskTimeEntries` scopes its ClickUp fetch *and* its delete-prune to that same window — so once an entry's `start_time` passes 7 days it is never re-read and never pruned, while the task row keeps refreshing `time_spent`. The Tasks page and Time Entries page then drift apart silently (observed on prod 2026-08-25: two tasks over-reporting by 0.75h and 1.00h). ClickUp emits no "time entry deleted" event at all and its `taskTimeTrackedUpdated` often doesn't fire for manual edits, so webhooks can't close this gap either.

  Scope is read from Settings → Sync → `reconcileLookbackDays` (default 365, clamped to [1, 1095]) — a preference that previously existed but was read by nothing. It runs the **windowed** reconcile (one team-level call per space × slice), covers **one enabled space per day** in rotation, and enqueues at `BULK_SWEEP_PRIORITY` so it can never head-of-line-block a live webhook. Its rotation is offset by one day from `reconcileArchived` so the two never target the same space on the same day. Skipped while a previous windowed reconcile is still draining.

  Caveat: the archived pass issues one paginated request per list (a sprint folder can hold 200+ archived lists) and fans a `sync-task-time-entries` job out per task onto the throughput-bottlenecked `clickup-time-entries` queue. The overlap guard only checks that the space has no `clickup-backfills` job in flight — it does **not** see the time-entry backlog, which drains after the backfill job itself completes. In practice the one-space-per-day rotation gives ~N days (N = enabled space count) for that backlog to drain, and those backfill time-entry jobs are deprioritized so they never block live webhooks. If archived-list counts grow much larger, bound the per-run list count or gate on `clickup-time-entries` depth.

## Windowed time-entry reconcile

`POST /admin/time-entries/reconcile-window` (body: `{ spaceId?: string; lookbackDays?: number }`, default lookback 90 days, clamped to a max of 400 days) enqueues one deprioritized `reconcile-time-entries-window` job per configured space × date-slice (`RECONCILE_WINDOW_SLICE_DAYS`, currently 7 days) — a cheap alternative to the per-task `sync-all` sweep. It is manual/on-demand only, wired to Settings → Sync → "Reconcile time entries". It shares its slicing with the 02:00 deep backfill via `sliceReconcileWindow`.

**Slice width matters:** a slice returning >= `PRUNE_SAFETY_MAX_ENTRIES` (1000) is treated as possibly-truncated and its delete-reconciliation is **skipped**. Measured 2026-08-25, the Projects space alone logs 1,255-2,300 entries per 30 days, so the previous 30-day slice disabled pruning on every run for that space. At 7 days the worst slice is ~590. Re-check this if entry volume roughly doubles — the failure mode is silent.

**Unverified assumption:** both its cross-space scoping and its delete-pruning depend on ClickUp's `GET /team/{team}/time_entries` honoring the `space_id` filter. That has not yet been confirmed against a live workspace. If ClickUp silently ignores `space_id`, the windowed fetch returns workspace-wide entries, which get upserted (and their tasks self-healed in) even for spaces this deployment doesn't track, and larger per-slice counts make the truncation guard (`PRUNE_SAFETY_MAX_ENTRIES`) trip more often, skipping pruning. Treat pruning from this endpoint as best-effort until the `space_id` probe is run — see `docs/superpowers/specs/2026-08-08-windowed-time-entry-reconcile-design.md` for the probe and fallback.

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

## Blue-green deployment

The production stack runs two web colors — `app-web-blue` and `app-web-green` —
behind Caddy. Caddy proxies to whichever color `active.conf` names. One color is
live; the other is the warm rollback target running the previous image.

### What a deploy does (push to `main`)

`.github/workflows/deploy.yml`: `quality` → `e2e` → `build-and-push` (GHCR image
tagged `:<sha>`) → `deploy`. The deploy job renders `.env` on the host from GitHub
secrets, syncs compose/Caddyfile/scripts, then runs `scripts/deploy.sh`, which:

1. Pulls the new image and ensures infra + Caddy are up.
2. Runs migrations once (`docker compose --profile tools run --rm migrate`) — before any cutover.
3. Detects the current live color from `active.conf` and targets the other.
4. Starts the target color on the new image.
5. Health-gates it on `/api/health` (30 × 2s). **If it never goes healthy, the
   deploy fails and traffic is NOT flipped — the old color keeps serving.**
6. Flips `active.conf` to the target and runs `caddy reload` (graceful).
7. Recreates the singleton `app-worker` on the new image, then prunes old images.

### Rolling back

- **Immediately after a bad deploy** (old color still running the previous image):
  on the host, in `DEPLOY_PATH`:
  ```bash
  # flip back to the other color
  printf 'reverse_proxy app-web-blue:3000\n' > active.conf   # or -green
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile
  ```
  This is instant — no rebuild.
- **Later** (the idle color has since been overwritten): re-run the `Deploy`
  workflow via `workflow_dispatch` from the previous good commit, or
  `DEPLOY_PATH=<path> IMAGE_TAG=<previous-sha> bash scripts/deploy.sh` on the host (the image is
  still in GHCR).

### Migration discipline — expand/contract (REQUIRED)

Blue and green share one Postgres, and the old color must keep working against the
new schema during the rollback window. Therefore **every migration must be
backward-compatible**:

- **Expand**: add nullable columns, new tables, new indexes. Ship code that
  tolerates both old and new shapes.
- **Contract**: only in a *later* deploy, once no running color depends on the old
  shape, drop/rename.
- **Never** drop or rename a column in the same deploy that introduces its
  replacement — that breaks instant rollback. Rollback flips *code*, never
  un-migrates the schema.

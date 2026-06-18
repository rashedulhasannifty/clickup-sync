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

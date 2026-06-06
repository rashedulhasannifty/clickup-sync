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

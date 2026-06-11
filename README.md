# ClickUp Sync NestJS Starter

A NestJS backend starter that replaces the current n8n ClickUp sync workflows with a code-based service using PostgreSQL, Redis, BullMQ, Prisma, and scheduled reconciliation.

## What is included

- NestJS 11 API and worker modules.
- Prisma 7 schema and initial SQL migration.
- BullMQ queues for webhooks, tasks, time entries, backfills, and maintenance.
- ClickUp API client.
- ClickUp webhook ingestion with dedupe and raw event storage.
- Defensive task and time-entry normalizers.
- Task upsert and soft-delete repository.
- Time-entry cost calculation with effective-dated assignee rates.
- Assignee rate management via dashboard (`/assignee-rates`) and `POST|PATCH|DELETE /admin/rates`; changing a rate triggers an automatic scoped `recalculate-costs` job on the `maintenance` queue. Manual recalculation via `POST /admin/rates/recalculate`.
- Scheduled reconciliation/backfill jobs.
- Dockerfile and Docker Compose for PostgreSQL and Redis.
- Swagger docs at `/docs`.
- Grafana starter queries in `docs/GRAFANA_QUERIES.md`.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev:deps
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

Open:

```text
http://localhost:3002/api/health
http://localhost:3002/docs
```

## Main webhook endpoint

```http
POST /webhooks/clickup
```

The endpoint saves the raw ClickUp payload, dedupes it, queues processing, and returns quickly.

## Authentication & roles

Access is per-user with role-based access control, organized around a single tenant **Organization**.

- **First signup claims the org.** The first `POST /auth/signup` attaches the new user to the seed org as its **Owner** and renames the org. After an Owner exists, public signup is closed (403) — everyone else joins by **email invitation** sent by an Owner/Admin.
- **Roles:**
  - **Owner** — org secrets (ClickUp API token, webhook secret, team ID, webhook registration) plus everything Admins can do.
  - **Admin** — operations: rates/tag-mapping CRUD, recalc, sync/backfill, dead-letter & webhook retry, view audit log, invite Members/Admins. Cannot touch org secrets or Owners.
  - **Member** — read-only: dashboards and reports, no write actions.
- **Sessions** are HTTP-only cookies, DB-backed (token stored only as a SHA-256 hash). Expired sessions are swept hourly.
- **`ADMIN_API_KEY`** is no longer a shared admin login — it is now a machine/automation credential that authenticates as a synthetic Owner.

New environment variables (see `.env.example`):

```env
DEFAULT_ORG_NAME=Default Org
SESSION_MAX_AGE_DAYS=30
SESSION_IDLE_TIMEOUT_DAYS=7
APP_BASE_URL=http://localhost:5173      # used to build invite links
ALLOWED_ORIGINS=http://localhost:5173   # comma-separated CORS origins for the SPA
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM="ClickUp Sync <no-reply@example.com>"
```

If SMTP is unconfigured, the dev mailer logs the invite link to the console.

## Source workflow mapping

| n8n behavior | NestJS location |
|---|---|
| Webhook receive, dedupe, route events | `src/webhooks`, `src/workers/clickup-event.processor.ts` |
| Fetch and normalize ClickUp tasks | `src/clickup`, `src/tasks` |
| Parent/subtask backfill by space | `src/sync/backfill.service.ts` |
| Task deletion | `src/tasks/tasks.repository.ts` soft delete |
| Time entry sync and cost calculation | `src/time-entries` |
| Assignee rate management | `src/rates` |
| Scheduled reconciliation | `src/sync/sync.scheduler.ts` |

## Notes before production

This starter intentionally includes the first working structure and core logic, not every possible admin endpoint. Recommended next additions are:

1. Manual endpoints to run a single task sync and space backfill.
2. Dead-letter retry endpoint.
3. ClickUp webhook registration/refresh endpoint.
4. More tests around ClickUp payload variants.
5. Production logging and alerting.

See `docs/ARCHITECTURE.md` and `docs/OPERATIONS.md` for implementation details.

## Setup & deployment

For the complete walkthrough — local dev, production deploy on Ubuntu (Docker Compose + Caddy/HTTPS), ClickUp webhook registration, and CI/CD with GitHub Actions — see **`docs/SETUP_GUIDE.md`** (all steps in one file). `docs/DEPLOYMENT.md` covers the deploy + CI/CD portion specifically.

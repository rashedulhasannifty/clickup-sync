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
http://localhost:3000/health
http://localhost:3000/docs
```

## Main webhook endpoint

```http
POST /webhooks/clickup
```

The endpoint saves the raw ClickUp payload, dedupes it, queues processing, and returns quickly.

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

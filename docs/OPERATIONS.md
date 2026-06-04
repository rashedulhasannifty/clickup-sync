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

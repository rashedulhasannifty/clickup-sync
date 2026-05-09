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

## Rate sync

The rate sync reads from Google Sheets using a service account. Required columns:

```text
assignee_id, assignee_name, assignee_email, currency, hourly_rate_cents, valid_from, valid_to
```

## Production checklist

- Use managed PostgreSQL/Neon and Redis.
- Set `CLICKUP_API_TOKEN` as a secret.
- Keep Grafana read-only credentials separate from app credentials.
- Enable HTTPS before setting the ClickUp webhook endpoint.
- Add alerting on failed jobs, missing rates, and stale checkpoints.

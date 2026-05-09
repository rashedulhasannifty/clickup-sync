# Architecture

This project replaces the n8n ClickUp sync workflows with a structured NestJS backend.

## Flow

1. `POST /webhooks/clickup` receives ClickUp events.
2. The raw payload is saved in `clickup_webhook_events` before processing.
3. A dedupe fingerprint prevents duplicate work.
4. BullMQ queues process ClickUp task, delete, time-entry, rate, and backfill jobs asynchronously.
5. Prisma writes normalized reporting rows into PostgreSQL.
6. Grafana continues querying PostgreSQL for dashboards.

## Implemented queues

- `clickup-webhooks`
- `clickup-tasks`
- `clickup-time-entries`
- `clickup-backfills`
- `assignee-rates`
- `maintenance`

## Important defaults copied from the n8n source workflows

- Team ID: `3450636`
- Spaces:
  - Digital Marketing: `3577824`, 90-day lookback
  - R&D Apps: `3589129`, 20-day lookback
  - Projects: `3525433`, 35-day lookback
- Webhook event types:
  - `taskCreated`
  - `taskUpdated`
  - `taskDeleted`
  - `taskTimeTrackedUpdated`
- Rate sheet ID: `1HmHES7b8bK3K252_fijWW9K_UHMwIJZWmqfszwIB6BA`

## Safety rules

- Webhook requests do not fetch ClickUp task details.
- Heavy work happens inside workers.
- ClickUp fields are normalized defensively.
- Tasks are soft-deleted, not hard-deleted.
- Cost calculation uses effective-dated assignee rates.

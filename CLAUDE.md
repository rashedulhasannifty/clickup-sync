# CLAUDE.md

This file gives Claude Code project-specific instructions for working on this repository.

## Project purpose

This repository is a NestJS backend starter that replaces the existing n8n ClickUp sync workflows with a code-based service.

The service synchronizes ClickUp data into PostgreSQL for reporting and Grafana dashboards. It handles:

- ClickUp task webhooks.
- Scheduled/backfill task sync by ClickUp Space.
- Parent task and subtask normalization.
- Task deletes as soft deletes.
- ClickUp tracked-time sync.
- Assignee-rate sync from Google Sheets.
- Cost calculation for time entries using effective-dated assignee rates.

## Source-of-truth files to read first

Before making architecture or behavior changes, read these files:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `prisma/schema.prisma`
- `src/config/clickup-spaces.config.ts`
- `source-workflows/ClickUp → DB Sync.json`
- `source-workflows/Sync Assignee Rates.json`
- `source-workflows/Old Clikup Task Sync_ Digital Marketing.json`
- `source-workflows/Old Clikup Task Sync_ Projects.json`
- `source-workflows/Old Clikup Task Sync_ R&D Apps.json`
- `source-workflows/clickup_sync_backend_documentation.md`

The n8n workflow files are historical source material. Do not copy n8n quirks blindly; translate the intended behavior into typed NestJS services, workers, repositories, and tests.

## Runtime stack

- Node.js `>=22`
- NestJS 11
- Prisma 7 with `prisma.config.ts`
- PostgreSQL
- Redis
- BullMQ
- Google Sheets API via service account credentials
- Swagger at `/docs`

## Important commands

Use these commands from the repository root:

```bash
npm install
npm run dev:deps
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

Quality checks:

```bash
npm run lint
npm run test
npm run build
```

Database reset for local development only:

```bash
npm run dev:reset
```

Do not run destructive database reset commands against staging or production.

## Environment variables

Use `.env.example` as the template. Never commit real secrets.

Required for core sync:

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
CLICKUP_API_TOKEN=pk_...
CLICKUP_TEAM_ID=3450636
CLICKUP_WEBHOOK_ENDPOINT=https://your-domain.com/webhooks/clickup
CLICKUP_WEBHOOK_SECRET=...
```

Required only for Google Sheets rate sync:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_RATES_SHEET_ID=...
GOOGLE_RATES_SHEET_NAME=rates
GOOGLE_ASSIGNEE_SHEET_NAME=assignee
```

## ClickUp permissions and API constraints

Use a dedicated ClickUp Workspace Owner/Admin service account token for production.

The service account token is needed because this backend must fetch and sometimes create/delete time entries for assignees. A normal member token is not enough for assignee-wide tracked-time sync.

Important ClickUp behavior to preserve:

- Webhook endpoint: `POST /webhooks/clickup`.
- Expected webhook events:
  - `taskCreated`
  - `taskUpdated`
  - `taskDeleted`
  - `taskTimeTrackedUpdated`
- Fetch task details with `GET /task/{task_id}?include_subtasks=true`.
- Backfill tasks with `GET /team/{team_id}/task` using:
  - `space_ids[]`
  - `date_updated_gt`
  - `include_closed=true`
  - `subtasks=true`
  - `page` starting at `0`
  - `limit=100`
- Time-entry sync should pass explicit `start_date` and `end_date` windows for backfills/reconciliation, not rely on ClickUp defaults.
- When creating a time entry for another user, use the API field `assignee`, not the old n8n-style `uid` field.
- Preserve webhook dedupe; duplicate events must not create duplicate writes or duplicate time entries.
- Verify webhook signatures before production release. Store the secret returned by ClickUp webhook creation in `CLICKUP_WEBHOOK_SECRET`.

## Default workspace mapping

These values came from the source workflows and are currently encoded in `src/config/clickup-spaces.config.ts`.

| Space | ID | Lookback |
|---|---:|---:|
| Digital Marketing | `3577824` | 90 days |
| R&D Apps | `3589129` | 20 days |
| Projects | `3525433` | 35 days |

Team ID: `3450636`.

## Main code areas

| Area | Files |
|---|---|
| App bootstrap | `src/main.ts`, `src/app.module.ts` |
| Config/env validation | `src/config/*` |
| ClickUp API client and normalization | `src/clickup/*` |
| Task persistence | `src/tasks/*` |
| Time entries and cost calculation | `src/time-entries/*` |
| Webhook ingestion/dedupe | `src/webhooks/*` |
| Scheduled/backfill sync | `src/sync/*` |
| Assignee rates | `src/rates/*` |
| BullMQ workers | `src/workers/*` |
| Database schema | `prisma/schema.prisma` |
| SQL migration | `prisma/migrations/0001_initial/migration.sql` |

## Data model rules

### Tasks

`clickup_tasks` is the reporting table. Preserve these rules:

- `task_id` is the conflict key.
- Parent tasks have `parent_task_id = null`.
- Subtasks store their ClickUp parent in `parent_task_id`.
- Missing parents should be fetched and inserted before subtasks when possible.
- Task deletes should be soft deletes unless the product owner explicitly asks for hard deletes.
- `sync_count`, `synced_at`, and job logs are operational signals; keep them accurate.

### Custom fields

Task normalization must defensively extract:

- `executive_name`
- `department`
- `client`
- `cost`
- `estimation`
- `sprint_name`
- `sprint_points`

`sprint_points` can appear at root level as `points` or `story_points`, or inside custom fields. Check root-level fields first, then custom fields as fallback.

For the `client` dropdown field, resolve the selected option name from `type_config.options` using `orderindex`.

### Time entries

`clickup_time_entries` stores normalized ClickUp tracked time.

Rules:

- Keep `time_entry_id` as the conflict key.
- Convert ClickUp millisecond durations into decimal hours.
- Store original logger fields separately from mapped assignee fields when adding multi-assignee behavior.
- Cost calculation must pick the effective assignee rate for the entry date.
- Missing rates should be visible in logs/job results; do not silently calculate cost as valid when no rate exists.

### Assignee rates

Rates come from the Google Sheet named `rates`.

Required columns:

```text
assignee_id, assignee_name, assignee_email, currency, hourly_rate_cents, valid_from, valid_to
```

Rules:

- `hourly_rate_cents` must be an integer.
- `valid_from` is required.
- Empty `valid_to` means open-ended.
- Use effective dating to calculate time-entry cost.

## Worker and queue rules

Webhook controllers should respond quickly and queue work. Do not perform heavy ClickUp fetches or database backfills inside the HTTP request path.

Expected queues:

- `clickup-webhooks`
- `clickup-tasks`
- `clickup-time-entries`
- `clickup-backfills`
- `assignee-rates`
- `maintenance`

When adding workers:

- Make jobs idempotent.
- Set useful attempts/backoff.
- Log enough context for failed jobs.
- Send unrecoverable payloads to dead-letter storage.
- Avoid infinite retry loops on invalid payloads.

## Coding standards

- Use NestJS dependency injection; avoid newing services manually.
- Keep API calls in `src/clickup/clickup.client.ts` or purpose-specific ClickUp service wrappers.
- Keep database writes in repositories.
- Keep normalization pure and easy to test.
- Add tests for every new payload parser or custom-field extractor branch.
- Prefer explicit DTO/types over `any`; use `unknown` plus guards for untrusted payloads.
- Never log API tokens, Google private keys, webhook secrets, raw auth headers, or full credentials.
- Preserve Prettier formatting.

## Before changing dependencies

This starter intentionally pins package versions. Before changing versions:

1. Check current official package compatibility.
2. Update `package.json` and lockfile together if a lockfile is added.
3. Run:

```bash
npm install
npm run lint
npm run test
npm run build
```

## Before changing Prisma schema

1. Update `prisma/schema.prisma`.
2. Create a migration with Prisma.
3. Review generated SQL before committing.
4. Run:

```bash
npm run prisma:generate
npm run prisma:deploy
npm run test
npm run build
```

Do not manually edit an existing applied migration unless this is still local-only and explicitly intended.

## Security checklist

Before production deployment, make sure these are done:

- ClickUp API token stored only in secret storage.
- Google service account key stored only in secret storage.
- Webhook signature verification enabled.
- HTTPS enabled for the webhook endpoint.
- PostgreSQL app user has least-privilege permissions.
- Grafana uses read-only database credentials.
- Queue dashboard/admin endpoints, if added, are protected.
- Rate limiting and request size limits are configured for public endpoints.

## Common implementation tasks

### Add a manual task sync endpoint

Create a controller endpoint that enqueues a task-sync job. Do not fetch ClickUp directly from the controller.

Suggested payload:

```json
{ "taskId": "86abc123" }
```

### Add a manual space backfill endpoint

Create a controller endpoint that enqueues a backfill job.

Suggested payload:

```json
{ "spaceId": "3577824", "lookbackDays": 90 }
```

Validate that the requested space is allowed unless an admin override is explicitly added.

### Add webhook registration

When implementing webhook registration:

- Use `CLICKUP_WEBHOOK_ENDPOINT`.
- Subscribe only to configured `CLICKUP_WEBHOOK_EVENTS`.
- Store the webhook ID and secret returned by ClickUp.
- Avoid creating duplicate active webhooks for the same endpoint/events.

### Complete multi-assignee tracked-time replacement

The source n8n workflow maps tags such as `ahmad`, `chisty`, `fahim`, `rashedul`, `rejaur`, `sayem`, and `expense` into assignee identities.

When implementing this in code:

- Move the mapping into config or a database table, not hardcoded worker branches.
- Fetch the original time entry.
- Create replacement time entries with `assignee` for mapped users.
- Delete the original only after all replacement entries are successfully created.
- Store an audit trail to prevent double replacement.
- Make the job idempotent.

## Known starter limitations

This is an initial starter, not a finished production system. Expected next work:

- Add explicit webhook signature verification middleware.
- Add manual admin endpoints for backfill, task sync, rate sync, retry, and webhook registration.
- Expand tests for real ClickUp payload variants.
- Add structured logging.
- Add production observability and alerting.
- Add an audit table for tracked-time replacement/splitting.

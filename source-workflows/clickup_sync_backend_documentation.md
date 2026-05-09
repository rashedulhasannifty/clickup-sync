# ClickUp Sync Backend Documentation

## 1. Project Overview

We currently use n8n workflows to sync ClickUp data into PostgreSQL for reporting and visualization in Grafana. The existing workflows provide a useful blueprint, but the new system should be built from scratch as a reliable backend application.

The new project will replace n8n with a code-based backend that handles ClickUp webhooks, scheduled backfills, task synchronization, time-entry synchronization, assignee-rate synchronization, job retries, failed-job tracking, and operational monitoring.

Grafana will remain the visualization layer. PostgreSQL will remain the reporting database.

## 2. Why We Are Moving Away From n8n

The current n8n setup works but has reliability and maintainability problems.

### Current Problems

1. Webhook workflows can become suspended or inactive.
2. Some ClickUp fields are empty, null, or inconsistent.
3. Failed jobs are hard to track, retry, or investigate.
4. Logic is duplicated across multiple n8n workflows.
5. Error handling is limited.
6. Backfills and live syncs are split across different workflows.
7. There is no central operational dashboard for sync health.
8. There is no proper dead-letter system for permanently failed jobs.
9. Hardcoded team IDs, space IDs, and assignee mappings are spread across workflows.
10. Debugging requires opening workflow executions instead of reviewing structured logs.

## 3. New System Goals

The new backend should be reliable, observable, maintainable, and easy to extend.

### Primary Goals

- Receive ClickUp webhook events reliably.
- Store raw webhook payloads before processing.
- Process sync work asynchronously through job queues.
- Retry failed jobs automatically.
- Store failed jobs for review and manual retry.
- Normalize ClickUp data safely, including null and missing fields.
- Sync tasks, subtasks, time entries, and assignee rates into PostgreSQL.
- Keep Grafana as the dashboard and visualization layer.
- Provide scheduled reconciliation/backfill jobs so missed webhooks can be recovered.
- Centralize configuration for ClickUp spaces, assignees, rates, and sync behavior.

### Non-Goals For Initial Version

- Replacing Grafana.
- Building a full customer-facing frontend.
- Rebuilding all dashboards inside Next.js.
- Depending on n8n for any core sync logic.

## 4. Recommended Tech Stack

### Backend

**NestJS**

Why:

- Strong structure for a growing backend.
- Good TypeScript support.
- Suitable for APIs, services, modules, and background processing.
- Easier to organize code than a plain Express app.

### Background Jobs

**BullMQ**

Why:

- Handles queues, retries, delayed jobs, failed jobs, and background processing.
- Allows webhook requests to return quickly while workers process heavy sync logic separately.
- Better fit for ClickUp sync, backfills, and retryable jobs than n8n workflow execution.

### Queue Storage

**Redis**

Why:

- BullMQ requires Redis.
- Stores job state, retry state, delayed jobs, and worker coordination.

### Database

**PostgreSQL / Neon**

Why:

- Already used by the current system.
- Grafana can query PostgreSQL directly.
- Good support for JSONB, indexing, reporting queries, and relational data.

### ORM / Query Layer

**Prisma or Drizzle**

Recommended: **Prisma** for initial development.

Why:

- Schema management.
- Type-safe database access.
- Easier migrations.
- Good developer experience.

### Visualization

**Grafana**

Why:

- Already used.
- Strong dashboarding and alerting.
- Can connect directly to PostgreSQL.
- No need to rebuild analytics UI.

### Optional Admin Frontend

**Next.js**

Why:

- Useful later for internal operations.
- Can provide manual sync, failed-job retry, webhook logs, and rate management screens.
- Should not be responsible for core sync processing.

## 5. Target Architecture

```text
ClickUp Webhooks
      ↓
NestJS Webhook API
      ↓
PostgreSQL: raw webhook event saved
      ↓
BullMQ Queue
      ↓
NestJS Workers
      ↓
PostgreSQL Reporting Tables
      ↓
Grafana Dashboards
```

For scheduled jobs:

```text
NestJS Scheduler / BullMQ Repeatable Jobs
      ↓
Backfill and Reconciliation Workers
      ↓
ClickUp API
      ↓
Normalize Data
      ↓
PostgreSQL
      ↓
Grafana
```

## 6. Main Components We Need

### 6.1 Webhook API

#### What It Does

Receives ClickUp webhook events.

#### Why We Need It

ClickUp sends real-time events when tasks are created, updated, deleted, or when time tracking changes.

The webhook endpoint should not do heavy processing. It should only receive, validate, save, enqueue, and respond.

#### Responsibilities

- Receive webhook payload.
- Extract event type.
- Extract task ID if available.
- Generate dedupe fingerprint.
- Save raw payload to database.
- Enqueue processing job.
- Return `200 OK` quickly.

#### Important Rule

Do not fetch ClickUp task details inside the webhook request. That should happen inside a background worker.

### 6.2 Webhook Event Store

#### What It Does

Stores every raw webhook payload before processing.

#### Why We Need It

If processing fails, we still have the original event. This allows replay, debugging, and audit history.

#### Table

```sql
CREATE TABLE clickup_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT UNIQUE,
  event_type TEXT,
  task_id TEXT,
  raw_payload JSONB NOT NULL,
  status TEXT DEFAULT 'received',
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT
);
```

### 6.3 Dedupe System

#### What It Does

Prevents the same ClickUp webhook event from being processed multiple times.

#### Why We Need It

Webhook systems can send duplicate events. Retrying duplicate events can cause unnecessary processing, duplicate logs, and incorrect sync behavior.

#### Strategy

Generate a fingerprint using:

1. ClickUp history item ID, if available.
2. Event ID, if available.
3. Task ID + event type + timestamp fallback.
4. Hash of raw payload as final fallback.

### 6.4 Queue System

#### What It Does

Moves sync work into asynchronous jobs.

#### Why We Need It

ClickUp API calls, database upserts, time-entry calculations, and backfills can fail or take time. Queues allow retries, visibility, and concurrency control.

#### Queues

Recommended queues:

```text
clickup-webhooks
clickup-tasks
clickup-time-entries
clickup-backfills
assignee-rates
maintenance
```

#### Job Types

```text
process-clickup-event
sync-clickup-task
delete-clickup-task
sync-task-time-entries
sync-assignee-rates
backfill-clickup-space
reconcile-recent-clickup-updates
refresh-clickup-webhooks
```

### 6.5 Worker Service

#### What It Does

Processes jobs from BullMQ.

#### Why We Need It

Workers allow the system to retry failed operations, scale processing separately from the API, and isolate long-running tasks.

#### Worker Responsibilities

- Process webhook events.
- Fetch task details from ClickUp.
- Normalize task data.
- Upsert tasks and subtasks.
- Fetch time entries.
- Calculate cost.
- Upsert time entries.
- Run scheduled backfills.
- Log success and failure.

### 6.6 ClickUp API Client

#### What It Does

Central wrapper around all ClickUp API calls.

#### Why We Need It

The existing n8n flows call ClickUp directly in many places. In code, all ClickUp access should go through one client so we can handle errors, rate limits, retries, and logging consistently.

#### Required Methods

```ts
getTask(taskId: string): Promise<ClickUpTask>
getTasksBySpace(spaceId: string, options): Promise<ClickUpTaskPage>
getTimeEntries(taskId: string, assigneeId?: string): Promise<ClickUpTimeEntry[]>
getTeamMembers(teamId: string): Promise<ClickUpMember[]>
getWebhooks(teamId: string): Promise<ClickUpWebhook[]>
createWebhook(teamId: string, endpoint: string, events: string[]): Promise<void>
deleteWebhook(webhookId: string): Promise<void>
```

### 6.7 Task Normalizer

#### What It Does

Converts raw ClickUp task data into our database format.

#### Why We Need It

ClickUp data can be inconsistent. Fields can be missing, null, empty strings, or stored in different locations.

The normalizer protects the database from bad input and makes behavior predictable.

#### Normalized Fields

```text
task_id
parent_task_id
task_name
description
url
status
status_type
status_color
priority
order_index
archived
created_date
updated_date
closed_date
due_date
start_date
time_estimate
time_spent
space_id
space_name
folder_id
folder_name
list_id
list_name
assignees_names
assignees_emails
watchers_names
watchers_emails
creator_id
creator_name
executive_name
department
client
cost
estimation
sprint_name
sprint_points
tags
custom_tags
```

#### Null Handling Rules

```text
Required ID missing → fail job
Task name missing → use "Untitled"
Optional text missing → null or empty string depending on schema
Invalid date → null
Invalid number → 0
Missing custom field → null or 0
Unknown dropdown value → null
```

### 6.8 Custom Field Extractor

#### What It Does

Extracts important custom fields from ClickUp tasks.

#### Why We Need It

The existing workflows rely heavily on custom fields like client, department, cost, estimation, sprint, and sprint points.

#### Fields To Extract

```text
executive_name
department
client
cost
estimation
sprint_name
sprint_points
```

#### Notes

- `client` appears to be a dropdown field and must be resolved from `type_config.options`.
- `sprint_points` may come from `points`, `story_points`, or a custom field.
- Custom field names should be matched safely and case-insensitively.

### 6.9 Task Repository

#### What It Does

Handles database writes for `clickup_tasks`.

#### Why We Need It

SQL upsert logic should be centralized instead of duplicated across workflows.

#### Responsibilities

- Upsert task.
- Upsert subtask.
- Soft-delete task.
- Find missing parent tasks.
- Update sync metadata.

#### Recommended Delete Strategy

Use soft delete instead of hard delete.

```sql
ALTER TABLE clickup_tasks
ADD COLUMN is_deleted BOOLEAN DEFAULT false,
ADD COLUMN deleted_at TIMESTAMPTZ;
```

Why:

- Safer for reports.
- Allows recovery.
- Preserves historical context.

### 6.10 Time Entry Sync

#### What It Does

Fetches and syncs ClickUp time entries.

#### Why We Need It

Time entries are needed for labor-cost reporting and productivity reporting in Grafana.

#### Responsibilities

- Fetch time entries by task ID.
- Normalize each entry.
- Extract logger user.
- Extract start/end/duration.
- Calculate duration hours.
- Upsert into `clickup_time_entries`.
- Attach applicable assignee rate.
- Calculate cost.

### 6.11 Cost Calculation

#### What It Does

Calculates cost for time entries using effective-dated assignee rates.

#### Why We Need It

Grafana reports need cost data, not just hours.

#### Formula

```text
cost_cents = hourly_rate_cents × duration_hours
```

#### Rate Lookup Logic

Find the rate where:

```text
assignee_id matches
entry start date falls within valid_from and valid_to range
```

If no rate is found:

```text
rate_id = null
cost_cents = 0
status = NO_RATE_FOUND
```

This should be visible in Grafana and job logs.

### 6.12 Assignee Rate Sync

#### What It Does

Syncs hourly rates from Google Sheets into PostgreSQL.

#### Why We Need It

The current workflow uses Google Sheets as the rate-management interface. We can keep that initially.

#### Responsibilities

- Read rate rows from Google Sheets.
- Validate required fields.
- Validate `valid_from` and `valid_to`.
- Validate `hourly_rate_cents`.
- Upsert into `assignee_rates`.
- Log invalid rows.

#### Future Option

Later, the optional Next.js admin panel can replace Google Sheets for rate management.

### 6.13 Scheduled Backfill / Reconciliation

#### What It Does

Periodically fetches recently updated ClickUp tasks to recover missed webhooks.

#### Why We Need It

Webhooks are not enough. They can fail, be delayed, or become inactive. Scheduled reconciliation makes the system self-healing.

#### Recommended Jobs

```text
Every 15 minutes:
  Fetch tasks updated in the last 2 hours

Every night:
  Fetch tasks updated in the last 7 days

Weekly:
  Run deeper backfill by space
```

#### Space Configuration

```ts
const CLICKUP_SPACES = [
  {
    id: '3577824',
    name: 'Digital Marketing',
    backfillLookbackDays: 90,
  },
  {
    id: '3589129',
    name: 'R&D Apps',
    backfillLookbackDays: 20,
  },
  {
    id: '3525433',
    name: 'Projects',
    backfillLookbackDays: 35,
  },
];
```

### 6.14 Sync Checkpoints

#### What It Does

Tracks the last successful sync per source and scope.

#### Why We Need It

Backfills need to know where to resume from. Grafana also needs visibility into sync freshness.

#### Table

```sql
CREATE TABLE sync_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  last_successful_sync_at TIMESTAMPTZ,
  last_attempted_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, scope_type, scope_id)
);
```

### 6.15 Failed Job System

#### What It Does

Tracks jobs that failed and allows later review or retry.

#### Why We Need It

This is one of the major missing features in the current n8n setup.

#### Required Features

- Automatic retry.
- Exponential backoff.
- Failed-job log.
- Dead-letter table.
- Manual retry endpoint.
- Grafana panel for failed jobs.

#### Job Log Table

```sql
CREATE TABLE sync_job_logs (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT,
  queue_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  attempts_made INT DEFAULT 0,
  error_message TEXT,
  error_stack TEXT,
  payload JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Dead Letter Table

```sql
CREATE TABLE dead_letter_jobs (
  id BIGSERIAL PRIMARY KEY,
  queue_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  payload JSONB NOT NULL,
  error_message TEXT,
  error_stack TEXT,
  attempts_made INT,
  failed_at TIMESTAMPTZ DEFAULT NOW(),
  retried_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
```

### 6.16 Logging

#### What It Does

Stores structured logs for debugging and reporting.

#### Why We Need It

n8n execution logs are hard to use for long-term observability. Structured logs make failures searchable and measurable.

#### Log Events

```text
webhook_received
webhook_duplicate
job_queued
job_started
job_completed
job_failed
clickup_api_error
task_normalized
task_upserted
time_entry_upserted
rate_missing
backfill_started
backfill_completed
```

### 6.17 Grafana Monitoring

#### What It Does

Visualizes both business data and system health.

#### Why We Need It

The project already uses Grafana. The new backend should expose better operational data through PostgreSQL.

#### Business Dashboards

- Task counts by space, folder, list, status.
- Completed tasks by period.
- Time spent by user.
- Cost by client.
- Cost by department.
- Cost by task/project.
- Sprint points by space/list/status.
- Billable vs non-billable hours.

#### Operational Dashboards

- Last webhook received time.
- Webhook events by event type.
- Failed jobs by queue.
- Failed jobs by error reason.
- Jobs retried per hour.
- Backfill duration by space.
- Last successful sync by space.
- ClickUp API errors by status code.
- Time entries with missing rates.
- Tasks with invalid or missing fields.

### 6.18 Optional Next.js Admin Panel

#### What It Does

Provides an internal UI for operating the sync system.

#### Why We Need It Later

Grafana is good for visualization but not ideal for actions like retrying jobs or running a manual backfill.

#### Suggested Pages

```text
Dashboard
Webhook Events
Failed Jobs
Dead Letter Jobs
Manual Sync
Backfill by Space
Assignee Rates
Sync Checkpoints
ClickUp Webhook Health
```

#### Suggested Actions

```text
Retry failed job
Replay webhook event
Run backfill now
Sync one task by task ID
Mark dead-letter job resolved
Refresh ClickUp webhook
```

## 7. Suggested Backend Folder Structure

```text
src/
  app.module.ts

  config/
    clickup.config.ts
    database.config.ts
    queue.config.ts

  database/
    prisma.service.ts
    migrations/

  clickup/
    clickup.module.ts
    clickup.client.ts
    clickup.types.ts
    clickup-normalizer.ts
    custom-field-extractor.ts

  webhooks/
    webhooks.module.ts
    clickup-webhook.controller.ts
    webhook-parser.service.ts
    webhook-events.repository.ts

  queues/
    queues.module.ts
    queue.constants.ts
    queue.service.ts

  workers/
    clickup-event.processor.ts
    task-sync.processor.ts
    time-entry-sync.processor.ts
    backfill.processor.ts
    rates-sync.processor.ts

  tasks/
    tasks.module.ts
    tasks.service.ts
    tasks.repository.ts

  time-entries/
    time-entries.module.ts
    time-entries.service.ts
    time-entries.repository.ts
    cost-calculator.service.ts

  rates/
    rates.module.ts
    rates.service.ts
    rates.repository.ts
    google-sheets-rates.service.ts

  sync/
    sync.module.ts
    sync-checkpoints.repository.ts
    sync-runs.repository.ts
    backfill.service.ts
    reconciliation.service.ts

  jobs/
    job-logs.repository.ts
    dead-letter.repository.ts
    job-retry.service.ts

  common/
    utils/
      safe-value.ts
      date-utils.ts
      hash.ts
    errors/
      app-error.ts
      clickup-error.ts
```

## 8. Environment Variables

```env
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://...
REDIS_URL=redis://...

CLICKUP_API_TOKEN=...
CLICKUP_TEAM_ID=3450636
CLICKUP_WEBHOOK_SECRET=optional
CLICKUP_WEBHOOK_ENDPOINT=https://api.example.com/webhooks/clickup

GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
GOOGLE_RATES_SHEET_ID=...

JOB_ATTEMPTS=5
JOB_BACKOFF_DELAY_MS=30000
```

## 9. Main Data Flow

### 9.1 Webhook Task Update

```text
ClickUp sends taskUpdated
  ↓
NestJS saves raw webhook event
  ↓
BullMQ job created
  ↓
Worker fetches full ClickUp task
  ↓
Task normalizer handles null fields
  ↓
Task repository upserts into clickup_tasks
  ↓
Job log saved
  ↓
Grafana sees updated data
```

### 9.2 Time Entry Update

```text
ClickUp sends taskTimeTrackedUpdated
  ↓
Webhook saved
  ↓
Job queued
  ↓
Worker fetches task time entries
  ↓
Entries normalized
  ↓
Rate is selected from assignee_rates
  ↓
Cost calculated
  ↓
clickup_time_entries upserted
  ↓
Missing rates logged if needed
```

### 9.3 Scheduled Backfill

```text
Scheduler starts backfill
  ↓
Fetch configured ClickUp space
  ↓
Paginate tasks updated after checkpoint/lookback
  ↓
Normalize parent tasks and subtasks
  ↓
Upsert all records
  ↓
Update sync checkpoint
  ↓
Log backfill result
```

## 10. Reliability Rules

1. Always save raw webhook payload before processing.
2. Always process heavy work in BullMQ workers.
3. Always use retries with exponential backoff.
4. Never let null ClickUp fields crash normal sync unless required fields are missing.
5. Always log failed jobs with payload and error message.
6. Always keep dead-letter jobs after retry limit is reached.
7. Always run scheduled reconciliation to recover missed webhook events.
8. Always update sync checkpoints after successful backfill.
9. Always expose sync health data to Grafana.
10. Always centralize ClickUp API calls in one client.

## 11. Implementation Phases

### Phase 1: Foundation

Build:

- NestJS project.
- PostgreSQL connection.
- Redis connection.
- BullMQ setup.
- Prisma schema.
- Basic health endpoint.

Deliverable:

- Backend service running with DB and Redis.

### Phase 2: Webhook Ingestion

Build:

- `POST /webhooks/clickup`.
- Webhook parser.
- Webhook dedupe.
- Raw event storage.
- Queue job creation.

Deliverable:

- ClickUp webhooks are received, saved, deduped, and queued.

### Phase 3: Task Sync

Build:

- ClickUp API client.
- Task fetch.
- Task normalizer.
- Custom field extractor.
- Task upsert repository.
- Task delete or soft-delete handling.

Deliverable:

- `taskCreated`, `taskUpdated`, and `taskDeleted` are handled.

### Phase 4: Time Entry Sync

Build:

- Time-entry fetch.
- Time-entry normalizer.
- Cost calculator.
- Time-entry upsert.
- Missing-rate logging.

Deliverable:

- `taskTimeTrackedUpdated` is handled with cost calculation.

### Phase 5: Backfill and Reconciliation

Build:

- Space config.
- Paginated ClickUp task fetch.
- Parent/subtask handling.
- Missing parent handling.
- Sync checkpoints.
- Scheduled jobs.

Deliverable:

- System can recover from missed webhooks.

### Phase 6: Assignee Rates

Build:

- Google Sheets reader.
- Rate validation.
- Rate upsert.
- Invalid row logs.

Deliverable:

- `assignee_rates` is synced automatically.

### Phase 7: Observability

Build:

- `sync_job_logs`.
- `dead_letter_jobs`.
- API request logs.
- Grafana operational dashboard queries.

Deliverable:

- Failed jobs and sync health are visible.

### Phase 8: Optional Admin Panel

Build:

- Next.js internal UI.
- Failed jobs screen.
- Retry job action.
- Replay webhook action.
- Manual backfill action.
- Sync checkpoint viewer.

Deliverable:

- Non-developers can operate the sync system.

## 12. MVP Scope

The first version should include only what is necessary to replace n8n safely.

### MVP Must Have

- NestJS API.
- BullMQ workers.
- Redis.
- PostgreSQL.
- ClickUp webhook ingestion.
- Raw webhook event table.
- Dedupe.
- Task sync.
- Time-entry sync.
- Cost calculation.
- Failed-job logs.
- Dead-letter jobs.
- Scheduled reconciliation.
- Grafana operational queries.

### MVP Can Skip

- Next.js admin panel.
- Advanced permissions.
- Complex UI.
- Replacing Google Sheets rate management.
- Rebuilding Grafana dashboards.

## 13. Summary

The new project should be a backend-first ClickUp sync platform.

We are not simply replacing n8n with code. We are building a more reliable sync system that can handle webhooks, backfills, retries, null fields, failed jobs, and operational monitoring.

Recommended stack:

```text
NestJS backend
BullMQ workers
Redis queue storage
PostgreSQL reporting database
Grafana visualization
Optional Next.js admin panel later
```

The key principle is:

```text
Receive everything.
Save raw data.
Process asynchronously.
Normalize safely.
Retry automatically.
Fail visibly.
Recover through backfills.
Visualize through Grafana.
```

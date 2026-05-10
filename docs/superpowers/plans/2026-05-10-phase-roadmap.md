# ClickUp Sync — Post-Phase-1 Roadmap

**Date:** 2026-05-10  
**Status:** Phase 1 complete and validated end-to-end.

---

## Architecture Decision

**Replacing both Google Sheets and Grafana with a React app.**

| Was | Now |
|---|---|
| Google Sheets → rate management | React UI + NestJS CRUD API |
| Grafana → dashboards & monitoring | React dashboard pages + NestJS reporting API |
| n8n | Already replaced by this NestJS service |

**Repo structure:** Same repo, npm workspaces monorepo. NestJS stays exactly where it is.

```
clickup-sync-nestjs/          ← root (npm workspaces)
  src/                        ← NestJS backend (current, unchanged)
  prisma/
  apps/
    web/                      ← React app (Vite + React + TypeScript)
      src/
        pages/
        components/
        api/
      package.json
      vite.config.ts
  package.json                ← add workspaces: ["apps/*"]
```

**React stack:** Vite + React + TypeScript, TanStack Query, Recharts, Tailwind CSS + shadcn/ui.

---

## What Phase 1 Delivered (Complete)

| Area | Status |
|---|---|
| HMAC-SHA256 webhook signature guard | ✅ |
| Webhook dedup (`clickup_webhook_seen`) | ✅ |
| BullMQ 6 queues (webhooks, tasks, time-entries, backfills, rates, maintenance) | ✅ |
| Task normalizer + custom field extractor | ✅ |
| Task repository upsert + soft-delete | ✅ |
| Time-entry normalizer + cost calculator | ✅ |
| Backfill service (paginated, per-space, checkpoints) | ✅ |
| Scheduled reconciliation every 15 min | ✅ |
| Google Sheets rate sync (to be removed in Phase 3) | ✅ → removing |
| Dead-letter repository (create, findPending, markRetried) | ✅ |
| Job logs repository | ✅ |
| Admin controller (task sync, backfill, rate sync, webhook register, dead-letter retry) | ✅ |
| Admin API key guard (timing-safe) | ✅ |
| Swagger at `/docs` | ✅ |

---

## Phases Overview

| Phase | Goal | Priority |
|---|---|---|
| **Phase 2** | Multi-assignee time-entry replacement | High |
| **Phase 3** | Remove Google Sheets, add rate management API | High |
| **Phase 4** | Reporting & operational API for the React app | High |
| **Phase 5** | React app (dashboard, rates, operations, admin) | High |
| **Phase 6** | Production cutover & hardening | High |

---

## Phase 2: Multi-Assignee Time-Entry Replacement

**Goal:** Port the remaining core n8n behavior — re-attribute shared-account time entries to the real assignees using task tags.

### Background

The n8n workflow identifies time entries logged under a shared "agency" ClickUp account and replaces them with entries attributed to the real assignee. Task tags like `ahmad`, `chisty`, `fahim`, `rashedul`, `rejaur`, `sayem`, `expense` map to real ClickUp user IDs.

The replacement flow:
1. Detect entry logged under the agency user.
2. Look up the task's tags in `tag_assignee_map`.
3. Create a new entry with `assignee = <real_user_id>`.
4. Delete the original **only after** the replacement is confirmed saved.
5. Write an audit row to `time_entry_replacements` — this makes the job idempotent.

### New Prisma Models

```prisma
model TagAssigneeMap {
  id              BigInt   @id @default(autoincrement())
  tagName         String   @unique @map("tag_name")
  clickupUserId   String   @map("clickup_user_id")
  clickupUserName String?  @map("clickup_user_name")
  clickupEmail    String?  @map("clickup_email")
  active          Boolean  @default(true)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at")

  @@map("tag_assignee_map")
}

model TimeEntryReplacement {
  id                 BigInt   @id @default(autoincrement())
  originalEntryId    String   @unique @map("original_entry_id")
  replacementEntryId String?  @map("replacement_entry_id")
  taskId             String?  @map("task_id")
  originalUserId     String?  @map("original_user_id")
  replacedUserId     String?  @map("replaced_user_id")
  tagName            String?  @map("tag_name")
  status             String   @default("replaced")
  errorMessage       String?  @map("error_message")
  replacedAt         DateTime @default(now()) @map("replaced_at")

  @@index([taskId])
  @@index([originalUserId])
  @@map("time_entry_replacements")
}
```

### New Files

| File | Purpose |
|---|---|
| `prisma/migrations/0002_tag_assignee_replacement/migration.sql` | New tables |
| `src/time-entries/assignee-replacement.service.ts` | Core replacement logic |
| `src/time-entries/tag-assignee-map.repository.ts` | DB access for tag→assignee config |
| `src/time-entries/time-entry-replacements.repository.ts` | Audit trail reads/writes |
| `src/workers/time-entry-replacement.processor.ts` | BullMQ processor for `replace-time-entry-assignees` job |
| `test/assignee-replacement.service.spec.ts` | Unit tests |
| `test/tag-assignee-map.repository.spec.ts` | Unit tests |

### New Environment Variable

```env
# ClickUp user ID of the shared agency account whose entries get replaced
CLICKUP_AGENCY_USER_ID=12345678
```

### Replacement Rules

- **Never delete the original before the replacement is confirmed saved.** Write `replacementEntryId` first, then delete.
- **Idempotent:** check `time_entry_replacements` before doing any work. If `originalEntryId` row exists, skip.
- **Cost recalculation:** after replacement, run cost calculation for the new entry using the replaced user's rate.
- **No mapping found:** log a warning and leave the entry as-is. Do not fail the job.

### Open Questions to Answer Before Starting

1. What is `CLICKUP_AGENCY_USER_ID`? (the shared account's numeric ClickUp user ID)
2. For each tag (`ahmad`, `chisty`, `fahim`, `rashedul`, `rejaur`, `sayem`, `expense`) — what are the real ClickUp user IDs? Run `GET /team/{teamId}/member` to get them.
3. Does `expense` map to a real person or is it a category label?
4. Retroactive replacement: do you want to re-process existing entries in `clickup_time_entries`, or only new ones going forward?

---

## Phase 3: Remove Google Sheets, Add Rate Management API

**Goal:** Delete the Google Sheets dependency entirely. Replace it with NestJS CRUD endpoints that the React app will call for rate management.

### What Gets Removed

| File | Action |
|---|---|
| `src/rates/google-sheets-rates.service.ts` | Delete |
| `src/rates/rates.service.ts` | Rewrite — remove Google Sheets import, keep rate lookup logic |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` env var | Remove from `.env.example` |
| `GOOGLE_PRIVATE_KEY` env var | Remove from `.env.example` |
| `GOOGLE_RATES_SHEET_ID` env var | Remove from `.env.example` |
| `GOOGLE_RATES_SHEET_NAME` env var | Remove from `.env.example` |
| `GOOGLE_ASSIGNEE_SHEET_NAME` env var | Remove from `.env.example` |
| `googleapis` npm package | Remove from `package.json` |
| `assignee-rates` BullMQ queue job that pulls from Sheets | Remove trigger |

### New Admin API Endpoints (Rates CRUD)

```
GET    /admin/rates                    — list all assignee rates (paginated)
POST   /admin/rates                    — create a rate
PATCH  /admin/rates/:id                — update a rate (valid_from, valid_to, hourly_rate_cents)
DELETE /admin/rates/:id                — delete a rate
```

### New Admin API Endpoints (Tag-Assignee Map CRUD — used by Phase 2)

```
GET    /admin/tag-assignee-map         — list all tag→assignee mappings
POST   /admin/tag-assignee-map         — add a mapping
PATCH  /admin/tag-assignee-map/:id     — update a mapping
DELETE /admin/tag-assignee-map/:id     — remove a mapping
```

### New DTOs

```typescript
// src/admin/dto/create-rate.dto.ts
export class CreateRateDto {
  assigneeId: string;
  assigneeName?: string;
  assigneeEmail?: string;
  currency: string;          // default 'AUD'
  hourlyRateCents: number;   // integer, e.g. 15000 = $150.00/hr
  validFrom: string;         // ISO date 'YYYY-MM-DD'
  validTo?: string;          // ISO date or omit for open-ended
}
```

### Modified Files

| File | Change |
|---|---|
| `src/rates/rates.module.ts` | Remove GoogleSheetsRatesService |
| `src/rates/rates.repository.ts` | Add `create`, `update`, `remove`, `findAll` methods |
| `src/admin/admin.controller.ts` | Add rate CRUD + tag-assignee map endpoints |
| `src/config/env.validation.ts` | Remove Google Sheets env vars |
| `.env.example` | Remove Google Sheets vars, document removal |
| `src/app.module.ts` | No change (RatesModule stays, just removes Sheets service) |

---

## Phase 4: Reporting & Operational API

**Goal:** Build the NestJS API endpoints that power the React app's dashboards. These replace all Grafana SQL queries.

### New Module

Create `src/reports/` module with a `ReportsController` and `ReportsService`.

### Business Report Endpoints

```
GET /reports/tasks/summary
  → { bySpace: [{spaceId, spaceName, count}], byStatus: [{status, count}], total: number }

GET /reports/tasks/by-space-status
  → [{spaceName, status, count}]  — matrix for stacked bar chart

GET /reports/time-entries/by-user?from=&to=
  → [{userId, userName, userEmail, totalHours, totalCostAud}]

GET /reports/time-entries/by-client?from=&to=
  → [{client, totalHours, totalCostAud}]

GET /reports/time-entries/by-department?from=&to=
  → [{department, totalHours, totalCostAud}]

GET /reports/time-entries/billable-summary?from=&to=
  → {billableHours, nonBillableHours, billableCostAud, nonBillableCostAud}

GET /reports/sprint-points?spaceId=
  → [{spaceName, status, totalPoints}]
```

### Operational Report Endpoints

```
GET /reports/ops/sync-health
  → [{scopeId, spaceName, lastSuccessfulSyncAt, ageMinutes, status}]

GET /reports/ops/webhook-events?limit=&offset=
  → {items: [{id, eventType, taskId, status, receivedAt, processedAt}], total}

GET /reports/ops/job-logs?queueName=&status=&limit=&offset=
  → {items: [{id, queueName, jobName, status, entityId, errorMessage, finishedAt}], total}

GET /reports/ops/dead-letters?limit=&offset=
  → {items: [{id, queueName, jobName, entityId, errorMessage, failedAt}], total}

GET /reports/ops/stats
  → {failedJobsLast24h, deadLetterPending, webhooksLast24h, missingRateEntries}
  — used by the dashboard overview cards
```

### New Files

| File | Purpose |
|---|---|
| `src/reports/reports.module.ts` | Module definition |
| `src/reports/reports.controller.ts` | All report endpoints (protected by `AdminApiKeyGuard`) |
| `src/reports/reports.service.ts` | Prisma queries for each report |
| `test/reports.service.spec.ts` | Unit tests with mocked Prisma |

### Note on Date Filters

All time-based report endpoints accept `from` and `to` as ISO strings. Defaults: `from = 30 days ago`, `to = now`. The React app date pickers pass these as query params.

---

## Phase 5: React App

**Goal:** Build the full internal React application replacing Grafana dashboards and Google Sheets.

### Monorepo Setup

**Step 1:** Add workspaces to root `package.json`:
```json
{
  "workspaces": ["apps/*"]
}
```

**Step 2:** Scaffold the app:
```bash
cd apps
npm create vite@latest web -- --template react-ts
cd web
npm install
```

**Step 3:** Install dependencies:
```bash
# In apps/web/
npm install @tanstack/react-query axios recharts date-fns
npm install -D tailwindcss @tailwindcss/vite
npx shadcn@latest init
```

**Step 4:** Configure Vite proxy for local development:
```typescript
// apps/web/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
```

### App Structure

```
apps/web/src/
  main.tsx
  App.tsx
  api/
    client.ts              ← axios instance with x-admin-key header
    reports.ts             ← report endpoint calls
    admin.ts               ← admin action calls
    rates.ts               ← rate CRUD calls
    tag-assignee.ts        ← tag-assignee map calls
  pages/
    DashboardPage.tsx      ← overview: stats cards + charts
    TasksPage.tsx          ← task list with filters
    TimeEntriesPage.tsx    ← time entries with cost
    RatesPage.tsx          ← assignee rate management
    TagAssigneePage.tsx    ← tag→assignee mapping management
    OpsPage.tsx            ← sync health, webhook events, job logs
    DeadLetterPage.tsx     ← dead-letter queue with retry
    AdminPage.tsx          ← manual sync, backfill, webhook registration
  components/
    layout/
      Sidebar.tsx
      Header.tsx
    charts/
      TasksBySpaceChart.tsx
      CostByClientChart.tsx
      HoursByUserChart.tsx
      BillableChart.tsx
    tables/
      RatesTable.tsx
      TimeEntriesTable.tsx
      JobLogsTable.tsx
      DeadLetterTable.tsx
    ui/                    ← shadcn/ui generated components
  lib/
    queryClient.ts         ← TanStack Query client
    utils.ts
```

### Page-by-Page Spec

#### Dashboard Page (`/`)

Cards (top row):
- Total tasks (non-deleted)
- Time entries last 30 days (hours + cost AUD)
- Dead-letter backlog count
- Sync health status (all spaces fresh / stale warning)

Charts:
- **Tasks by space + status** — stacked bar chart (Recharts `BarChart`)
- **Hours by user** — horizontal bar chart, last 30 days
- **Cost by client** — pie chart or bar chart, last 30 days
- **Billable vs non-billable** — donut chart

Data source: `GET /reports/ops/stats` + `GET /reports/tasks/by-space-status` + `GET /reports/time-entries/by-user` + `GET /reports/time-entries/by-client` + `GET /reports/time-entries/billable-summary`

#### Tasks Page (`/tasks`)

Filters: space, status, date range (updatedDate), search by name.  
Table columns: Task ID, Name, Space, Status, Assignees, Updated, Sprint Points, Cost.  
Click row → expand to show raw JSON (for debugging).

Data source: query `clickup_tasks` via a new `GET /reports/tasks?spaceId=&status=&limit=&offset=` endpoint.

#### Time Entries Page (`/time-entries`)

Filters: user, date range, billable toggle, status (COST_CALCULATED / NO_RATE_FOUND).  
Table columns: Task Name, User, Start Time, Duration (hrs), Rate, Cost (AUD), Status.  
Color-code `NO_RATE_FOUND` rows in red.

Data source: `GET /reports/time-entries?userId=&from=&to=&status=&limit=&offset=`

#### Rates Page (`/rates`)

Table of `assignee_rates` rows. Columns: Assignee, Email, Currency, Rate ($/hr), Valid From, Valid To, Actions.

Actions:
- **Add rate** — modal form (assignee name/email/id, rate, valid_from, valid_to)
- **Edit** — inline or modal
- **Delete** — confirm dialog

Data source: `GET /admin/rates`, `POST /admin/rates`, `PATCH /admin/rates/:id`, `DELETE /admin/rates/:id`

#### Tag-Assignee Map Page (`/tag-assignee`)

Table of `tag_assignee_map` rows. Columns: Tag Name, ClickUp User ID, Name, Email, Active.

Actions:
- **Add mapping** — form with tagName + clickupUserId
- **Deactivate / Delete** — toggle active or remove

Data source: `GET /admin/tag-assignee-map`, `POST`, `PATCH`, `DELETE`

#### Ops Page (`/ops`)

**Sync Health panel:**  
Table of spaces with last successful sync, age in minutes, status badge (Fresh / Stale / Unknown).

**Webhook Events panel:**  
Recent 50 webhook events. Columns: Event Type, Task ID, Status, Received At, Processed At.

**Job Logs panel:**  
Filterable by queue and status. Columns: Queue, Job, Status, Entity ID, Error, Finished At.

Data source: `GET /reports/ops/sync-health`, `GET /reports/ops/webhook-events`, `GET /reports/ops/job-logs`

#### Dead Letter Page (`/dead-letters`)

Table of pending dead-letter jobs. Columns: Queue, Job Name, Entity ID, Error, Failed At, Actions.

**Retry button:** calls `POST /admin/dead-letters/:id/retry` → optimistically removes row, shows toast.

Data source: `GET /reports/ops/dead-letters`

#### Admin Page (`/admin`)

Three action sections:

**Sync a Task**  
Input: Task ID → button "Sync Now" → calls `POST /admin/tasks/sync`

**Backfill a Space**  
Select: space (Digital Marketing / R&D Apps / Projects) + optional lookback days → "Trigger Backfill" → calls `POST /admin/backfill`

**Webhook Registration**  
Button "Register Webhook" → calls `POST /admin/webhooks/register` → shows returned secret in a copy-to-clipboard box with warning "Save this secret now — it will not be shown again."

### API Client Setup

```typescript
// apps/web/src/api/client.ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
    'x-admin-key': import.meta.env.VITE_ADMIN_API_KEY,
  },
});
```

```env
# apps/web/.env.local
VITE_ADMIN_API_KEY=test-admin-key
VITE_API_BASE_URL=http://localhost:3000
```

### Shared Types

Create `src/types/` in the NestJS project and export response shapes. The React app imports them directly since it's the same repo:

```typescript
// src/types/reports.ts (NestJS side)
export interface TasksBySpaceStatus {
  spaceName: string;
  status: string;
  count: number;
}

export interface TimeEntryByUser {
  userId: string;
  userName: string;
  userEmail: string;
  totalHours: number;
  totalCostAud: number;
}
// ... etc
```

```typescript
// apps/web/src/api/reports.ts (React side)
import type { TasksBySpaceStatus, TimeEntryByUser } from '../../../src/types/reports';
```

### New Root Scripts

```json
// root package.json
{
  "scripts": {
    "dev": "concurrently \"npm run start:dev\" \"npm run dev --workspace=apps/web\"",
    "dev:deps": "docker compose up -d",
    "dev:web": "npm run dev --workspace=apps/web",
    "build:web": "npm run build --workspace=apps/web"
  }
}
```

---

## Phase 6: Production Cutover & Hardening

**Goal:** Go-live checklist. Complete before turning off n8n.

### Security

- [ ] `CLICKUP_WEBHOOK_SECRET` — set from webhook registration output
- [ ] `ADMIN_API_KEY` — strong random 32+ character string
- [ ] `CLICKUP_API_TOKEN` — dedicated Workspace Owner service account (not a personal token)
- [ ] PostgreSQL `clickup` user: grant only `SELECT`, `INSERT`, `UPDATE`, `DELETE` on app tables — no DDL rights
- [ ] Add request size limit: `app.use(express.json({ limit: '1mb' }))`
- [ ] Add rate limiting on the webhook endpoint (`@nestjs/throttler`): 100 req / 60s per IP

### React App Production

- [ ] Build: `npm run build --workspace=apps/web` → outputs `apps/web/dist/`
- [ ] Serve `dist/` via nginx static files, or deploy to Vercel/Netlify
- [ ] Set `VITE_ADMIN_API_KEY` in the hosting environment (not committed to git)
- [ ] Configure CORS in NestJS to allow the React app origin in production

```typescript
// src/main.ts — update enableCors for production
app.enableCors({
  origin: process.env.WEB_APP_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
});
```

### Cutover Procedure

1. **Run NestJS alongside n8n** — both receive webhooks. Watch for 3-5 days that NestJS processes all events correctly.
2. **Verify data parity** — compare `clickup_tasks` and `clickup_time_entries` row counts vs n8n output.
3. **Deregister n8n webhook** — via ClickUp workspace → Integrations, delete the n8n endpoint.
4. **Monitor 48 hours** — watch dead-letter queue, job failure rate, sync checkpoint freshness in the React ops page.
5. **Suspend n8n workflows** — after clean 48h, deactivate all ClickUp sync workflows in n8n.

### New Endpoints for Cutover

```
GET    /admin/webhooks              — list registered ClickUp webhooks
DELETE /admin/webhooks/:id          — delete a specific webhook (to clean up n8n registration)
GET    /admin/status                — overall system status (checkpoint age, dead-letter count, queue depth)
```

---

## Implementation Order

```
Phase 2  →  Phase 3  →  Phase 4  →  Phase 5  →  Phase 6
```

Phase 2 and Phase 3 can be done in parallel (different files, no conflicts).  
Phase 4 must come before Phase 5 (React app needs the API).  
Phase 6 is the go-live gate.

**Before starting Phase 2:** collect the real ClickUp user IDs for each tag name from `GET /team/{teamId}/member`.

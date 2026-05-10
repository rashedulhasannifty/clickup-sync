# Phase 5: React App — Design Spec

**Date:** 2026-05-10
**Status:** Approved
**Phases prerequisite:** Phases 2, 3, 4 complete ✅

---

## Goal

Build the full internal React application that replaces Grafana dashboards and Google Sheets. The app provides:
- Business reporting dashboards (tasks, time entries, cost)
- Assignee rate management (CRUD)
- Tag-assignee map management (CRUD)
- Operational monitoring (sync health, webhook events, job logs)
- Dead-letter queue inspection and retry
- Admin actions (manual sync, backfill, webhook registration)

---

## Section 1: Monorepo & Build Setup

### Workspace Structure

```
clickup-sync-nestjs/          ← root (npm workspaces)
  apps/
    web/                      ← React app (Vite + React + TypeScript)
      src/
      package.json
      vite.config.ts
      tsconfig.json
  src/                        ← NestJS backend (unchanged)
  src/types/                  ← shared response types (exported by NestJS, imported by React)
  package.json                ← add "workspaces": ["apps/*"]
```

### Root `package.json` Changes

Add `"workspaces": ["apps/*"]` and new scripts:

```json
{
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "concurrently \"npm run start:dev\" \"npm run dev --workspace=apps/web\"",
    "dev:web": "npm run dev --workspace=apps/web",
    "build:web": "npm run build --workspace=apps/web"
  }
}
```

Add `concurrently` as a dev dependency.

### Vite Dev Proxy

```typescript
// apps/web/vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
},
```

All Axios calls use `baseURL: '/api'` so they proxy to NestJS in dev without CORS issues.

### Production Serving

NestJS serves the React build via `ServeStaticModule`:

```typescript
ServeStaticModule.forRoot({
  rootPath: join(__dirname, '..', 'apps/web/dist'),
  exclude: ['/api/*', '/docs*', '/webhooks/*', '/admin/*', '/reports/*'],
})
```

All non-excluded routes fall through to `index.html` so React Router handles client-side navigation.

### Stack

| Package | Version | Purpose |
|---|---|---|
| Vite | 6 | Build tool |
| React | 19 | UI framework |
| TypeScript | 5 | Type safety |
| React Router | v6 | Client-side routing |
| TanStack Query | v5 | Server state / data fetching |
| Axios | latest | HTTP client |
| Recharts | latest | Charts |
| Tailwind CSS | v4 | Utility CSS |
| shadcn/ui | latest | Component library |

### Theme

Light mode. shadcn/ui default light theme.

---

## Section 2: Auth & Routing

### Auth Flow

No backend session. Auth is purely client-side:

1. First visit → `LoginPage` at `/login`
2. User enters admin API key → stored in `localStorage` under key `adminApiKey`
3. All subsequent requests include `x-admin-key: <stored key>` header via Axios instance
4. Sidebar has a **Logout** button → clears `adminApiKey` from localStorage → redirects to `/login`
5. Global Axios `401` response interceptor → clears stored key → redirects to `/login`

### Route Table

```
/login          → LoginPage            (public)
/               → DashboardPage        (protected)
/tasks          → TasksPage            (protected)
/time-entries   → TimeEntriesPage      (protected)
/rates          → RatesPage            (protected)
/tag-assignee   → TagAssigneePage      (protected)
/ops            → OpsPage              (protected)
/dead-letters   → DeadLetterPage       (protected)
/admin          → AdminPage            (protected)
```

A `ProtectedRoute` wrapper checks `localStorage.getItem('adminApiKey')`. If absent, redirects to `/login`. All protected routes render inside `AppLayout` (sidebar + header).

---

## Section 3: App Structure

```
apps/web/src/
  main.tsx
  App.tsx                       ← router setup, QueryClientProvider
  api/
    client.ts                   ← Axios instance, localStorage key injection, 401 interceptor
    reports.ts                  ← typed calls to /reports/* endpoints
    admin.ts                    ← typed calls to /admin/* action endpoints
    rates.ts                    ← typed calls to /admin/rates CRUD
    tag-assignee.ts             ← typed calls to /admin/tag-assignee-map CRUD
  pages/
    LoginPage.tsx
    DashboardPage.tsx
    TasksPage.tsx
    TimeEntriesPage.tsx
    RatesPage.tsx
    TagAssigneePage.tsx
    OpsPage.tsx
    DeadLetterPage.tsx
    AdminPage.tsx
  components/
    layout/
      AppLayout.tsx             ← wraps all protected pages
      Sidebar.tsx               ← nav links + logout
      Header.tsx                ← page title + fetch indicator
    charts/
      TasksBySpaceChart.tsx     ← stacked bar (Recharts BarChart)
      HoursByUserChart.tsx      ← horizontal bar
      CostByClientChart.tsx     ← bar chart
      BillableChart.tsx         ← donut (Recharts PieChart)
    tables/
      DataTable.tsx             ← reusable paginated table
    ui/                         ← shadcn/ui generated components
  hooks/
    useReports.ts               ← TanStack Query hooks for report endpoints
    useRates.ts                 ← query + mutation hooks for rates CRUD
    useTagAssignee.ts           ← query + mutation hooks for tag-assignee CRUD
    useAdmin.ts                 ← mutation hooks for admin actions
  lib/
    queryClient.ts              ← TanStack QueryClient (staleTime: 60_000, retry: 1)
    utils.ts                    ← formatCurrency, formatHours, formatDate helpers
  types/                        ← re-export from ../../../src/types/ or local copies
```

### Shared Types

Response shapes are defined in `src/types/reports.ts` and `src/types/admin.ts` in the NestJS project. The React app imports them via relative path:

```typescript
import type { TasksBySpaceStatus } from '../../../src/types/reports';
```

---

## Section 4: Pages Spec

### Dashboard Page (`/`)

**Stat cards (top row):**
- Total tasks (non-deleted count)
- Hours last 30d + total cost AUD
- Dead-letter backlog count
- Sync health: "All Fresh" (green) / "Stale: {n} spaces" (amber/red)

**Charts (below cards):**
- Tasks by Space + Status — stacked bar chart
- Hours by User — horizontal bar chart, last 30d
- Cost by Client — bar chart, last 30d
- Billable vs Non-Billable — donut chart

**Data sources:** `GET /reports/ops/stats`, `GET /reports/tasks/by-space-status`, `GET /reports/time-entries/by-user`, `GET /reports/time-entries/by-client`, `GET /reports/time-entries/billable-summary`

---

### Tasks Page (`/tasks`)

**Filters:** Space (dropdown), Status (dropdown), Updated date range, Name search (debounced)

**Table columns:** Task ID, Name, Space, Status, Assignees, Updated, Sprint Points, Cost

**Row expand:** Click row → inline JSON viewer showing raw task record (for debugging)

**Data source:** `GET /reports/tasks?spaceId=&status=&from=&to=&search=&limit=&offset=`

> This endpoint does not exist yet — it must be added to `ReportsController` / `ReportsService` as part of Phase 5 NestJS work before the React page can be wired up.

---

### Time Entries Page (`/time-entries`)

**Filters:** User (dropdown), Date range, Status (COST_CALCULATED / NO_RATE_FOUND / ALL)

**Table columns:** Task Name, User, Start Time, Duration (hrs), Rate ($/hr), Cost (AUD), Status

**Row styling:** `NO_RATE_FOUND` rows highlighted in red background

**Data source:** `GET /reports/time-entries?userId=&from=&to=&status=&limit=&offset=`

> This endpoint does not exist yet — must be added alongside the tasks list endpoint.

---

### Rates Page (`/rates`)

**Table columns:** Assignee Name, Email, Currency, Rate ($/hr), Valid From, Valid To, Actions

**Actions:**
- **Add Rate** — modal form: assignee name, email, assignee ID, currency (default AUD), hourly rate ($/hr converts to cents), valid from, valid to (optional)
- **Edit** — same modal pre-filled
- **Delete** — confirm dialog before `DELETE /admin/rates/:id`

**Data source:** `GET /admin/rates`, `POST /admin/rates`, `PATCH /admin/rates/:id`, `DELETE /admin/rates/:id`

---

### Tag-Assignee Map Page (`/tag-assignee`)

**Table columns:** Tag Name, ClickUp User ID, Name, Email, Active, Actions

**Actions:**
- **Add Mapping** — modal form: tag name, ClickUp user ID, name, email
- **Toggle Active** — `PATCH /admin/tag-assignee-map/:id` with `{ active: false/true }`
- **Delete** — confirm dialog before `DELETE /admin/tag-assignee-map/:id`

**Data source:** `GET /admin/tag-assignee-map`, `POST`, `PATCH`, `DELETE`

---

### Ops Page (`/ops`)

Three stacked panels:

**Sync Health:** Table of spaces with columns: Space Name, Last Successful Sync, Age (minutes), Status badge (Fresh ≤ 20min / Stale > 20min / Unknown). Auto-refreshes every 60s — the sync health query uses `refetchInterval: 60_000` (overrides the global default).

**Webhook Events:** Recent 50 events. Columns: Event Type, Task ID, Status, Received At, Processed At.

**Job Logs:** Filterable by queue name and status. Columns: Queue, Job Name, Status, Entity ID, Error Message, Finished At.

**Data sources:** `GET /reports/ops/sync-health`, `GET /reports/ops/webhook-events`, `GET /reports/ops/job-logs`

---

### Dead Letters Page (`/dead-letters`)

**Table columns:** Queue, Job Name, Entity ID, Error Message, Failed At, Actions

**Retry action:** `POST /admin/dead-letters/:id/retry` → row removed optimistically → success toast. On error: row restored + error toast.

**Data source:** `GET /reports/ops/dead-letters`

---

### Admin Page (`/admin`)

Three action cards:

**Sync a Task:**
Text input (Task ID) + "Sync Now" button → `POST /admin/tasks/sync { taskId }` → success/error toast

**Backfill a Space:**
Space select (Digital Marketing / R&D Apps / Projects) + lookback days input (default from space config) + "Trigger Backfill" button → `POST /admin/backfill { spaceId, lookbackDays }` → toast

**Register Webhook:**
"Register Webhook" button → `POST /admin/webhooks/register` → shows returned secret in a read-only input with copy-to-clipboard button and red warning: "Save this secret now — it will not be shown again."

---

## Section 5: Data Fetching & Error Handling

### TanStack Query Config

```typescript
// lib/queryClient.ts
new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
})
```

### Query / Mutation Pattern

- Each page's data comes from typed hooks in `src/hooks/`
- Mutations call `queryClient.invalidateQueries` on success to refresh relevant lists
- Query errors render an inline red banner with the error message and a retry button
- Mutation errors render a shadcn/ui toast (destructive variant)

### Axios Client

```typescript
// api/client.ts
export const apiClient = axios.create({ baseURL: '/api' });

apiClient.interceptors.request.use((config) => {
  const key = localStorage.getItem('adminApiKey');
  if (key) config.headers['x-admin-key'] = key;
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('adminApiKey');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);
```

---

## Section 6: NestJS Changes Required

Two new report endpoints are needed to support the Tasks and Time Entries pages (not built in Phase 4):

```
GET /reports/tasks?spaceId=&status=&from=&to=&search=&limit=&offset=
  → { items: ClickupTask[], total: number }

GET /reports/time-entries?userId=&from=&to=&status=&limit=&offset=
  → { items: ClickupTimeEntry[], total: number }
```

These are straightforward Prisma queries added to `ReportsService` and `ReportsController`. They are protected by `AdminApiKeyGuard`.

`ServeStaticModule` must be added to `AppModule` for production serving.

---

## Section 7: Testing

No automated tests for the React app in Phase 5 (internal tool). TypeScript and shared response types provide compile-time correctness. Each page will be manually smoke-tested against the live NestJS dev server before Phase 5 is marked complete.

---

## Out of Scope for Phase 5

- Dark mode toggle
- User-level access control (beyond the single admin key)
- Mobile / responsive layout (desktop-first internal tool)
- Automated E2E tests
- i18n

---

## Definition of Done

- [ ] `apps/web/` scaffolded and running via `npm run dev:web`
- [ ] Login page functional, key stored in localStorage, 401 redirect works
- [ ] All 8 pages render with real data from NestJS dev server
- [ ] Charts on Dashboard Page display correctly
- [ ] Rates CRUD mutations work end-to-end
- [ ] Tag-Assignee Map CRUD mutations work end-to-end
- [ ] Dead-letter retry works with optimistic UI
- [ ] Admin actions (sync task, backfill, register webhook) return feedback
- [ ] `npm run build:web` produces a valid dist
- [ ] NestJS serves the built app at `/` in production mode

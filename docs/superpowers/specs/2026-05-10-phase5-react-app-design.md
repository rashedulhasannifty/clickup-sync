# Phase 5: React App — Design Spec (Updated with Design Files)

**Date:** 2026-05-10
**Status:** Approved — updated to match Claude Design handoff
**Phases prerequisite:** Phases 2, 3, 4 complete ✅
**Design source:** `design/project/` (Claude Design export)

---

## Goal

Build the full internal React application that replaces Grafana dashboards and Google Sheets. Pixel-accurate recreation of the Claude Design prototype in production React/TypeScript.

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
  src/types/                  ← shared response types
  design/                     ← design handoff bundle (reference only, not built)
  package.json                ← add "workspaces": ["apps/*"]
```

### Root `package.json` Changes

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
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
},
```

### Production Serving

NestJS serves the React build via `ServeStaticModule`:

```typescript
ServeStaticModule.forRoot({
  rootPath: join(__dirname, '..', 'apps/web/dist'),
  exclude: ['/api/*', '/docs*', '/webhooks/*', '/admin/*', '/reports/*'],
})
```

All non-excluded routes fall through to `index.html`.

### Stack

| Package | Purpose |
|---|---|
| Vite 6, React 19, TypeScript 5 | Core |
| React Router v6 | Client-side routing |
| TanStack Query v5 | Server state / data fetching |
| Axios | HTTP client |
| **No Recharts** — custom pure-SVG charts | Charts (matches design exactly) |
| **No shadcn/ui** — custom components from scratch | UI components |
| Tailwind CSS v4 | Utility CSS (for layout/spacing helpers) |
| Geist font (Google Fonts) | Typography — matches design |

### CSS Design Tokens

The app uses CSS custom properties matching the design exactly:

```css
:root {
  --font-sans: "Geist", -apple-system, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
  --page-bg: #f7f7f5;
  --surface: #ffffff;
  --surface-alt: #fafaf9;
  --muted-bg: #f5f5f4;
  --hover: rgba(15, 23, 42, 0.04);
  --sidebar-bg: #fafaf8;
  --sidebar-active-bg: rgba(123, 104, 238, 0.10);
  --border: #e7e5e2;
  --border-soft: #efeeec;
  --border-strong: #d4d4d2;
  --text: #0f172a;
  --text-muted: #64748b;
  --text-faint: #94a3b8;
  --accent: #7B68EE;
  --accent-hover: #6953dc;
  --accent-soft: rgba(123, 104, 238, 0.10);
  --accent-strong: #5b48c9;
  --accent-grad: linear-gradient(120deg, #FF02F0 0%, #7B68EE 50%, #49CCF9 100%);
  --green: #10b981;
  --amber: #f59e0b;
  --red: #ef4444;
  --blue: #3b82f6;
}
```

Dark mode tokens are also defined (triggered by `data-theme="dark"` on `<html>`).

---

## Section 2: Auth & Routing

### Auth Flow

No backend session. Auth is purely client-side:

1. First visit → `LoginPage` at `/login`
2. User enters admin API key → stored in `localStorage` under key `adminApiKey`
3. All subsequent requests include `x-admin-key: <stored key>` header via Axios instance
4. Header has a light/dark toggle (always present regardless of default theme)
5. Sidebar footer shows a user avatar chip with a logout/collapse control
6. Global Axios `401` response interceptor → clears stored key → redirects to `/login`

### Route Table

```
/login           → LoginPage            (public)
/                → redirect to /overview
/overview        → OverviewPage         (protected)
/tasks           → TasksPage            (protected)
/tasks/:taskId   → TasksPage with drawer open (protected)
/time-entries    → TimeEntriesPage      (protected)
/missing-rates   → MissingRatesPage     (protected)
/assignee-rates  → AssigneeRatesPage    (protected)
/spaces          → SpacesPage           (protected)
/sync-logs       → SyncLogsPage         (protected)
/settings        → SettingsPage         (protected)
```

A `ProtectedRoute` wrapper checks `localStorage.getItem('adminApiKey')`. If absent, redirects to `/login`. All protected routes render inside `AppLayout`.

---

## Section 3: App Structure

```
apps/web/src/
  main.tsx
  App.tsx                         ← router, QueryClientProvider, FilterContext
  api/
    client.ts                     ← Axios instance, localStorage key, 401 interceptor
    reports.ts                    ← typed calls to /reports/* endpoints
    admin.ts                      ← typed calls to /admin/* action endpoints
    rates.ts                      ← /admin/rates CRUD
    tag-assignee.ts               ← /admin/tag-assignee-map CRUD
  pages/
    LoginPage.tsx
    OverviewPage.tsx
    TasksPage.tsx                 ← includes TaskDetailDrawer
    TimeEntriesPage.tsx           ← includes TimeEntryDrawer
    MissingRatesPage.tsx          ← grouped cards + triage queue views
    AssigneeRatesPage.tsx         ← grouped by assignee + RateModal
    SpacesPage.tsx                ← grid + workload views
    SyncLogsPage.tsx              ← sync runs tab + webhook events tab
    SettingsPage.tsx              ← connection / sync rules / scopes / members / notifications
  components/
    layout/
      AppLayout.tsx               ← wraps all protected pages
      Sidebar.tsx                 ← collapsible, amber badge on Missing Rates
      TopBar.tsx                  ← search trigger, date range, space filter, theme toggle
      CommandPalette.tsx          ← Cmd+K global search
    charts/
      BarChart.tsx                ← vertical + horizontal bar (pure SVG)
      DonutChart.tsx              ← donut with legend (pure SVG)
      LineChart.tsx               ← area line chart (pure SVG)
    ui/
      Button.tsx                  ← variants: default, primary, accent, ghost, danger, subtle
      Card.tsx                    ← surface container with optional header/action
      MetricCard.tsx              ← KPI card with delta and sparkline
      StatusBadge.tsx             ← colored status pill with dot
      Pill.tsx                    ← general tone pill (gray/green/amber/red/blue/purple)
      Avatar.tsx + AvatarStack.tsx
      DataTable.tsx               ← sortable, paginated, column-visibility toggle
      Drawer.tsx                  ← slide-in panel from right
      Modal.tsx                   ← centered modal with backdrop
      Input.tsx                   ← with optional leading icon
      Select.tsx                  ← custom dropdown (not native select)
      Tabs.tsx                    ← underline + segmented variants
      Switch.tsx
      Field.tsx                   ← label + hint + error wrapper
      Callout.tsx                 ← info/warning/error banner
      Tooltip.tsx
      EmptyState.tsx
      Sparkline.tsx               ← inline mini line chart
      Kbd.tsx                     ← keyboard shortcut display
      SectionHeader.tsx
      PageHeader.tsx
    formatters.ts                 ← fmt.money, fmt.hours, fmt.relative, fmt.date, etc.
  hooks/
    useReports.ts                 ← TanStack Query hooks for report endpoints
    useRates.ts                   ← query + mutation hooks for rates CRUD
    useTagAssignee.ts             ← query + mutation hooks for tag-assignee CRUD
    useAdmin.ts                   ← mutation hooks for admin actions
    useGlobalFilters.ts           ← dateRange + space filter context
  lib/
    queryClient.ts                ← staleTime: 60_000, retry: 1, refetchOnWindowFocus: false
    utils.ts
  types/
    index.ts                      ← re-exports from ../../../src/types/
```

---

## Section 4: Navigation

Sidebar has 8 nav items:

| Route | Label | Icon | Badge |
|---|---|---|---|
| /overview | Overview | Home | — |
| /tasks | Tasks | CheckSquare | — |
| /time-entries | Time Entries | Clock | — |
| /missing-rates | Missing Rates | AlertTriangle | amber count badge (from `/reports/ops/stats`) |
| /assignee-rates | Assignee Rates | DollarSign | — |
| /spaces | Spaces | Layers | — |
| /sync-logs | Sync Logs | Webhook | — |
| /settings | Settings | Settings | — |

Sidebar is collapsible (icon-only mode). Width: 232px expanded, 60px collapsed. Footer shows user avatar + name + email + collapse toggle.

Top bar contains: Cmd+K search trigger, global date range select, global space filter select, sync status pill (green "Synced Xm ago"), light/dark toggle, notification bell.

---

## Section 5: Pages Spec

### Overview Page (`/overview`)

**KPI grid (6 cards):**
- Total tasks (accent card with sparkline) → navigates to /tasks
- Open tasks (count + % of total) → navigates to /tasks
- Closed tasks (count + % of total)
- Time tracked (hours + entry count) → navigates to /time-entries
- Calculated cost (AUD, last 30d)
- Missing rates (count + affected assignees) → navigates to /missing-rates

**Sync health card:** Animated pulse dot health panel with 6 indicators: webhook endpoint, latest event, successful events 24h, duplicate skipped, failed events, last task update.

**Charts grid (6 charts, `repeat(auto-fit, minmax(320px, 1fr))`):**
- Tasks by status — DonutChart with legend
- Tasks by space — horizontal BarChart
- Time tracked by assignee — horizontal BarChart (hours)
- Cost by department — horizontal BarChart (AUD)
- Cost by client — horizontal BarChart (AUD)
- Missing rates trend — LineChart (14-day daily count, amber color)

**Bottom row (2 columns):** Recent webhook activity table (7 events, clickable rows → /sync-logs) + Alerts panel (4 actionable alert items with amber/red icons).

**Sprint points card:** horizontal BarChart by sprint name.

**Data sources:** `GET /reports/ops/stats`, `GET /reports/tasks/by-space-status`, `GET /reports/time-entries/by-user`, `GET /reports/time-entries/by-client`, `GET /reports/time-entries/by-department`, `GET /reports/time-entries/billable-summary`, `GET /reports/ops/webhook-events?limit=7`, `GET /reports/sprint-points`

---

### Tasks Page (`/tasks`, `/tasks/:taskId`)

**Filters bar:** Search (debounced, searches name/ID/assignee/client), Status, Priority, Assignee, Task type (parent/subtask/all), Archived (exclude/include/only). Reset button appears when any filter is active.

**Table columns:** Task (with subtask indent, status color bar, overdue/just-synced pills), Status (StatusBadge), Space, List, Assignees (AvatarStack), Client, Dept (Pill), Sprint, Pts, Est, Spent (red if over), Updated, Synced.

**Row click:** Opens `TaskDetailDrawer` (620px wide). Drawer has 4 tabs:
- **Overview:** Hierarchy & ownership (MetaGrid), Business fields, Time tracking mini-cards (estimate/logged/cost), Dates
- **Time entries:** List of time entry cards per entry (avatar + user + date range + hours + cost or "no rate" pill)
- **Raw fields:** Prettified JSON viewer
- **Sync history:** Timeline of sync events for this task with colored icons

Header actions: Export CSV, Sync now.

**Data source:** `GET /reports/tasks?spaceId=&status=&priority=&assigneeId=&type=&archived=&search=&limit=&offset=`

> This endpoint must be added to `ReportsController` as part of Phase 5 NestJS work.

---

### Time Entries Page (`/time-entries`)

**KPI strip (6 dense metric cards):** Total hours + entry count, Billable hours + %, Non-billable hours, Total cost + avg rate/h, With cost (count), Missing rates (count) → navigates to /missing-rates.

**Filters bar:** Search (task/assignee), Assignee, Billable (all/billable/non-billable), Status (all/COST_CALCULATED/NO_RATE_FOUND), "Missing rate only" switch toggle. Reset button.

**Table columns:** ID (monospace), Task, Assignee (Avatar + name), Start (dateTime), Duration (hrs, bold), Bill (green/gray pill), Rate ($/h), Cost (bold), Status (green/amber pill), Synced.

**Row click:** Opens `TimeEntryDrawer` (520px). Shows: assignee card with avatar + "Rates" link button, Time section (start/end/duration/billable), Cost calculation panel (green if calculated: `Xh × $Y/h = $Z`; amber if NO_RATE_FOUND with "Add rate" button), Description, Sync metadata.

Header actions: Export CSV, Recalculate costs.

**Data source:** `GET /reports/time-entries?userId=&from=&to=&status=&billable=&search=&limit=&offset=`

> This endpoint must be added to `ReportsController`.

---

### Missing Rates Page (`/missing-rates`)

Dedicated page for cost calculation problems. Badge in sidebar shows count.

**View toggle (segmented tabs):** Grouped (cards) | Triage queue

**Summary KPI (4 dense cards):** Affected assignees, Affected entries, Affected hours, Est. uncosted spend.

**Filters:** Search by assignee, Severity (all/high/medium/low). Export issues button.

**Grouped view:** Card grid `repeat(auto-fill, minmax(360px, 1fr))`. Each card:
- Left colored border (red=high, amber=medium, gray=low)
- Avatar + name + email + severity pill + issue type pill
- 2-col stat grid: entries count, hours, date range
- Expandable "Show affected tasks (N)" list
- Footer: Add Rate (accent), Entries, Rates buttons

**Triage queue view:** Sorted list (by severity then count). Each row: severity stripe, avatar, name + issue type + severity pills, date range, entry count + hours + estimated cost, action buttons.

**Data source:** `GET /reports/ops/missing-rates` (new endpoint needed — returns assignees with NO_RATE_FOUND entries, grouped with count/hours/date range)

---

### Assignee Rates Page (`/assignee-rates`)

**KPI (4 dense cards):** Active rates, Covered assignees, Avg active rate ($/h), Without rate (links to /missing-rates).

**Filters:** Search by assignee name/email, "Active rates only" switch.

**Grouped by assignee** (not flat table). Each assignee card:
- Header: Avatar + name + email + current active rate ($/h) + "New rate" button
- Table below header showing all rate rows: From, To, Rate, Status (active/historical pill), Updated, Edit button

**New Rate / Edit Rate modal:**
- Fields: Assignee select, Hourly rate + Currency (side by side), Effective from + Effective to (side by side, date inputs)
- Blue callout explaining closed-open interval `[from, to)`
- Amber callout if overlap detected
- Footer: Delete (danger, left), Cancel, Save/Create (accent, right)

**Data source:** `GET /admin/rates`, `POST /admin/rates`, `PATCH /admin/rates/:id`, `DELETE /admin/rates/:id`

---

### Spaces Page (`/spaces`)

**View toggle:** Grid | Workload

**Grid view:** `repeat(auto-fill, minmax(320px, 1fr))` card grid. Each card:
- Top colored border (space color)
- Space icon (initial letter in colored bg) + name + space ID (monospace) + synced/paused pill
- 2×2 stat grid: Tasks, Open, Members, Hours
- Billable progress bar (space color)
- Footer: View tasks, Settings buttons

**Workload view:** Single card with:
- Summary header (total hours across N spaces)
- Stacked proportional bar (space colors)
- Legend with color swatches + name + hours + %
- Detail table: Space, Tasks, Open, Members, Hours, Billable, Cost

**Data source:** `GET /reports/tasks/summary`, `GET /reports/time-entries/by-client` (for cost). May need a dedicated `GET /reports/spaces` endpoint returning per-space stats.

---

### Sync Logs Page (`/sync-logs`)

**Tabs:** Sync runs (count) | Webhook events (count)

**Sync Runs tab:**
- KPI (4 cards): Last success (relative time), Last failure (relative + truncated error), Success rate %, Avg duration
- Table: Status pill, Run ID (monospace), Trigger (pill), Started, Duration, Tasks, Time entries, Errors (red if > 0), chevron
- Row click → `SyncRunDrawer` (620px): Run summary MetaGrid, Counts stat grid, Error message (red code block if present), Dark terminal-style logs panel (color-coded by [INFO]/[WARN]/[ERROR])

**Webhook Events tab:**
- KPI (4 cards): Total 24h, Processed + %, Failed, Avg latency
- Filters: Search, Status (all/processed/failed), Event type
- "Retry all failed" button (appears when failedCount > 0)
- Table: Status (OK/fail pill), Event (blue pill), Task ID (monospace), Received, Latency, Attempts (amber if > 1), chevron
- Row click → `WebhookEventDrawer` (580px): Status pills, MetaGrid, Error (if present), Dark JSON payload viewer, Retry + Copy payload buttons

**Dead-letter integration:** Dead-letter items surfaced in Webhook Events tab as failed events with retry action.

**Data source:** `GET /reports/ops/job-logs`, `GET /reports/ops/webhook-events`, `GET /reports/ops/dead-letters`

---

### Settings Page (`/settings`)

**Tabs:** Connection | Sync rules | Scope filters | Members & access | Notifications

**Connection tab:**
- Workspace card: ClickUp workspace info, last sync, webhook status, token expiry, API quota. Test connection / Rotate token / Disconnect buttons.
- Webhook card: endpoint URL (read-only), subscribed events (blue pills), signing secret (password input).

**Sync rules tab:**
- Sync schedule card: real-time webhooks (switch), full reconciliation schedule (select), backfill on connect (switch)
- Cost calculation card: default currency, rate matching (start date vs due date), auto-recalculate on rate change, non-billable zero cost
- Failure handling card: webhook retry attempts, pause on repeated failure

**Scope filters tab:**
- Info callout explaining scope behavior
- Synced spaces card: switch per space, space color dot + name + stats
- Status filters card: excluded statuses as removable pills + "Add status" dashed button
- Tag filters card: currently showing "no tag filters set"

**Members & access tab:**
- Table: Member (avatar + name/email), Role (colored pill), Last active, 2FA status, Edit button
- Invite member button (accent)

**Notifications tab:**
- Alerts card: sync run failed, webhook errors spike, missing rate created, token expiring — all switches
- Channels card: Email, Slack, PagerDuty — switches

**Tag-Assignee Map is accessed via Settings** — add a "Tag-Assignee Map" section under Sync rules or as a 6th tab.

**Data source:** Mix of NestJS config reads and CRUD endpoints. Settings persistence is Phase 6 scope — in Phase 5 the settings page is read-only display wired to real data where available, controls are non-functional for settings that don't have backing API endpoints yet.

---

## Section 6: Shared Components Detail

### Custom Charts (pure SVG, no external library)

**BarChart:** Supports both vertical (SVG `<rect>`) and horizontal (CSS flex with colored bars) modes. Color palette: `['#7B68EE','#FF02F0','#49CCF9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4']`. Labels below for vertical, labels left for horizontal.

**DonutChart:** SVG `<circle>` with `strokeDasharray`. Center label + value. Side legend with color swatches. Animated stroke transitions.

**LineChart:** SVG path with area gradient fill. X-axis labels (filtered to ~6). Area fill uses linear gradient from stroke color at 18% → 0%.

**Sparkline:** Inline mini polyline for MetricCard. No axes.

### DataTable

Sortable (click header, three-state: asc → desc → none). Paginated (page size options: 10/25/50/100). Column visibility toggle (Columns button → checkbox dropdown). Compact/comfortable density via `--row-h` CSS var. Sticky first column option. Zebra striping. Empty state slot.

### CommandPalette (Cmd+K / Ctrl+K)

Fuzzy search across: navigation (all 8 routes), tasks (first 30), assignees. Backdrop blur overlay. `fadeIn` + `modalIn` animations. Keyboard: ↑↓ navigate, ↵ select, Esc close.

### Formatters (`formatters.ts`)

```typescript
fmt.money(cents, currency?)  // Intl.NumberFormat currency
fmt.number(n)                // Intl.NumberFormat
fmt.hours(h)                 // "X.Xh"
fmt.shortHours(h)            // "<60m → "Xm", else "X.Xh"
fmt.relative(iso)            // "just now" / "Xm ago" / "Xh ago" / "Xd ago"
fmt.date(iso)                // "Jan 15, 2025"
fmt.shortDate(iso)           // "Jan 15"
fmt.dateTime(iso)            // "Jan 15, 9:30 AM"
fmt.time(iso)                // "9:30 AM"
```

---

## Section 7: Data Fetching & Error Handling

**TanStack Query Config:**
```typescript
new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
})
```

Sync health query in Overview uses `refetchInterval: 60_000` override.

**Axios client:** Single instance, `baseURL: '/api'`, request interceptor injects `x-admin-key` from localStorage, response interceptor handles 401 → redirect to /login.

**Error states:** Query errors → inline red banner per component with retry button. Mutation errors → toast-style notification (custom, not shadcn/ui). Network errors → generic message, no stack traces.

**Global filters:** `FilterContext` provides `dateRange` (default '30d') and `space` (default 'all') via React context, consumed by all pages.

---

## Section 8: NestJS Changes Required

New endpoints needed (not built in Phase 4):

```
GET /reports/tasks?spaceId=&status=&priority=&assigneeId=&type=&archived=&search=&limit=&offset=
  → { items: ClickupTask[], total: number }

GET /reports/time-entries?userId=&from=&to=&status=&billable=&search=&limit=&offset=
  → { items: ClickupTimeEntry[], total: number }

GET /reports/ops/missing-rates
  → [{ assignee, severity, missing_count, affected_hours, estimated_missing_cost_cents, first_date, latest_date, affected_tasks }]

GET /reports/spaces
  → [{ spaceId, name, taskCount, openCount, memberCount, hoursLogged, billableHours, costCents, synced }]
```

`ServeStaticModule` added to `AppModule` for production serving.

---

## Section 9: Testing

No automated tests for the React app in Phase 5. TypeScript + shared response types provide compile-time correctness. Manual smoke-test of each page against live NestJS dev server before Phase 5 is marked complete.

---

## Out of Scope for Phase 5

- Settings controls that write to NestJS (Settings page is display-only except for rates/tag-assignee CRUD which already has API)
- Mobile/responsive layout (desktop-first internal tool)
- Automated E2E tests
- i18n
- Notification delivery (Slack/email/PagerDuty wiring)

---

## Definition of Done

- [ ] `apps/web/` scaffolded and running via `npm run dev:web`
- [ ] Login page functional, key stored in localStorage, 401 redirect works
- [ ] All 8 pages render with real data from NestJS dev server
- [ ] Cmd+K command palette works across nav, tasks, assignees
- [ ] Sidebar collapse/expand works; Missing Rates badge shows live count
- [ ] Overview charts render correctly with real data
- [ ] Task page: filter bar, sortable table, detail drawer with 4 tabs
- [ ] Time entries page: filter bar, sortable table, detail drawer with cost breakdown
- [ ] Missing rates page: both grouped and triage views
- [ ] Assignee rates CRUD (add/edit/delete) works end-to-end
- [ ] Spaces page: both grid and workload views
- [ ] Sync logs: sync runs + webhook events tabs, both with click-to-drawer detail
- [ ] Settings page renders connection status and scopes from real data
- [ ] `npm run build:web` produces a valid dist
- [ ] NestJS serves the built app at `/` in production mode

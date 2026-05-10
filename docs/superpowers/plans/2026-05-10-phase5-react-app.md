# Phase 5: React App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full internal React application that replaces Grafana and Google Sheets.  
**Design reference:** `design/project/` — Claude Design export. All pages must match pixel-accurately.  
**Spec:** `docs/superpowers/specs/2026-05-10-phase5-react-app-design.md`  
**Prerequisite:** Phases 2, 3, 4 complete.

**Testing rule for React:** No automated tests (spec §9). TypeScript compile-time checks are the correctness gate. All React tasks skip the Red-Green-Refactor loop.  
**Testing rule for NestJS additions:** TDD applies — write failing test first, then implement.

---

## File Map

| File | Action |
|---|---|
| `package.json` (root) | Modify — add workspaces, concurrently, dev scripts |
| `src/reports/reports.service.ts` | Modify — add missingRates(), spaces(); extend tasks() + timeEntriesList() params |
| `src/reports/reports.controller.ts` | Modify — add /ops/missing-rates, /spaces endpoints; extend tasks + time-entries params |
| `src/app.module.ts` | Modify — add ServeStaticModule |
| `apps/web/` | Create — full Vite+React app |

---

## Task 1: NestJS backend gaps — missing-rates + spaces endpoints

**Files:**
- Modify: `src/reports/reports.service.ts`
- Modify: `src/reports/reports.controller.ts`
- Test: `test/reports.service.spec.ts` (extend existing or create)

**What's needed:**
- `GET /reports/ops/missing-rates` — returns assignees with NO_RATE_FOUND entries, grouped
- `GET /reports/spaces` — per-space task/hour/cost stats

`/reports/tasks` and `/reports/time-entries` exist but are missing some params from the spec:
- tasks: missing `priority`, `assigneeId`, `type` (parent/subtask/all), `archived`
- time-entries: missing `billable` (boolean filter), `search` (task name)

- [ ] **Step 1: Write failing tests**

```typescript
// test/reports.service.spec.ts — add to existing describe block or create

describe('ReportsService.missingRates', () => {
  it('queries time entries with NO_RATE_FOUND status grouped by user', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { user_id: 'u1', user_name: 'Alice', user_email: 'a@x.com', missing_count: BigInt(3), affected_hours: 5.5, first_date: new Date('2025-01-01'), latest_date: new Date('2025-01-15') }
    ]);
    const prisma = { $queryRaw: queryRaw } as any;
    const svc = new ReportsService(prisma);
    const result = await svc.missingRates();
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u1');
    expect(result[0].missingCount).toBe(3);
  });
});

describe('ReportsService.spaces', () => {
  it('returns per-space aggregated stats', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { space_id: '3577824', space_name: 'DM', task_count: BigInt(10), open_count: BigInt(5), hours_logged: 20.5, cost_cents: 5000 }
    ]);
    const prisma = { $queryRaw: queryRaw } as any;
    const svc = new ReportsService(prisma);
    const result = await svc.spaces();
    expect(result).toHaveLength(1);
    expect(result[0].spaceId).toBe('3577824');
    expect(result[0].hoursLogged).toBe(20.5);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest test/reports.service.spec.ts --no-coverage --testNamePattern="missingRates|spaces" 2>&1 | tail -20
```

Expected: FAIL — `missingRates is not a function`

- [ ] **Step 3: Add `missingRates()` to ReportsService**

Add to `src/reports/reports.service.ts` before the closing `}`:

```typescript
async missingRates() {
  type Row = {
    user_id: string;
    user_name: string;
    user_email: string;
    missing_count: bigint;
    affected_hours: number;
    first_date: Date;
    latest_date: Date;
  };
  const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      e.user_id,
      e.user_name,
      e.user_email,
      COUNT(*)::bigint AS missing_count,
      COALESCE(SUM(e.duration_hours), 0)::float AS affected_hours,
      MIN(e.start_time) AS first_date,
      MAX(e.start_time) AS latest_date
    FROM clickup_time_entries e
    WHERE e.status = 'NO_RATE_FOUND'
    GROUP BY e.user_id, e.user_name, e.user_email
    ORDER BY COUNT(*) DESC
  `);
  return rows.map(r => ({
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    missingCount: Number(r.missing_count),
    affectedHours: Number(r.affected_hours),
    firstDate: r.first_date,
    latestDate: r.latest_date,
  }));
}

async spaces() {
  type Row = {
    space_id: string;
    space_name: string;
    task_count: bigint;
    open_count: bigint;
    hours_logged: number;
    cost_cents: number;
  };
  const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      t.space_id,
      t.space_name,
      COUNT(DISTINCT t.task_id)::bigint AS task_count,
      COUNT(DISTINCT CASE WHEN t.status NOT IN ('complete','closed') THEN t.task_id END)::bigint AS open_count,
      COALESCE(SUM(e.duration_hours), 0)::float AS hours_logged,
      COALESCE(SUM(e.cost_cents), 0)::float AS cost_cents
    FROM clickup_tasks t
    LEFT JOIN clickup_time_entries e ON e.task_id = t.task_id
    WHERE t.is_deleted = false
    GROUP BY t.space_id, t.space_name
    ORDER BY task_count DESC
  `);
  return rows.map(r => ({
    spaceId: r.space_id,
    spaceName: r.space_name,
    taskCount: Number(r.task_count),
    openCount: Number(r.open_count),
    hoursLogged: Number(r.hours_logged),
    costAud: Number(r.cost_cents) / 100,
  }));
}
```

- [ ] **Step 4: Extend `tasks()` params in ReportsService**

In `src/reports/reports.service.ts`, update the `tasks()` method signature and where clause:

```typescript
async tasks(
  spaceId?: string,
  status?: string,
  search?: string,
  fromParam?: string,
  toParam?: string,
  limit = 50,
  offset = 0,
  priority?: string,
  assigneeId?: string,
  type?: string,        // 'parent' | 'subtask' | 'all'
  archived?: string,    // 'exclude' | 'include' | 'only'
) {
  const safeLimit = Math.min(limit, 200);
  const where: Prisma.ClickupTaskWhereInput = {};
  if (archived === 'only') {
    where.isDeleted = true;
  } else if (archived === 'include') {
    // no isDeleted filter
  } else {
    where.isDeleted = false;
  }
  if (spaceId) where.spaceId = spaceId;
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (search) where.taskName = { contains: search, mode: 'insensitive' };
  if (type === 'parent') where.parentTaskId = null;
  if (type === 'subtask') where.parentTaskId = { not: null };
  if (assigneeId) where.assigneesIds = { has: assigneeId };
  if (fromParam || toParam) {
    where.updatedDate = { gte: parseDate(fromParam, new Date(0)), lte: parseDate(toParam, new Date()) };
  }
  const [items, total] = await this.prisma.$transaction([
    this.prisma.clickupTask.findMany({
      where,
      orderBy: { updatedDate: 'desc' },
      take: safeLimit,
      skip: offset,
      select: {
        taskId: true, taskName: true, spaceId: true, spaceName: true, status: true,
        priority: true, parentTaskId: true, assigneesNames: true, assigneesIds: true,
        updatedDate: true, syncedAt: true, sprintPoints: true, cost: true,
        client: true, department: true, isDeleted: true,
      },
    }),
    this.prisma.clickupTask.count({ where }),
  ]);
  return { items: items.map(t => ({ ...t, cost: t.cost.toNumber() })), total, limit: safeLimit, offset };
}
```

- [ ] **Step 5: Extend `timeEntriesList()` params in ReportsService**

In `src/reports/reports.service.ts`, update the `timeEntriesList()` method:

```typescript
async timeEntriesList(
  userId?: string,
  fromParam?: string,
  toParam?: string,
  status?: string,
  limit = 50,
  offset = 0,
  billable?: string,   // 'true' | 'false'
  search?: string,     // searches task name
) {
  const safeLimit = Math.min(limit, 200);
  const from = parseDate(fromParam, defaultFrom());
  const to = parseDate(toParam, new Date());
  const where: Prisma.ClickupTimeEntryWhereInput = { startTime: { gte: from, lte: to } };
  if (userId) where.userId = userId;
  if (status) where.status = status;
  if (billable !== undefined) where.billable = billable === 'true';
  if (search) where.task = { taskName: { contains: search, mode: 'insensitive' } };
  const [items, total] = await this.prisma.$transaction([
    this.prisma.clickupTimeEntry.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: safeLimit,
      skip: offset,
      select: {
        timeEntryId: true, taskId: true, userId: true, userName: true, userEmail: true,
        startTime: true, endTime: true, durationHours: true, hourlyRateCents: true,
        costCents: true, status: true, billable: true, description: true, syncedAt: true,
        task: { select: { taskName: true } },
      },
    }),
    this.prisma.clickupTimeEntry.count({ where }),
  ]);
  return {
    items: items.map(e => ({
      timeEntryId: e.timeEntryId,
      taskId: e.taskId,
      taskName: e.task?.taskName ?? null,
      userId: e.userId,
      userName: e.userName,
      userEmail: e.userEmail,
      startTime: e.startTime,
      endTime: e.endTime,
      durationHours: e.durationHours.toNumber(),
      hourlyRateCents: Number(e.hourlyRateCents),
      costAud: Number(e.costCents) / 100,
      status: e.status,
      billable: e.billable,
      description: e.description,
      syncedAt: e.syncedAt,
    })),
    total,
    limit: safeLimit,
    offset,
  };
}
```

- [ ] **Step 6: Add endpoints to ReportsController**

In `src/reports/reports.controller.ts`, add:

```typescript
@Get('ops/missing-rates')
@ApiOperation({ summary: 'Assignees with NO_RATE_FOUND entries, grouped by user' })
missingRates() { return this.reports.missingRates(); }

@Get('spaces')
@ApiOperation({ summary: 'Per-space task, hour, and cost aggregates' })
spaces() { return this.reports.spaces(); }
```

Also update the `tasks()` and `timeEntriesList()` controller methods to pass the new query params:

```typescript
@Get('tasks')
tasks(
  @Query('spaceId') spaceId?: string,
  @Query('status') status?: string,
  @Query('search') search?: string,
  @Query('from') from?: string,
  @Query('to') to?: string,
  @Query('limit') limit?: string,
  @Query('offset') offset?: string,
  @Query('priority') priority?: string,
  @Query('assigneeId') assigneeId?: string,
  @Query('type') type?: string,
  @Query('archived') archived?: string,
) {
  return this.reports.tasks(spaceId, status, search, from, to, Number(limit) || 50, Number(offset) || 0, priority, assigneeId, type, archived);
}

@Get('time-entries')
timeEntriesList(
  @Query('userId') userId?: string,
  @Query('from') from?: string,
  @Query('to') to?: string,
  @Query('status') status?: string,
  @Query('limit') limit?: string,
  @Query('offset') offset?: string,
  @Query('billable') billable?: string,
  @Query('search') search?: string,
) {
  return this.reports.timeEntriesList(userId, from, to, status, Number(limit) || 50, Number(offset) || 0, billable, search);
}
```

- [ ] **Step 7: Run tests + build**

```bash
npx jest test/reports.service.spec.ts --no-coverage 2>&1 | tail -20
npm run build 2>&1 | tail -10
```

Expected: tests pass, build succeeds

- [ ] **Step 8: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts test/reports.service.spec.ts
git commit -m "feat: add missing-rates + spaces report endpoints; extend tasks/time-entries query params"
```

---

## Task 2: Monorepo setup

**Files:**
- Modify: `package.json` (root)
- Create: `apps/web/` (scaffolded by Vite CLI)

- [ ] **Step 1: Add workspaces to root package.json**

In `package.json`, add:
```json
"workspaces": ["apps/*"],
```

Add to `scripts`:
```json
"dev": "concurrently \"npm run start:dev\" \"npm run dev --workspace=apps/web\"",
"dev:web": "npm run dev --workspace=apps/web",
"build:web": "npm run build --workspace=apps/web"
```

Add to `devDependencies`:
```json
"concurrently": "^9.1.0"
```

- [ ] **Step 2: Scaffold the Vite app**

```bash
mkdir -p apps
cd apps && npm create vite@latest web -- --template react-ts
```

- [ ] **Step 3: Install React app dependencies**

```bash
cd apps/web
npm install @tanstack/react-query axios react-router-dom date-fns
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 4: Configure `apps/web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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

- [ ] **Step 5: Create `apps/web/.env.local`**

```env
VITE_ADMIN_API_KEY=test-admin-key
```

Add `apps/web/.env.local` to `.gitignore`.

- [ ] **Step 6: Verify the app starts**

```bash
npm run dev:web
```

Expected: Vite dev server on `http://localhost:5173` with default React template

- [ ] **Step 7: Commit**

```bash
git add package.json apps/web/package.json apps/web/vite.config.ts apps/web/tsconfig.json apps/web/index.html .gitignore
git commit -m "feat: scaffold apps/web Vite+React workspace"
```

---

## Task 3: Design tokens, CSS foundation, and formatters

**Files:**
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/components/formatters.ts`

- [ ] **Step 1: Create `apps/web/src/index.css`**

Set up CSS custom properties matching the design spec exactly. Light mode tokens from §1, dark mode via `[data-theme="dark"]`. Add Geist font from Google Fonts. Reset and base styles. See spec §1 for the exact token list.

```css
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap');
@import "tailwindcss";

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

[data-theme="dark"] {
  --page-bg: #0f0f0e;
  --surface: #1a1a18;
  --surface-alt: #141413;
  --muted-bg: #1e1e1c;
  --hover: rgba(255,255,255,0.05);
  --sidebar-bg: #161614;
  --sidebar-active-bg: rgba(123,104,238,0.15);
  --border: #2a2a28;
  --border-soft: #222220;
  --border-strong: #363634;
  --text: #f8f8f7;
  --text-muted: #8b8b88;
  --text-faint: #5a5a57;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-sans); background: var(--page-bg); color: var(--text); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
```

- [ ] **Step 2: Create `apps/web/src/components/formatters.ts`**

```typescript
export const fmt = {
  money(cents: number, currency = 'AUD') {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
  },
  number(n: number) {
    return new Intl.NumberFormat('en-AU').format(n);
  },
  hours(h: number) {
    return `${h.toFixed(1)}h`;
  },
  shortHours(h: number) {
    if (h < 1) return `${Math.round(h * 60)}m`;
    return `${h.toFixed(1)}h`;
  },
  relative(iso: string | Date) {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  },
  date(iso: string | Date) {
    return new Intl.DateTimeFormat('en-AU', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
  },
  shortDate(iso: string | Date) {
    return new Intl.DateTimeFormat('en-AU', { month: 'short', day: 'numeric' }).format(new Date(iso));
  },
  dateTime(iso: string | Date) {
    return new Intl.DateTimeFormat('en-AU', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  },
  time(iso: string | Date) {
    return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/index.css apps/web/src/components/formatters.ts
git commit -m "feat: add design tokens CSS and formatters"
```

---

## Task 4: API client infrastructure

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/lib/queryClient.ts`
- Create: `apps/web/src/hooks/useGlobalFilters.ts`

- [ ] **Step 1: Create `apps/web/src/api/client.ts`**

```typescript
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const key = localStorage.getItem('adminApiKey') ?? import.meta.env.VITE_ADMIN_API_KEY ?? '';
  if (key) config.headers['x-admin-key'] = key;
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('adminApiKey');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
```

- [ ] **Step 2: Create typed API modules**

Create `apps/web/src/api/reports.ts` — typed functions for every `GET /reports/*` endpoint, each calling `apiClient.get(...)` and returning the typed response.

Create `apps/web/src/api/admin.ts` — typed functions for admin actions (sync task, backfill, sync rates, register webhook, dead-letter retry).

Create `apps/web/src/api/rates.ts` — CRUD functions for `GET/POST/PATCH/DELETE /admin/rates`.

Create `apps/web/src/api/tag-assignee.ts` — CRUD functions for `GET/POST/PATCH/DELETE /admin/tag-assignee-map`.

All functions must be typed using the shared types in `src/types/` (or inline interfaces if types don't exist yet for a particular shape).

- [ ] **Step 3: Create `apps/web/src/lib/queryClient.ts`**

```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});
```

- [ ] **Step 4: Create `apps/web/src/hooks/useGlobalFilters.ts`**

FilterContext providing `dateRange` ('7d' | '30d' | '90d' | 'custom') and `space` ('all' | spaceId). Stored in sessionStorage so it survives page navigation but resets on tab close. Expose `useGlobalFilters()` hook.

- [ ] **Step 5: Create TanStack Query hooks**

- `apps/web/src/hooks/useReports.ts` — one `useQuery` hook per report endpoint
- `apps/web/src/hooks/useRates.ts` — query + mutations (create, update, delete) with `queryClient.invalidateQueries` on success
- `apps/web/src/hooks/useTagAssignee.ts` — same pattern
- `apps/web/src/hooks/useAdmin.ts` — `useMutation` hooks for admin actions (no query invalidation needed)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/ apps/web/src/lib/ apps/web/src/hooks/
git commit -m "feat: add API client, QueryClient, and TanStack Query hooks"
```

---

## Task 5: Base UI components

**Files:** `apps/web/src/components/ui/` — all base components from spec §3

**Design reference:** `design/project/components.jsx` — the design system. Implement each component to match.

- [ ] **Create each UI component in `apps/web/src/components/ui/`:**

  - `Button.tsx` — variants: `default | primary | accent | ghost | danger | subtle`. Props: `size` (sm/md/lg), `loading`, `disabled`, `icon` (left).
  - `Card.tsx` — `var(--surface)` background, `1px solid var(--border)` border, optional `header` (title + action slot), optional hover state.
  - `MetricCard.tsx` — KPI card with value, label, delta (green if positive, red if negative), optional Sparkline slot.
  - `StatusBadge.tsx` — colored dot + text. Map status strings to colors: `complete/closed` → green, `in progress` → blue, `open` → gray, etc.
  - `Pill.tsx` — general colored pill. Tone prop: `gray | green | amber | red | blue | purple`. Small text, rounded.
  - `Avatar.tsx` — initials-based circular avatar. Props: `name`, `size` (sm/md/lg), optional `color` (derived from name hash if not provided).
  - `AvatarStack.tsx` — overlapping Avatar components with `+N` overflow chip.
  - `DataTable.tsx` — generic table. Props: `columns` (with `sortable?`, `hidden?`), `data`, `pageSize`, `onSort`, `emptyState`. Sticky header. Column visibility dropdown. Pagination controls.
  - `Drawer.tsx` — slide-in from right. Props: `open`, `onClose`, `width` (default 520px), `title`, `children`. Backdrop overlay. CSS transition `translateX`.
  - `Modal.tsx` — centered with backdrop blur. Props: `open`, `onClose`, `title`, `children`, `footer`.
  - `Input.tsx` — text input with optional leading icon, label, error state.
  - `Select.tsx` — custom dropdown (not native `<select>`). Props: `options`, `value`, `onChange`, `placeholder`.
  - `Tabs.tsx` — two variants: `underline` (default) and `segmented`. Renders tab bar + active content slot.
  - `Switch.tsx` — toggle switch with `checked` / `onChange`.
  - `Field.tsx` — label + optional hint + error message wrapper around any input.
  - `Callout.tsx` — info/warning/error banner. Tone: `info | warning | error`.
  - `Tooltip.tsx` — simple hover tooltip via CSS `:hover` + `::after` or a portal. Props: `content`, `children`.
  - `EmptyState.tsx` — centered icon + heading + body + optional action button.
  - `Sparkline.tsx` — inline mini polyline SVG. Props: `data` (number[]), `color`, `width`, `height`.
  - `Skeleton.tsx` — shimmer loading placeholder. Props: `width`, `height`, `radius`. Used for loading states on all pages before data arrives. Animate with a `@keyframes shimmer` CSS animation using a left-to-right gradient sweep on `var(--muted-bg)`.
  - `Kbd.tsx` — `<kbd>` styled span for keyboard shortcuts.
  - `SectionHeader.tsx` — `h2` + optional description + optional right-side action.
  - `PageHeader.tsx` — page title + breadcrumb + right-side actions slot.

- [ ] **Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat: add base UI components (Button, Card, DataTable, Drawer, Modal, etc.)"
```

---

## Task 6: Custom charts (pure SVG)

**Files:** `apps/web/src/components/charts/`  
**Design reference:** `design/project/charts.jsx`

- [ ] **Create `BarChart.tsx`**

  Pure SVG. Two modes via `direction` prop (`'vertical' | 'horizontal'`):
  - Vertical: `<rect>` bars from bottom, x-axis labels below, y-axis gridlines.
  - Horizontal: flex-based colored bars with left labels and right value labels.
  Color palette: `['#7B68EE','#FF02F0','#49CCF9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4']`.
  Props: `data: { label: string; value: number; color?: string }[]`, `height`, `showValues?`.

- [ ] **Create `DonutChart.tsx`**

  SVG `<circle>` with `strokeDasharray` / `strokeDashoffset`. Center slot (label + value). Side legend with color swatches. CSS transition on stroke.
  Props: `data: { label: string; value: number; color?: string }[]`, `size` (default 180), `thickness` (default 28).

- [ ] **Create `LineChart.tsx`**

  SVG path with area gradient fill. Compute path from data points scaled to SVG viewBox. X-axis labels (filtered to ~6). Fill gradient from stroke color at 18% → 0%.
  Props: `data: { date: string; value: number }[]`, `color` (default `--accent`), `height`.

- [ ] **Create `ChartEmpty.tsx`**

  Rendered by BarChart/DonutChart/LineChart when `data` is empty or all values are zero. Centered placeholder: gray bar-chart icon (SVG) + "No data available" text in `var(--text-faint)`. Same dimensions as the chart container so layout doesn't shift.

- [ ] **Commit**

```bash
git add apps/web/src/components/charts/
git commit -m "feat: add pure-SVG BarChart, DonutChart, LineChart, ChartEmpty components"
```

---

## Task 7: App layout (Sidebar + TopBar + CommandPalette)

**Files:**
- `apps/web/src/components/layout/AppLayout.tsx`
- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/src/components/layout/TopBar.tsx`
- `apps/web/src/components/layout/CommandPalette.tsx`
- `apps/web/src/App.tsx`

**Design reference:** `design/project/app-shell.jsx`

- [ ] **Create `Sidebar.tsx`**

  Width: 232px expanded, 60px collapsed. Toggle stored in localStorage. Nav items (spec §4): Overview, Tasks, Time Entries, Missing Rates (with amber badge from stats query), Assignee Rates, Spaces, Sync Logs, Settings. Active item styled with `var(--sidebar-active-bg)`. Footer: Avatar + name + email (from localStorage key, or just "Admin") + collapse toggle icon.

- [ ] **Create `TopBar.tsx`**

  Search trigger (Cmd+K badge), global date range `<Select>` (`7d | 30d | 90d`), global space `<Select>` (`All Spaces | Digital Marketing | R&D Apps | Projects`), sync status pill (from syncHealth query), light/dark toggle (toggles `data-theme` on `<html>`), notification bell.

- [ ] **Create `AppLayout.tsx`**

  Renders `<Sidebar>` + `<TopBar>` + `<main>` slot. Responsive to sidebar collapsed state. Page background `var(--page-bg)`.

- [ ] **Create `CommandPalette.tsx`**

  Opens on `Cmd+K` / `Ctrl+K`. Backdrop blur overlay with `fadeIn` + `modalIn` animations. Input with search icon. Results: Navigation section (all 8 routes), Tasks section (first 30 from cache or query), Assignees section. Keyboard nav (↑↓ ↵ Esc). Fuzzy filter by substring match on labels.

- [ ] **Create `App.tsx`**

  React Router setup. `ProtectedRoute` wrapper checks `localStorage.getItem('adminApiKey')`, redirects to `/login` if absent. Routes:

  ```
  /login          → LoginPage (no layout)
  /               → redirect to /overview
  /overview       → OverviewPage (in AppLayout)
  /tasks          → TasksPage (in AppLayout)
  /tasks/:taskId  → TasksPage (in AppLayout, TaskDetailDrawer auto-opens)
  /time-entries   → TimeEntriesPage (in AppLayout)
  /missing-rates  → MissingRatesPage (in AppLayout)
  /assignee-rates → AssigneeRatesPage (in AppLayout)
  /spaces         → SpacesPage (in AppLayout)
  /sync-logs      → SyncLogsPage (in AppLayout)
  /settings       → SettingsPage (in AppLayout)
  ```

  Wrap everything in `<QueryClientProvider>` and `<FilterProvider>`.

- [ ] **Commit**

```bash
git add apps/web/src/components/layout/ apps/web/src/App.tsx apps/web/src/main.tsx
git commit -m "feat: add AppLayout, Sidebar, TopBar, CommandPalette, and router"
```

---

## Task 8: Login page

**File:** `apps/web/src/pages/LoginPage.tsx`

- [ ] **Implement LoginPage**

  Centered card (400px). Gradient logo mark (from `--accent-grad`). Heading "ClickUp Sync" + subheading "Internal dashboard". Password-type input labeled "Admin API Key". "Sign in" button (full width, accent). On submit: stores key in localStorage under `adminApiKey`, redirects to `/overview`. On mount: if key already stored, redirect to `/overview`.

- [ ] **Commit**

```bash
git add apps/web/src/pages/LoginPage.tsx
git commit -m "feat: add LoginPage with localStorage auth"
```

---

## Task 9: Overview page

**File:** `apps/web/src/pages/OverviewPage.tsx`  
**Design reference:** `design/project/pages/overview.jsx`

- [ ] **Implement OverviewPage**

  Data hooks: `useStats()`, `useTasksBySpaceStatus()`, `useTimeEntriesByUser()`, `useTimeEntriesByClient()`, `useTimeEntriesByDepartment()`, `useTimeEntriesBillableSummary()`, `useWebhookEvents({ limit: 7 })`, `useSyncHealth()`, `useSprintPoints()`.

  Layout (match design):
  - 6 KPI MetricCard grid (spec §5 Overview section)
  - Sync health card with animated pulse dots
  - 6 charts in `repeat(auto-fit, minmax(320px, 1fr))` grid
  - Bottom row: webhook activity table (7 rows) + alerts panel
  - Sprint points bar chart

  Sync health indicator: green dot if all spaces Fresh, amber if any Stale, gray if Unknown.  
  Missing Rates KPI card navigates to `/missing-rates` on click.

- [ ] **Commit**

```bash
git add apps/web/src/pages/OverviewPage.tsx
git commit -m "feat: add OverviewPage with KPIs, charts, sync health, and webhook activity"
```

---

## Task 10: Tasks page + TaskDetailDrawer

**Files:**
- `apps/web/src/pages/TasksPage.tsx`
- `apps/web/src/components/TaskDetailDrawer.tsx`

**Design reference:** `design/project/pages/tasks.jsx`

- [ ] **Implement TasksPage**

  Filter bar (debounced 300ms): Search input, Status select, Priority select, Assignee select (populated from tasks data), Type select (Parent/Subtask/All), Archived select. Reset button when any filter active.

  DataTable columns (spec §5 Tasks):
  - Task (with subtask indent via `parentTaskId`, left status-color bar, overdue pill if past due date)
  - Status (StatusBadge)
  - Space (Pill)
  - List / Client (Pill)
  - Assignees (AvatarStack)
  - Dept (Pill)
  - Sprint points, Cost, Updated, Synced

  Row click: navigates to `/tasks/:taskId` which opens TaskDetailDrawer.  
  On `/tasks/:taskId` mount: open drawer with task ID from URL param.

  Data: `useTasks(filters)` with pagination.

- [ ] **Implement TaskDetailDrawer**

  620px wide Drawer with 4 tabs:
  - **Overview:** MetaGrid (task ID, space, list, status, priority, assignees, client, dept, sprint, dates). Time mini-cards (estimate/logged/cost).
  - **Time entries:** List of per-entry cards (avatar + name + date range + hours + cost or "no rate" pill). Fetch from `useTimeEntriesList({ taskId })`.
  - **Raw fields:** Prettified JSON viewer (`<pre>` with monospace font, syntax-highlighted keys).
  - **Sync history:** Timeline list. Each event: colored dot (green success, red fail), timestamp, event type, sync count.

  Header: Task name title + "Sync now" button (calls `useSyncTask`) + "Export CSV" button (client-side from current drawer data).

- [ ] **Commit**

```bash
git add apps/web/src/pages/TasksPage.tsx apps/web/src/components/TaskDetailDrawer.tsx
git commit -m "feat: add TasksPage with filters, sortable table, and TaskDetailDrawer"
```

---

## Task 11: Time Entries page + TimeEntryDrawer

**Files:**
- `apps/web/src/pages/TimeEntriesPage.tsx`
- `apps/web/src/components/TimeEntryDrawer.tsx`

**Design reference:** `design/project/pages/time-entries.jsx`

- [ ] **Implement TimeEntriesPage**

  KPI strip (6 dense MetricCards): Total hours + entry count, Billable hours + %, Non-billable hours, Total cost + avg rate/h, With cost count, Missing rates count (links to /missing-rates).

  Filters: Search (task/assignee), Assignee select, Billable select (All/Billable/Non-billable), Status select (All/COST_CALCULATED/NO_RATE_FOUND), "Missing rate only" Switch.

  DataTable columns (spec §5 Time Entries):
  - ID (monospace, truncated)
  - Task name
  - Assignee (Avatar + name)
  - Start dateTime
  - Duration (bold)
  - Billable (green/gray Pill)
  - Rate ($/h)
  - Cost (bold)
  - Status (StatusBadge: green if COST_CALCULATED, amber if NO_RATE_FOUND)
  - Synced (relative)

  `NO_RATE_FOUND` rows: red left border or background tint.  
  Row click: opens TimeEntryDrawer.  
  Header: Export CSV + "Recalculate costs" (calls admin recalculate endpoint when available, or shows coming-soon toast).

- [ ] **Implement TimeEntryDrawer**

  520px Drawer. Sections:
  - Assignee card: Avatar + name + email + "View Rates" link → navigates to /assignee-rates filtered to this user
  - Time section: start/end/duration/billable fields in MetaGrid
  - Cost calculation panel: green card if COST_CALCULATED showing `Xh × $Y/h = $Z AUD`; amber card if NO_RATE_FOUND with "Add rate" button → navigates to /assignee-rates
  - Description (if present)
  - Sync metadata: time entry ID (monospace), synced at

- [ ] **Commit**

```bash
git add apps/web/src/pages/TimeEntriesPage.tsx apps/web/src/components/TimeEntryDrawer.tsx
git commit -m "feat: add TimeEntriesPage with cost status and TimeEntryDrawer"
```

---

## Task 12: Missing Rates page

**File:** `apps/web/src/pages/MissingRatesPage.tsx`  
**Design reference:** `design/project/pages/missing-rates.jsx`

- [ ] **Implement MissingRatesPage**

  Data: `useMissingRates()` calling `GET /reports/ops/missing-rates`.

  4 KPI dense cards: Affected assignees, Affected entries, Affected hours, Est. uncosted spend.

  Filters: Search by assignee, Severity filter. "Export issues" button (CSV download).

  View toggle (segmented Tabs): "Grouped" | "Triage queue"

  **Grouped view:** Card grid. Each assignee card:
  - Left border: red if high (>10 entries), amber if medium (3-10), gray if low (<3)
  - Avatar + name + email + severity Pill + issue type Pill ("No active rate")
  - 2-col stat grid: entry count, hours, date range
  - Expandable "Show affected tasks (N)" (render list of task IDs as Pill links)
  - Footer: "Add Rate" (accent) + "View Entries" + "View Rates" buttons

  **Triage queue view:** Sorted table list with same data in a denser format.

- [ ] **Commit**

```bash
git add apps/web/src/pages/MissingRatesPage.tsx
git commit -m "feat: add MissingRatesPage with grouped and triage views"
```

---

## Task 13: Assignee Rates page + RateModal

**Files:**
- `apps/web/src/pages/AssigneeRatesPage.tsx`
- `apps/web/src/components/RateModal.tsx`

**Design reference:** `design/project/pages/assignee-rates.jsx`

- [ ] **Implement AssigneeRatesPage**

  Data: `useRates()` calling `GET /admin/rates`.

  4 KPI dense cards: Active rates count, Covered assignees, Avg active rate ($/h), Without rate count (links to /missing-rates).

  Filters: Search by name/email, "Active rates only" Switch.

  Layout: Grouped by assignee (not flat table). Each assignee group:
  - Header: Avatar + name + email + current active rate ($/h, green) + "New rate" Button
  - Rates DataTable below header: From date, To date, Rate ($/h), Status (active = green Pill, historical = gray Pill), Updated (relative), Edit Button

  "New Rate" / Edit → opens RateModal.  
  State management: `selectedRate` and `isModalOpen` useState. On close/save: `queryClient.invalidateQueries(['rates'])`.

- [ ] **Implement RateModal**

  Modal with Fields:
  - Assignee select (pre-populated from existing assignees in rates data, or free-text input if new)
  - Hourly rate input (number) + Currency select (USD default, then AUD/EUR/GBP) side by side
  - Effective from (date input) + Effective to (date input, optional) side by side
  - Blue Callout: "Rates apply in a closed-open interval: `[from, to)`. Leave 'To' empty for an open-ended rate."
  - Amber Callout (conditional): "Warning: this rate overlaps with an existing rate for this assignee."

  Footer: Delete (danger, left, only in edit mode) + Cancel + Save/Create (accent, right).

  On Save: calls `useCreateRate()` or `useUpdateRate()` mutation → invalidates rates query → closes modal.  
  On Delete: confirm via `window.confirm` → calls `useDeleteRate()` → invalidates → closes.

- [ ] **Commit**

```bash
git add apps/web/src/pages/AssigneeRatesPage.tsx apps/web/src/components/RateModal.tsx
git commit -m "feat: add AssigneeRatesPage with grouped view and RateModal CRUD"
```

---

## Task 14: Spaces page

**File:** `apps/web/src/pages/SpacesPage.tsx`  
**Design reference:** `design/project/pages/spaces.jsx`

- [ ] **Implement SpacesPage**

  Data: `useSpaces()` calling `GET /reports/spaces`.

  View toggle (segmented Tabs): "Grid" | "Workload"

  **Grid view:** `repeat(auto-fill, minmax(320px, 1fr))` card grid. Each space Card:
  - Top colored border (cycle through accent palette per spaceId hash)
  - Space initial letter in colored circle + name + ID (monospace) + Pill (synced/paused)
  - 2×2 stat grid: Tasks, Open tasks, Hours logged, Cost AUD
  - Billable progress bar (colored per space)
  - Footer: "View Tasks" Button (navigates to /tasks?spaceId=X) + "Settings" Button (navigates to /settings)

  **Workload view:** Single Card with:
  - Summary header (total hours across all spaces)
  - Stacked proportional bar (one colored segment per space)
  - Legend: color swatch + space name + hours + %
  - Detail DataTable: Space, Tasks, Open, Hours, Cost AUD

- [ ] **Commit**

```bash
git add apps/web/src/pages/SpacesPage.tsx
git commit -m "feat: add SpacesPage with grid and workload views"
```

---

## Task 15: Sync Logs page + drawers

**Files:**
- `apps/web/src/pages/SyncLogsPage.tsx`
- `apps/web/src/components/SyncRunDrawer.tsx`
- `apps/web/src/components/WebhookEventDrawer.tsx`

**Design reference:** `design/project/pages/sync-logs.jsx`

- [ ] **Implement SyncLogsPage**

  Tabs (underline): "Sync Runs (N)" | "Webhook Events (N)"

  **Sync Runs tab:** Data from `useJobLogs()`.
  - 4 KPI cards: Last success (relative), Last failure (relative + error preview), Success rate %, Avg duration
  - DataTable: Status Pill, Run ID (monospace, first 8 chars), Trigger Pill, Started, Duration, Tasks count, Time entries count, Errors (red text if >0), chevron
  - Row click → SyncRunDrawer

  **Webhook Events tab:** Data from `useWebhookEvents()`.
  - 4 KPI cards: Total 24h, Processed count + %, Failed count, Avg latency (estimate from available data)
  - Filters: Search, Status (All/processed/failed), Event type select
  - "Retry all failed" Button (visible only if failed count > 0)
  - DataTable: Status Pill (OK green / fail red), Event Pill (blue), Task ID (monospace), Received (relative), Latency, Attempts (amber Pill if >1), chevron
  - Row click → WebhookEventDrawer
  - Dead-letter items also surfaced here with retry action

- [ ] **Implement SyncRunDrawer**

  620px Drawer. Sections:
  - Run summary MetaGrid (run ID, queue, job name, trigger, started, finished, duration)
  - Counts stat grid (tasks processed, time entries processed, errors)
  - Error message (red `<pre>` code block if present)
  - Dark terminal-style logs panel: black background, monospace, lines prefixed with [INFO]/[WARN]/[ERROR] in green/amber/red

- [ ] **Implement WebhookEventDrawer**

  580px Drawer. Sections:
  - Status Pill + event type Pill
  - MetaGrid (event ID, task ID, received at, processed at, latency)
  - Error message (red Callout if present)
  - Dark JSON payload viewer: black background, monospace, prettified JSON with basic key coloring
  - Footer: "Retry" Button (calls dead-letter retry if applicable) + "Copy payload" Button (clipboard)

- [ ] **Commit**

```bash
git add apps/web/src/pages/SyncLogsPage.tsx apps/web/src/components/SyncRunDrawer.tsx apps/web/src/components/WebhookEventDrawer.tsx
git commit -m "feat: add SyncLogsPage with sync runs + webhook events tabs and detail drawers"
```

---

## Task 16: Settings page

**File:** `apps/web/src/pages/SettingsPage.tsx`  
**Design reference:** `design/project/pages/settings.jsx`

- [ ] **Implement SettingsPage**

  5 tabs (underline): Connection | Sync rules | Scope filters | Members & access | Notifications

  **Connection tab:**
  - Workspace Card: workspace name "Nifty IT" (hardcoded for Phase 5), last sync time from syncHealth, webhook status (green/red Pill from syncHealth data), API token expiry (N/A for now). Buttons: "Test connection" (calls syncHealth endpoint to verify), "Rotate token" (disabled, Phase 6 scope), "Disconnect" (disabled).
  - Webhook Card: endpoint URL (read-only Input from VITE config or hardcoded), subscribed events (blue Pills: taskCreated, taskUpdated, taskDeleted, taskTimeTrackedUpdated), signing secret (password Input, value masked, "Register Webhook" Button calls admin endpoint and shows secret).

  **Sync rules tab:**
  - Sync schedule Card: real-time webhooks Switch (display-only, on), reconciliation schedule Select (display-only), backfill on connect Switch (display-only).
  - Cost calculation Card: currency select (display-only AUD), rate matching select (display-only), auto-recalculate Switch (display-only).
  - Tag-Assignee Map section (new tab or sub-section): DataTable of tag→assignee mappings. "Add mapping" Button → inline form or Modal. Edit/Delete per row. Data from `useTagAssignee()`.

  **Scope filters tab:**
  - Info Callout: "Scope filters control which ClickUp spaces are synced."
  - Synced spaces Card: Switch per space (Digital Marketing, R&D Apps, Projects) — display-only in Phase 5.
  - Status filters Card: excluded statuses as removable Pills + "Add status" dashed Button — display-only.
  - Tag filters Card: "No tag filters set" EmptyState.

  **Members & access tab:**
  - Single member row (the API key holder — display-only "Admin" user).

  **Notifications tab:**
  - Alerts Card: 4 switches — all display-only for Phase 5.
  - Channels Card: Email/Slack/PagerDuty switches — all display-only.

  Note: Only the Tag-Assignee Map section and Webhook registration are functional in Phase 5. All other controls are rendered but non-functional.

- [ ] **Commit**

```bash
git add apps/web/src/pages/SettingsPage.tsx
git commit -m "feat: add SettingsPage with connection, sync rules, scope, and tag-assignee CRUD"
```

---

## Task 17: ServeStaticModule + production build verification

**Files:**
- Modify: `src/app.module.ts`

- [ ] **Step 1: Install @nestjs/serve-static**

```bash
npm install @nestjs/serve-static
```

- [ ] **Step 2: Add ServeStaticModule to AppModule**

In `src/app.module.ts`, add to imports:

```typescript
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

// Inside @Module imports array:
ServeStaticModule.forRoot({
  rootPath: join(__dirname, '..', 'apps/web/dist'),
  exclude: ['/api/(.*)', '/docs(.*)', '/webhooks/(.*)', '/admin/(.*)', '/reports/(.*)'],
}),
```

- [ ] **Step 3: Run production build verification**

```bash
npm run build:web && npm run build
```

Expected: both builds succeed with no errors

- [ ] **Step 4: Smoke test production serving**

```bash
# In one terminal: npm run start:prod
# In browser: http://localhost:3000
```

Expected: React app loads at `/`, API routes still work at `/admin/...` and `/reports/...`

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts package.json package-lock.json
git commit -m "feat: serve React dist via ServeStaticModule in production"
```

---

## Task 18: Full smoke test + definition of done

Run through each definition-of-done item from spec §9 against the live NestJS dev server:

- [ ] `apps/web/` scaffolded and running via `npm run dev:web`
- [ ] Login page functional: key stored, 401 redirect works
- [ ] All 8 pages render with real data from NestJS dev server
- [ ] Cmd+K command palette works (nav, tasks, assignees)
- [ ] Sidebar collapse/expand works; Missing Rates badge shows live count
- [ ] Overview charts render correctly with real data
- [ ] Tasks page: filter bar, sortable table, detail drawer with 4 tabs
- [ ] Time Entries page: filter bar, sortable table, drawer with cost breakdown
- [ ] Missing Rates page: both grouped and triage views
- [ ] Assignee Rates CRUD: add/edit/delete works end-to-end
- [ ] Spaces page: both grid and workload views
- [ ] Sync Logs: sync runs + webhook events tabs, click-to-drawer detail
- [ ] Settings page: connection status and scopes from real data
- [ ] `npm run build:web` produces a valid dist
- [ ] NestJS serves the built app at `/` in production mode

- [ ] **Final commit**

```bash
git add .
git commit -m "feat: Phase 5 complete — React internal app with all pages and production build"
```

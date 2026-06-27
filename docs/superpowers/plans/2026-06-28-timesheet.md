# Timesheet Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-assignee Timesheet view — pick an assignee + date range (7/30/90/custom), see a per-day → per-task breakdown of hours and cost, and export it to a grouped Excel file.

**Architecture:** A read-only `GET /reports/timesheet` endpoint runs one Dhaka-day-bucketed aggregation over `clickup_time_entries` (joined to `clickup_tasks` for task names), then a **pure, separately-tested assembler** (`src/reports/timesheet.assemble.ts`) turns the flat aggregated rows into the weekday-zero-filled, day-unioned, missing-rate-aware response. The web app adds a `TimesheetPage` that renders that response as a grouped table and builds the grouped `.xlsx` from the same data via ExcelJS. No schema change (read-only) → no migration.

**Tech Stack:** NestJS 11, Prisma 7 (`Prisma.sql` raw queries), PostgreSQL, React 19 + Vite, TanStack React Query v5, ExcelJS, Jest + ts-jest.

## Global Constraints

- Node.js `>=22`; NestJS 11; Prisma 7. Do not change dependency versions.
- **Dhaka bucketing:** `start_time` is a UTC-naive `timestamp`. Always label it UTC before converting: `(e.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')`. Emit the timezone literal via `Prisma.raw(\`'Asia/Dhaka'\`)`, exactly as `costTrend` does.
- **Money naming debt:** fields/columns named `*Aud` and `currency='AUD'` actually hold **USD**. Keep the `*Aud` naming for consistency with existing reports; do **not** rename anything here.
- **Missing rates:** never report a `NO_RATE_FOUND` entry's cost as a real `$0`. Cost is `null` at any level where there is no valid-cost entry; surface a `missingRateCount` instead.
- **Auth:** the `/reports/*` controller is covered by the global `AuthGuard`. The timesheet route is readable by any authenticated user (Owner/Admin/Member), matching every other report. No extra role gate.
- **Testing/quality:** run `npm test` (Jest, root config `testRegex: .*\.spec\.ts$`, run in band) and `npm run build` for backend; `npm run build:web` (tsc + Vite) for frontend. **Do not** rely on `npm run lint` — it is broken project-wide (ESLint v10, no flat config).
- Preserve Prettier formatting. Prefer explicit types over `any`.

---

### Task 1: Pure timesheet assembler + unit tests (backend, no DB)

The testable core of the feature. A pure function that takes flat aggregated rows (already Dhaka-day-bucketed by SQL) plus the Dhaka calendar bounds, and produces the grouped, weekday-zero-filled, missing-rate-aware structure. No Prisma, no DB — fast `npm test` coverage.

**Files:**
- Create: `src/reports/timesheet.assemble.ts`
- Test: `src/reports/timesheet.assemble.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (imported by Task 2 service and Task 3/5 frontend types must match this shape):
  - `dhakaDate(instant: Date): string` → `'YYYY-MM-DD'` for the instant in `Asia/Dhaka`.
  - `eachDate(fromDhaka: string, toDhaka: string): string[]` → inclusive ascending list of `'YYYY-MM-DD'`.
  - `assembleTimesheet(rows: TimesheetAggRow[], fromDhaka: string, toDhaka: string): Timesheet`
  - Types `TimesheetAggRow`, `TimesheetTask`, `TimesheetDay`, `Timesheet` (defined below).

- [ ] **Step 1: Write the failing test**

Create `src/reports/timesheet.assemble.spec.ts`:

```ts
import {
  assembleTimesheet,
  dhakaDate,
  eachDate,
  type TimesheetAggRow,
} from './timesheet.assemble';

describe('dhakaDate', () => {
  it('buckets a late-UTC instant into the next Dhaka calendar day', () => {
    // 2026-06-22T20:00:00Z is 2026-06-23 02:00 in Dhaka (UTC+6).
    expect(dhakaDate(new Date('2026-06-22T20:00:00Z'))).toBe('2026-06-23');
  });
  it('keeps a midday-UTC instant on the same Dhaka day', () => {
    expect(dhakaDate(new Date('2026-06-22T06:00:00Z'))).toBe('2026-06-22');
  });
});

describe('eachDate', () => {
  it('returns an inclusive ascending range', () => {
    expect(eachDate('2026-06-22', '2026-06-25')).toEqual([
      '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25',
    ]);
  });
  it('returns a single day when from === to', () => {
    expect(eachDate('2026-06-22', '2026-06-22')).toEqual(['2026-06-22']);
  });
});

describe('assembleTimesheet', () => {
  // Range: Mon 2026-06-22 .. Sun 2026-06-28.
  // Entries on Mon (two tasks), Fri (one task), Sat (one task). Sun empty.
  const rows: TimesheetAggRow[] = [
    { day: '2026-06-22', taskId: 'A', taskName: 'Alpha', hours: 2,   validCostCents: 8000,  entryCount: 1, missingRateCount: 0 },
    { day: '2026-06-22', taskId: 'B', taskName: 'Beta',  hours: 1.5, validCostCents: 0,     entryCount: 1, missingRateCount: 1 },
    { day: '2026-06-26', taskId: 'A', taskName: 'Alpha', hours: 3,   validCostCents: 12000, entryCount: 1, missingRateCount: 0 },
    { day: '2026-06-27', taskId: 'C', taskName: 'Gamma', hours: 4,   validCostCents: 16000, entryCount: 1, missingRateCount: 0 },
  ];
  const ts = assembleTimesheet(rows, '2026-06-22', '2026-06-28');

  it('includes every weekday in range, zero-filled, plus the worked Saturday', () => {
    const dates = ts.days.map((d) => d.date);
    // Mon..Fri (22-26) always present; Sat 27 present because it has entries;
    // Sun 28 absent (empty weekend).
    expect(dates).toEqual([
      '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27',
    ]);
  });

  it('marks weekends and zero-fills empty weekdays', () => {
    const tue = ts.days.find((d) => d.date === '2026-06-23')!;
    expect(tue.weekday).toBe('Tue');
    expect(tue.isWeekend).toBe(false);
    expect(tue.tasks).toEqual([]);
    expect(tue.subtotalHours).toBe(0);
    const sat = ts.days.find((d) => d.date === '2026-06-27')!;
    expect(sat.isWeekend).toBe(true);
  });

  it('sums per-task hours and cost and orders tasks by name', () => {
    const mon = ts.days.find((d) => d.date === '2026-06-22')!;
    expect(mon.tasks.map((t) => t.taskId)).toEqual(['A', 'B']);
    expect(mon.tasks[0]).toMatchObject({ taskId: 'A', hours: 2, costAud: 80 });
    expect(mon.subtotalHours).toBe(3.5);
  });

  it('renders cost as null (not $0) when a task has only missing-rate entries', () => {
    const mon = ts.days.find((d) => d.date === '2026-06-22')!;
    const beta = mon.tasks.find((t) => t.taskId === 'B')!;
    expect(beta.costAud).toBeNull();
    expect(beta.missingRateCount).toBe(1);
    // Day still has a valid-cost task (Alpha), so the day subtotal is a number.
    expect(mon.subtotalCostAud).toBe(80);
    expect(mon.missingRateCount).toBe(1);
  });

  it('computes grand totals across worked days', () => {
    expect(ts.totalHours).toBe(10.5);   // 2 + 1.5 + 3 + 4
    expect(ts.totalCostAud).toBe(360);  // 80 + 0(valid for Beta) + 120 + 160
    expect(ts.missingRateCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- timesheet.assemble`
Expected: FAIL — `Cannot find module './timesheet.assemble'`.

- [ ] **Step 3: Write the implementation**

Create `src/reports/timesheet.assemble.ts`:

```ts
/**
 * Pure assembly for the Timesheet report. The SQL layer (reports.service.ts)
 * does the Dhaka-day bucketing and per-(day,task) aggregation; this module turns
 * those flat rows into the grouped, weekday-zero-filled, missing-rate-aware shape
 * the API returns. Kept pure (no Prisma/DB) so it is unit-tested directly.
 *
 * Money note: `*CostCents`/`*CostAud` are named AUD but hold USD in practice
 * (see the currency-aud-usd-debt note). Naming is kept for consistency.
 */

/** One aggregated (Dhaka-day, task) row coming out of the SQL query. */
export interface TimesheetAggRow {
  day: string;            // 'YYYY-MM-DD' Dhaka calendar date
  taskId: string;
  taskName: string | null;
  hours: number;
  /** Sum of cost_cents over entries that are NOT NO_RATE_FOUND. */
  validCostCents: number;
  /** Total entries in this (day, task) bucket. */
  entryCount: number;
  /** Count of NO_RATE_FOUND entries in this bucket. */
  missingRateCount: number;
}

export interface TimesheetTask {
  taskId: string;
  taskName: string | null;
  hours: number;
  /** Dollars, or null when the task has no valid-cost entry (all missing). */
  costAud: number | null;
  entryCount: number;
  missingRateCount: number;
}

export interface TimesheetDay {
  date: string;           // 'YYYY-MM-DD'
  weekday: string;        // 'Mon'..'Sun'
  isWeekend: boolean;
  tasks: TimesheetTask[];
  subtotalHours: number;
  subtotalCostAud: number | null;
  missingRateCount: number;
}

export interface Timesheet {
  days: TimesheetDay[];
  totalHours: number;
  totalCostAud: number | null;
  missingRateCount: number;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dhaka calendar date ('YYYY-MM-DD') of a UTC instant. en-CA formats as ISO date. */
export function dhakaDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Inclusive ascending list of 'YYYY-MM-DD' dates. Iterated in UTC (no DST drift). */
export function eachDate(fromDhaka: string, toDhaka: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${fromDhaka}T00:00:00Z`);
  const end = Date.parse(`${toDhaka}T00:00:00Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

function weekdayOf(date: string): { weekday: string; isWeekend: boolean } {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return { weekday: WEEKDAY[dow], isWeekend: dow === 0 || dow === 6 };
}

/**
 * Uniform cost rule applied at task/day/grand level: cost is null when there is
 * no valid-cost entry (every entry was NO_RATE_FOUND), otherwise the summed
 * valid cost in dollars. This avoids a misleading real $0 against logged hours.
 */
function cost(validCostCents: number, entryCount: number, missingRateCount: number): number | null {
  const hasValidCostEntry = entryCount - missingRateCount > 0;
  return hasValidCostEntry ? validCostCents / 100 : null;
}

export function assembleTimesheet(
  rows: TimesheetAggRow[],
  fromDhaka: string,
  toDhaka: string,
): Timesheet {
  // Group rows by Dhaka day.
  const byDay = new Map<string, TimesheetAggRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }

  // Day set = weekday skeleton ∪ any day that has entries (so worked weekends and
  // any boundary day an entry buckets into are included).
  const dayset = new Set<string>();
  for (const d of eachDate(fromDhaka, toDhaka)) {
    if (!weekdayOf(d).isWeekend) dayset.add(d);
  }
  for (const d of byDay.keys()) dayset.add(d);
  const orderedDays = [...dayset].sort();

  let totalHours = 0;
  let totalValidCostCents = 0;
  let totalEntryCount = 0;
  let totalMissing = 0;

  const days: TimesheetDay[] = orderedDays.map((date) => {
    const { weekday, isWeekend } = weekdayOf(date);
    const dayRows = (byDay.get(date) ?? [])
      .slice()
      .sort((a, b) => (a.taskName ?? '').localeCompare(b.taskName ?? '') || a.taskId.localeCompare(b.taskId));

    let subtotalHours = 0;
    let subtotalValidCostCents = 0;
    let dayEntryCount = 0;
    let dayMissing = 0;

    const tasks: TimesheetTask[] = dayRows.map((r) => {
      subtotalHours += r.hours;
      subtotalValidCostCents += r.validCostCents;
      dayEntryCount += r.entryCount;
      dayMissing += r.missingRateCount;
      return {
        taskId: r.taskId,
        taskName: r.taskName,
        hours: r.hours,
        costAud: cost(r.validCostCents, r.entryCount, r.missingRateCount),
        entryCount: r.entryCount,
        missingRateCount: r.missingRateCount,
      };
    });

    totalHours += subtotalHours;
    totalValidCostCents += subtotalValidCostCents;
    totalEntryCount += dayEntryCount;
    totalMissing += dayMissing;

    return {
      date,
      weekday,
      isWeekend,
      tasks,
      subtotalHours,
      subtotalCostAud: cost(subtotalValidCostCents, dayEntryCount, dayMissing),
      missingRateCount: dayMissing,
    };
  });

  return {
    days,
    totalHours,
    totalCostAud: cost(totalValidCostCents, totalEntryCount, totalMissing),
    missingRateCount: totalMissing,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- timesheet.assemble`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/reports/timesheet.assemble.ts src/reports/timesheet.assemble.spec.ts
git commit -m "feat(reports): pure timesheet assembler (skeleton, zero-fill, missing-rate cost)"
```

---

### Task 2: Timesheet SQL query + endpoint (backend)

Wire the assembler to a real Dhaka-day-bucketed aggregation and expose it at `GET /reports/timesheet`. No DB unit test (the reports service has none — it is raw-SQL/DB-bound); correctness of the pure logic is covered by Task 1, and the SQL reuses the proven `costTrend` Dhaka expression. Verified by `npm run build` + a documented manual smoke.

**Files:**
- Modify: `src/reports/reports.service.ts` (add `timesheet` method; reuse existing `parseDate`/`defaultFrom` helpers at top of file)
- Modify: `src/reports/reports.controller.ts` (add route; `BadRequestException` is already imported)

**Interfaces:**
- Consumes (from Task 1): `assembleTimesheet`, `dhakaDate`, `TimesheetAggRow`.
- Produces (Task 3 frontend types must match): `GET /reports/timesheet?userId&from&to` →
  `{ userId: string; userName: string | null; from: string; to: string; days: TimesheetDay[]; totalHours: number; totalCostAud: number | null; missingRateCount: number }`.

- [ ] **Step 1: Add the service method**

In `src/reports/reports.service.ts`, add this import near the top (after the existing imports):

```ts
import { assembleTimesheet, dhakaDate, type TimesheetAggRow } from './timesheet.assemble';
```

Then add this method inside the `ReportsService` class (e.g. right after `timeEntriesAssignees`):

```ts
  /**
   * Single-assignee timesheet: per-Dhaka-day, per-task hours + cost for one user
   * over [from, to]. The SQL buckets by Dhaka day (start_time is UTC-naive — label
   * UTC first, exactly like costTrend) and aggregates per (day, task). The pure
   * `assembleTimesheet` then builds the weekday skeleton, unions worked days, and
   * applies the missing-rate cost rule. cost_cents for NO_RATE_FOUND entries is
   * never summed as valid (see data-model rule).
   */
  async timesheet(userId: string, fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const TZ = Prisma.raw(`'Asia/Dhaka'`);

    type Row = {
      day: string;
      task_id: string;
      task_name: string | null;
      user_name: string | null;
      hours: number;
      valid_cost_cents: bigint;
      entry_count: number;
      missing_rate_count: number;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT to_char((e.start_time AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
             e.task_id                                                         AS task_id,
             MAX(t.task_name)                                                  AS task_name,
             MAX(e.user_name)                                                  AS user_name,
             COALESCE(SUM(e.duration_hours), 0)::float                         AS hours,
             COALESCE(SUM(CASE WHEN e.status <> 'NO_RATE_FOUND' THEN e.cost_cents ELSE 0 END), 0)::bigint AS valid_cost_cents,
             COUNT(*)::int                                                     AS entry_count,
             SUM(CASE WHEN e.status = 'NO_RATE_FOUND' THEN 1 ELSE 0 END)::int  AS missing_rate_count
      FROM clickup_time_entries e
      LEFT JOIN clickup_tasks t ON t.task_id = e.task_id
      WHERE e.user_id = ${userId}
        AND e.start_time IS NOT NULL
        AND e.start_time >= ${from}
        AND e.start_time <= ${to}
      GROUP BY day, e.task_id
      ORDER BY day, task_name
    `);

    const aggRows: TimesheetAggRow[] = rows.map((r) => ({
      day: r.day,
      taskId: r.task_id,
      taskName: r.task_name,
      hours: Number(r.hours),
      validCostCents: Number(r.valid_cost_cents),
      entryCount: Number(r.entry_count),
      missingRateCount: Number(r.missing_rate_count),
    }));

    const sheet = assembleTimesheet(aggRows, dhakaDate(from), dhakaDate(to));
    const userName = rows.find((r) => r.user_name)?.user_name ?? null;

    return {
      userId,
      userName,
      from: from.toISOString(),
      to: to.toISOString(),
      ...sheet,
    };
  }
```

- [ ] **Step 2: Add the controller route**

In `src/reports/reports.controller.ts`, add this route (e.g. right after the `timeEntriesAssignees` route near the top, or alongside the other `time-entries/*` routes):

```ts
  @Get('timesheet')
  @ApiOperation({ summary: 'Single-assignee timesheet: per-day, per-task hours + cost over [from, to]. userId is required; from/to default to the last 30 days.' })
  timesheet(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    return this.reports.timesheet(userId, from, to);
  }
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: PASS (no TypeScript errors).

- [ ] **Step 4: Run the full backend test suite**

Run: `npm test`
Expected: PASS — Task 1's `timesheet.assemble.spec.ts` is green and nothing else regressed.

- [ ] **Step 5: Manual smoke (documented; run if a dev DB + server are available)**

With the dev stack running (`npm run dev:deps`, `npm run start:dev`) and a valid admin key or session, pick a `userId` from `GET /reports/time-entries/assignees` and call:

```bash
curl -s -H "x-admin-key: $ADMIN_API_KEY" \
  "http://127.0.0.1:3002/reports/timesheet?userId=<USER_ID>&from=2026-06-01T00:00:00.000Z&to=2026-06-28T23:59:59.999Z" | head -c 800
```

Expected: JSON with `days[]` (weekdays present even at 0h), `totalHours`, `totalCostAud`. (Backend port is 3002 per the nest-port-wsl-collision note.)

- [ ] **Step 6: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts
git commit -m "feat(reports): GET /reports/timesheet endpoint"
```

---

### Task 3: Frontend API client + React Query hook + types

Expose the endpoint to the web app with typed shapes that mirror Task 2's response.

**Files:**
- Modify: `apps/web/src/api/reports.ts` (add `timesheet` to `reportsApi`)
- Modify: `apps/web/src/hooks/useReports.ts` (add `useTimesheet` + types)

**Interfaces:**
- Consumes: `GET /reports/timesheet` from Task 2.
- Produces (Task 4 + Task 5 consume these): `useTimesheet(params)` and exported types `Timesheet`, `TimesheetDay`, `TimesheetTask`.

- [ ] **Step 1: Add the API method**

In `apps/web/src/api/reports.ts`, add inside the `reportsApi` object (e.g. after `timeEntriesAssignees`):

```ts
  timesheet: (params: { userId: string; from?: string; to?: string }) =>
    apiClient.get('/reports/timesheet', { params }).then(r => r.data),
```

- [ ] **Step 2: Add types + hook**

In `apps/web/src/hooks/useReports.ts`, add (e.g. after the `useTimeEntriesAssignees` hook):

```ts
export interface TimesheetTask {
  taskId: string;
  taskName: string | null;
  hours: number;
  costAud: number | null;
  entryCount: number;
  missingRateCount: number;
}

export interface TimesheetDay {
  date: string;        // 'YYYY-MM-DD'
  weekday: string;     // 'Mon'..'Sun'
  isWeekend: boolean;
  tasks: TimesheetTask[];
  subtotalHours: number;
  subtotalCostAud: number | null;
  missingRateCount: number;
}

export interface Timesheet {
  userId: string;
  userName: string | null;
  from: string;
  to: string;
  days: TimesheetDay[];
  totalHours: number;
  totalCostAud: number | null;
  missingRateCount: number;
}

/**
 * Single-assignee timesheet. `enabled` only fires once an assignee is chosen so
 * the page can show a "select an assignee" empty state without a wasted request.
 */
export function useTimesheet(params: { userId: string; from?: string; to?: string }) {
  return useQuery<Timesheet>({
    queryKey: ['timesheet', params.userId, params.from || null, params.to || null],
    queryFn: () => reportsApi.timesheet(params),
    enabled: !!params.userId,
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 3: Build the web app to verify types compile**

Run: `npm run build:web`
Expected: PASS (tsc + Vite build succeed).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): timesheet API client + useTimesheet hook"
```

---

### Task 4: Grouped Excel export utility

The existing `exportXlsx` writes a flat sheet; the timesheet needs a grouped layout (day header → task rows → day subtotal, repeated, then a grand total). Add a dedicated function rather than overloading the flat helper. Reuse the same ExcelJS lazy-load, accent header styling, and download mechanics.

**Files:**
- Create: `apps/web/src/lib/timesheet-xlsx.ts`

**Interfaces:**
- Consumes (from Task 3): `Timesheet` type.
- Produces (Task 5 consumes): `exportTimesheetXlsx(opts: { assigneeName: string; sheet: Timesheet; includeCost: boolean }): Promise<void>`.

- [ ] **Step 1: Write the implementation**

Create `apps/web/src/lib/timesheet-xlsx.ts`:

```ts
/**
 * Grouped .xlsx export for the Timesheet page. Unlike the flat `exportXlsx`
 * helper, this writes day-grouped rows: a day header row, one row per task under
 * it, a day subtotal row, repeated per day, then a grand-total row.
 *
 * Honors the page's Hide/Show Cost toggle via `includeCost` (cost column dropped
 * when false). Missing-rate cost cells are left blank, never 0.
 */
import type { Timesheet } from '../hooks/useReports';

function stamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const HEADER_FILL = 'FF4F46E5'; // indigo accent, matches xlsx.ts
const DAY_FILL = 'FFEEF2FF';    // light indigo for day header rows
const TOTAL_FILL = 'FFE5E7EB';  // grey for the grand-total row

export async function exportTimesheetXlsx(opts: {
  assigneeName: string;
  sheet: Timesheet;
  includeCost: boolean;
}): Promise<void> {
  const { assigneeName, sheet, includeCost } = opts;

  // CJS/ESM interop, same as xlsx.ts.
  const mod = await import('exceljs');
  const ExcelJS = ((mod as { default?: typeof import('exceljs') }).default ?? mod) as typeof import('exceljs');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Timesheet', { views: [{ state: 'frozen', ySplit: 1 }] });

  // Columns: Date | Task | Hours [| Cost]. Date column doubles as the label
  // column for day headers / subtotals.
  const lastCol = includeCost ? 4 : 3;
  ws.columns = [
    { key: 'c0', width: 16 },                                  // Date / label
    { key: 'c1', width: 48 },                                  // Task
    { key: 'c2', width: 12, style: { numFmt: '#,##0.##' } },   // Hours
    ...(includeCost ? [{ key: 'c3', width: 14, style: { numFmt: '#,##0.00' } }] : []),
  ];

  // Header row.
  const headerCells = includeCost ? ['Date', 'Task', 'Hours', 'Cost'] : ['Date', 'Task', 'Hours'];
  const header = ws.addRow(headerCells);
  header.height = 20;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.alignment = { vertical: 'middle', horizontal: 'left' };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  });

  const fillRow = (rowNumber: number, argb: string) => {
    const row = ws.getRow(rowNumber);
    for (let c = 1; c <= lastCol; c++) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    }
    row.font = { bold: true };
  };

  for (const day of sheet.days) {
    // Day header: "2026-06-22 · Mon" in the Date col, day subtotal in Hours/Cost.
    const dayHeaderVals: (string | number | null)[] = [
      `${day.date} · ${day.weekday}`,
      day.tasks.length ? '' : '(no time logged)',
      day.subtotalHours,
    ];
    if (includeCost) dayHeaderVals.push(day.subtotalCostAud); // null → blank cell
    const dayRow = ws.addRow(dayHeaderVals);
    fillRow(dayRow.number, DAY_FILL);

    // Task rows.
    for (const task of day.tasks) {
      const vals: (string | number | null)[] = ['', task.taskName ?? task.taskId, task.hours];
      if (includeCost) vals.push(task.costAud); // null (missing rate) → blank cell
      ws.addRow(vals);
    }
  }

  // Grand-total row.
  const totalVals: (string | number | null)[] = ['Total', '', sheet.totalHours];
  if (includeCost) totalVals.push(sheet.totalCostAud);
  const totalRow = ws.addRow(totalVals);
  fillRow(totalRow.number, TOTAL_FILL);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = assigneeName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'assignee';
  a.href = url;
  a.download = `timesheet-${safeName}-${stamp(new Date())}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

- [ ] **Step 2: Build the web app to verify it compiles**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/timesheet-xlsx.ts
git commit -m "feat(web): grouped timesheet Excel export"
```

---

### Task 5: Timesheet page + route + nav

The user-facing page: assignee dropdown + Hide/Show Cost toggle, the grouped table, and the export button. Date range comes from the existing topbar global filter (24h/7d/30d/90d/custom), like every other report page.

**Files:**
- Create: `apps/web/src/pages/TimesheetPage.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import + route)
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (nav item)

**Interfaces:**
- Consumes (from Tasks 3/4): `useTimesheet`, `useTimeEntriesAssignees`, `useGlobalFilters`, `exportTimesheetXlsx`, types `Timesheet`/`TimesheetDay`.
- Produces: route `/timesheet`, sidebar entry.

- [ ] **Step 1: Write the page**

Create `apps/web/src/pages/TimesheetPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Download, AlertTriangle } from 'lucide-react';
import { useTimesheet, useTimeEntriesAssignees, type TimesheetDay } from '../hooks/useReports';
import { useGlobalFilters } from '../hooks/useGlobalFilters';
import { exportTimesheetXlsx } from '../lib/timesheet-xlsx';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Switch } from '../components/ui/Switch';
import { MetricCard } from '../components/ui/MetricCard';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { fmt } from '../lib/formatters';

export function TimesheetPage() {
  const { fromDate, toDate, dateRangeLabel } = useGlobalFilters();
  const { data: assignees } = useTimeEntriesAssignees();
  const [userId, setUserId] = useState('');
  const [showCost, setShowCost] = useState(true);

  const assigneeOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Select an assignee…' }];
    for (const a of assignees ?? []) {
      if (!a.id) continue;
      opts.push({ value: a.id, label: a.name ?? a.id });
    }
    return opts;
  }, [assignees]);

  const assigneeName = useMemo(
    () => assignees?.find((a) => a.id === userId)?.name ?? userId,
    [assignees, userId],
  );

  const query = useTimesheet({ userId, from: fromDate || undefined, to: toDate || undefined });
  const sheet = query.data;

  const exportExcel = useMutation({
    mutationFn: async () => {
      if (!sheet) return;
      await exportTimesheetXlsx({ assigneeName: assigneeName || 'assignee', sheet, includeCost: showCost });
    },
  });

  const cost = (v: number | null) =>
    v == null ? <span style={{ color: 'var(--text-faint)' }}>—</span> : fmt.money(v * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PageHeader
        title="Timesheet"
        description="Per-day, per-task tracked time for one assignee."
        actions={
          <Button
            size="md"
            variant="subtle"
            icon={<Download size={13} strokeWidth={1.75} />}
            loading={exportExcel.isPending}
            disabled={!sheet || !sheet.days.length || exportExcel.isPending}
            onClick={() => exportExcel.mutate()}
          >
            Export Excel
          </Button>
        }
      />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        <Select ariaLabel="Select assignee" size="md" options={assigneeOptions} value={userId} onChange={setUserId} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Range: {dateRangeLabel}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <Switch ariaLabel="Show cost column" checked={showCost} onChange={setShowCost} />
          <span>Show cost</span>
        </label>
      </div>

      {!userId ? (
        <EmptyState
          icon={<CalendarClock size={20} strokeWidth={1.75} />}
          title="Select an assignee"
          body="Choose an assignee to see their daily tracked-time breakdown. Use the date range in the top bar to change the window."
        />
      ) : (
        <>
          <QueryError query={query} what="timesheet" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <MetricCard dense label="Total hours" value={fmt.hours(sheet?.totalHours ?? 0)} />
            {showCost && (
              <MetricCard dense label="Total cost" value={sheet?.totalCostAud == null ? '—' : fmt.money((sheet.totalCostAud) * 100)} />
            )}
            {!!sheet?.missingRateCount && (
              <MetricCard
                dense
                label="Missing rates"
                value={fmt.number(sheet.missingRateCount)}
                sublabel="entries without a rate"
                icon={<AlertTriangle size={13} strokeWidth={1.75} />}
              />
            )}
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', background: 'var(--muted-bg)' }}>
                  <th style={{ padding: '8px 12px', width: 200 }}>Date</th>
                  <th style={{ padding: '8px 12px' }}>Task</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', width: 100 }}>Hours</th>
                  {showCost && <th style={{ padding: '8px 12px', textAlign: 'right', width: 120 }}>Cost</th>}
                </tr>
              </thead>
              <tbody>
                {(sheet?.days ?? []).map((day: TimesheetDay) => (
                  <DayRows key={day.date} day={day} showCost={showCost} renderCost={cost} />
                ))}
                {sheet && (
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px' }}>Total</td>
                    <td />
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(sheet.totalHours)}</td>
                    {showCost && <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cost(sheet.totalCostAud)}</td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function DayRows({
  day,
  showCost,
  renderCost,
}: {
  day: TimesheetDay;
  showCost: boolean;
  renderCost: (v: number | null) => React.ReactNode;
}) {
  const muted = day.isWeekend;
  const cols = showCost ? 4 : 3;
  return (
    <>
      <tr style={{ background: muted ? 'var(--muted-bg)' : 'var(--hover-bg, var(--muted-bg))', borderTop: '1px solid var(--border)' }}>
        <td style={{ padding: '8px 12px', fontWeight: 600, color: muted ? 'var(--text-muted)' : 'var(--text)' }}>
          {day.date} · {day.weekday}
          {day.missingRateCount > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--pill-amber-text, var(--text-muted))' }}>
              {day.missingRateCount} missing rate
            </span>
          )}
        </td>
        <td style={{ padding: '8px 12px', color: 'var(--text-faint)' }}>{day.tasks.length ? '' : 'No time logged'}</td>
        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(day.subtotalHours)}</td>
        {showCost && <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{renderCost(day.subtotalCostAud)}</td>}
      </tr>
      {day.tasks.map((t) => (
        <tr key={t.taskId} style={{ borderTop: '1px solid var(--border)' }}>
          <td />
          <td style={{ padding: '6px 12px', paddingLeft: 24 }}>{t.taskName ?? t.taskId}</td>
          <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.hours(t.hours)}</td>
          {showCost && <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{renderCost(t.costAud)}</td>}
        </tr>
      ))}
    </>
  );
}
```

Note (verified): `EmptyState` is `{ title, body?, action?, icon? }` (`apps/web/src/components/ui/EmptyState.tsx`), and `fmt.money(cents)`, `fmt.hours(h)`, `fmt.number(n)` exist in `apps/web/src/lib/formatters.ts` — `fmt.money` takes **cents**, so cost in dollars is `fmt.money(costAud * 100)`, the same convention `TimeEntriesPage` uses.

- [ ] **Step 2: Register the route**

In `apps/web/src/App.tsx`, add the lazy import alongside the others (e.g. after the `TimeEntriesPage` lazy import):

```tsx
const TimesheetPage = React.lazy(() =>
	import('./pages/TimesheetPage').then((m) => ({ default: m.TimesheetPage })),
);
```

And add the route right after the `/time-entries` route:

```tsx
											<Route path="/timesheet" element={<SuspenseRoute><TimesheetPage /></SuspenseRoute>} />
```

- [ ] **Step 3: Add the sidebar nav item**

In `apps/web/src/components/layout/Sidebar.tsx`, add `CalendarClock` to the `lucide-react` import block, then add this nav entry to `navItems` right after the Time Entries entry:

```tsx
    { to: "/timesheet", label: "Timesheet", icon: CalendarClock },
```

- [ ] **Step 4: Build the web app**

Run: `npm run build:web`
Expected: PASS (tsc + Vite build succeed).

- [ ] **Step 5: Manual verification (documented)**

Run the app (`npm run dev:all`), open the web UI, go to **Timesheet**:
- The empty state shows until an assignee is selected.
- Selecting an assignee loads a grouped table: weekdays appear even at 0h; a worked weekend day appears; each day lists per-task hours (and cost); day subtotals + grand total render.
- Toggle **Show cost** off → cost columns disappear.
- Change the top-bar date range (7d/30d/90d/custom) → the table updates.
- Click **Export Excel** → a `timesheet-<name>-YYYY-MM-DD.xlsx` downloads with the grouped layout; with cost hidden, the file has no cost column; missing-rate cells are blank (not 0).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/TimesheetPage.tsx apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(web): Timesheet page, route, and nav entry"
```

---

## Self-Review

**Spec coverage:**
- Single-assignee selection → Task 5 (assignee `Select`, `enabled: !!userId`). ✓
- Date range 7/30/90/custom → reuses topbar `useGlobalFilters` (24h/7d/30d/90d/custom). ✓
- Per-day → per-task rows with hours + cost → Tasks 1/2 (assembler + SQL), Task 5 (table). ✓
- Weekdays zero-filled; weekends only if logged → Task 1 (`dayset` = weekday skeleton ∪ worked days), tested. ✓
- Day subtotals + grand total → Task 1 (subtotals/totals), Task 5 (rendered). ✓
- Hide/Show Cost toggle, export honors it → Task 5 (`showCost`), Task 4 (`includeCost`). ✓
- Excel grouped layout, respects active filters → Task 4 (grouped writer built from loaded `sheet`). ✓
- Missing-rate cost as `—`/blank + count signal → Task 1 (`cost()` null rule + `missingRateCount`), Task 4 (blank cells), Task 5 (`—` + notes). ✓
- Dhaka-day bucketing + boundary union → Task 1 (`dhakaDate`, boundary test), Task 2 (SQL `AT TIME ZONE`). ✓
- Auth = any authenticated user → Task 2 (route on globally-guarded controller, no extra role). ✓

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The only soft note is the `EmptyState` prop confirmation in Task 5 Step 1, with an explicit instruction to match existing usage — not a placeholder for logic.

**Type consistency:** `Timesheet`/`TimesheetDay`/`TimesheetTask` are defined identically in Task 1 (backend) and Task 3 (frontend); the Task 2 response spreads `...sheet` and adds `userId/userName/from/to`, matching Task 3's `Timesheet` interface. `exportTimesheetXlsx({ assigneeName, sheet, includeCost })` (Task 4) is called with exactly those keys in Task 5. `useTimesheet({ userId, from, to })` signature matches between Task 3 and Task 5. ✓

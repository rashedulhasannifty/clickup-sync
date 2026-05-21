# Overview cost-trend chart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ERP-style cost trend chart to the Overview page showing total
labour cost over time with D/W/M granularity and per-client drill-down on
click via a side drawer.

**Architecture:** One new backend endpoint (`GET /reports/time-entries/cost-trend`)
that returns time-bucketed cost aggregates with empty buckets zero-filled via
`generate_series`; the drawer reuses the existing `/reports/time-entries/by-client`
endpoint with a per-bucket date window. Frontend adds two new components
(`CostTrendCard`, `CostBucketDrawer`) and extends the existing `LineChart` to
support click + hover tooltip.

**Tech Stack:** NestJS 11, Prisma 7 (raw SQL via `Prisma.sql`), Postgres, Jest
(backend unit tests), React 19 + tanstack-react-query 5 (frontend).

**Spec:** `docs/superpowers/specs/2026-05-21-overview-cost-trend-design.md` —
read this first. Notable constraints from it:

- Timezone: **`Asia/Dhaka`** (UTC+6, no DST).
- Week shape: **Sunday-start** (Sun → Sat), implemented via the
  `date_trunc('week', t + '1 day') - '1 day'` shift.
- Currency field name stays **`totalCostAud`** in the new endpoint (matches
  existing endpoints — codebase-wide AUD→USD rename is out of scope).
- Drawer **does not filter** $0-cost clients; renders them with an amber
  "no rate" Pill in the Cost column.
- "Topbar override" = `dateRange === 'custom' && customFrom && customTo`.
  Other topbar states (24h / 7d / 30d / 90d) do **not** override the
  bucket-specific default window.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/reports/reports.service.ts` | modify | Add `costTrend(bucket, from, to)` method. |
| `src/reports/reports.controller.ts` | modify | Add `@Get('time-entries/cost-trend')` with enum validation. |
| `test/reports.service.spec.ts` | modify | Add `costTrend` unit tests. |
| `test/reports.controller.spec.ts` | new | Controller-level test for the bucket enum check. |
| `apps/web/src/api/reports.ts` | modify | Add `costTrend` API method. |
| `apps/web/src/hooks/useReports.ts` | modify | Add `useCostTrend` hook + types. |
| `apps/web/src/components/charts/LineChart.tsx` | modify | Add `onPointClick`, hover tooltip, larger interactive markers. |
| `apps/web/src/components/CostBucketDrawer.tsx` | new | Drawer body: per-client table with "no rate" badge + footer total. |
| `apps/web/src/components/charts/CostTrendCard.tsx` | new | Card wrapper: title, D/W/M toggle, chart, owns selected-bucket state, mounts drawer. |
| `apps/web/src/lib/bucketWindow.ts` | new | Tiny pure helper: `bucketWindowUtc(bucket, type)` returns `{from, to}` ISO strings for the drawer's `/time-entries/by-client` call. |
| `apps/web/src/pages/OverviewPage.tsx` | modify | Insert the new card between Sync Health and the charts grid. |

---

## Task 1: Backend — `costTrend` service method (TDD)

**Files:**
- Modify: `src/reports/reports.service.ts` (add new method at end of class, before the closing `}`)
- Test: `test/reports.service.spec.ts` (add new `describe('costTrend', ...)` block after the existing `spaces` describe)

- [ ] **Step 1: Write the failing tests**

Add this block at the end of `test/reports.service.spec.ts`, **before** the
final closing `});` of the outer `describe`:

```ts
  describe('costTrend', () => {
    it('maps raw rows to { bucket, totalCostAud, totalHours, entryCount } and sorts ascending', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { bucket: '2026-05-18', total_cost_cents: BigInt(120000), total_hours: 8,   entry_count: 4 },
        { bucket: '2026-05-19', total_cost_cents: BigInt(0),      total_hours: 0,   entry_count: 0 },
        { bucket: '2026-05-20', total_cost_cents: BigInt(45000),  total_hours: 3.5, entry_count: 2 },
      ]);
      const result = await new ReportsService(prisma).costTrend('day');
      expect(result).toEqual([
        { bucket: '2026-05-18', totalCostAud: 1200, totalHours: 8,   entryCount: 4 },
        { bucket: '2026-05-19', totalCostAud: 0,    totalHours: 0,   entryCount: 0 },
        { bucket: '2026-05-20', totalCostAud: 450,  totalHours: 3.5, entryCount: 2 },
      ]);
    });

    it('throws on invalid bucket value', async () => {
      const prisma = makePrisma();
      await expect(new ReportsService(prisma).costTrend('hour' as any))
        .rejects.toThrow(/bucket/i);
    });

    it("emits SQL containing date_trunc('day', ...) at Asia/Dhaka for bucket=day", async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/date_trunc\('day'/);
      expect(sqlText).toMatch(/Asia\/Dhaka/);
      expect(sqlText).not.toMatch(/Australia\/Sydney/);
    });

    it('emits the Sunday-shift week expression for bucket=week', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('week');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      // The Sunday-start trick: shift +1 day, truncate to ISO week (Monday),
      // shift back -1 day. We assert both halves of the shift are present.
      expect(sqlText).toMatch(/date_trunc\('week'/);
      expect(sqlText).toMatch(/\+ interval '1 day'/);
      expect(sqlText).toMatch(/- interval '1 day'/);
    });

    it("emits date_trunc('month', ...) for bucket=month", async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('month');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/date_trunc\('month'/);
    });

    it('uses generate_series so empty buckets are returned with zeros', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/generate_series/);
      expect(sqlText).toMatch(/LEFT JOIN/i);
    });

    it('filters out soft-deleted tasks', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/t\.is_deleted\s*=\s*false/);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- reports.service`
Expected: 7 failures in the new `costTrend` block (method does not exist).
Pre-existing tests in the file should still pass.

- [ ] **Step 3: Implement `costTrend` on `ReportsService`**

In `src/reports/reports.service.ts`, add this method (it can go at the
bottom of the class, after `spaces()`):

```ts
  /**
   * Time-bucketed cost trend for the Overview page.
   *
   * Buckets in Asia/Dhaka local time (no DST, UTC+6). Week buckets are
   * Sunday-start: Postgres's date_trunc('week', ...) is Monday-based, so we
   * shift +1 day before truncating and shift back -1 day after, which moves
   * the week boundary from Mon→Sun→Mon to Sun→Sat→Sun.
   *
   * Empty buckets are returned with zeros (via generate_series LEFT JOIN)
   * so the chart shows a continuous timeline instead of gaps.
   */
  async costTrend(
    bucket: 'day' | 'week' | 'month',
    fromParam?: string,
    toParam?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new Error(`Invalid bucket "${bucket}" (expected day|week|month)`);
    }

    const from = parseDate(fromParam, defaultFromForBucket(bucket));
    const to = parseDate(toParam, new Date());

    // Build the bucket expression. Applied to `e.start_time AT TIME ZONE 'Asia/Dhaka'`
    // for the aggregate, and to the input range for generate_series.
    const TZ = 'Asia/Dhaka';
    const bucketExpr = (tsLocal: Prisma.Sql): Prisma.Sql => {
      if (bucket === 'day')   return Prisma.sql`date_trunc('day', ${tsLocal})`;
      if (bucket === 'month') return Prisma.sql`date_trunc('month', ${tsLocal})`;
      // Sunday-start week: shift +1d, truncate Mon-based week, shift -1d.
      return Prisma.sql`(date_trunc('week', ${tsLocal} + interval '1 day') - interval '1 day')`;
    };
    const interval =
      bucket === 'day'   ? Prisma.sql`interval '1 day'`   :
      bucket === 'week'  ? Prisma.sql`interval '1 week'`  :
                           Prisma.sql`interval '1 month'`;

    const aggBucket    = bucketExpr(Prisma.sql`(e.start_time AT TIME ZONE ${TZ})`);
    const seriesStart  = bucketExpr(Prisma.sql`(${from}::timestamptz AT TIME ZONE ${TZ})`);
    const seriesEnd    = bucketExpr(Prisma.sql`(${to  }::timestamptz AT TIME ZONE ${TZ})`);

    type Row = {
      bucket: string;
      total_cost_cents: bigint;
      total_hours: number;
      entry_count: number;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH series AS (
        SELECT generate_series(${seriesStart}, ${seriesEnd}, ${interval}) AS bucket_local
      ),
      agg AS (
        SELECT ${aggBucket}                                    AS bucket_local,
               COALESCE(SUM(e.cost_cents), 0)::bigint          AS total_cost_cents,
               COALESCE(SUM(e.duration_hours), 0)::float       AS total_hours,
               COUNT(*)::int                                   AS entry_count
        FROM clickup_time_entries e
        JOIN clickup_tasks t ON e.task_id = t.task_id
        WHERE e.start_time IS NOT NULL
          AND e.start_time >= ${from}
          AND e.start_time <= ${to}
          AND t.is_deleted = false
        GROUP BY 1
      )
      SELECT to_char(s.bucket_local, 'YYYY-MM-DD')             AS bucket,
             COALESCE(a.total_cost_cents, 0)::bigint           AS total_cost_cents,
             COALESCE(a.total_hours, 0)::float                 AS total_hours,
             COALESCE(a.entry_count, 0)::int                   AS entry_count
      FROM series s
      LEFT JOIN agg a ON a.bucket_local = s.bucket_local
      ORDER BY s.bucket_local ASC
    `);

    return rows.map((r) => ({
      bucket: r.bucket,
      totalCostAud: Number(r.total_cost_cents) / 100,
      totalHours: Number(r.total_hours),
      entryCount: Number(r.entry_count),
    }));
  }
```

And add this helper near the top of the file, next to `defaultFrom()`:

```ts
function defaultFromForBucket(bucket: 'day' | 'week' | 'month'): Date {
  const d = new Date();
  if (bucket === 'day')   { d.setDate(d.getDate() - 30); return d; }
  if (bucket === 'week')  { d.setDate(d.getDate() - 7 * 12); return d; }
  // month: 12 months back
  d.setMonth(d.getMonth() - 12);
  return d;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- reports.service`
Expected: all `costTrend` tests pass; pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.service.ts test/reports.service.spec.ts
git commit -m "feat(reports): cost-trend service method with Dhaka-local Sunday-start buckets"
```

---

## Task 2: Backend — controller endpoint + tests

**Files:**
- Modify: `src/reports/reports.controller.ts` (add new endpoint between `time-entries/aggregates` and `time-entries`)
- Test: `test/reports.controller.spec.ts` (new file — controller-only unit test)

- [ ] **Step 1: Write the failing controller test**

Create `test/reports.controller.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { ReportsController } from '../src/reports/reports.controller';

describe('ReportsController', () => {
  function makeService() {
    return {
      costTrend: jest.fn().mockResolvedValue([]),
    } as any;
  }

  describe('costTrend', () => {
    it('passes bucket + from + to through to the service for valid bucket', async () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc);
      await ctrl.costTrend('day', '2026-05-01', '2026-05-21');
      expect(svc.costTrend).toHaveBeenCalledWith('day', '2026-05-01', '2026-05-21');
    });

    it('rejects bucket="hour" with BadRequestException', async () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc);
      await expect(ctrl.costTrend('hour' as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(svc.costTrend).not.toHaveBeenCalled();
    });

    it('rejects missing bucket', async () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc);
      await expect(ctrl.costTrend(undefined as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['day', 'week', 'month'] as const)('accepts bucket=%s', async (b) => {
      const svc = makeService();
      const ctrl = new ReportsController(svc);
      await ctrl.costTrend(b);
      expect(svc.costTrend).toHaveBeenCalledWith(b, undefined, undefined);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- reports.controller`
Expected: tests fail because `ReportsController` has no `costTrend` method
yet.

- [ ] **Step 3: Add the controller endpoint**

In `src/reports/reports.controller.ts`, add this import at the top (extend
the existing `@nestjs/common` import):

```ts
import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
```

Then add this method in the controller, immediately **after** `timeEntriesAggregates(...)`
and **before** `timeEntriesList(...)` (so the route order is consistent with
the file's flow):

```ts
  @Get('time-entries/cost-trend')
  @ApiOperation({ summary: 'Time-bucketed cost trend for the Overview chart. bucket=day|week|month; defaults vary by bucket if from/to are omitted.' })
  costTrend(
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new BadRequestException(`Invalid bucket "${bucket ?? ''}" (expected day|week|month)`);
    }
    return this.reports.costTrend(bucket, from, to);
  }
```

- [ ] **Step 4: Run controller + service tests**

Run: `npm run test -- reports`
Expected: both `reports.controller.spec.ts` and `reports.service.spec.ts`
pass entirely.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.controller.ts test/reports.controller.spec.ts
git commit -m "feat(reports): expose /reports/time-entries/cost-trend with bucket enum validation"
```

---

## Task 3: Frontend — API method + react-query hook

**Files:**
- Modify: `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/hooks/useReports.ts`

No frontend test framework exists in `apps/web` — these are wiring-only
files. Verification is via the manual checklist in Task 7.

- [ ] **Step 1: Add the API client method**

In `apps/web/src/api/reports.ts`, add this entry to the `reportsApi` object
(place it next to `timeEntriesByClient`):

```ts
  costTrend: (params: { bucket: 'day' | 'week' | 'month'; from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/cost-trend', { params }).then(r => r.data),
```

- [ ] **Step 2: Add the `useCostTrend` hook**

In `apps/web/src/hooks/useReports.ts`, add this near the other
`useTimeEntries*` hooks:

```ts
export interface CostTrendPoint {
  bucket: string;        // 'YYYY-MM-DD'
  totalCostAud: number;  // dollars
  totalHours: number;
  entryCount: number;
}

export function useCostTrend(
  bucket: 'day' | 'week' | 'month',
  from?: string,
  to?: string,
) {
  return useQuery<CostTrendPoint[]>({
    queryKey: ['cost-trend', bucket, from ?? null, to ?? null],
    queryFn: () => reportsApi.costTrend({ bucket, from, to }),
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): cost-trend API client + useCostTrend hook"
```

---

## Task 4: Frontend — extend `LineChart` with click + hover tooltip

The existing `LineChart` is render-only with `<title>` tooltips. The trend
card needs (a) click on a point, (b) a proper hover tooltip, (c) larger
markers so the click target is reachable. The existing call sites pass
no `onPointClick` so they're unaffected.

**Files:**
- Modify: `apps/web/src/components/charts/LineChart.tsx`

- [ ] **Step 1: Replace the file with the extended version**

Replace the entire contents of
`apps/web/src/components/charts/LineChart.tsx` with:

```tsx
import { useState } from 'react';
import { ChartEmpty } from './ChartEmpty';

interface LineData {
  label?: string;
  date?: string;
  value: number;
  /** Free-form payload passed back to the click handler. Useful when `date`/`label` aren't enough to identify the point (e.g. carry the bucket key). */
  key?: string;
}

interface LineChartProps {
  data: LineData[];
  color?: string;
  height?: number;
  /** Called when the user clicks a point. Receives the full LineData. */
  onPointClick?: (d: LineData, index: number) => void;
  /** Custom tooltip body. Default shows label/date + value. */
  renderTooltip?: (d: LineData) => React.ReactNode;
}

export function LineChart({
  data,
  color = 'var(--accent)',
  height = 160,
  onPointClick,
  renderTooltip,
}: LineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length < 2) return <ChartEmpty height={height} />;

  const max = Math.max(...data.map(d => d.value));
  const min = Math.min(...data.map(d => d.value));
  const range = max - min || 1;
  const w = 100;
  const padY = 8;
  const step = w / (data.length - 1);
  const points = data.map((d, i) => [i * step, height - padY - ((d.value - min) / range) * (height - padY * 2)] as [number, number]);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const area = `${path} L ${w} ${height} L 0 ${height} Z`;
  const gradId = `lg-${data.length}-${Math.round(height)}`;
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  const labelItems = data.filter((_, i) => i % labelStep === 0);

  // Tooltip position: the hovered point in viewBox coords (0..100, 0..height).
  // We render an absolutely-positioned div on top of the SVG using percent x
  // and pixel y, so it scales with the SVG width.
  const hovered = hoverIdx != null ? data[hoverIdx] : null;
  const hoveredPt = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const isHover = hoverIdx === i;
          return (
            <g key={i}>
              {/* Larger invisible hit target so taps/clicks land reliably */}
              <circle
                cx={p[0]}
                cy={p[1]}
                r="4"
                fill="transparent"
                style={{ cursor: onPointClick ? 'pointer' : 'default' }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => onPointClick?.(data[i], i)}
              />
              <circle
                cx={p[0]}
                cy={p[1]}
                r={isHover ? '2.4' : '1.4'}
                fill={color}
                style={{ transition: 'r 120ms ease-out', pointerEvents: 'none' }}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hoveredPt && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: `${(hoveredPt[0] / w) * 100}%`,
            top: hoveredPt[1] - 6,
            transform: 'translate(-50%, -100%)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 6px 16px rgba(15,23,42,0.08)',
            padding: '6px 10px',
            fontSize: 11,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          {renderTooltip ? renderTooltip(hovered) : (
            <>
              <div style={{ fontWeight: 600 }}>{hovered.label ?? hovered.date}</div>
              <div style={{ color: 'var(--text-muted)' }}>{hovered.value}</div>
            </>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>
        {labelItems.map((d, i) => (
          <span key={i}>{d.label ?? (d.date ? new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')}</span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the existing callers still compile**

Search the web app for `LineChart` usage:

Run: `grep -rn "LineChart" apps/web/src` (or `Grep` tool with pattern `LineChart`).
Expected: existing usage doesn't pass `onPointClick` / `renderTooltip` —
both are optional, so it compiles unchanged.

Run: `npm --prefix apps/web run lint`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/charts/LineChart.tsx
git commit -m "feat(web): LineChart supports onPointClick + hover tooltip"
```

---

## Task 5: Frontend — `bucketWindowUtc` helper

The drawer needs to fetch `/reports/time-entries/by-client?from=...&to=...`
for the *clicked bucket's BD-local window* in UTC ISO. The existing
endpoint uses `start_time >= from AND start_time <= to` (closed-closed
range), so the helper subtracts 1 ms from the exclusive end to avoid
double-counting at the boundary.

**Files:**
- Create: `apps/web/src/lib/bucketWindow.ts`

- [ ] **Step 1: Create the helper**

Create `apps/web/src/lib/bucketWindow.ts`:

```ts
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no DST.

/**
 * Convert a bucket key (e.g. '2026-05-21' as BD-local bucket start) to the
 * UTC ISO window that contains all time entries falling in that bucket.
 *
 * - day:   [bucketStart, bucketStart + 1 day)
 * - week:  [bucketStart, bucketStart + 7 days)  (Sunday-start week)
 * - month: [bucketStart, first day of next month)
 *
 * Returns `from` inclusive and `to` inclusive-of-last-ms so the existing
 * `/time-entries/by-client?from=…&to=…` endpoint (closed-closed) yields the
 * correct set without crossing into the next bucket.
 */
export function bucketWindowUtc(
  bucket: string,
  bucketType: 'day' | 'week' | 'month',
): { from: string; to: string } {
  const [yStr, mStr, dStr] = bucket.split('-');
  const y = Number(yStr);
  const m = Number(mStr); // 1-indexed
  const d = Number(dStr);
  if (!y || !m || !d) {
    throw new Error(`bucketWindowUtc: invalid bucket "${bucket}"`);
  }

  // Midnight BD local in UTC ms.
  const startUtcMs = Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;

  let endExclusiveUtcMs: number;
  if (bucketType === 'day') {
    endExclusiveUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  } else if (bucketType === 'week') {
    endExclusiveUtcMs = startUtcMs + 7 * 24 * 60 * 60 * 1000;
  } else {
    // month: end = first day of next month at midnight BD local.
    endExclusiveUtcMs = Date.UTC(y, m, 1) - DHAKA_OFFSET_MS;
  }

  return {
    from: new Date(startUtcMs).toISOString(),
    to: new Date(endExclusiveUtcMs - 1).toISOString(),
  };
}

/**
 * Human-readable label for a bucket, e.g. for a drawer title.
 * - day:   'Tuesday, May 21, 2026'
 * - week:  'Week of May 17 – May 23, 2026'
 * - month: 'May 2026'
 */
export function bucketLabel(bucket: string, bucketType: 'day' | 'week' | 'month'): string {
  const [yStr, mStr, dStr] = bucket.split('-');
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const d = Number(dStr);
  const start = new Date(Date.UTC(y, m, d));
  const fmtDay = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const fmtMon = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const fmtMonth = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });

  if (bucketType === 'day') return fmtDay.format(start);
  if (bucketType === 'month') return fmtMonth.format(start);
  // week: Sunday start, Saturday end
  const end = new Date(Date.UTC(y, m, d + 6));
  return `Week of ${fmtMon.format(start)} – ${fmtMon.format(end)}, ${y}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/bucketWindow.ts
git commit -m "feat(web): bucketWindowUtc + bucketLabel helpers for cost-trend drawer"
```

---

## Task 6: Frontend — `CostBucketDrawer` component

The drawer body. Uses the existing `Drawer`, `Pill`, and the existing
`useTimeEntriesByClient`-style fetch (but with a per-bucket window — so we
call the API directly with a dedicated query key, not via the existing
hook).

**Files:**
- Create: `apps/web/src/components/CostBucketDrawer.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/CostBucketDrawer.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api/reports';
import { Drawer } from './ui/Drawer';
import { Pill } from './ui/Pill';
import { fmt } from '../lib/formatters';
import { bucketWindowUtc, bucketLabel } from '../lib/bucketWindow';

interface CostBucketDrawerProps {
  open: boolean;
  bucket: string | null;                    // 'YYYY-MM-DD' or null when closed
  bucketType: 'day' | 'week' | 'month';
  onClose: () => void;
}

interface ClientRow { client: string; totalHours: number; totalCostAud: number; }

function moneyAud(dollars: number) { return fmt.money(Math.round(dollars * 100)); }

export function CostBucketDrawer({ open, bucket, bucketType, onClose }: CostBucketDrawerProps) {
  const navigate = useNavigate();

  // Compute the window unconditionally when we have a bucket, so the
  // react-query key is stable per bucket+type pair.
  const window = bucket ? bucketWindowUtc(bucket, bucketType) : null;

  const q = useQuery<ClientRow[]>({
    queryKey: ['cost-trend-drawer', bucketType, bucket],
    queryFn: () => reportsApi.timeEntriesByClient({ from: window!.from, to: window!.to }),
    enabled: open && !!bucket,
  });

  const rows = (q.data ?? []).slice().sort((a, b) => {
    if (b.totalCostAud !== a.totalCostAud) return b.totalCostAud - a.totalCostAud;
    return b.totalHours - a.totalHours;
  });
  const footerTotal = rows.reduce((s, r) => s + r.totalCostAud, 0);

  const title = bucket ? `Cost by client — ${bucketLabel(bucket, bucketType)}` : 'Cost by client';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      width={560}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Total</span>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{moneyAud(footerTotal)}</span>
        </div>
      }
    >
      <div style={{ flex: 1, overflow: 'auto' }}>
        {q.isLoading && (
          <div style={{ padding: 16 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ height: 32, background: 'var(--muted-bg)', borderRadius: 6, marginBottom: 8, opacity: 0.6 }} />
            ))}
          </div>
        )}
        {q.isError && (
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>
              Couldn't load this bucket's breakdown.
            </div>
            <button
              type="button"
              onClick={() => q.refetch()}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                background: 'var(--surface)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}
        {!q.isLoading && !q.isError && rows.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            No time entries logged in this period.
          </div>
        )}
        {!q.isLoading && !q.isError && rows.length > 0 && (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                {['Client', 'Hours', 'Cost'].map((h, i) => (
                  <th key={h} style={{
                    padding: '8px 14px', textAlign: i === 0 ? 'left' : 'right',
                    fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--muted-bg)',
                    position: 'sticky', top: 0,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const noRate = r.totalCostAud === 0;
                return (
                  <tr
                    key={r.client}
                    onClick={() => {
                      if (!window) return;
                      navigate(`/time-entries?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}&search=${encodeURIComponent(r.client)}`);
                    }}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-soft)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '8px 14px', color: 'var(--text)' }}>{r.client}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                      {fmt.hours(r.totalHours)}
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {noRate
                        ? <Pill tone="amber">no rate</Pill>
                        : <span style={{ color: 'var(--text)', fontWeight: 500 }}>{moneyAud(r.totalCostAud)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm --prefix apps/web run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/CostBucketDrawer.tsx
git commit -m "feat(web): CostBucketDrawer with per-client table + no-rate badge"
```

---

## Task 7: Frontend — `CostTrendCard` component + Overview wiring

The card owns the D/W/M toggle, the resolved date window, the chart, and
the drawer state. It's the only piece that touches `OverviewPage`.

**Files:**
- Create: `apps/web/src/components/charts/CostTrendCard.tsx`
- Modify: `apps/web/src/pages/OverviewPage.tsx`

- [ ] **Step 1: Create `CostTrendCard`**

Create `apps/web/src/components/charts/CostTrendCard.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { LineChart } from './LineChart';
import { useCostTrend } from '../../hooks/useReports';
import type { CostTrendPoint } from '../../hooks/useReports';
import { useGlobalFilters } from '../../hooks/useGlobalFilters';
import { CostBucketDrawer } from '../CostBucketDrawer';
import { fmt } from '../../lib/formatters';

type Bucket = 'day' | 'week' | 'month';

const BUCKET_DEFAULTS_DAYS: Record<Bucket, number> = { day: 30, week: 7 * 12, month: 365 };

function moneyAud(dollars: number) { return fmt.money(Math.round(dollars * 100)); }

function defaultRangeForBucket(bucket: Bucket): { from: string; to: string } {
  // Rolling window to now. Month uses ~365d back, which generally produces
  // 12-13 monthly buckets — good enough; bucketing happens server-side.
  const to = new Date();
  const from = new Date();
  if (bucket === 'month') from.setMonth(from.getMonth() - 12);
  else from.setDate(from.getDate() - BUCKET_DEFAULTS_DAYS[bucket]);
  return { from: from.toISOString(), to: to.toISOString() };
}

function shortBucketLabel(p: CostTrendPoint, bucket: Bucket): string {
  const [y, m, d] = p.bucket.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (bucket === 'month') return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (bucket === 'week')  return `Wk of ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function windowDescription(bucket: Bucket, customActive: boolean): string {
  if (customActive) return 'custom range';
  if (bucket === 'day')   return 'last 30 days';
  if (bucket === 'week')  return 'last 12 weeks';
  return 'last 12 months';
}

export function CostTrendCard() {
  const [bucket, setBucket] = useState<Bucket>('day');
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  // Topbar override = explicit custom range. Other presets (7d/30d/90d)
  // intentionally don't override the bucket-specific default because they
  // produce too few bars for a meaningful trend (e.g. M view on a 7d
  // window would show 1 bar).
  const { dateRange, customFrom, customTo } = useGlobalFilters();
  const useTopbar = dateRange === 'custom' && !!customFrom && !!customTo;

  const range = useMemo(() => {
    if (useTopbar) {
      return { from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString() };
    }
    return defaultRangeForBucket(bucket);
  }, [bucket, useTopbar, customFrom, customTo]);

  const q = useCostTrend(bucket, range.from, range.to);
  const data = q.data ?? [];

  // Map to LineChart's data shape. The `key` carries the bucket string so we
  // can resolve clicks back to the drawer window.
  const chartData = data.map(p => ({
    label: shortBucketLabel(p, bucket),
    value: p.totalCostAud,
    key: p.bucket,
  }));

  const hasAnySpend = data.some(p => p.totalCostAud > 0);

  return (
    <>
      <Card
        title="Client cost trend"
        subtitle={`${bucket === 'day' ? 'Daily' : bucket === 'week' ? 'Weekly' : 'Monthly'} — ${windowDescription(bucket, useTopbar)}${!hasAnySpend && !q.isLoading ? ' · no spend in this period' : ''}`}
        padding={16}
        action={
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            {(['day', 'week', 'month'] as const).map((b) => {
              const active = bucket === b;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBucket(b)}
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 600,
                    background: active ? 'var(--accent)' : 'var(--surface)',
                    color: active ? 'var(--accent-foreground, white)' : 'var(--text-muted)',
                    border: 0, cursor: 'pointer',
                    borderLeft: b === 'day' ? 0 : '1px solid var(--border)',
                  }}
                  aria-pressed={active}
                  aria-label={`Switch to ${b}ly granularity`}
                >
                  {b === 'day' ? 'D' : b === 'week' ? 'W' : 'M'}
                </button>
              );
            })}
          </div>
        }
      >
        {q.isError ? (
          <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 0' }}>
            Couldn't load cost trend.
          </div>
        ) : (
          <LineChart
            data={chartData}
            height={200}
            onPointClick={(d) => d.key && setSelectedBucket(d.key)}
            renderTooltip={(d) => {
              const point = data.find(p => p.bucket === d.key);
              return (
                <>
                  <div style={{ fontWeight: 600 }}>{d.label}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{moneyAud(d.value)}</div>
                  {point && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                      {fmt.hours(point.totalHours)} · {point.entryCount} entr{point.entryCount === 1 ? 'y' : 'ies'}
                    </div>
                  )}
                </>
              );
            }}
          />
        )}
      </Card>
      <CostBucketDrawer
        open={!!selectedBucket}
        bucket={selectedBucket}
        bucketType={bucket}
        onClose={() => setSelectedBucket(null)}
      />
    </>
  );
}
```

- [ ] **Step 2: Insert the card on `OverviewPage`**

In `apps/web/src/pages/OverviewPage.tsx`, add this import alongside the
other chart imports near the top of the file:

```tsx
import { CostTrendCard } from '../components/charts/CostTrendCard';
```

Then find the existing `{/* Charts Grid */}` block (it currently starts
with the `<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>`).
Immediately **before** that `{/* Charts Grid */}` comment line, insert:

```tsx
      {/* Cost trend */}
      <CostTrendCard />

```

That places the new card after Sync Health and before the existing charts
grid, full-width on its own row.

- [ ] **Step 3: Build and lint**

Run: `npm --prefix apps/web run lint && npm --prefix apps/web run build`
Expected: both pass.

- [ ] **Step 4: Manual verification** (no FE test framework — check by hand)

Start the backend + web in dev mode (in two terminals if needed):

```bash
npm run dev:deps
npm run start:dev
npm --prefix apps/web run dev
```

Open the dashboard and confirm each checkbox below. Tick as you go:

- [ ] The "Client cost trend" card appears between **Sync Health** and the
      existing 2-column charts grid, full-width on its own row.
- [ ] D / W / M toggle switches the data and the subtitle ("Daily — last
      30 days" / "Weekly — last 12 weeks" / "Monthly — last 12 months").
- [ ] Setting a **custom** topbar range (date picker → custom) updates the
      subtitle to "… — custom range" and refetches.
- [ ] Hovering a point shows the tooltip with formatted money + hours +
      entry count.
- [ ] Clicking a point opens the right-side drawer with title "Cost by
      client — <bucket label>".
- [ ] Drawer rows are sorted by cost desc; rows with `$0` cost show an
      amber "no rate" Pill in the Cost column (verifiable for any bucket
      where a client has `NO_RATE_FOUND` entries — visible on the
      `/missing-rates` page).
- [ ] Drawer footer "Total" equals the clicked point's value.
- [ ] Clicking a drawer row navigates to
      `/time-entries?from=…&to=…&search=<client>` and the Time Entries
      page reflects that filter.
- [ ] Hovering a *weekly* point in late May 2026: the bucket label starts
      with "Sun" (Sunday-start week boundary).
- [ ] An empty bucket in the middle of the window renders as a 0 point
      (continuous line, no gap).
- [ ] Stop the backend → reload the page → the trend area shows
      "Couldn't load cost trend." inline; rest of Overview still renders.
- [ ] Closing the drawer with `Esc` returns focus to the trend chart
      area (existing `Drawer` a11y still works).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/charts/CostTrendCard.tsx apps/web/src/pages/OverviewPage.tsx
git commit -m "feat(web): Overview cost-trend card with D/W/M toggle + drill-down drawer"
```

---

## Final sweep

- [ ] **Run the full backend test suite:** `npm run test`
- [ ] **Run lint + build:** `npm run lint && npm run build && npm --prefix apps/web run lint && npm --prefix apps/web run build`
- [ ] All steps above committed (`git status` clean).

---

## Self-review notes (for the executing agent)

1. **No FE tests.** `apps/web` has no test framework; the manual checklist
   in Task 7 is the verification gate. Do not skip it.
2. **Currency naming.** The new field is `totalCostAud` on purpose — read
   the spec's "Currency note (known debt)" section before objecting.
3. **`Prisma.sql` composition.** Task 1's SQL composes nested `Prisma.sql`
   fragments via parameterised interpolation. Do **not** switch to string
   concatenation — it would defeat the bind-parameter safety and the
   `bucket` value is the only string assembled into SQL, and that's done
   after an enum check (controller) + a defensive re-check (service).
4. **Sunday-start week trick.** If you ever need to debug whether the
   shift works: `date_trunc('week', '2026-05-24'::timestamp + interval '1 day') - interval '1 day'`
   should equal `2026-05-24` (a Sunday). Mon-based default would give
   `2026-05-18`.
5. **Drawer reuses an existing endpoint.** Do not add a second cost-by-client
   endpoint. The bucket window from `bucketWindowUtc` already aligns with
   the existing endpoint's closed-closed range semantics.

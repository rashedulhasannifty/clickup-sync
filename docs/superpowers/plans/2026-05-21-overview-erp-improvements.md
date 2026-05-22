# Overview ERP improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three ERP-style additions to the Overview page: period-over-period deltas on KPI cards + trend total, forecast dashed-tail on the trend chart, and a new Anomalies panel surfacing spend spikes.

**Architecture:** Two new backend endpoints (`/reports/overview-deltas`, `/reports/anomalies`) + one frontend-only feature (forecast tail extends the existing `LineChart`). Three new frontend components (`Delta`, `AnomaliesPanel`) plus extensions to `MetricCard`, `LineChart`, `OverviewPage`, `CostTrendCard`.

**Tech Stack:** NestJS 11, Prisma 7 (raw SQL via `Prisma.sql`), Postgres (`percentile_cont` for medians), Jest (backend), React 19 + tanstack-react-query 5 (frontend).

**Spec:** `docs/superpowers/specs/2026-05-21-overview-erp-improvements-design.md` — read this first. Notable constraints:

- Timezone everywhere: **`Asia/Dhaka`** (UTC+6, no DST).
- Week shape (used by the client-spike baseline): Sunday-start via the `+1d / date_trunc('week') / -1d` shift.
- Currency field naming stays **`totalCostAud`** in new endpoints (codebase-wide AUD→USD rename is deferred).
- Soft-deleted tasks (`t.is_deleted = true`) excluded from all aggregates.
- Anomaly thresholds: `cost > 2 × median` AND `cost > $50` (`5000` cents) absolute floor on both daily and client signals.
- The three sections are independent; tasks are ordered by section but Section 2 (forecast, frontend-only) could ship before Section 1 if needed.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/reports/reports.service.ts` | modify | Add `overviewDeltas(from, to)` and `anomalies()` methods. |
| `src/reports/reports.controller.ts` | modify | Add `@Get('overview-deltas')` and `@Get('anomalies')` endpoints. |
| `test/reports.service.spec.ts` | modify | New describe blocks for both service methods. |
| `test/reports.controller.spec.ts` | modify | New describe blocks for both controller endpoints. |
| `apps/web/src/api/reports.ts` | modify | Add `overviewDeltas` and `anomalies` API methods. |
| `apps/web/src/hooks/useReports.ts` | modify | Add `useOverviewDeltas` and `useAnomalies` hooks + types. |
| `apps/web/src/components/ui/Delta.tsx` | new | Inline delta pill: arrow + percent + "vs prior <range>" label. |
| `apps/web/src/components/ui/MetricCard.tsx` | modify | Add optional `delta?: ReactNode` prop. |
| `apps/web/src/components/AnomaliesPanel.tsx` | new | Card listing daily + client spike rows with action links. |
| `apps/web/src/components/charts/LineChart.tsx` | modify | Add optional `dashedTail?: { toValue: number } \| null` prop. |
| `apps/web/src/components/charts/CostTrendCard.tsx` | modify | Forecast wiring + subtitle delta. |
| `apps/web/src/lib/periodProgress.ts` | new | Pure helper computing `{ elapsed, total }` seconds for the current incomplete bucket, or `null`. |
| `apps/web/src/pages/OverviewPage.tsx` | modify | Wire deltas to two KPI cards; mount AnomaliesPanel next to Alerts. |

---

## Task 1: Backend — `overviewDeltas` service method (TDD)

**Files:**
- Modify: `src/reports/reports.service.ts` (add new method near `timeEntriesByUser`, mirroring its pattern)
- Test: `test/reports.service.spec.ts` (add new `describe('overviewDeltas', ...)` block after the existing `costTrend` describe)

- [ ] **Step 1: Write the failing tests**

Add this block at the end of `test/reports.service.spec.ts`, before the final closing `});` of the outer `describe`:

```ts
  describe('overviewDeltas', () => {
    it('returns current + prior totals mapped to dollars', async () => {
      const prisma = makePrisma();
      // Two raw queries: current, then prior. Stub in order.
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total_hours: 124.5, total_cost_cents: BigInt(1843250) }])
        .mockResolvedValueOnce([{ total_hours: 105.0, total_cost_cents: BigInt(1560000) }]);
      const result = await new ReportsService(prisma).overviewDeltas(
        '2026-05-01T00:00:00.000Z',
        '2026-05-31T23:59:59.999Z',
      );
      expect(result).toEqual({
        current: { totalHours: 124.5, totalCostAud: 18432.5 },
        prior:   { totalHours: 105,   totalCostAud: 15600 },
      });
    });

    it('computes the prior window as [from - (to - from), from)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 0, total_cost_cents: BigInt(0) }]);
      await new ReportsService(prisma).overviewDeltas(
        '2026-05-15T00:00:00.000Z',
        '2026-05-20T00:00:00.000Z',
      );
      // First call = current window. Second call = prior window.
      // Prior window for a 5-day current window: 2026-05-10 → 2026-05-15.
      const priorCall = prisma.$queryRaw.mock.calls[1][0];
      const sqlText: string = priorCall.sql ?? priorCall.text ?? String(priorCall);
      expect(sqlText).toMatch(/SUM\(e\.cost_cents\)/);
      // The prior window's `from` and `to` are passed as parameters; verify
      // the values array contains both dates in order.
      const values: unknown[] = priorCall.values ?? [];
      const isoStrings = values
        .map(v => (v instanceof Date ? v.toISOString() : String(v)))
        .join(' ');
      expect(isoStrings).toMatch(/2026-05-10T00:00:00\.000Z/);
      expect(isoStrings).toMatch(/2026-05-15T00:00:00\.000Z/);
    });

    it('excludes soft-deleted tasks in both windows', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 0, total_cost_cents: BigInt(0) }]);
      await new ReportsService(prisma).overviewDeltas();
      const call0: string = prisma.$queryRaw.mock.calls[0][0].sql ?? String(prisma.$queryRaw.mock.calls[0][0]);
      const call1: string = prisma.$queryRaw.mock.calls[1][0].sql ?? String(prisma.$queryRaw.mock.calls[1][0]);
      expect(call0).toMatch(/t\.is_deleted\s*=\s*false/);
      expect(call1).toMatch(/t\.is_deleted\s*=\s*false/);
    });

    it('handles null sums (no rows in window)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: null, total_cost_cents: null }]);
      const result = await new ReportsService(prisma).overviewDeltas();
      expect(result.current).toEqual({ totalHours: 0, totalCostAud: 0 });
      expect(result.prior).toEqual({ totalHours: 0, totalCostAud: 0 });
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- reports.service`
Expected: 4 failures in the new `overviewDeltas` block (method does not exist).

- [ ] **Step 3: Implement `overviewDeltas` on `ReportsService`**

In `src/reports/reports.service.ts`, add this method below `timeEntriesByUser` (around line 200, depending on file state):

```ts
  /**
   * Current-period totals and the equal-length prior-period totals, used by
   * the Overview page's KPI cards to render period-over-period deltas. The
   * prior window is `[from - (to - from), from)` — exclusive on the upper
   * bound so it doesn't overlap with the current window.
   *
   * Soft-deleted tasks are excluded from both windows.
   */
  async overviewDeltas(fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const spanMs = to.getTime() - from.getTime();
    const priorFrom = new Date(from.getTime() - spanMs);
    const priorTo = from; // exclusive upper bound — see `<` below

    type Row = { total_hours: number | null; total_cost_cents: bigint | null };
    const sumWindow = (winFrom: Date, winTo: Date, upperOp: 'lte' | 'lt') => {
      const upper = upperOp === 'lte'
        ? Prisma.sql`e.start_time <= ${winTo}`
        : Prisma.sql`e.start_time <  ${winTo}`;
      return this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
               COALESCE(SUM(e.cost_cents), 0)::bigint   AS total_cost_cents
        FROM clickup_time_entries e
        JOIN clickup_tasks t ON e.task_id = t.task_id
        WHERE e.start_time IS NOT NULL
          AND e.start_time >= ${winFrom}
          AND ${upper}
          AND t.is_deleted = false
      `);
    };

    const [currentRows, priorRows] = await Promise.all([
      sumWindow(from, to, 'lte'),
      sumWindow(priorFrom, priorTo, 'lt'),
    ]);

    const mapRow = (r: Row) => ({
      totalHours: Number(r.total_hours ?? 0),
      totalCostAud: Number(r.total_cost_cents ?? 0n) / 100,
    });

    return {
      current: mapRow(currentRows[0] ?? { total_hours: 0, total_cost_cents: 0n }),
      prior:   mapRow(priorRows[0]   ?? { total_hours: 0, total_cost_cents: 0n }),
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- reports.service`
Expected: all `overviewDeltas` tests pass; pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.service.ts test/reports.service.spec.ts
git commit -m "feat(reports): overviewDeltas service method for period-over-period KPIs"
```

---

## Task 2: Backend — `overview-deltas` controller endpoint

**Files:**
- Modify: `src/reports/reports.controller.ts` (add new endpoint near `time-entries/cost-trend`)
- Test: `test/reports.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test**

In `test/reports.controller.spec.ts`, add this block inside the outer `describe('ReportsController', ...)`:

```ts
  describe('overviewDeltas', () => {
    function makeServiceWithDeltas() {
      return {
        overviewDeltas: jest.fn().mockResolvedValue({
          current: { totalHours: 10, totalCostAud: 1000 },
          prior:   { totalHours: 8,  totalCostAud: 800 },
        }),
      } as any;
    }

    it('passes from/to through to the service', async () => {
      const svc = makeServiceWithDeltas();
      const ctrl = new ReportsController(svc);
      await ctrl.overviewDeltas('2026-05-01', '2026-05-31');
      expect(svc.overviewDeltas).toHaveBeenCalledWith('2026-05-01', '2026-05-31');
    });

    it('returns the service result unchanged', async () => {
      const svc = makeServiceWithDeltas();
      const ctrl = new ReportsController(svc);
      const result = await ctrl.overviewDeltas();
      expect(result).toEqual({
        current: { totalHours: 10, totalCostAud: 1000 },
        prior:   { totalHours: 8,  totalCostAud: 800 },
      });
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- reports.controller`
Expected: failures because `ReportsController.overviewDeltas` doesn't exist.

- [ ] **Step 3: Add the controller endpoint**

In `src/reports/reports.controller.ts`, add this method immediately after the existing `costTrend` method:

```ts
  @Get('overview-deltas')
  @ApiOperation({ summary: 'Current-period totals (hours, cost) and equal-length prior-period totals for the Overview KPI deltas.' })
  overviewDeltas(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.overviewDeltas(from, to);
  }
```

- [ ] **Step 4: Run controller + service tests**

Run: `npm run test -- reports`
Expected: all controller + service tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.controller.ts test/reports.controller.spec.ts
git commit -m "feat(reports): expose /reports/overview-deltas endpoint"
```

---

## Task 3: Frontend — `Delta` API + hook + types

**Files:**
- Modify: `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/hooks/useReports.ts`

- [ ] **Step 1: Add the API client method**

In `apps/web/src/api/reports.ts`, add this entry to `reportsApi` near `timeEntriesByUser`:

```ts
  overviewDeltas: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/overview-deltas', { params }).then(r => r.data),
```

- [ ] **Step 2: Add the `useOverviewDeltas` hook + type**

In `apps/web/src/hooks/useReports.ts`, add this near the other `useTimeEntries*` hooks:

```ts
export interface OverviewDeltas {
  current: { totalHours: number; totalCostAud: number };
  prior:   { totalHours: number; totalCostAud: number };
}

/**
 * `from`/`to` default to the global filter's range (topbar). Callers like
 * CostTrendCard pass their own range when the trend chart's window differs
 * from the topbar (e.g. weekly view with the default 12-week window).
 */
export function useOverviewDeltas(from?: string, to?: string) {
  const filters = useGlobalFilters();
  const effFrom = from ?? filters.fromDate;
  const effTo = to ?? filters.toDate;
  return useQuery<OverviewDeltas>({
    queryKey: ['overview-deltas', effFrom, effTo],
    queryFn: () => reportsApi.overviewDeltas({ from: effFrom, to: effTo }),
    placeholderData: keepPreviousData,
  });
}
```

`useQuery`, `keepPreviousData`, `reportsApi`, and `useGlobalFilters` are already imported.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): overviewDeltas API client + useOverviewDeltas hook"
```

---

## Task 4: Frontend — `Delta` component + `MetricCard` prop + Overview wiring

**Files:**
- Create: `apps/web/src/components/ui/Delta.tsx`
- Modify: `apps/web/src/components/ui/MetricCard.tsx`
- Modify: `apps/web/src/pages/OverviewPage.tsx`

- [ ] **Step 1: Create `Delta`**

Create `apps/web/src/components/ui/Delta.tsx`:

```tsx
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

interface DeltaProps {
  /** Current-period value. */
  current: number;
  /** Prior-period value. */
  prior: number;
  /** Suffix label, e.g. "30d" → renders "vs prior 30d". */
  rangeLabel: string;
  /**
   * Direction that means "good". Defaults to 'down' — for cost/hours, less
   * is treated as the positive case (green). Callers can flip this for
   * metrics where up is good (e.g. completed-task counts).
   */
  desirable?: 'up' | 'down';
}

// Values within ±2% render as neutral; avoids noise on tiny changes.
const NEUTRAL_THRESHOLD = 0.02;

export function Delta({ current, prior, rangeLabel, desirable = 'down' }: DeltaProps) {
  // No prior data — show "new" or neutral.
  if (prior === 0) {
    if (current === 0) return <Pill icon={<Minus size={11} strokeWidth={2} />} text="—" tone="neutral" suffix={rangeLabel} />;
    return <Pill icon={null} text="new" tone="neutral" suffix={rangeLabel} />;
  }

  const pct = (current - prior) / prior;
  const absPct = Math.abs(pct);

  if (absPct < NEUTRAL_THRESHOLD) {
    return <Pill icon={<Minus size={11} strokeWidth={2} />} text="—" tone="neutral" suffix={rangeLabel} />;
  }

  const isUp = pct > 0;
  const upIsDesirable = desirable === 'up';
  const tone: 'positive' | 'negative' = (isUp === upIsDesirable) ? 'positive' : 'negative';
  const icon = isUp ? <ArrowUp size={11} strokeWidth={2} /> : <ArrowDown size={11} strokeWidth={2} />;
  const text = `${(absPct * 100).toFixed(1)}%`;

  return <Pill icon={icon} text={text} tone={tone} suffix={rangeLabel} />;
}

const TONES: Record<'positive' | 'negative' | 'neutral', { fg: string; bg: string }> = {
  positive: { fg: 'var(--green)',      bg: 'var(--pill-green-bg)' },
  negative: { fg: 'var(--red)',        bg: 'var(--pill-red-bg)' },
  neutral:  { fg: 'var(--text-muted)', bg: 'transparent' },
};

function Pill({
  icon, text, tone, suffix,
}: {
  icon: React.ReactNode;
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
  suffix: string;
}) {
  const { fg, bg } = TONES[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          padding: '1px 5px',
          borderRadius: 4,
          background: bg,
          color: fg,
          fontWeight: 600,
        }}
      >
        {icon}
        {text}
      </span>
      <span>vs prior {suffix}</span>
    </span>
  );
}
```

- [ ] **Step 2: Add `delta` prop to `MetricCard`**

In `apps/web/src/components/ui/MetricCard.tsx`, Read the file first to understand its current shape. Then add an optional `delta?: React.ReactNode` prop to the props interface and render it just below the existing `sublabel` element. The exact diff depends on the existing structure — typically:

Find the props interface (around the top of the file) and add `delta?: React.ReactNode;`.

Find where the `sublabel` is rendered (somewhere in the JSX). Immediately below the sublabel `<div>`, add:

```tsx
{delta && <div style={{ marginTop: 4 }}>{delta}</div>}
```

Destructure `delta` in the function parameter list alongside the other props.

- [ ] **Step 3: Wire the delta into `OverviewPage`**

In `apps/web/src/pages/OverviewPage.tsx`, add this import near the top:

```tsx
import { Delta } from '../components/ui/Delta';
import { useOverviewDeltas } from '../hooks/useReports';
```

Then, inside the `OverviewPage` function near the other hook calls (`stats`, `tasksSummary`, etc.), add:

```tsx
  const deltasQ = useOverviewDeltas();
  const deltas = deltasQ.data;
```

Also add a `rangeLabel` derivation. Near the existing `dateRangeLabel` destructure from `useGlobalFilters`, extend it to also pull `dateRange`, `customFrom`, `customTo`:

```tsx
  const { dateRangeLabel, dateRange, customFrom, customTo } = useGlobalFilters();
```

Then add a derived label (next to the other derivations in the body of the component):

```tsx
  // Short range label for delta pills — derived from the topbar's dateRange.
  // For custom ranges, compute day count from the actual window.
  const rangeShort = (() => {
    if (dateRange === '24h')  return '24h';
    if (dateRange === '7d')   return '7d';
    if (dateRange === '30d')  return '30d';
    if (dateRange === '90d')  return '90d';
    if (dateRange === 'custom' && customFrom && customTo) {
      const days = Math.max(1, Math.round((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000));
      return `${days}d`;
    }
    return 'period';
  })();
```

Find the `Time tracked` `<MetricCard ... />` and add the `delta` prop:

```tsx
        <MetricCard
          label="Time tracked"
          value={timeByUser.isLoading ? '—' : fmt.hours(totalHours)}
          sublabel={dateRangeLabel}
          delta={deltas && <Delta current={deltas.current.totalHours} prior={deltas.prior.totalHours} rangeLabel={rangeShort} />}
          icon={<Clock size={14} strokeWidth={1.75} />}
          onClick={() => navigate('/time-entries')}
        />
```

Find the `Calculated cost` `<MetricCard ... />` and add the `delta` prop:

```tsx
        <MetricCard
          label="Calculated cost"
          value={timeByUser.isLoading ? '—' : moneyAud(totalCost)}
          sublabel={dateRangeLabel}
          delta={deltas && <Delta current={deltas.current.totalCostAud} prior={deltas.prior.totalCostAud} rangeLabel={rangeShort} />}
          icon={<DollarSign size={14} strokeWidth={1.75} />}
        />
```

Remove or replace any pre-existing `delta` strings on these cards if they conflict (the cost-trend audit pass may have left some). The new `delta` prop accepts a `ReactNode` and replaces whatever was there.

If `MetricCard` already has a `delta` prop with a different type (e.g. `string`), check carefully — you may need to rename the existing one or merge.

- [ ] **Step 4: Build + lint**

Run:
```bash
npm --prefix apps/web run build
```
Expected: build passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/Delta.tsx apps/web/src/components/ui/MetricCard.tsx apps/web/src/pages/OverviewPage.tsx
git commit -m "feat(web): Delta component + KPI period-over-period indicators on Overview"
```

---

## Task 5: Frontend — `LineChart` `dashedTail` prop

The forecast feature is frontend-only. `LineChart` gets an optional `dashedTail` prop. When set, the chart draws an additional dashed segment from the last data point extending half a bucket-width past it, ending at the projected Y. The chart's Y scale auto-expands to include the projected value so the tail never clips above.

**Files:**
- Modify: `apps/web/src/components/charts/LineChart.tsx`

- [ ] **Step 1: Add the `dashedTail` prop and rendering**

Read `apps/web/src/components/charts/LineChart.tsx` first to confirm its current state. Then make these changes:

Extend the `LineChartProps` interface:

```ts
interface LineChartProps {
  data: LineData[];
  color?: string;
  height?: number;
  onPointClick?: (d: LineData, index: number) => void;
  renderTooltip?: (d: LineData) => ReactNode;
  formatMax?: (v: number) => string;
  /**
   * Optional dashed tail rendered past the last data point. When set, the
   * chart draws a dashed segment from the last actual point extending
   * forward (half a bucket-width) to the projected value. The Y scale
   * auto-expands to include `toValue` so the tail never clips above.
   */
  dashedTail?: { toValue: number } | null;
}
```

In the function signature, destructure `dashedTail`:

```ts
export function LineChart({
  data,
  color = 'var(--accent)',
  height = 160,
  onPointClick,
  renderTooltip,
  formatMax,
  dashedTail,
}: LineChartProps) {
```

Replace the `const max` line so it includes the projected value:

```ts
  const dataMax = Math.max(...data.map(d => d.value));
  const dataMin = Math.min(...data.map(d => d.value));
  // If a dashedTail is provided, expand the Y range to include it so the
  // dashed line never clips above the chart area.
  const max = dashedTail ? Math.max(dataMax, dashedTail.toValue) : dataMax;
  const min = dashedTail ? Math.min(dataMin, dashedTail.toValue) : dataMin;
  const range = max - min || 1;
```

After the existing `<path d={linePath} ...>` element (the solid line), add the dashed-tail rendering. Insert it inside the SVG, after the solid stroke path and BEFORE the overlay `<rect>`:

```tsx
        {dashedTail && (
          (() => {
            const lastX = points[points.length - 1][0];
            const lastY = points[points.length - 1][1];
            // Extend half a step past the last actual point so the tail
            // visibly leans into the gutter without overflowing the SVG
            // bounds. step is the data-point spacing in viewBox units.
            const tipX = Math.min(w - 1, lastX + step / 2);
            const tipY = height - padY - ((dashedTail.toValue - min) / range) * (height - padY * 2);
            return (
              <path
                d={`M ${lastX},${lastY} L ${tipX},${tipY}`}
                fill="none"
                stroke={color}
                strokeOpacity={0.5}
                strokeWidth="1.5"
                strokeDasharray="3 3"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })()
        )}
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm --prefix apps/web run build
```
Expected: clean build. No call site yet uses `dashedTail` so behavior is unchanged for existing consumers.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/charts/LineChart.tsx
git commit -m "feat(web): LineChart dashedTail prop for forecast extrapolation"
```

---

## Task 6: Frontend — `periodProgress` helper + forecast wiring in `CostTrendCard`

**Files:**
- Create: `apps/web/src/lib/periodProgress.ts`
- Modify: `apps/web/src/components/charts/CostTrendCard.tsx`

- [ ] **Step 1: Create `periodProgress` helper**

Create `apps/web/src/lib/periodProgress.ts`:

```ts
import type { CostTrendBucket } from '../hooks/useReports';

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * If `bucket` represents the current incomplete BD-local period, returns
 * `{ elapsed, total }` in seconds. Otherwise returns `null`.
 *
 * - day:   bucket date equals today (BD)
 * - week:  bucket date equals the Sunday on/before today (BD)
 * - month: bucket date equals the 1st of the current month (BD)
 */
export function currentPeriodProgress(
  bucket: string,
  bucketType: CostTrendBucket,
  now: Date = new Date(),
): { elapsed: number; total: number } | null {
  const parts = bucket.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]); // 1-indexed
  const d = Number(parts[2]);
  if (!y || !m || !d) return null;

  // Shift "now" into Dhaka-local time by adding the offset, then read it as
  // UTC. The resulting Date's getUTC* values represent BD local.
  const nowBdMs = now.getTime() + DHAKA_OFFSET_MS;
  const nowBd = new Date(nowBdMs);
  const bdYear  = nowBd.getUTCFullYear();
  const bdMonth = nowBd.getUTCMonth(); // 0-indexed
  const bdDay   = nowBd.getUTCDate();
  const bdDow   = nowBd.getUTCDay();   // 0 = Sunday

  if (bucketType === 'day') {
    if (y !== bdYear || (m - 1) !== bdMonth || d !== bdDay) return null;
    const bucketStartBdMs = Date.UTC(y, m - 1, d);
    const elapsedMs = nowBdMs - bucketStartBdMs;
    if (elapsedMs <= 0) return null;
    return { elapsed: elapsedMs / 1000, total: 86400 };
  }

  if (bucketType === 'week') {
    // Today's Sunday in BD local.
    const todaySundayMs = Date.UTC(bdYear, bdMonth, bdDay - bdDow);
    const bucketStartMs = Date.UTC(y, m - 1, d);
    if (todaySundayMs !== bucketStartMs) return null;
    const elapsedMs = nowBdMs - bucketStartMs;
    if (elapsedMs <= 0) return null;
    return { elapsed: elapsedMs / 1000, total: 7 * 86400 };
  }

  // month
  if (y !== bdYear || (m - 1) !== bdMonth || d !== 1) return null;
  const monthStartMs = Date.UTC(y, m - 1, 1);
  const elapsedMs = nowBdMs - monthStartMs;
  if (elapsedMs <= 0) return null;
  // Days in month: day 0 of (m) gives the last day of (m-1). Since m is
  // 1-indexed, passing m directly gets us the last day of *this* month.
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { elapsed: elapsedMs / 1000, total: daysInMonth * 86400 };
}
```

- [ ] **Step 2: Wire forecast into `CostTrendCard`**

Read `apps/web/src/components/charts/CostTrendCard.tsx`. Then make these edits:

Add the import:

```ts
import { currentPeriodProgress } from '../../lib/periodProgress';
```

Inside the component, after `const data = q.data ?? [];`, compute the projected tail:

```tsx
  // Forecast: if the last bucket is the current incomplete period AND we're
  // past the 5% elapsed-fraction floor AND there's spend to extrapolate
  // from, project it forward to the end of the period.
  const lastPoint = data[data.length - 1];
  const progress = lastPoint ? currentPeriodProgress(lastPoint.bucket, bucket) : null;
  const elapsedFrac = progress ? progress.elapsed / progress.total : 0;
  const projection = (progress && elapsedFrac >= 0.05 && lastPoint && lastPoint.totalCostAud > 0)
    ? lastPoint.totalCostAud * (progress.total / progress.elapsed)
    : null;
```

Find the `<LineChart ... />` element and add the `dashedTail` prop:

```tsx
          <LineChart
            data={chartData}
            height={200}
            formatMax={moneyAud}
            dashedTail={projection != null ? { toValue: projection } : null}
            onPointClick={(d) => d.key && setSelectedBucket(d.key)}
            renderTooltip={(d) => { /* ... existing body ... */ }}
          />
```

Extend the `renderTooltip` to add a `Projected:` line on the current bucket only. Replace the existing tooltip body with:

```tsx
            renderTooltip={(d) => {
              const point = data.find(p => p.bucket === d.key);
              const isCurrentBucket = lastPoint && d.key === lastPoint.bucket && projection != null;
              return (
                <>
                  <div style={{ fontWeight: 600 }}>{d.label}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{moneyAud(d.value)}</div>
                  {point && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                      {fmt.hours(point.totalHours)} · {point.entryCount} entr{point.entryCount === 1 ? 'y' : 'ies'}
                    </div>
                  )}
                  {isCurrentBucket && projection != null && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 4, fontStyle: 'italic' }}>
                      Projected: {moneyAud(projection)} at current pace
                    </div>
                  )}
                </>
              );
            }}
```

- [ ] **Step 3: Add subtitle delta to `CostTrendCard`**

The trend card's subtitle currently looks like:
`Daily — last 30 days` (plus optional `· no spend in this period`).

The spec calls for it to also show the period-over-period delta:
`Daily — last 30 days · $12.4k total · ↑18% vs prior 30d`.

This uses the chart's own range (which may differ from the topbar). Add a parallel `useOverviewDeltas(chartFrom, chartTo)` call inside `CostTrendCard`:

Add this import near the top of `CostTrendCard.tsx`:

```tsx
import { Delta } from '../ui/Delta';
import { useOverviewDeltas } from '../../hooks/useReports';
```

Inside the component, after the existing `range` `useMemo`, add:

```tsx
  const deltasQ = useOverviewDeltas(range.from, range.to);
  const totalCostAud = data.reduce((s, p) => s + p.totalCostAud, 0);
  const subtitleRangeShort =
    useTopbar
      ? (() => {
          const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000));
          return `${days}d`;
        })()
      : (bucket === 'day' ? '30d' : bucket === 'week' ? '12w' : '12mo');
```

Find the `subtitle={...}` prop on `<Card>`. Replace it with a richer subtitle string + an inline `Delta` block. Since `Card.subtitle` is `string`, we need to also pass a custom react node — instead, render the delta inline next to the value. Simplest path: change the `<Card>` to use `title` only and render a manual subtitle row inside the children. But that's a bigger change.

Cleaner path: extend the existing subtitle string with the total, and render the `Delta` separately as part of the chart container.

Update the Card's subtitle from:

```tsx
subtitle={`${bucket === 'day' ? 'Daily' : bucket === 'week' ? 'Weekly' : 'Monthly'} — ${windowDescription(bucket, useTopbar)}${!hasAnySpend && !q.isLoading ? ' · no spend in this period' : ''}`}
```

to:

```tsx
subtitle={`${bucket === 'day' ? 'Daily' : bucket === 'week' ? 'Weekly' : 'Monthly'} — ${windowDescription(bucket, useTopbar)} · ${moneyAud(totalCostAud)} total${!hasAnySpend && !q.isLoading ? ' · no spend in this period' : ''}`}
```

Then, inside the Card body (just above the `{q.isError ? ...}` block), insert the Delta indicator:

```tsx
        {deltasQ.data && (
          <div style={{ marginBottom: 8 }}>
            <Delta
              current={deltasQ.data.current.totalCostAud}
              prior={deltasQ.data.prior.totalCostAud}
              rangeLabel={subtitleRangeShort}
            />
          </div>
        )}
```

- [ ] **Step 4: Verify build**

Run:
```bash
npm --prefix apps/web run build
```
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/periodProgress.ts apps/web/src/components/charts/CostTrendCard.tsx
git commit -m "feat(web): cost-trend forecast tail + subtitle period-over-period delta"
```

---

## Task 7: Backend — `anomalies` service method (TDD)

**Files:**
- Modify: `src/reports/reports.service.ts`
- Test: `test/reports.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append this block at the end of `test/reports.service.spec.ts`, before the outer closing `});`:

```ts
  describe('anomalies', () => {
    it('maps daily spike rows to { date, totalCostAud, medianAud, multiplier }', async () => {
      const prisma = makePrisma();
      // Two raw queries: daily, then client. Stub in order.
      prisma.$queryRaw
        .mockResolvedValueOnce([{
          date: '2026-05-04',
          total_cost_cents: BigInt(192000),
          median_cost_cents: BigInt(45600),
          multiplier: 4.21,
        }])
        .mockResolvedValueOnce([]);
      const result = await new ReportsService(prisma).anomalies();
      expect(result.dailySpikes).toEqual([{
        date: '2026-05-04',
        totalCostAud: 1920,
        medianAud: 456,
        multiplier: 4.21,
      }]);
    });

    it('maps client spike rows to { client, lastWeekCostAud, baselineMedianAud, multiplier }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          client: 'Acme',
          week_cost_cents: BigInt(210000),
          baseline_median_cents: BigInt(67000),
          multiplier: 3.13,
        }]);
      const result = await new ReportsService(prisma).anomalies();
      expect(result.clientSpikes).toEqual([{
        client: 'Acme',
        lastWeekCostAud: 2100,
        baselineMedianAud: 670,
        multiplier: 3.13,
      }]);
    });

    it('returns empty arrays when no spikes', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await new ReportsService(prisma).anomalies();
      expect(result).toEqual({ dailySpikes: [], clientSpikes: [] });
    });

    it("daily query uses Asia/Dhaka, percentile_cont(0.5), $50 floor, 2x median, soft-delete filter", async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).anomalies();
      const dailyCall = prisma.$queryRaw.mock.calls[0][0];
      const sql: string = dailyCall.sql ?? dailyCall.text ?? String(dailyCall);
      expect(sql).toMatch(/Asia\/Dhaka/);
      expect(sql).toMatch(/percentile_cont\(0\.5\)/);
      expect(sql).toMatch(/5000/);              // $50 floor in cents
      expect(sql).toMatch(/2\s*\*\s*m\.median/i);
      expect(sql).toMatch(/t\.is_deleted\s*=\s*false/);
    });

    it('client query uses Sunday-start week shift and 90-day baseline excluding last 7 days', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).anomalies();
      const clientCall = prisma.$queryRaw.mock.calls[1][0];
      const sql: string = clientCall.sql ?? clientCall.text ?? String(clientCall);
      expect(sql).toMatch(/date_trunc\('week'/);
      expect(sql).toMatch(/\+ interval '1 day'/);
      expect(sql).toMatch(/- interval '1 day'/);
      expect(sql).toMatch(/interval '90 days'/);
      expect(sql).toMatch(/interval '7 days'/);
      expect(sql).toMatch(/t\.is_deleted\s*=\s*false/);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- reports.service`
Expected: 5 failures in the new `anomalies` block (method does not exist).

- [ ] **Step 3: Implement `anomalies` on `ReportsService`**

In `src/reports/reports.service.ts`, add this method at the bottom of the class, after `costTrend`:

```ts
  /**
   * Statistical-rule anomaly detection for the Overview "Anomalies" panel.
   *
   * Daily spike rule: a BD-local day in the last 30 where day_cost > 2x the
   *   median day_cost (over non-zero days) AND day_cost > $50.
   *
   * Client spike rule: a client whose last-7-days cost > 2x their 90-day
   *   weekly-median (over Sunday-start weeks in the [90d, 7d) window),
   *   AND last-7-days cost > $50.
   *
   * Both rules require median > 0 to avoid Infinity multipliers on
   *   brand-new metrics. Soft-deleted tasks excluded.
   */
  async anomalies() {
    const TZ = Prisma.raw("'Asia/Dhaka'");
    type DailyRow = {
      date: string;
      total_cost_cents: bigint;
      median_cost_cents: bigint | number;
      multiplier: number;
    };
    type ClientRow = {
      client: string;
      week_cost_cents: bigint;
      baseline_median_cents: bigint | number;
      multiplier: number;
    };

    const [dailyRows, clientRows] = await Promise.all([
      this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
        WITH daily_costs AS (
          SELECT date_trunc('day', e.start_time AT TIME ZONE ${TZ}) AS day_local,
                 SUM(e.cost_cents)::bigint AS day_cents
          FROM clickup_time_entries e
          JOIN clickup_tasks t ON e.task_id = t.task_id
          WHERE e.start_time IS NOT NULL
            AND e.start_time >= now() - interval '30 days'
            AND t.is_deleted = false
          GROUP BY 1
        ),
        median AS (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY day_cents) AS median_cents
          FROM daily_costs
          WHERE day_cents > 0
        )
        SELECT to_char(d.day_local, 'YYYY-MM-DD')                AS date,
               d.day_cents                                        AS total_cost_cents,
               m.median_cents                                     AS median_cost_cents,
               (d.day_cents::float / NULLIF(m.median_cents, 0))::float AS multiplier
        FROM daily_costs d, median m
        WHERE d.day_cents > 5000
          AND m.median_cents > 0
          AND d.day_cents > 2 * m.median_cents
        ORDER BY d.day_local DESC
        LIMIT 10
      `),

      this.prisma.$queryRaw<ClientRow[]>(Prisma.sql`
        WITH last_7 AS (
          SELECT t.client, SUM(e.cost_cents)::bigint AS week_cents
          FROM clickup_time_entries e
          JOIN clickup_tasks t ON e.task_id = t.task_id
          WHERE e.start_time IS NOT NULL
            AND e.start_time >= now() - interval '7 days'
            AND t.client IS NOT NULL AND t.client <> ''
            AND t.is_deleted = false
          GROUP BY t.client
        ),
        baseline_weeks AS (
          SELECT t.client,
                 (date_trunc('week', (e.start_time AT TIME ZONE ${TZ}) + interval '1 day') - interval '1 day') AS week_local,
                 SUM(e.cost_cents)::bigint AS week_cents
          FROM clickup_time_entries e
          JOIN clickup_tasks t ON e.task_id = t.task_id
          WHERE e.start_time IS NOT NULL
            AND e.start_time >= now() - interval '90 days'
            AND e.start_time <  now() - interval '7 days'
            AND t.client IS NOT NULL AND t.client <> ''
            AND t.is_deleted = false
          GROUP BY t.client, 2
        ),
        baseline AS (
          SELECT client,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY week_cents) AS median_week_cents
          FROM baseline_weeks
          WHERE week_cents > 0
          GROUP BY client
        )
        SELECT l.client                                                     AS client,
               l.week_cents                                                  AS week_cost_cents,
               b.median_week_cents                                           AS baseline_median_cents,
               (l.week_cents::float / NULLIF(b.median_week_cents, 0))::float AS multiplier
        FROM last_7 l
        JOIN baseline b ON b.client = l.client
        WHERE l.week_cents > 5000
          AND b.median_week_cents > 0
          AND l.week_cents > 2 * b.median_week_cents
        ORDER BY multiplier DESC
        LIMIT 10
      `),
    ]);

    return {
      dailySpikes: dailyRows.map(r => ({
        date: r.date,
        totalCostAud: Number(r.total_cost_cents) / 100,
        medianAud: Number(r.median_cost_cents) / 100,
        multiplier: Number(r.multiplier),
      })),
      clientSpikes: clientRows.map(r => ({
        client: r.client,
        lastWeekCostAud: Number(r.week_cost_cents) / 100,
        baselineMedianAud: Number(r.baseline_median_cents) / 100,
        multiplier: Number(r.multiplier),
      })),
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- reports.service`
Expected: all `anomalies` tests pass; pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.service.ts test/reports.service.spec.ts
git commit -m "feat(reports): anomalies service method (daily + client spend spikes)"
```

---

## Task 8: Backend — `anomalies` controller endpoint

**Files:**
- Modify: `src/reports/reports.controller.ts`
- Test: `test/reports.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test**

In `test/reports.controller.spec.ts`, add this block inside the outer `describe('ReportsController', ...)`:

```ts
  describe('anomalies', () => {
    it('returns the service result unchanged', async () => {
      const svc = {
        anomalies: jest.fn().mockResolvedValue({
          dailySpikes: [{ date: '2026-05-04', totalCostAud: 1920, medianAud: 456, multiplier: 4.21 }],
          clientSpikes: [],
        }),
      } as any;
      const ctrl = new ReportsController(svc);
      const result = await ctrl.anomalies();
      expect(svc.anomalies).toHaveBeenCalledTimes(1);
      expect(result.dailySpikes).toHaveLength(1);
      expect(result.clientSpikes).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- reports.controller`
Expected: failure because `anomalies` doesn't exist on the controller.

- [ ] **Step 3: Add the endpoint**

In `src/reports/reports.controller.ts`, add this method immediately after `overviewDeltas`:

```ts
  @Get('anomalies')
  @ApiOperation({ summary: 'Spend-spike anomalies for the Overview panel — daily totals and per-client weekly totals exceeding their median baselines.' })
  anomalies() {
    return this.reports.anomalies();
  }
```

- [ ] **Step 4: Run all reports tests**

Run: `npm run test -- reports`
Expected: all controller + service tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.controller.ts test/reports.controller.spec.ts
git commit -m "feat(reports): expose /reports/anomalies endpoint"
```

---

## Task 9: Frontend — AnomaliesPanel + API + hook + Overview wiring

**Files:**
- Modify: `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/hooks/useReports.ts`
- Create: `apps/web/src/components/AnomaliesPanel.tsx`
- Modify: `apps/web/src/pages/OverviewPage.tsx`

- [ ] **Step 1: Add the API client method**

In `apps/web/src/api/reports.ts`, add to `reportsApi`:

```ts
  anomalies: () => apiClient.get('/reports/anomalies').then(r => r.data),
```

- [ ] **Step 2: Add the hook + types**

In `apps/web/src/hooks/useReports.ts`, add near the other hooks:

```ts
export interface DailySpike {
  date: string;
  totalCostAud: number;
  medianAud: number;
  multiplier: number;
}

export interface ClientSpike {
  client: string;
  lastWeekCostAud: number;
  baselineMedianAud: number;
  multiplier: number;
}

export interface Anomalies {
  dailySpikes: DailySpike[];
  clientSpikes: ClientSpike[];
}

export function useAnomalies() {
  return useQuery<Anomalies>({
    queryKey: ['anomalies'],
    queryFn: () => reportsApi.anomalies(),
    // Anomalies are computed off rolling windows that don't shift often; a
    // 60s stale time keeps the panel responsive without hammering the DB.
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Create `AnomaliesPanel`**

Create `apps/web/src/components/AnomaliesPanel.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { Card } from './ui/Card';
import { fmt } from '../lib/formatters';
import { useAnomalies } from '../hooks/useReports';
import type { DailySpike, ClientSpike } from '../hooks/useReports';

function moneyAud(dollars: number) { return fmt.money(Math.round(dollars * 100)); }

export function AnomaliesPanel() {
  const navigate = useNavigate();
  const q = useAnomalies();
  const data = q.data;

  const rows: { key: string; title: string; subtitle: string; onClick: () => void }[] = [];

  if (data) {
    for (const s of data.dailySpikes) {
      rows.push({
        key: `daily-${s.date}`,
        title: `${formatDate(s.date)} was ${s.multiplier.toFixed(1)}× the 30-day median`,
        subtitle: `${moneyAud(s.totalCostAud)} vs ${moneyAud(s.medianAud)} typical`,
        onClick: () => navigate(dailyLink(s.date)),
      });
    }
    for (const s of data.clientSpikes) {
      rows.push({
        key: `client-${s.client}`,
        title: `${s.client} is up ${s.multiplier.toFixed(1)}× vs their 90-day baseline`,
        subtitle: `${moneyAud(s.lastWeekCostAud)} last 7d, ${moneyAud(s.baselineMedianAud)} typical weekly`,
        onClick: () => navigate(clientLink(s.client)),
      });
    }
  }

  return (
    <Card
      padding={0}
      title="Anomalies"
      subtitle="Daily spikes and per-client variance"
    >
      {q.isLoading && (
        <div style={{ padding: 16 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ height: 32, background: 'var(--muted-bg)', borderRadius: 6, marginBottom: 8, opacity: 0.6 }} />
          ))}
        </div>
      )}
      {q.isError && (
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>Couldn't load anomalies.</div>
          <button
            type="button"
            onClick={() => q.refetch()}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: 'var(--surface)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
            }}
          >Retry</button>
        </div>
      )}
      {data && rows.length === 0 && !q.isLoading && (
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No anomalies in the last 30 days.</p>
        </div>
      )}
      {data && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              onClick={r.onClick}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 16px',
                borderBottom: i < rows.length - 1 ? '1px solid var(--border-soft)' : 0,
                background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <span
                style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <TrendingUp size={13} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function dailyLink(iso: string): string {
  // The day in BD local → UTC window [start, +1d). The TimeEntries page
  // reads from/to URL params (set up by the cost-trend feature) and applies
  // them as a custom range.
  const [y, m, d] = iso.split('-').map(Number);
  const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
  const startMs = Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;
  const endMs = startMs + 86_400_000 - 1;
  const from = new Date(startMs).toISOString();
  const to   = new Date(endMs).toISOString();
  return `/time-entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

function clientLink(client: string): string {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  return `/time-entries?from=${encodeURIComponent(weekAgo.toISOString())}&to=${encodeURIComponent(now.toISOString())}&search=${encodeURIComponent(client)}`;
}
```

- [ ] **Step 4: Mount in `OverviewPage`**

Read `apps/web/src/pages/OverviewPage.tsx` and find the existing Activity + Alerts grid (a `<div>` with `gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)'`). The right column currently holds a single `Alerts` card.

Add this import near the top of the file:

```tsx
import { AnomaliesPanel } from '../components/AnomaliesPanel';
```

Wrap the existing Alerts card in a flex column with the new Anomalies panel below it. Replace the Alerts card site like this — find the existing `<Card padding={0} title="Alerts" ...>...</Card>` block, and wrap it:

```tsx
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {/* existing Alerts <Card>...</Card> stays in place inside this wrapper */}
          <AnomaliesPanel />
        </div>
```

So the grid still has 2 columns (Activity on the left, the Alerts+Anomalies stack on the right).

- [ ] **Step 5: Build + lint**

Run:
```bash
npm --prefix apps/web run build
```
Expected: clean build.

- [ ] **Step 6: Manual verification checklist**

Start the backend + web in dev mode:

```bash
npm run dev:deps
npm run start:dev
npm --prefix apps/web run dev
```

Tick each box after observing:

- [ ] KPI cards `Time tracked` and `Calculated cost` show a delta pill with arrow + percent + "vs prior 30d".
- [ ] Switching the topbar from `30d` to `7d` updates both the delta and its label to "vs prior 7d".
- [ ] Setting topbar to `custom` with a 14-day span shows "vs prior 14d".
- [ ] Trend card subtitle shows total and a delta pill below it (e.g. `· $12.4k total` then `↑18% vs prior 30d` inline). Switching D/W/M updates the rangeLabel suffix (`30d`/`12w`/`12mo`).
- [ ] On the trend chart, with `D` selected, the latest bucket (today) shows a dashed segment leaning toward a projected end-of-day value. Hovering the bucket reveals "Projected: $X at current pace".
- [ ] At very start of day (elapsed < 5%), no dashed tail appears.
- [ ] Switching to `W` view on a day other than Sunday morning shows the dashed tail on the current week's bucket.
- [ ] Switching to `M` view on a day other than the 1st shows the dashed tail on the current month's bucket.
- [ ] Selecting a topbar custom range that ends in the past (no current bucket) hides the dashed tail.
- [ ] The Anomalies card renders next to (or stacked below) the Alerts card. If no spikes exist, "No anomalies in the last 30 days." renders.
- [ ] Daily spike row click navigates to `/time-entries?from=...&to=...` for that day; the page reflects the date filter.
- [ ] Client spike row click navigates to `/time-entries?from=...&to=...&search=<client>` and filters accordingly.
- [ ] No console errors during interactions.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts apps/web/src/components/AnomaliesPanel.tsx apps/web/src/pages/OverviewPage.tsx
git commit -m "feat(web): AnomaliesPanel + Overview wiring"
```

---

## Final sweep

- [ ] **Run the full backend test suite:** `npm run test`
- [ ] **Build:** `npm run build && npm --prefix apps/web run build`
- [ ] All steps committed (`git status` clean).

---

## Self-review notes (for the executing agent)

1. **FE has no test framework.** The manual checklist in Task 9 is the verification gate. Don't skip it.
2. **Currency naming.** The new endpoints return `totalCostAud` deliberately — see the spec's "Currency note" and `MEMORY.md`'s `currency-aud-usd-debt` entry.
3. **`Prisma.raw` usage.** Both `anomalies` queries inject `'Asia/Dhaka'` via `Prisma.raw` for the same reason as `costTrend` — the TZ name needs to appear inline in SQL, not as a bind parameter. `Prisma.raw` is safe here because the value is a hardcoded string constant.
4. **Anomaly thresholds are fixed.** `2× median`, `$50 floor`, 30-day daily window, 90-day client baseline, 7-day client recent window, 10-row limit. If any threshold becomes configurable later, route it through the controller's query params, not the service signature.
5. **MetricCard `delta` may need a rename.** The existing `MetricCard` in `apps/web/src/components/ui/MetricCard.tsx` may already have a `delta` prop typed as `string`. Read the file before editing in Task 4 Step 2 and choose a clean migration path — either rename the existing prop or merge types so the new `ReactNode` form is accepted.
6. **Tooltips and the forecast tail share Y scale.** Because the Y scale is auto-expanded by `dashedTail`, the actual-data line may visually compress when projection is much larger than recent data. That's intentional and the projected tooltip line surfaces the actual projected value so the user can read magnitude.
7. **The `dailyLink` helper duplicates `bucketWindowUtc` logic.** This is intentional — keeping the panel's link math local avoids tangling AnomaliesPanel with cost-trend internals. If a third consumer ever needs this math, extract it then.

# Overview page ERP improvements — design

Date: 2026-05-21
Author: Rashedul + Claude
Status: approved (brainstorm phase)

## Goal

Three additions to the Overview page that bring it closer to an ERP feel:

1. **Period-over-period deltas** on the date-scoped KPI cards and the cost-trend total.
2. **Forecast tail** on the cost-trend chart — a dashed segment extending the line through the current incomplete bucket.
3. **Anomalies panel** next to the existing Alerts card, surfacing daily spend spikes and per-client spend spikes via statistical rules.

## Non-goals

- Deltas on Total / Open / Closed task counts. The task data is a live snapshot from ClickUp; we don't capture state-transition history, so a "vs prior 30d" delta on a count column would require new persistence. Out of scope.
- Forecasting beyond the current incomplete bucket (no multi-bucket projection, no "end of month" hard horizon).
- Forecast confidence bands. The projection is a flat extrapolation, not a probabilistic forecast.
- Anomalies driven by ML / time-series models. Simple median-multiplier rules only.
- Replacing or restructuring the existing Alerts panel.
- Per-client P&L / margin analysis (would need client billing rates that don't exist in the schema).
- Executive summary band, scheduled PDF exports.

## Currency note (carried over)

The schema's `currency` columns and existing response field names (`totalCostAud`) are stale — the team treats the stored values as USD. A codebase-wide rename is a separate larger task, **out of scope here**. The new endpoints keep the existing `totalCostAud` field name. See the cost-trend spec's "Currency note" section.

## Decisions locked in (from brainstorm)

- **Delta baseline:** prior equal-length window. If topbar shows "last 30d", compare to the 30 days immediately preceding the current window.
- **Forecast scope:** only fill out the current incomplete bucket; no projection past it.
- **Anomalies placement:** new panel next to existing Alerts (not merged).
- **Anomaly thresholds:** `cost > 2 × median` AND `cost > $50` absolute floor, on both daily and per-client signals.

---

## Section 1 — Period deltas

### User-facing behaviour

A small **Delta** indicator renders on:

1. **`Time tracked` KPI card** — below the existing sublabel.
2. **`Calculated cost` KPI card** — below the existing sublabel.
3. **Cost-trend card subtitle** — `Daily — last 30 days · $12.4k total · ↑18% vs prior 30d`.

The Delta is a small inline element: arrow glyph (`↑`/`↓`/`—`), percent change to one decimal place, and a `vs prior <N>` label. `<N>` is derived from the current window's length in days: `24h`, `7d`, `30d`, `90d` for presets, or `<days>d` (rounded) for custom ranges that don't match a preset.

Tone:
- **Up + cost or hours**: amber/red. (More spend / more time is generally a flag, not a celebration.)
- **Up + tasks closed**: green. (Not in scope today — flagged for the metric, not implemented since we don't have a deltable task-closed metric.)
- **Down + cost or hours**: green.
- **Within ±2%**: gray (`—` neutral arrow). Avoids "0.3% up" looking like a real signal.

### Edge cases

- Prior period is zero / null: render `new` in muted gray (no percent). E.g. a client just started logging time.
- Both current and prior are zero: render `—` (no change).
- Loading / error: card hides the delta gracefully.

### Backend

New endpoint, single purpose:

```
GET /reports/overview-deltas?from=ISO&to=ISO
```

Returns:

```json
{
  "current": { "totalHours": 124.5, "totalCostAud": 18432.50 },
  "prior":   { "totalHours": 105.0, "totalCostAud": 15600.00 }
}
```

Prior window is computed server-side as `[from − (to−from), from)` (exclusive on the upper bound so it doesn't overlap with the current window).

Both blocks aggregate the same way as `timeEntriesByUser` (sum `duration_hours`, sum `cost_cents`), but at the totals level only. Excludes soft-deleted tasks (`t.is_deleted = false`) for consistency with `costTrend`.

### Frontend

- New component `apps/web/src/components/ui/Delta.tsx` (small inline pill — arrow + percent + label).
- `MetricCard` gets an optional `delta` prop (`{ pct: number; label: string; tone?: 'positive' | 'negative' | 'neutral' }` — caller decides tone semantics).
- New hook `useOverviewDeltas(fromDate, toDate)` calling the new endpoint, wired to topbar date range.
- `OverviewPage` passes computed `delta` props to the two relevant `MetricCard`s.
- `CostTrendCard` renders the delta inline in its subtitle when the topbar override is in effect OR computes its own prior window from the bucket-default range otherwise.

---

## Section 2 — Forecast tail on trend chart

### User-facing behaviour

When the LAST bucket of the trend chart is the **current incomplete period**, the chart shows:

- A dashed segment of the same accent color, lower opacity (~50%), extending from the previous bucket's point to the projected end-of-bucket value.
- The current bucket's solid point stays drawn at the bucket's actual-to-date value.
- The tooltip on the current bucket includes a second line: `Projected: $X (at current pace)`.
- The dashed segment has no marker dots — it's not a real measurement.

The forecast is **suppressed** when:
- The current bucket is not in the data (e.g., user picked a custom topbar range ending in the past).
- Elapsed fraction of the period is `< 5%` — projection would be too volatile.
- The actual-to-date cost is 0 — nothing to extrapolate.

### Current-bucket detection

Computed client-side from the BD-local calendar:

- **Day:** the last bucket's date equals today's date in `Asia/Dhaka`.
- **Week:** the last bucket's date equals the Sunday-on-or-before today in `Asia/Dhaka`.
- **Month:** the last bucket's date equals the first of the current month in `Asia/Dhaka`.

### Projection math

```
projected = actual × (period_total_seconds / elapsed_seconds)
```

Where:
- **Day:** `period_total_seconds = 86400`. `elapsed_seconds` = seconds since BD-local midnight.
- **Week:** `period_total_seconds = 7 × 86400`. `elapsed_seconds` = seconds since the bucket's BD-local Sunday midnight.
- **Month:** `period_total_seconds = days_in_month × 86400`. `elapsed_seconds` = seconds since BD-local 1st-of-month midnight.

If `elapsed_seconds / period_total_seconds < 0.05`, render no tail.

### Implementation

Frontend-only. No backend change. `CostTrendCard`:

1. Examines `data[data.length - 1].bucket`. If it's the current period, compute `elapsedFraction` and `projected`.
2. Passes a new optional prop `dashedTail = { fromIndex: data.length - 2, toValue: projected }` to `LineChart`.
3. `LineChart` draws a separate dashed cubic segment from the second-to-last point to a virtual point at the same X as the last point (since the X axis is bucket-aligned) with Y derived from `projected`.
4. The solid line still passes through the actual last point. The dashed tail is an additional path layer.

`CostTrendCard` also adds a "Projected: …" line into the tooltip body for the current bucket.

---

## Section 3 — Anomalies panel

### User-facing behaviour

A new card titled **Anomalies** placed next to the existing **Alerts** card in the existing Activity + Alerts row. Same `Card` shell, same sizing pattern as `Alerts`.

Each anomaly row: small icon, one-line description, and a right-aligned "view →" link.

**Daily spend spike**:
> 📈 May 4 was 4.2× the 30-day median ($1,920 vs $456)
> [view →] → `/time-entries?from=<day-start>&to=<day-end>`

**Client spend spike**:
> 📈 Client X is up 3.1× vs their 90-day baseline ($2,100 last 7d, $670 typical)
> [view →] → `/time-entries?search=<client>&from=<7-days-ago>&to=<now>`

Empty state: `No anomalies in the last 30 days.`
Loading: skeleton bars (same pattern as drawer).
Error: inline error + Retry button.

### Detection rules

- **Daily spike:** for each day in last 30 in BD time, compute `day_cost_cents = SUM(cost_cents)`. Compute `median_cents = percentile_cont(0.5)` over days with `day_cost_cents > 0`. A day is flagged when `day_cost_cents > 2 × median_cents` AND `day_cost_cents > 5000` (= $50). Limit 10, ordered by day DESC.
- **Client spike:** for each client, compute `last7_cost_cents = SUM(cost_cents WHERE start_time >= now() - '7 days')`. Compute that client's weekly baseline median: bucket the prior 83 days (last_90 minus last_7) into BD-local weeks, sum each week, take `percentile_cont(0.5)`. A client is flagged when `last7_cost_cents > 2 × median_week_cents` AND `last7_cost_cents > 5000`. Limit 10, ordered by multiplier DESC.

Both signals require a non-zero baseline (`median > 0`). A brand-new metric with no historical median is not surfaced (would otherwise produce `Infinity` multipliers).

Soft-deleted tasks excluded everywhere.

### Backend

New endpoint:

```
GET /reports/anomalies
```

Returns:

```json
{
  "dailySpikes": [
    { "date": "2026-05-04", "totalCostAud": 1920.00, "medianAud": 456.00, "multiplier": 4.21 }
  ],
  "clientSpikes": [
    { "client": "Acme", "lastWeekCostAud": 2100.00, "baselineMedianAud": 670.00, "multiplier": 3.13 }
  ]
}
```

Implementation in `reports.service.ts`. Two raw-SQL queries using Postgres `percentile_cont(0.5) WITHIN GROUP (ORDER BY ...)`. Asia/Dhaka time bucketing for the daily signal; weeks use the same Sunday-start trick as `costTrend`.

### Frontend

- New component `apps/web/src/components/AnomaliesPanel.tsx`. Composition of `Card` + `Pill` + `Button` + table-like rows.
- New hook `useAnomalies()` (no params; backend uses fixed time windows).
- `OverviewPage` mounts it next to the existing Alerts in the same grid row. Existing grid is `grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr)` (Activity left, Alerts right). New layout: stack Anomalies under Alerts in the right column to preserve the Activity feed's width.

### Empty / sparse data

If both `dailySpikes` and `clientSpikes` are empty, the panel renders a single muted line: "No anomalies in the last 30 days." This is the common case for healthy steady-state spend.

---

## Architecture summary

| Layer | Section 1 (Deltas) | Section 2 (Forecast) | Section 3 (Anomalies) |
|---|---|---|---|
| Backend endpoint | NEW `/reports/overview-deltas` | (none — FE-only) | NEW `/reports/anomalies` |
| Backend service method | NEW `overviewDeltas(from, to)` | — | NEW `anomalies()` |
| Frontend hook | NEW `useOverviewDeltas` | (uses existing useCostTrend) | NEW `useAnomalies` |
| New components | `Delta` | (extends `LineChart` with `dashedTail` prop) | `AnomaliesPanel` |
| Touched files | `MetricCard.tsx`, `OverviewPage.tsx`, `CostTrendCard.tsx` | `LineChart.tsx`, `CostTrendCard.tsx` | `OverviewPage.tsx` |

The three sections are independent. They can be implemented in sequence (Section 1 → 2 → 3) or in parallel.

## Data shapes (summary)

**`/reports/overview-deltas` response:**
```ts
type OverviewDeltas = {
  current: { totalHours: number; totalCostAud: number };
  prior:   { totalHours: number; totalCostAud: number };
};
```

**`/reports/anomalies` response:**
```ts
type DailySpike = {
  date: string;          // 'YYYY-MM-DD' BD local
  totalCostAud: number;
  medianAud: number;
  multiplier: number;
};
type ClientSpike = {
  client: string;
  lastWeekCostAud: number;
  baselineMedianAud: number;
  multiplier: number;
};
type Anomalies = {
  dailySpikes: DailySpike[];
  clientSpikes: ClientSpike[];
};
```

**`LineChart` extension:**
```ts
interface LineChartProps {
  // ... existing
  dashedTail?: { fromIndex: number; toValue: number } | null;
}
```

When set, `LineChart` draws an additional dashed cubic segment from `points[fromIndex]` to a virtual endpoint at the next X step (one bucket past the last solid point) with Y derived from `toValue`. Stroke matches `color` but at ~50% opacity.

## Error handling

- **Backend `overviewDeltas`:** invalid date → fallback to default; prior window same-length. No 4xx beyond bad date parsing.
- **Backend `anomalies`:** stable result shape even when empty; no 4xx for empty data.
- **Frontend `Delta`:** if the hook errors, render nothing (graceful degradation — don't lie with a bogus "0%").
- **Frontend forecast tail:** if projection math fails (e.g., division by zero, NaN), don't render the tail.
- **Frontend `AnomaliesPanel`:** same pattern as `CostBucketDrawer` — skeleton on load, inline error + Retry on failure.

## Testing

### Backend (`test/reports.service.spec.ts`)

- `overviewDeltas`:
  - Computes prior window as `[from - (to-from), from)`.
  - Maps current + prior totals to `totalCostAud` cents → dollars.
  - Excludes soft-deleted tasks.
- `anomalies`:
  - Daily spike: seeded data with one day at 5× median above $50 → that day appears.
  - Daily spike: day at 5× median but only $20 total → NOT flagged (below floor).
  - Daily spike: only one non-zero day total (no baseline) → empty result.
  - Client spike: client with last-7d 3× baseline → flagged.
  - Client spike: brand-new client (no 83-day history) → NOT flagged.
  - Both: soft-deleted task entries excluded.

### Frontend

No FE test framework (consistent with rest of dashboard). Manual checklist:

- [ ] `Time tracked` and `Calculated cost` cards show delta on initial load.
- [ ] Switching topbar from `last 30d` to `last 7d` updates the delta and its label (`vs prior 7d`).
- [ ] Setting topbar to a custom range produces a delta with the matching same-length prior window.
- [ ] Prior=0, current>0 renders `new` (not `Infinity%`).
- [ ] Prior=current renders neutral `—`.
- [ ] Within `±2%` renders neutral `—`.
- [ ] Forecast tail appears as a dashed segment when viewing today on Daily view, this week on Weekly view, this month on Monthly view. Hover on the actual bucket shows a `Projected: $X` second line.
- [ ] Forecast tail disappears when:
  - Topbar set to a range ending in the past.
  - Switching from `Day` to `Week` mid-day on a day where the week has just started (<5% elapsed).
  - Actual-to-date is $0.
- [ ] Anomalies panel renders next to Alerts (or stacks under it on narrower viewports).
- [ ] Daily spike row links to `/time-entries?from=<day>&to=<day>` and the Time Entries page filters accordingly.
- [ ] Client spike row links to `/time-entries?search=<client>&from=<7d-ago>&to=<now>` and the page reflects the filter.
- [ ] Empty state displays when no anomalies in the window.

## Out of scope (deferred)

- Variance / anomaly signals for hours (only cost surfaced).
- Anomalies sorted by date AND multiplier together (currently date-desc for daily, multiplier-desc for clients).
- Forecast across multiple future buckets.
- Confidence bands or probabilistic projection.
- Per-card "history sparkline" inside `MetricCard` (different feature).

## Risks

- **Median over noisy data:** the daily-spike median uses 30 days. If a project has a single day of activity in that window, median is 0 → no signal. The `median > 0` guard prevents nonsensical multipliers but means sparse-data projects show no daily anomalies. Acceptable for the first version.
- **Forecast volatility at start-of-period:** the 5% elapsed-fraction floor mitigates wild projections at midnight / first-of-month. If a user wants the forecast earlier, they can wait — the chart stays usable without it.
- **`percentile_cont` performance:** computes a full sort per group. For 30 days of data, trivial. For 90 days × N clients in the client-spike query, still small (Postgres handles tens of thousands of rows easily).
- **Anomalies endpoint freshness:** results recompute on every request (no caching). For a dashboard with one-second SLA this is fine; if pageview rate goes up substantially, add a 60s React-Query stale time.

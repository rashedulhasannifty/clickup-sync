# Overview cost-trend chart — design

Date: 2026-05-21
Author: Rashedul + Claude
Status: approved (brainstorm phase)

## Goal

Add an ERP-style cost trend chart to the Overview page showing total client
labour cost over time, with daily / weekly / monthly granularity and a
per-client drill-down on click.

## Non-goals

- Per-client multi-series lines on the trend itself (rejected during
  brainstorming — drill-down on click was preferred).
- Comparison overlays ("vs previous period").
- Forecasting / projection lines.
- New top-level page; this lives on `/overview` only.
- Replacing or removing any existing Overview chart.

## User-facing behaviour

1. New full-width card appears between **Sync Health** and the existing 2-col
   charts grid. Title: "Client cost trend". Subtitle reflects current bucket
   and window (e.g. "Daily — last 30 days").
2. Card header has a **D / W / M** segmented toggle (right-aligned).
   - `D` → daily buckets, default window = rolling 30 days back from now
     (i.e. `from = now − 30 days`, `to = now`).
   - `W` → weekly buckets (week starts Monday, AU local), default window =
     rolling 12 weeks back from now.
   - `M` → monthly buckets (calendar month, AU local), default window =
     rolling 12 months back from now.
   - The window is rolling (not calendar-aligned). The current partial
     bucket — e.g. today on `D`, this week on `W` — is included and shown
     in its partial state; users can still click it to drill in.
3. **Topbar override:** if the user has set a non-default date range in the
   topbar, the chart uses that range instead of the bucket-specific default.
   The subtitle reflects the actual range in use.
4. Chart is a single area-line of total cost AUD per bucket. Buckets with
   zero spend render as zero points (not gaps), so the timeline is continuous.
5. Hover shows a tooltip: bucket label, total cost, total hours, entry count.
6. Click on a point opens a right-side drawer showing the per-client
   breakdown for that bucket.

### Drawer behaviour

- Title: "Cost by client" + bucket subtitle (e.g. "Week of May 18 – May 24,
  2026").
- Body: table with columns `Client`, `Hours`, `Cost (AUD)`, sorted by cost
  desc. Rows where `totalCostAud === 0` are filtered out client-side so the
  drawer doesn't list every known client.
- Each row links to `/time-entries?from=<bucketStart>&to=<bucketEnd>&search=<client>`.
- Footer total: sum of cost across visible rows (should match the clicked
  point's value).
- Loading: skeleton table rows.
- Error: inline error + Retry button. Drawer stays open.

## Architecture

### Backend — one new endpoint

```
GET /reports/time-entries/cost-trend
  ?bucket=day|week|month   (required)
  &from=ISO date           (optional; default depends on bucket)
  &to=ISO date             (optional; default = now)
```

Response:

```json
[
  { "bucket": "2026-05-15", "totalCostAud": 1432.50, "totalHours": 18.25, "entryCount": 9 },
  { "bucket": "2026-05-16", "totalCostAud": 0,       "totalHours": 0,     "entryCount": 0 },
  ...
]
```

- `bucket` is the **start** of the period in ISO date form (`YYYY-MM-DD`).
- Sorted ascending by `bucket`.
- Empty buckets included with zero values (via `generate_series` joined to
  the aggregate).
- Excludes entries with `start_time IS NULL`.
- Excludes soft-deleted tasks (consistent with `timeEntriesByClient`).
- 400 on invalid `bucket` value.

#### SQL shape (Postgres)

```sql
WITH series AS (
  SELECT generate_series(
    date_trunc($BUCKET, $FROM::timestamptz AT TIME ZONE 'Australia/Sydney'),
    date_trunc($BUCKET, $TO::timestamptz   AT TIME ZONE 'Australia/Sydney'),
    ('1 ' || $BUCKET)::interval
  ) AS bucket_local
),
agg AS (
  SELECT
    date_trunc($BUCKET, e.start_time AT TIME ZONE 'Australia/Sydney') AS bucket_local,
    COALESCE(SUM(e.cost_cents), 0)::bigint   AS total_cost_cents,
    COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
    COUNT(*)::int                             AS entry_count
  FROM clickup_time_entries e
  JOIN clickup_tasks t ON e.task_id = t.task_id
  WHERE e.start_time IS NOT NULL
    AND e.start_time >= $FROM
    AND e.start_time <= $TO
    AND t.is_deleted = false
  GROUP BY 1
)
SELECT
  to_char(s.bucket_local, 'YYYY-MM-DD')        AS bucket,
  COALESCE(a.total_cost_cents, 0)              AS total_cost_cents,
  COALESCE(a.total_hours, 0)                   AS total_hours,
  COALESCE(a.entry_count, 0)                   AS entry_count
FROM series s
LEFT JOIN agg a ON a.bucket_local = s.bucket_local
ORDER BY s.bucket_local ASC;
```

Notes:
- `$BUCKET` is a validated string literal interpolated server-side after the
  enum check; not passed as a bind parameter (`date_trunc` requires a literal
  in some clients).
- Existing index on `clickup_time_entries.start_time` is sufficient; bucket
  count is small (max ~365 daily) so no further indexing needed.

### Backend — drawer reuses existing endpoint

`GET /reports/time-entries/by-client?from=<bucketStart>&to=<bucketEnd>` is
already implemented and returns the exact shape the drawer needs. No new
endpoint required.

Bucket-end calculation (frontend, before fetching for drawer):

```
day   → end = bucketStart + 1 day  - 1 ms
week  → end = bucketStart + 7 days - 1 ms
month → end = first day of next month - 1 ms
```

`from` is inclusive, `to` is inclusive — matches existing `timeEntriesByClient`
(`e.start_time >= from AND e.start_time <= to`).

### Frontend components

| Component | New / changed | Responsibility |
|---|---|---|
| `apps/web/src/pages/OverviewPage.tsx` | changed | Renders the new card between Sync Health and the charts grid. |
| `apps/web/src/components/charts/CostTrendCard.tsx` | new | Card wrapper: title, subtitle, D/W/M toggle, chart canvas, owns selected-bucket state, mounts the drawer. |
| `apps/web/src/components/charts/LineChart.tsx` | changed | Add `onPointClick(bucket, value)`, visible markers, hover tooltip. Keep existing area-fill look. |
| `apps/web/src/components/CostBucketDrawer.tsx` | new | Slides in from right via existing `Drawer`. Shows per-client table for the bucket. |
| `apps/web/src/hooks/useReports.ts` | changed | Add `useCostTrend(bucket, from, to)`. |
| `apps/web/src/api/reports.ts` | changed | Add `fetchCostTrend(...)`. |
| `src/reports/reports.controller.ts` | changed | Add `@Get('time-entries/cost-trend')`. |
| `src/reports/reports.service.ts` | changed | Add `costTrend(bucket, from, to)` method. |

### Data flow

```
OverviewPage
  └─ CostTrendCard (bucket: 'day'|'week'|'month'; selectedBucket: string|null)
       ├─ resolveRange(bucket, topbarRange)
       │     → topbar set?  use topbar range
       │     → else         derive default per bucket (30d / 12w / 12m back)
       ├─ useCostTrend(bucket, from, to)   →  GET /reports/time-entries/cost-trend
       └─ LineChart  onPointClick → setSelectedBucket(bucket)
            └─ CostBucketDrawer (open = !!selectedBucket)
                  └─ useTimeEntriesByClient(bucketStart, bucketEnd)
                         → existing GET /reports/time-entries/by-client
```

### State / cache

- React-query keys:
  - Trend: `['reports', 'cost-trend', bucket, fromISO, toISO]`
  - Drawer: `['reports', 'by-client', bucketStartISO, bucketEndISO]` —
    parameters distinct from the main Overview "by-client" query so they
    don't collide in cache.

## Error handling

- **Backend**
  - Invalid `bucket` value → `400 BadRequestException`.
  - `from > to` after parsing → `400 BadRequestException`.
  - DB error bubbles up via existing global filter; controller doesn't catch.
- **Frontend**
  - Trend query failure → inline `QueryError` style row above the chart;
    chart area renders `ChartEmpty`.
  - Drawer query failure → inline error inside the drawer body with Retry.
  - All-zero result → chart still renders (a flat line at 0); subtitle shows
    "no spend in this period".

## Timezone

All bucketing done in **`Australia/Sydney`** local time. A time entry whose
UTC `start_time` is `2026-05-20T23:30:00Z` (which is May 21 09:30 AEST) must
land in the May 21 day bucket. The SQL uses
`date_trunc(bucket, start_time AT TIME ZONE 'Australia/Sydney')` to enforce
this.

`generate_series` also runs in local time so empty-bucket fill aligns with
the aggregate.

## Testing

### Backend specs (`test/reports.service.spec.ts`)

- `costTrend('day', ...)`:
  - Seeded data: 3 entries on 2026-05-18, 0 on 2026-05-19, 2 on 2026-05-20,
    window = May 18 – May 20.
  - Asserts 3 buckets returned, May 19 row has zeros, totals sum correctly.
- `costTrend('week', ...)`:
  - Two entries in two adjacent ISO weeks; asserts each week bucket has
    correct sum and `bucket` is Monday in `YYYY-MM-DD` form.
- `costTrend('month', ...)`:
  - One entry on the last day of one month (AU local) and one on the first
    day of the next; assert they're in different buckets.
- Timezone edge case: entry with UTC `start_time = '2026-05-20T23:30:00Z'`
  groups into the `2026-05-21` daily bucket (Sydney is UTC+10).
- Excludes soft-deleted tasks: entry on a `is_deleted = true` task isn't
  counted.
- Excludes entries with `start_time IS NULL`.

### Backend controller (`test/reports.controller.spec.ts`)

- Existing spec gets a case rejecting `bucket=hour` with `400`.
- A passing case asserts the controller calls `reports.costTrend` with the
  correct args.

### Frontend

No frontend test framework exists in `apps/web` (consistent with the rest of
the dashboard). Manual verification checklist:

- [ ] D/W/M toggle switches the data and subtitle correctly.
- [ ] Topbar "last 7 days" override is reflected in subtitle and chart.
- [ ] Click on a daily point opens the drawer with that day's per-client
      breakdown; row "Open in Time Entries →" link carries the right
      from/to/search query params.
- [ ] Click on a weekly bar opens drawer with a 7-day window; total
      across drawer rows matches the clicked point's value.
- [ ] Empty window (no entries) shows zero-line + "no spend in this period"
      subtitle, no crash.
- [ ] Network failure on trend renders inline error, no white-screen.
- [ ] Drawer Retry button re-fetches after a transient failure.
- [ ] Card respects dark mode (existing `--accent` token).

## Out of scope (deferred)

- Per-client multi-series lines on the trend (would change the data model
  meaningfully — separate spec if requested).
- CSV export of the trend (could reuse the existing `csv.ts` helper later).
- Comparison overlay ("this period vs previous").
- Saved chart preferences (last selected bucket persisted in localStorage).

## Risks

- **Timezone correctness** — if `pg_timezone_names` doesn't include
  `Australia/Sydney` in some environment the query fails. Mitigated: this
  zone is in the default Postgres timezone DB and the deployment already
  uses Postgres 16. Spec covers a TZ assertion.
- **`date_trunc` literal vs parameter** — Prisma's `$queryRaw` passes
  values as bind parameters; `date_trunc` accepts the bucket as text, so
  this works, but we must still validate the input enum before reaching SQL
  to avoid odd inputs like `'microseconds'` producing bogus buckets.
- **Bucket-end inclusivity at boundaries** — the existing `by-client`
  endpoint uses `<=` on `to`, so a frontend-computed bucket end of
  `bucketStart + interval - 1ms` is safe (no double-counting at the
  boundary).

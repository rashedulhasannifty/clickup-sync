# User Daily-Hour Spikes — Design

**Date:** 2026-06-12
**Status:** Approved (design); pending implementation plan

## Problem

We sync ClickUp tracked time into `clickup_time_entries`, but there is no view that
shows how many hours a given user logged on a given day, nor any way to spot days
where a user logged an unusually high amount of time. The existing `AnomaliesPanel`
(Overview page) detects per-day **cost** spikes across all users — it does not break
down by user, and it works in cost, not hours.

We want a dedicated UI that:

1. Shows a **team-wide watchlist** of flagged spike days across all users.
2. Lets you pick a single user and see their **daily-hours chart**, with spike days
   highlighted.

## Detection rules

Bucketing is timezone-aware: a "day" is
`date_trunc('day', start_time AT TIME ZONE 'Asia/Dhaka')`, matching the rest of the
reports service.

For each `(user, local-day)` we sum `duration_hours`. A user-day is a **spike** if
**either** rule fires:

- **Absolute:** `daily_hours > cap`, where `cap` is the configurable org setting
  (default **12**). Catches over-logging and data errors.
- **Relative:** `daily_hours > 2 × (that user's median daily hours)` **AND**
  `daily_hours >= 4`. The 4-hour floor prevents users with a tiny median from being
  flagged on a normal short day (same spirit as the `> $50` floor in the existing
  cost anomaly logic).

The median is `percentile_cont(0.5)` over that user's days **with hours > 0** inside
the selected window.

The window honors the global date-range filter (the same one other report pages use),
falling back to 30 days when unset.

## Architecture

### Backend

#### 1. Configurable cap setting (extend `AppSettings`)

The cap is an **org-wide** server-side setting (single-tenant today; stored on the
existing singleton `AppSettings` row, mirroring the ClickUp-connection settings).

- **Migration** `0008_spike_hours_cap`: add column
  `spike_hours_cap INTEGER NOT NULL DEFAULT 12` to `app_settings`.
- **Prisma**: add `spikeHoursCap Int @default(12) @map("spike_hours_cap")` to the
  `AppSettings` model.
- **`SettingsService`**: add `getSpikeHoursCap(): number` (DB value, default 12 if
  null); include `spikeHoursCap` in `getMasked()`; accept it in `update()`.
- **`UpdateSettingsDto`**: add optional `spikeHoursCap` (integer, sensible bounds,
  e.g. `1..24`).
- **Endpoint**: reuse the existing `PATCH /admin/settings` (Owner-only). No new
  settings endpoint.

#### 2. Detection endpoint

- **Route**: `GET /reports/time-entries/hour-spikes` in `reports.controller.ts`,
  guarded like the other report endpoints (`@ApiSecurity('x-admin-key')`, auth guard).
- **Service**: `hourSpikes(filters)` in `reports.service.ts`, modeled on the existing
  `anomalies()` and `costTrendByAssignee()` raw-SQL methods.
- Reads the cap from `SettingsService.getSpikeHoursCap()`. The cap is **not**
  overridable per request — it is the org setting.
- SQL outline:
  - CTE `daily` — `SUM(duration_hours)` per `(user_id, user_name, day_local)` over
    the window, joined to `clickup_tasks` with `is_deleted = false` (matching the
    other reports' filtering).
  - CTE `medians` — `percentile_cont(0.5)` of `hours` per user over days with
    `hours > 0`.
  - Spike flag = `hours > :cap OR (hours > 2 * median AND hours >= 4)`.
  - Continuous day axis via `generate_series()` so the per-user chart has no gaps.

**Response shape:**

```jsonc
{
  "cap": 12,
  "watchlist": [
    {
      "userId": "123",
      "userName": "Rashedul",
      "date": "2026-06-10",
      "hours": 14.5,
      "median": 6.0,
      "multiplier": 2.42,        // hours / median (null if median is 0)
      "rule": "absolute" | "relative" | "both"
    }
    // ranked, highest first
  ],
  "byUser": {
    "buckets": ["2026-05-13", "...", "2026-06-12"],   // continuous day axis
    "users": [
      {
        "userId": "123",
        "userName": "Rashedul",
        "points": [{ "date": "2026-05-13", "hours": 5.5, "isSpike": false }]
      }
    ]
  }
}
```

### Frontend

#### 3. New page `HourSpikesPage.tsx`

- **Route + nav**: lazy-loaded route in `App.tsx` inside `<AppLayout>`; a new sidebar
  nav item (e.g. "Time Spikes").
- **API**: `reportsApi.hourSpikes(params)` in `api/reports.ts`; `useHourSpikes()`
  hook in `hooks/useReports.ts` (React Query, `keepPreviousData`, keyed on the global
  date range).
- **Layout:**
  - **Top — team watchlist**: ranked spike rows across all users, reusing the
    `AnomaliesPanel` visual language (amber marker; label like `2.4× their median`
    for relative or `>12h` for absolute; `both` shows both). Each row links to
    `/time-entries?userId=…&from=…&to=…` for drill-down.
  - **Bottom — per-user chart**: a user dropdown (populated from `byUser.users`);
    selecting one renders that user's daily-hours `BarChart` (existing hand-rolled
    SVG chart). Spike days render amber, normal days in the base color. A label/line
    indicates the current cap.
  - Honors the global date-range filter like the other report pages.

#### 4. Settings wiring

- Add a "Daily-hour spike cap" numeric input to the **Sync tab**'s cost/calculation
  section in `SettingsPage.tsx`, using the existing `useUpdateSettings()` hook and
  `useSettings()` for the current value. Owner-editable (the endpoint already enforces
  Owner-only for writes).

## Testing

- **`hourSpikes()` unit tests** (mirroring existing reports-service tests):
  - absolute-only trigger (hours over cap, but at/under 2× median)
  - relative-only trigger (hours over 2× median and ≥ 4, but ≤ cap)
  - 4-hour floor suppresses a small-median false positive (e.g. median 1h, day 3h)
  - neither rule triggers (normal day)
  - `both` classification when a day satisfies both rules
  - cap is read from `SettingsService` (a changed cap changes the flags)
- **Settings tests**: `spikeHoursCap` round-trips through `update()` and appears in
  `getMasked()`; default of 12 when unset.

## Decisions locked

- Cap is **org-wide only**, not per-view query-param overridable.
- Spike marker color is **amber**, matching the existing anomalies styling.
- No new background job / materialized table — computed on the fly in SQL over the
  already-indexed `start_time` (small window, cheap).

## Out of scope

- Per-org isolation of the cap (single-tenant today; lives on the singleton
  `AppSettings`). If/when Spec 2 multi-org lands, the cap moves with org settings.
- Alerting/notifications on new spikes (the Notifications tab is still a placeholder).
- Cost-based per-user spikes (this feature is hours-only; cost spikes remain in the
  existing `AnomaliesPanel`).

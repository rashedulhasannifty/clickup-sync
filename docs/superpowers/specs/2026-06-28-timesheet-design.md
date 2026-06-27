# Timesheet feature — design spec

**Date:** 2026-06-28
**Status:** Approved (ready for implementation plan)

## Summary

A ClickUp-style **Timesheet** view. The user selects a single assignee and a date
range (7 / 30 / 90 / custom days) and sees a per-day breakdown of that person's
tracked time, with per-task rows under each day showing hours and cost, day
subtotals, and a grand total. The view can be exported to a grouped Excel file.

This reuses the existing `reports` module, the existing assignee-list endpoint, the
existing Dhaka-day bucketing convention, the existing date-range preset control, and
the existing `exceljs` dependency. No new Nest module.

## Decisions (from brainstorming)

- **Assignee selection:** single assignee at a time.
- **Daily detail:** per-task rows under each day (task + hours + cost), day subtotal,
  grand total.
- **Columns:** hours **and** cost. A **Hide/Show Cost** toggle controls cost
  visibility on the page; the Excel export honors the toggle (cost hidden → cost
  omitted from the export). The export also respects the active assignee + date range.
- **Empty days:** weekdays (Mon–Fri) always appear, showing 0h when nothing was
  logged. Weekend days (Sat/Sun) appear only if they have entries.
- **Excel layout:** grouped like the on-screen view — a day header row, task rows
  beneath, a day subtotal row, repeated per day, then a grand-total row.
- **Auth:** same as all other `/reports/*` endpoints — any authenticated user (Owner /
  Admin / Member). Cost visibility matches existing reports, which already return cost
  to all authenticated users.

## Backend

### Endpoint

`GET /reports/timesheet`

| Param    | Required | Notes |
|----------|----------|-------|
| `userId` | yes      | ClickUp user id (`clickup_time_entries.user_id`). |
| `from`   | no       | ISO instant. Defaults to 30 days ago via the existing `parseDate` helper. |
| `to`     | no       | ISO instant. Defaults to now. |

Added as a method on `ReportsService` and a route on `ReportsController`, alongside
the existing time-entry report endpoints. Protected by the global `AuthGuard` like the
rest of the reports controller; no extra role gate.

### Query

One aggregation over `clickup_time_entries` joined to `clickup_tasks` for the task
name, filtered by `user_id = :userId` and `start_time` in `[from, to]`, grouped by
**Dhaka day** and `task_id`, summing `duration_hours` and `cost_cents`:

```sql
SELECT
  (e.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')::date AS day,
  e.task_id,
  MAX(t.name)                              AS task_name,
  SUM(e.duration_hours)                    AS hours,
  SUM(e.cost_cents)                        AS cost_cents,
  -- entries whose cost is not valid (no rate found)
  SUM(CASE WHEN e.status = 'NO_RATE_FOUND' THEN 1 ELSE 0 END) AS missing_rate_count
FROM clickup_time_entries e
LEFT JOIN clickup_tasks t ON t.task_id = e.task_id
WHERE e.user_id = :userId
  AND e.start_time >= :from
  AND e.start_time <= :to
GROUP BY day, e.task_id
ORDER BY day, task_name;
```

`start_time` is a UTC-naive `timestamp` column; it is labelled UTC before converting
to `Asia/Dhaka`, matching `costTrend` and the rest of the reports
(`dhaka-bucketing-utc-naive` convention). `cost_cents` is `BigInt`; convert to AUD as
`Number(cents) / 100`.

### Day skeleton and merge rule

The service builds the output day list deterministically so the table and the Excel
agree:

1. Compute the **Dhaka calendar dates** of `from` and `to` (convert the UTC instants to
   Dhaka, take the date part) — these bound the skeleton.
2. **Weekday skeleton:** every Mon–Fri date in `[fromDhaka, toDhaka]`.
3. **Output day set = weekday skeleton ∪ every day returned by the query.** This is what
   makes "weekends only if logged" work, and it also includes any boundary day an entry
   buckets into.
4. Sort ascending. Each day merges its aggregated task rows (or `tasks: []` for an empty
   weekday).

### Cost / missing-rate handling

Entries with status `NO_RATE_FOUND` have no valid cost. Per the data-model rule (*"do
not silently calculate cost as valid when no rate exists"*), cost for such rows must
**not** be summed into a `$0` that reads as real:

- A task row's `costAud` is `null` when **all** of its entries are missing a rate.
- `missingRateCount` is surfaced per task row, per day, and at the grand-total level.
- The UI renders `null` cost as `—` (not `$0.00`) and shows a small "N entries missing a
  rate" note where `missingRateCount > 0`.
- Day/grand subtotals sum only the entries that have a valid cost; the missing-rate
  count communicates the gap.

### Response shape (single source of truth for table + Excel)

```jsonc
{
  "userId": "12345",
  "userName": "Rashedul",
  "from": "2026-05-29T...",
  "to":   "2026-06-28T...",
  "days": [
    {
      "date": "2026-06-22",
      "weekday": "Mon",
      "isWeekend": false,
      "tasks": [
        { "taskId": "86abc", "taskName": "Build X", "hours": 3.5, "costAud": 140.0, "missingRateCount": 0 }
      ],
      "subtotalHours": 3.5,
      "subtotalCostAud": 140.0,
      "missingRateCount": 0
    },
    {
      "date": "2026-06-23",
      "weekday": "Tue",
      "isWeekend": false,
      "tasks": [],
      "subtotalHours": 0,
      "subtotalCostAud": 0,
      "missingRateCount": 0
    }
  ],
  "totalHours": 41.0,
  "totalCostAud": 1640.0,
  "missingRateCount": 0
}
```

## Frontend

New page in `apps/web/src/pages/TimesheetPage.tsx`, with a route and a sidebar nav
entry, following the existing report-page patterns (React Query + axios, Tailwind).

- **Assignee dropdown:** populated from the existing `/reports/time-entries/assignees`
  endpoint (hook). Until an assignee is chosen, show a "Select an assignee" empty state
  and do not fire the timesheet query.
- **Date range:** reuse the existing 7d / 30d / 90d / custom preset control (same one
  other report pages use).
- **Hide/Show Cost toggle:** local UI state. Hiding cost hides the cost columns in the
  table and removes them from the export.
- **Data hook:** `useTimesheet({ userId, from, to })` (React Query, `enabled: !!userId`,
  `keepPreviousData`).
- **Table:** for each day, a day header row (date · weekday · subtotal hours · subtotal
  cost), task rows beneath (task name/link · hours · cost), and a grand-total footer.
  Weekend rows are visually muted. `costAud: null` renders as `—` with a missing-rate
  hint.

## Excel export

- An **Export Excel** button builds the file client-side from the same `useTimesheet`
  response using `exceljs` (already a dependency; reuse the lazy-load + styling approach
  in `apps/web/src/lib/xlsx.ts`).
- **Grouped layout:** for each day — a day header row (date + weekday + day subtotal),
  task rows beneath, then repeated per day, then a grand-total row at the bottom. Money
  and number cells are typed like the existing export util; missing-rate cost cells are
  blank (not `0`).
- The **cost columns are omitted** when the Hide Cost toggle is on.
- Filename: `timesheet-{assigneeName}-YYYY-MM-DD.xlsx`.
- Because the export is built from the loaded response, it inherently respects the active
  assignee + date range and the cost toggle.

Note: this grouped layout differs from the existing flat `exportXlsx` helper. Add a
dedicated grouped-export function (in `xlsx.ts` or a sibling) rather than overloading the
flat helper.

## Testing

Backend service unit tests (the high-value layer — bucketing, skeleton, sums):

1. **Bucketing + skeleton + weekend rule:** a fixed set of entries spanning a Mon, a Fri,
   and a Sat → asserts each entry lands on the correct Dhaka day, every Mon–Fri in range
   appears (empty weekdays have `tasks: []`, 0 subtotal), the Sat appears because it has
   entries, an empty Sun does **not** appear, per-task sums and the grand total are
   correct.
2. **Dhaka-day boundary:** an entry at `2026-06-22T20:00:00Z` (early Jun 23 in Dhaka,
   UTC+6) buckets into `2026-06-23`, and a range-boundary day with an entry appears —
   proving the skeleton ∪ entry-days union, not just the bucket.
3. **Missing rate:** a task whose only entry is `NO_RATE_FOUND` yields `costAud: null`
   and `missingRateCount: 1` at task / day / grand-total levels; cost is never reported
   as `$0` for it.

Frontend: a light render/interaction test for the page is optional; the export and
grouping logic derive from the typed response, so the backend tests carry the core
guarantees.

## Out of scope

- Multiple-assignee timesheets (single assignee only).
- Editing time entries from this view (read-only).
- Per-ORG isolation (tracked separately as Spec 2).
- Currency rename (`*Aud` fields hold USD in practice; not touched here — see
  `currency-aud-usd-debt`).

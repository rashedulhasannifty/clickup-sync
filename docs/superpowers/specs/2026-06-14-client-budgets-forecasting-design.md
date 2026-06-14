# Client Budgets & Forecasting — Design

**Date:** 2026-06-14
**Status:** Approved, ready for implementation plan
**Branch:** `feat/budgets-forecasting`

---

## Goal

Let the team set a recurring monthly budget per client and see, for any month,
how actual spend tracks against that budget plus a month-end forecast. This is
dashboard-only: visual surfaces and status badges, no proactive notifications
(those belong to the separate general alerting-engine feature).

This builds directly on data already collected — `clickup_tasks.client` and the
calculated `clickup_time_entries.cost_cents` — and mirrors the existing
effective-dated `AssigneeRate` pattern.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Budget dimension | **Client** only (not space/department/assignee). |
| Time model | **Recurring monthly amount**, effective-dated (mirrors `AssigneeRate`). |
| Spend metric | **Both**, cost is primary; hours shown alongside for context. |
| Forecast method | **Both** (linear run-rate + trailing-average), UI toggle. |
| Notifications | **Dashboard-only** for now. No emails. |
| Run-rate day basis | **Business days** (Mon–Fri), no holiday calendar (YAGNI). |
| Default currency | **`USD`** (honest; see currency AUD/USD debt — no field rename here). |

## Non-goals

- No emails / Slack / background alert jobs (defer to the alerting-engine feature).
- No multi-dimension budgets (space/department/assignee). Build client cleanly so
  a second dimension *could* be added later; do not abstract prematurely.
- No holiday calendar for business-day counting.
- No budget rollover / carry-forward between months.

---

## 1. Data model

New Prisma model, mirroring `AssigneeRate` exactly (effective-dated,
closed-closed `[validFrom, validTo]` interval, latest-`validFrom`-wins on overlap):

```prisma
model ClientBudget {
  budgetId           BigInt    @id @default(autoincrement()) @map("budget_id")
  client             String                                   // matches clickup_tasks.client (free string)
  monthlyAmountCents BigInt    @map("monthly_amount_cents")    // integer cents, like hourly_rate_cents
  currency           String    @default("USD")
  validFrom          DateTime  @map("valid_from") @db.Date
  validTo            DateTime? @map("valid_to")  @db.Date
  notes              String?
  updatedAt          DateTime  @default(now()) @updatedAt @map("updated_at")

  @@unique([client, validFrom])
  @@index([client, validFrom, validTo])
  @@map("client_budgets")
}
```

### Migration

- Hand-author `prisma/migrations/0011_client_budgets/migration.sql` (CREATE TABLE +
  unique constraint + index), then `npm run prisma:generate` and
  `npm run prisma:deploy`. **Do not** run `prisma migrate dev` — the schema drifts
  from migrations and `migrate dev` would try to reconcile the whole history.

### Budget resolution for a month

Given a target month, resolve the single applicable budget row exactly like
`cost-calculator.service.ts` resolves a rate:

- `validFrom <= <month_end_date>` AND (`validTo IS NULL` OR `validTo >= <month_start_date>`)
- `orderBy: { validFrom: 'desc' }`, `findFirst`

So if two budget rows overlap a month, the one with the later `validFrom` wins.
The human convention (a row ending the last day of a month, the next starting the
first day of the next month — no gap, no overlap) matches the rates convention.

---

## 2. Forecasting math (server-side)

All computed in the reports query/service so timezone and business-day logic
stays in one tested place (never in the browser).

Let the target month default to the **current Dhaka month** (`?month=YYYY-MM`
overrides). All spend is bucketed by Dhaka day/month using the established
expression `e.start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka'`
(`start_time` is `timestamp without time zone` holding UTC — see the Dhaka
bucketing memory; do not skip the conversion or months shift −6h).

Per client, for the target month:

- **MTD actual cost** = `SUM(cost_cents)` for entries whose Dhaka day ∈ `[month_start, today]`.
- **MTD actual hours** = `SUM(hours)` over the same window.
- **Daily series** = cost per Dhaka day from `month_start` to `today` (continuous,
  zero-filled), feeding the burn-down chart.
- **Linear run-rate forecast** =
  `mtd_cost ÷ business_days_elapsed × business_days_in_month`.
  - `business_days_elapsed` = Mon–Fri days from `month_start` through `today` (Dhaka).
  - Guard: if `business_days_elapsed == 0` (e.g. 1st of month is a weekend),
    forecast = `mtd_cost` (no projection yet) to avoid divide-by-zero.
- **Trailing-average forecast** =
  `mtd_cost + (avg_daily_cost_last_7_calendar_days × remaining_calendar_days)`.
  - `avg_daily_cost_last_7_days` uses the last 7 calendar days up to and including
    today (Dhaka), cost summed and divided by 7.
  - `remaining_calendar_days` = days after today through `month_end`.
- **Past months** (target month is entirely in the past): `business_days_elapsed
  == business_days_in_month` and `remaining_calendar_days == 0`, so **both
  forecasts equal the actual**. No special-casing needed beyond the elapsed math
  being driven by `min(today, month_end)`.

### Status

Backend returns the raw numbers; the badge is derived from them. `pctOfBudget =
mtd_cost / monthly_amount`. The server-computed `status` and `forecastPct` use the
**run-rate forecast** (the UI default), since the backend cannot know the client's
toggle state. Both `forecastRunRate` and `forecastTrailing` are in the payload, so
when the user flips the toggle the client recomputes `forecastPct` and the badge
from the trailing number without a refetch. (Status logic lives in one shared
helper used by both sides so server and client agree.)

| Status | Rule |
|---|---|
| `over` | `pctOfBudget >= 1.0` (actual already at/over budget) |
| `projected-over` | `forecastPct >= 1.0` AND `pctOfBudget < 1.0` |
| `near` | `forecastPct >= 0.85` AND not over/projected-over |
| `under` | otherwise (has a budget) |
| `no-budget` | client has spend in the month but no resolved budget row |

`no-budget` rows are surfaced (sorted to the bottom) so unbudgeted-but-active
clients are visible rather than silently absent — they get a "Set budget" action.

---

## 3. Backend API

New module `src/budgets/` with `BudgetsService` + `BudgetsRepository`, following
the `src/rates/` layout. CRUD lives on the existing `AdminController`; the
read/status endpoint lives on `ReportsController`.

```
GET    /admin/budgets                 — list all budgets (Admin+)         page?/limit?
POST   /admin/budgets                 — create
PATCH  /admin/budgets/:id             — update
DELETE /admin/budgets/:id             — delete

GET    /reports/budgets/status?month=YYYY-MM
       → [{
           client, monthlyAmount, currency,
           mtdCost, mtdHours,
           forecastRunRate, forecastTrailing,
           pctOfBudget, forecastPct,
           status,                       // over | projected-over | near | under | no-budget
           dailySeries: [{ date, cost }]
         }]
```

### DTOs (all editable fields whitelisted up front)

```ts
// CreateClientBudgetDto
client: string;             // required
monthlyAmountCents: number; // required, integer >= 0
currency?: string;          // default 'USD'
validFrom: string;          // required, ISO date 'YYYY-MM-DD'
validTo?: string;           // ISO date or omit for open-ended
notes?: string;

// UpdateClientBudgetDto — all optional, but INCLUDES every editable field
monthlyAmountCents?, currency?, validFrom?, validTo?, notes?, client?
```

> Note: `UpdateClientBudgetDto` deliberately includes `client` and every editable
> field so `ValidationPipe({ whitelist: true })` does not silently strip a field
> the UI sends — this is the bug class the tag-assignee map currently has
> (`tagName`/`active` stripped). Do not repeat it here.

### Cross-cutting

- CRUD write actions flow through the existing `AuditLogInterceptor` on
  `AdminController` → automatic audit-log entries, actor from the session user.
- Role gating via the global `AuthGuard` + `RolesGuard`: list/status readable by
  Member+, CRUD restricted to Admin+ (match how rates are gated).
- `GET /reports/budgets/status` reuses the Dhaka bucket/timezone SQL. If the
  bucket+TZ expression in `costTrendBySegment` factors out cleanly into a small
  shared private helper, extract it; otherwise duplicate the one-liner rather than
  forcing an awkward abstraction.

---

## 4. Frontend (`apps/web`)

### New `BudgetsPage.tsx` (route `/budgets`, sidebar entry)

- **Month picker**, defaults to the current month.
- **Status table** — columns: Client · Budget · MTD cost · MTD hours · % used ·
  Forecast · status badge. `no-budget` rows at the bottom with a **Set budget**
  action.
- **Forecast toggle** (Run-rate / Trailing) — switches the Forecast column value
  and the projection line in the chart. Recomputes the badge client-side from the
  already-fetched `forecastRunRate` / `forecastTrailing` (no refetch).
- **Per-client expand → burn-down chart** (Recharts): cumulative actual line vs.
  ideal-pace line vs. budget ceiling, with the selected forecast as a dashed
  projection to month-end.
- **CRUD** via a `BudgetModal` (modeled on `RateModal`): client (autocomplete from
  `GET /reports/clients`), amount, valid-from, valid-to, notes. Add / Edit /
  Delete (delete behind a confirm).
- **CSV export** of the status table, reusing `apps/web/src/lib/csv.ts`.
- **Role gating** via existing `RequireRole`: Members see read-only (no
  CRUD/Set-budget buttons); Admin/Owner can edit.

### Overview card

- "Clients over / projected over budget this month": a count plus the top
  offenders, linking to `/budgets`. Real data from `GET /reports/budgets/status`
  — no synthetic series, no hard-coded sparkline.

### API client / hooks

- `apps/web/src/api/budgets.ts` (CRUD) and the status call (add to `reports.ts`
  or a `budgets` reports section).
- `apps/web/src/hooks/useBudgets.ts` — TanStack Query hooks mirroring
  `useRates` / `useReports`. Mutations invalidate the budget list + status
  queries.

---

## 5. Testing

- `test/budgets.service.spec.ts`:
  - Budget resolution: effective dating, overlap → latest `validFrom` wins,
    open-ended (`validTo` null), month with no applicable row → `no-budget`.
  - Forecast math: mid-month run-rate, first-day divide-by-zero guard, trailing
    average, **past month ⇒ both forecasts == actual**.
  - Status thresholds: each of over / projected-over / near / under / no-budget.
  - Dhaka boundary: an entry logged late evening Dhaka near a month edge lands in
    the correct month (the −6h trap).
- `test/budgets.repository.spec.ts`: CRUD, mirroring the rates repository test.
- Reports status query test with mocked Prisma (shape + aggregation).
- Verify with `npm run test` and `npm run build`. (`npm run lint` is known-broken
  project-wide — do not block on it.)

---

## New / changed files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `ClientBudget` model |
| `prisma/migrations/0011_client_budgets/migration.sql` | New table (hand-authored) |
| `src/budgets/budgets.module.ts` | New module |
| `src/budgets/budgets.service.ts` | Resolution + forecast + status |
| `src/budgets/budgets.repository.ts` | CRUD |
| `src/admin/dto/create-client-budget.dto.ts` | Create DTO |
| `src/admin/dto/update-client-budget.dto.ts` | Update DTO (all fields whitelisted) |
| `src/admin/admin.controller.ts` | Budget CRUD endpoints |
| `src/reports/reports.controller.ts` | `GET /reports/budgets/status` |
| `src/reports/reports.service.ts` | Status query (reuse Dhaka bucketing) |
| `src/app.module.ts` | Register `BudgetsModule` |
| `apps/web/src/pages/BudgetsPage.tsx` | New page |
| `apps/web/src/components/BudgetModal.tsx` | CRUD modal |
| `apps/web/src/api/budgets.ts` | API client |
| `apps/web/src/hooks/useBudgets.ts` | Query/mutation hooks |
| `apps/web/src/pages/OverviewPage.tsx` | Add budget card |
| `apps/web/src/components/layout/*` (sidebar/routes) | `/budgets` nav entry |
| `test/budgets.service.spec.ts`, `test/budgets.repository.spec.ts` | Tests |

---

## Follow-up (separate effort — the "polish" batch)

Not part of this spec; tracked separately as small mechanical fixes:
tag-assignee `active`/`tagName` DTO whitelist bug, rates PATCH assignee-metadata,
Settings persistence for sync rules/notifications, command-palette task search,
task-drawer real history, `?userId=` deep link on AssigneeRatesPage. The
DTO-whitelist lesson is already applied to this spec's budget DTOs.

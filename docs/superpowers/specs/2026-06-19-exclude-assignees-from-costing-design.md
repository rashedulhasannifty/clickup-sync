# Exclude assignees from costing — design

Date: 2026-06-19

## Problem

Some assignees should never be costed (e.g. contractors billed elsewhere,
internal accounts, expense-only identities). Today, any assignee without an
effective rate produces time entries with cost status `NO_RATE_FOUND`, which:

- lists them on the **Missing Rates** page and in the "Without rate" badge, and
- nags us to set a rate we deliberately do not want to set.

We still want to **see their tasks and time entries everywhere** — we just don't
want them flagged as missing a rate, and we don't want to invent a rate for them.

## Goal

Let an admin mark specific assignees as **excluded from costing**. Excluded
assignees:

- need no rate and never appear as "missing rate",
- keep their tasks and time entries visible everywhere,
- contribute their **hours** to totals but **$0** to cost (a free resource),
- are clearly marked as intentionally excluded (not confused with a real $0 rate
  or a genuine missing rate).

Non-goals: hiding excluded assignees' activity, per-space/per-client exclusion,
time-bounded exclusion (it is a simple on/off list).

## Core design

Introduce a third cost status, **`COST_EXCLUDED`**, alongside the existing
`COST_CALCULATED` and `NO_RATE_FOUND`. The exclusion decision lives in exactly
one place — `CostCalculatorService.calculate()` — so every code path that costs
an entry (webhook sync, backfill, recalc) honours it automatically.

An excluded entry resolves to `{ rateId: null, currency: 'USD',
hourlyRateCents: 0n, costCents: 0n, status: 'COST_EXCLUDED' }`.

### Two definitions of "missing rate" — and why this works

"Missing rate" is computed two ways in the codebase:

1. **By status** — anything reading `status === 'NO_RATE_FOUND'` (the Time
   Entries status pill/filter, the `noRateFoundCount` summary).
2. **By rate-existence** — `missingRates()` uses `NOT EXISTS (assignee_rates …)`,
   and the `stats().missingRateEntries` counter uses `status != 'COST_CALCULATED'`.

The **status-based** consumers self-heal: once recalc rewrites an excluded
entry's status to `COST_EXCLUDED`, it stops matching `NO_RATE_FOUND`.

The **rate-existence** consumers do **not** self-heal — an excluded assignee
still has no `assignee_rates` row — so they need explicit filtering. There are
exactly two: `missingRates()` and `stats().missingRateEntries`.

## Storage

Excluded assignees live in **settings preferences** (the existing `app_settings`
JSON), not a new table:

```ts
cost: {
  …,
  excludedAssignees: { id: string; name: string | null; email: string | null }[];
}
```

Rationale (not just "no migration"):

- `CostCalculatorService.calculate()` runs per-entry inside tight recalc loops
  and must stay **synchronous**. `SettingsService` already exposes a sync
  in-memory cache (`getPreferences()`); a table would force rebuilding that same
  cache layer just to feed the hot path.
- No schema migration — avoids the known migration-drift friction.
- Audit ("who excluded whom") is already captured by `AuditLogInterceptor`
  because the toggle goes through an `AdminController` write endpoint, so a
  table's audit advantage does not apply.
- `deepMergePrefs` **replaces arrays wholesale**, which is exactly why the
  "send the full new list" (PUT) update model works cleanly.

`name`/`email` are snapshotted for display so the management UI needs no extra
lookup.

## Backend changes

1. **`SettingsService` / `settings.service.ts`**
   - Add `excludedAssignees` to `SettingsPreferences.cost` and to
     `DEFAULT_PREFERENCES` (`[]`).
   - Add a sync helper `getExcludedAssigneeIds(): Set<string>` built from
     `getPreferences().cost.excludedAssignees`.

2. **`CostCalculatorService` / `cost-calculator.service.ts`**
   - After the `if (!userId || !startTime)` guard, before the `nonBillableZero`
     branch:
     ```ts
     if (this.settings.getExcludedAssigneeIds().has(userId)) {
       return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'COST_EXCLUDED' };
     }
     ```
   - Exclusion takes precedence over `nonBillableZero` and rate lookup.

3. **Recalc on toggle**
   - When the excluded list changes, enqueue a scoped `recalculate-costs` job
     (queue `maintenance`) for each newly-added and newly-removed assignee id,
     flipping their existing entries between `NO_RATE_FOUND` ⇄ `COST_EXCLUDED`.
     Reuses the existing rate-change recalc path
     (`CostRecalculationService.recalculate({ assigneeId })`).

4. **`reports.service.ts` `missingRates()`**
   - Add an exclusion filter to the `missing` CTE using the empty-safe form
     (Postgres `NOT IN ()` is a syntax error):
     ```sql
     AND e.user_id <> ALL(${Prisma.sql`array[${...ids}]::text[]`})
     ```
     With an empty list, `<> ALL(array[]::text[])` is `true` for every row, so
     no special-casing is needed.

5. **`reports.service.ts` `stats()`**
   - Change `missingRateEntries` count from `status: { not: 'COST_CALCULATED' }`
     to `status: { notIn: ['COST_CALCULATED', 'COST_EXCLUDED'] }`, else excluded
     entries keep inflating the "Without rate" badge.

6. **Admin endpoint — `AdminController`**
   - `PUT /admin/excluded-assignees` — body is the **whole** list
     `{ assignees: { id, name, email }[] }`; replaces the stored array. Owner/Admin
     gated like other admin writes; audited by `AuditLogInterceptor`.
   - Diff old vs new list to decide which assignee ids to recalc (added ∪ removed).
   - Persist via `SettingsService.update({ preferences: { cost: { excludedAssignees } } })`.

7. **Picker source endpoint — `reports.controller.ts`**
   - `GET /reports/time-entries/assignees` — distinct `(user_id, user_name,
     user_email)` from `clickup_time_entries` where `user_id IS NOT NULL`,
     ordered by name. Feeds the "Exclude assignee" picker (all assignees with
     time entries, so we can pre-emptively exclude someone who currently has a
     rate).

8. **Test — `cost-calculator.service.spec.ts`**
   - Add a `COST_EXCLUDED` branch test mirroring the existing `NO_RATE_FOUND`
     cases (required by CLAUDE.md: a test per new cost-status branch). Cover:
     excluded user returns `COST_EXCLUDED` with `costCents: 0`, and exclusion
     wins over `nonBillableZero`.

## Frontend changes

1. **Assignee Rates page (`AssigneeRatesPage.tsx`)** — new **"Excluded
   assignees"** card (admin-only controls):
   - Lists currently-excluded assignees (avatar, name, email) each with a
     **Remove** (un-exclude) button.
   - An **"Exclude assignee"** action opens a searchable picker populated from
     `GET /reports/time-entries/assignees`.
   - Add/remove issues a `PUT /admin/excluded-assignees` with the full new list,
     then shows a toast ("recalculation queued — costs update shortly").

2. **Time Entries page (`TimeEntriesPage.tsx`)**
   - **Status pill** is currently binary (`COST_CALCULATED` → green, *else* →
     amber "no rate found"). A `COST_EXCLUDED` entry would wrongly render "no
     rate found". Add a third case → grey **"Excluded"** pill.
   - **Status filter dropdown** (`STATUS_OPTIONS`) — add `{ value:
     'COST_EXCLUDED', label: 'Excluded' }`.
   - **Cost column** — for `COST_EXCLUDED`, show a muted **"Excluded"** label
     instead of the "—"/`$0.00` rendering, so it is distinct from a real $0 rate.

## Data flow

```
admin toggles exclude  →  PUT /admin/excluded-assignees (full list)
                           ├─ SettingsService.update(preferences.cost.excludedAssignees)
                           │     └─ refresh() → sync in-memory cache updated
                           └─ enqueue recalculate-costs per changed assignee id
                                 └─ CostRecalculationService.recalculate({assigneeId})
                                       └─ CostCalculatorService.calculate()
                                             └─ excluded? → status COST_EXCLUDED, cost 0
```

After recalc:
- status-based "missing rate" surfaces drop the assignee automatically,
- `missingRates()` and `stats().missingRateEntries` drop them via explicit
  filtering,
- Time Entries shows "Excluded" pill + "Excluded" cost,
- cost-trend / cost-by-assignee reports show them at $0 (hours still counted).

## Known consequence (intended)

Per the "hours yes, cost $0" decision: the weighted average rate
(`avgRateCents = totalCostCents / totalHours`, `reports.service.ts`) is diluted —
excluded hours add to the denominator with $0 in the numerator, lowering the
reported average $/h. This is the direct result of treating excluded assignees as
a free resource, not a bug.

## Error handling / edge cases

- **Empty list** — `<> ALL(array[]::text[])` is safe; `getExcludedAssigneeIds()`
  returns an empty set; nothing is excluded.
- **Excluding an assignee who already has a rate** — allowed (picker lists all
  assignees with time entries). Exclusion wins in `calculate()`, so their entries
  become `COST_EXCLUDED` regardless of the rate row, which remains untouched.
  Removing the exclusion + recalc restores normal rate-based costing.
- **Idempotency** — recalc is already idempotent; re-PUTting the same list
  recalcs only the diff (which may be empty → no-op).
- **Unknown assignee id in PUT** — accepted and stored (forward-compatible);
  recalc for an id with no entries is a harmless no-op.

## Out of scope

- Per-space / per-client / time-bounded exclusion.
- Hiding excluded assignees from activity views.
- Bulk import of exclusions.

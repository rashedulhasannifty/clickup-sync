# Rates-from-UI: Cost Recalculation, `valid_to` Fix, Google Sheets Removal

- **Date:** 2026-05-20
- **Status:** Design approved; implementation plan pending
- **Branch:** `feat/rates-from-ui-costs`

## 1. Background & problem

The service syncs ClickUp tracked time into `clickup_time_entries` and computes
labour cost using effective-dated `assignee_rates`. Investigation showed the
"manage assignee rates from the UI instead of Google Sheets" capability is
**already built**:

- Google Sheets sync is a no-op stub — `src/rates/rates.service.ts:9-12`.
- Backend CRUD exists — `RatesRepository` (`src/rates/rates.repository.ts`) and
  `GET/POST/PATCH/DELETE /admin/rates` (`src/admin/admin.controller.ts:165-197`).
- Frontend exists and is routed — `AssigneeRatesPage` at `/assignee-rates`
  (`apps/web/src/App.tsx:106-113`), `RateModal.tsx`, `hooks/useRates.ts`,
  `api/rates.ts`.
- `src/config/env.validation.ts` already dropped the `GOOGLE_*` vars.

Three gaps make the UI-managed rates flow not actually work:

1. **No cost recalculation.** `CostCalculatorService` only runs during
   time-entry *sync*. Creating/editing/deleting a rate via the API/UI does not
   recompute cost on existing `clickup_time_entries`; they stay
   `NO_RATE_FOUND` / cost `0` until every task is re-synced. There is no
   endpoint or button to trigger recompute.
2. **`valid_to` interval semantics are inconsistent.**
   `src/time-entries/cost-calculator.service.ts:12` treats `valid_to` as
   **inclusive** (`validTo >= entryDate`), but the UI
   (`apps/web/src/components/RateModal.tsx:467-479`, overlap check uses
   `< to`) and `src/reports/reports.service.ts:386` (`valid_to > date`) use a
   **closed-open `[from, to)`** interval. A time entry whose date equals a
   rate's `valid_to` is costed by that rate but simultaneously reported as a
   missing rate; boundary days are double-covered.
3. **Dead Google Sheets wiring is still active and misleading.** A daily 1 AM
   cron (`src/sync/sync.scheduler.ts:18-19`), `POST /admin/rates/sync`
   (`src/admin/admin.controller.ts:157-163`, Swagger text still says "from
   Google Sheets"), and the `ASSIGNEE_RATES` queue + `RatesSyncProcessor` +
   `JOBS.SYNC_ASSIGNEE_RATES` + `RatesService.syncRates()` all still exist and
   run the no-op. CLAUDE.md and `.env.example` still document Google Sheets.

## 2. Goals / Non-goals

**Goals**

- Recompute existing time-entry costs when a rate is created/edited/deleted:
  - **Automatic**, scoped to the changed assignee, on every rate mutation.
  - **Manual** "Recalculate costs" — global and per-assignee.
- Fix `valid_to` so cost calculation matches the canonical closed-open
  `[from, to)` contract already used by the UI and the missing-rates report.
- Remove all dead Google Sheets wiring and update docs.

**Non-goals (explicitly out of scope; flagged as separate follow-ups)**

- Security hardening (open CORS, always-on Swagger, fail-open guards, no rate
  limiting on the public webhook).
- The pre-existing `test/admin.controller.spec.ts` constructor-arity failure.
- `ClickupClient.getTimeEntries` pagination.
- Deeper correctness audit of `clickup-normalizer.ts` /
  `custom-field-extractor.ts` / `tasks.service.ts` / dead-letter-on-final-
  failure path.
- Server-side rate-overlap enforcement (UI only warns today).
- The non-functional "Export" button on `AssigneeRatesPage`.

## 3. Approved approach

**Approach A — async job on the existing idle `MAINTENANCE` queue, with
`RatesService` as the single mutation seam.** Cost logic stays single-sourced
in `CostCalculatorService`. Chosen over synchronous in-request recompute
(violates "respond fast, queue heavy work"; blocks UI; no retry) and over a
raw-SQL bulk update (duplicates effective-dating/rounding logic — the very
drift this spec fixes).

## 4. Detailed design

### 4.1 `valid_to` bug fix

`src/time-entries/cost-calculator.service.ts:12`: change the effective-date
predicate to an exclusive end:

```
where: { assigneeId: userId,
         validFrom: { lte: entryDate },
         OR: [{ validTo: null }, { validTo: { gt: entryDate } }] }
```

`validFrom: { lte }` (inclusive start) is unchanged — correct for `[from, to)`.
This makes the calculator agree with `RateModal` and `reports.missingRates`.
Closed-open `[from, to)` is documented as the canonical contract.

### 4.2 Recalculation core

New `src/time-entries/cost-recalculation.service.ts`:

- `recalculate({ assigneeId? }): Promise<{ scanned: number; updated: number }>`.
- Select `clickup_time_entries` filtered by `userId = assigneeId` (or all rows
  when `assigneeId` is omitted).
- For each entry, call the corrected
  `CostCalculatorService.calculate(userId, startTime, durationHours)` and write
  back `cost_cents`, `hourly_rate_cents`, `rate_id`, `currency`, `status`.
- Idempotent: re-running yields identical rows.
- Iterate in bounded chunks (e.g. 500) to avoid one giant transaction; per-row
  `update` is acceptable at expected volume (hundreds–low thousands).
- Write one `sync_job_logs` row via `JobLogsRepository` (queue `maintenance`,
  job `recalculate-costs`, `entityType: 'assignee'`,
  `entityId: assigneeId ?? '*'`, `timeEntriesSynced = updated`) for parity with
  other workers.

### 4.3 Async wiring

- `src/queues/queue.constants.ts`: add `RECALCULATE_COSTS: 'recalculate-costs'`.
  Reuse the existing `QUEUES.MAINTENANCE` (currently declared but unused).
- New `src/workers/cost-recalc.processor.ts`, `@Processor(QUEUES.MAINTENANCE)`,
  handling `RECALCULATE_COSTS` jobs (`{ assigneeId?: string }`) →
  `CostRecalculationService.recalculate(...)`, using
  `JobLogsRepository.started/finished/failed` like
  `time-entry-sync.processor.ts`. Register in `workers.module.ts`.
- `RatesService` is repurposed (its dead `syncRates()` is removed) to own the
  mutation seam:
  - `create(...)`, `update(id, ...)`, `remove(id)` wrap `RatesRepository`,
    then enqueue `MAINTENANCE / RECALCULATE_COSTS { assigneeId }` for the
    affected assignee after the DB write succeeds.
  - `RatesRepository.remove` currently returns `void`; it must return (or
    `RatesService` must first fetch) the deleted row's `assigneeId` so the
    recompute can be scoped. `update` already returns the mapped row
    (has `assigneeId`).
  - Enqueue happens **after** the DB write commits. If enqueue throws, the
    rate write is still successful — log the enqueue error and return success
    (the user can fall back to the manual Recalculate button). Document this
    ordering.
- `AdminController` rate routes (`createRate`/`updateRate`/`deleteRate`) call
  `RatesService` instead of `RatesRepository` directly. `listRates` stays a
  direct repo read.

### 4.4 Manual endpoints

- Replace `POST /admin/rates/sync` with
  `POST /admin/rates/recalculate` accepting optional `assigneeId` (query or
  body) → enqueue `MAINTENANCE / RECALCULATE_COSTS { assigneeId? }` →
  `{ queued: true, scope: assigneeId ?? 'all' }`.

### 4.5 Frontend

- `apps/web/src/api/rates.ts`: add `recalculate(assigneeId?)` →
  `POST /admin/rates/recalculate`.
- `apps/web/src/hooks/useRates.ts`: add `useRecalcCosts()` mutation; on success
  invalidate `['rates']`, `['time-entries']`, `['stats']`, `['missing-rates']`
  and surface a toast "Recalculation queued — costs update shortly".
- `apps/web/src/pages/AssigneeRatesPage.tsx`: a global "Recalculate costs"
  header button and a per-assignee card action calling
  `useRecalcCosts({ assigneeId })`.
- Automatic recalculation needs no UI (server-side via `RatesService`).
- Confirm during implementation there is no remaining "sync from Google
  Sheets" control in `SettingsPage` / `hooks/useAdmin` / `api/admin`; remove if
  present. (The non-functional "Export" button is out of scope.)

### 4.6 Dead Google Sheets removal checklist

- Delete `src/workers/rates-sync.processor.ts`; remove from
  `src/workers/workers.module.ts`.
- Remove `RatesService.syncRates()` (service repurposed per 4.3).
- Remove `JOBS.SYNC_ASSIGNEE_RATES` and `QUEUES.ASSIGNEE_RATES`, plus its
  `@InjectQueue` in `QueueService`, the `BullModule.registerQueue` entry, and
  the `QueueService.get()` map entry. Grep to confirm no other references
  before deleting the queue.
- Remove the `syncRates()` cron in `src/sync/sync.scheduler.ts` (and now-unused
  imports).
- Remove `POST /admin/rates/sync` (`src/admin/admin.controller.ts:157-163`).
- Docs: update `CLAUDE.md` (rates section, the `GOOGLE_*` env block, the
  queues list, common-tasks/security-checklist Google lines), `.env.example`
  (drop `GOOGLE_*` if present), and any `README.md` / `docs/ARCHITECTURE.md` /
  `docs/OPERATIONS.md` mentions of Google Sheets rate sync.

### 4.7 Data flow

```
Rate mutation (UI RateModal) ──▶ AdminController rate route
  ──▶ RatesService.{create|update|remove}
       ──▶ RatesRepository (DB write, committed)
       ──▶ QueueService.enqueue(MAINTENANCE, RECALCULATE_COSTS, {assigneeId})
  ──▶ CostRecalcProcessor
       ──▶ CostRecalculationService.recalculate({assigneeId})
            ──▶ per entry: CostCalculatorService.calculate (corrected [from,to))
            ──▶ update clickup_time_entries (cost_cents, rate_id, status, …)
            ──▶ sync_job_logs row
UI: toast + React Query invalidation; next refetch shows computed costs.
Manual button ──▶ ratesApi.recalculate ──▶ same endpoint + job.
```

## 5. Error handling

- Recalc jobs are idempotent and use the existing
  `QueueService.defaultJobOptions()` (attempts + exponential backoff).
  Failures are logged to `sync_job_logs` (status `failed`). Whether exhausted
  jobs route to `dead_letter_jobs` depends on the existing global failed-job
  handler — confirm that path exists during implementation; if it does not,
  note it as a separate follow-up (do not build it here).
- Rate write and recompute enqueue are ordered write-then-enqueue; an enqueue
  failure does not roll back or fail the rate mutation.
- An entry with no effective rate after recompute keeps the existing semantics:
  `status = NO_RATE_FOUND`, cost `0`, visible on the Missing Rates page.

## 6. Testing (TDD)

- `cost-calculator.service.spec.ts`:
  - Entry whose date equals a rate's `valid_to` is **not** matched by that rate
    (proves exclusive end).
  - Entry whose date equals `valid_from` **is** matched (inclusive start).
  - Open-ended rate (`validTo = null`) matches any date `>= validFrom`.
- `cost-recalculation.service.spec.ts`:
  - Scoped recompute updates only the targeted assignee's entries.
  - Idempotent: running twice produces identical rows.
  - No effective rate → `NO_RATE_FOUND` / cost `0`.
  - Prisma mocked (or test DB); cost decision delegated to the real
    `CostCalculatorService`.
- All existing tests stay green; `npm run build` clean. (The known unrelated
  `test/admin.controller.spec.ts` arity failure remains out of scope.)

## 7. Acceptance criteria

- Adding a rate in the UI results, within seconds (no full re-sync), in that
  assignee's time entries showing computed cost and `COST_CALCULATED`.
- Editing or deleting a rate recomputes that assignee's entries.
- Manual "Recalculate costs" works both globally and per-assignee.
- A time entry exactly on a rate's `valid_to` is excluded by that rate, and the
  cost calculator agrees with the Missing Rates report.
- No remaining `ASSIGNEE_RATES` queue, `RatesSyncProcessor`,
  `/admin/rates/sync`, or Google Sheets references in code or docs; build and
  tests green.

## 8. Out of scope / follow-ups

Security hardening; `admin.controller.spec` arity bug; `getTimeEntries`
pagination; normalizer/tasks/dead-letter deeper audit; server-side rate-overlap
enforcement; `AssigneeRatesPage` Export button; building a dead-letter path if
one is found missing during §5.

# Addendum — "Make all settings workable" (wire the safe ones)

Date: 2026-06-15. Branch: `feat/settings-persistence-and-polish` (continues the polish plan).

Scope chosen by user: **wire the safe ones**. Defer Default currency (AUD/USD column debt),
Pause-on-failure circuit breaker, and notification delivery (those stay preview).

Safe defaults principle: every new behavior is gated by a preference whose default reproduces
today's behavior, so nothing changes until a user opts in (and existing tests stay green).

## New preference keys (extend `SettingsPreferences`)

```
sync.realtimeWebhooks: boolean      // default true  — webhook ingestion on/off
sync.backfillOnConnect: boolean     // default true  — backfill enabled spaces on webhook register
cost.autoRecalcOnRateChange: boolean// default true  — rate edits enqueue recalc
cost.rateMatching: 'start' | 'due'  // default 'start'— which date selects the effective rate
cost.nonBillableZero: boolean       // default false — non-billable entries cost 0
failure.webhookRetryAttempts: number// default 5     — BullMQ attempts for webhook jobs (3|5|10)
```
(existing: `notifications.*`, `sync.reconcileLookbackDays`, `spaces`)

## Tasks

- **A. Preferences shape** — extend `SettingsPreferences` + `DEFAULT_PREFERENCES` in
  `src/settings/settings.service.ts`; mirror in `apps/web/src/api/settings.ts`; extend
  `test/settings.preferences.spec.ts` defaults.
- **B. Cost engine** — `CostCalculatorService` injects `SettingsService`; `calculate(userId,
  startTime, durationHours, cache?, opts?: { billable?: boolean; dueDate?: Date|null })`. If
  `cost.nonBillableZero && billable === false` → cost 0, status `COST_CALCULATED`, no rate lookup.
  Rate date = `cost.rateMatching === 'due' && opts.dueDate ? dueDate : startTime`. Update callers:
  `cost-recalculation.service.ts` (select `billable` + `task: { select: { dueDate: true } }`, pass
  opts), `time-entries.service.ts` (pass `billable`; build a taskId→dueDate map only when
  `rateMatching==='due'`), `assignee-replacement.service.ts` (pass `billable: data.billable`).
  Update `cost-calculator.service.spec.ts` constructor + add nonBillable/due-date tests.
- **C. Webhook retry + realtime toggle** — `QueueService` injects `SettingsService`, add
  `webhookJobOptions()` = `{ ...defaultJobOptions(), attempts: failure.webhookRetryAttempts }`.
  Webhook controller uses it AND early-returns `{ success: true, skipped: true }` when
  `!sync.realtimeWebhooks`. Admin `webhooks/retry-failed` re-enqueue uses `webhookJobOptions()`.
- **D. Backfill-on-connect + auto-recalc toggle** — `AdminController.registerWebhook` enqueues a
  backfill per **enabled** space when `sync.backfillOnConnect`. `RatesService.enqueueRecalc`
  no-ops when `!cost.autoRecalcOnRateChange` (inject `SettingsService`).
- **E. Frontend** — `SettingsPage`: un-disable + bind Real-time webhooks, Backfill on connect,
  Rate matching, Auto-recalc, Treat-non-billable-as-zero, Webhook retry; persist via `patchPrefs`
  (Owner-gated). Keep Default currency + Pause-on-failure disabled (preview). Reword the sync-tab
  "preview only" callout to list only the still-preview items; add a hint that changing rate
  matching / non-billable requires a Recalculate to apply to existing entries.

Verify per task: `npm run test` + `npm run build` (backend), `cd apps/web && npm run build`.
`npm run lint` is broken — ignore.

# Task chargeability — our own billable flag

**Date:** 2026-08-27
**Status:** Approved (design)

## Problem

Reporting currently splits time on ClickUp's per-time-entry `billable` flag
(`clickup_time_entries.billable`, populated by the normalizer from the ClickUp
API). We do not maintain that flag in ClickUp — nobody sets it there — so the
split it produces is noise, and the "Billable / Non-billable" numbers on the
dashboard mean nothing in practice.

We want our own flag, owned here, set by an Owner or Admin, named
**Chargeable / Non-chargeable**, with every task chargeable until someone says
otherwise.

## Why the task is the right grain

ClickUp's flag is per time entry. Ours is per **task**: chargeability is a
property of the work, not of a single sitting at it. The consequence is real and
intended — a task's time is now *entirely* chargeable or *entirely* not, and a
task with a mix of billable and non-billable ClickUp entries can no longer be
expressed. That expressiveness was never used deliberately, and per-task is what
somebody can actually maintain.

Entries with no task at all (`task_id IS NULL`, a real and deliberately-kept
case) have no flag to read and count as **chargeable**.

## Is it safe to put a user-owned column on synced data?

Yes, but it is a first and it needs a guardrail.

`TasksRepository.upsert` builds both its `create` and its `update` by spreading
`NormalizedTask`. A column that is not a field of `NormalizedTask` is therefore
never written by any sync path — webhook, backfill, reconcile, or manual sync.
`is_chargeable` survives resyncs for free.

That safety is incidental, not designed, and it is exactly the kind of thing a
later "let's make the upsert write every column" refactor destroys silently: the
flags would revert to `true` on the next resync of each task, with no error
anywhere. So:

- the column is declared in a labelled **local annotations** block in
  `schema.prisma`, separated from the mirrored ClickUp columns;
- `TasksRepository.upsert` carries a comment saying why it must not write it;
- a test asserts that upserting a task never includes `isChargeable` in either
  the `create` or the `update` payload.

`clickup_tasks` stops being purely a mirror of ClickUp and becomes *a mirror plus
locally-owned annotations*. That is the concept being introduced here; anything
added to that block later inherits the same rules.

## Decisions (confirmed)

1. **Non-chargeable time costs zero.** Not a setting — the rule. The existing
   `cost.nonBillableZero` preference is deleted, subsumed by this.
2. **The resolved rate is still stored.** Only `cost_cents` becomes `0`;
   `rate_id` and `hourly_rate_cents` are resolved and written as normal. The
   internal cost of unbilled work therefore stays recoverable as hours × rate,
   which zeroing all three would have thrown away permanently.
3. **A new `NOT_CHARGEABLE` cost status**, alongside `COST_CALCULATED`,
   `NO_RATE_FOUND` and `COST_EXCLUDED`. Reusing `COST_CALCULATED` (what the old
   `nonBillableZero` path did) would make one status mean two different things.
   It also keeps non-chargeable work out of Missing Rates — a non-chargeable
   entry with no rate is not a problem anyone needs to fix.
4. **ClickUp's `billable` keeps syncing and stops being read.** The column and
   the normalizer are untouched; nothing in reports, filters, cost or UI reads
   it. Dropping it would be an irreversible loss of synced ClickUp data for no
   gain.
5. **Owner and Admin only.** Matches every other write, and lands in the admin
   audit log automatically by living on `AdminController`. Members see the flag
   and get disabled controls.
6. **Set from the task drawer or from a bulk action** on the Tasks page
   selection, both through the same confirmation dialog.

## Cost calculation

`CostCalculatorService.calculate` takes `chargeable: boolean` in its `opts`,
sourced from the entry's task (absent task ⇒ `true`). The precedence becomes:

1. no `userId` / no `startTime` → `NO_RATE_FOUND` (unchanged)
2. excluded assignee → `COST_EXCLUDED` (unchanged)
3. **not chargeable** → resolve the rate, store it, `cost_cents = 0`,
   `NOT_CHARGEABLE`
4. otherwise → today's behavior

Non-chargeable is checked *before* the rate lookup can fail, so a missing rate
never masks it.

Every path that computes cost passes the flag: the sync path
(`time-entries.service.ts`), the recalculation service, and
`assignee-replacement.service.ts`. All three already join or can join the task —
the sync path already fetches `dueDate` per task for `rateMatching`, so the flag
rides along on the same lookup.

## Recalculation

`CostRecalculationService.recalculate` scopes by `assigneeId` today; it gains
`taskIds`. Toggling chargeability enqueues a scoped `recalculate-costs` job on
the existing `maintenance` queue, exactly as a rate change does. Idempotent.

No one-time migration recalc is needed: every task starts chargeable, so no
stored cost changes until somebody toggles something.

## API

| Endpoint | Purpose |
|---|---|
| `PATCH /admin/tasks/chargeable` | `{ taskIds: string[], chargeable: boolean }` → sets the flag, enqueues the scoped recalc, returns the affected counts. Owner/Admin; audited. |
| `GET /reports/tasks/chargeable-preview?taskIds=…` | Counts behind the confirmation dialog: tasks, time entries, hours. |

The preview cannot be computed client-side: Tasks rows carry ClickUp's
rolled-up `time_spent`, not our own entry count for the window.

Two details the dialog depends on:

- The preview reports **how many of the given tasks would actually change**, not
  just how many were passed. Marking twelve tasks non-chargeable when three
  already are should say nine, or the dialog overstates what is about to happen.
- `taskIds` is capped at **500 per request** (`400` beyond it), for both
  endpoints. A comma-separated list of ids in a query string is bounded by URL
  length, and the cap is well above any selection a person builds by hand. The
  UI never sends more because the selection lives on paged tables.

`PATCH /admin/tasks/chargeable` is likewise idempotent: setting a flag to the
value it already holds is a no-op that neither writes nor enqueues a recalc for
that task.

## Reporting

Every report that split on `clickup_time_entries.billable` reads the joined
task's `is_chargeable` instead, with a task-less entry counting as chargeable.

Renames, without aliases — this is an internal-only app and two names for one
concept is how the next bug gets written:

| Before | After |
|---|---|
| `?billable=true\|false` | `?chargeable=true\|false` |
| `billableHours` / `nonBillableHours` | `chargeableHours` / `nonChargeableHours` |
| `GET /reports/time-entries/billable-summary` | `GET /reports/time-entries/chargeable-summary` |
| `billableCostAud` / `nonBillableCostAud` | *(dropped — see below)* |

The summary loses its cost half: non-chargeable cost is always zero now, so
`nonBillableCostAud` would be a column of zeros and `billableCostAud` would
equal total cost. It becomes an hours split.

In the grouped-by-task view every row is wholly chargeable or wholly not, so the
row shows a **Chargeable** pill rather than a chargeable/non-chargeable hours
split. The flat entry view shows the same pill, resolved through the task.

`is_chargeable` also joins the tasks list payload (`GET /reports/tasks`) and the
task drawer, so the Tasks page can show the current state per row and the drawer
can toggle it. The Tasks page gets a Chargeable column; it does **not** get a
chargeable filter in this work — nobody has asked to slice tasks that way, and
the column plus sorting covers looking at them.

## UI

- **Task drawer** — a Chargeable toggle, disabled for Members.
- **Tasks page selection bar** — *Mark chargeable* / *Mark non-chargeable*,
  operating on the current selection.
- **Confirmation dialog** (required on both routes, existing `Modal`): names the
  task count, the time-entry count, the hours, and that costs will be
  recalculated. It is the only place the change is committed.
- Labels everywhere become Chargeable / Non-chargeable: filter options, drawer,
  breakdown panel, timesheet, metric cards.
- The `cost.nonBillableZero` control is removed from Settings.

## Order of work

1. Schema + migration + upsert guardrail test
2. Cost calculator: `chargeable` opt, `NOT_CHARGEABLE`, delete `nonBillableZero`
3. Recalculation `taskIds` scope
4. `PATCH /admin/tasks/chargeable` + preview endpoint
5. Reports read the task flag; renames
6. UI: labels, drawer toggle, bulk action, confirmation dialog

Steps 1–3 change stored values for nobody (everything is chargeable), so they
can land before the UI exists without any user-visible effect.

## Out of scope

- Writing the flag back to ClickUp. ClickUp has no field for it, and we are
  deliberately not maintaining theirs.
- Per-time-entry overrides. If one sitting on a chargeable task is not
  chargeable, that is a different feature and needs its own grain decision.
- Retro-reporting on what non-chargeable work cost. Decision 2 keeps the data
  needed for it; no report is built here.
- A chargeable filter on the Tasks or Time Entries pages beyond the existing
  (renamed) `chargeable` param on time entries.

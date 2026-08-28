# Per-assignee chargeability — one task, several billing answers

**Date:** 2026-08-28
**Status:** Approved (design)
**Extends:** [2026-08-27-task-chargeability-design.md](2026-08-27-task-chargeability-design.md)

## Problem

Chargeability is a single boolean on the task (`clickup_tasks.is_chargeable`).
A task with four people's tracked time is therefore entirely chargeable or
entirely not — there is no way to say "everyone's time on this task is billable
except Rashedul's".

That is a real case, and today the only ways to express it are both wrong: mark
the whole task non-chargeable (losing three people's billable hours), or leave
it chargeable and correct the invoice by hand outside the system.

## What this changes about the earlier grain decision

The previous spec argued for the task as the right grain, and listed
"per-time-entry overrides" as out of scope with the note that it *"needs its own
grain decision"*. This is that decision.

The task grain was not wrong — it is the right **default**. What was wrong was
treating it as a ceiling. The task flag stays exactly as it is and keeps meaning
what it means; two more specific layers are added above it, and each one is
optional. A workspace that never sets a rule behaves identically to today.

## The precedence stack

| # | Layer | Where it lives | Wins over |
|---|---|---|---|
| 0 | Assignee excluded from costing | `settings.cost.excludedAssignees` | everything |
| 1 | Per-entry override | `clickup_time_entries.chargeable_override` | 2, 3 |
| 2 | (task, assignee) rule | `task_assignee_chargeability` | 3 |
| 3 | Task flag | `clickup_tasks.is_chargeable` | the default |
| — | Default | — | `true` |

**Most specific wins, in either direction.** A rule can make one person's time
chargeable on a task that is otherwise non-chargeable, and an entry override can
contradict its own rule. This is deliberate: the alternative ("non-chargeable is
sticky, no layer can grant it back") cannot express "this task is internal
except the two hours we agreed to bill".

**Layer 0 is already implemented and needs no code.** `CostCalculatorService`
returns `COST_EXCLUDED` for an excluded assignee at
`cost-calculator.service.ts:30`, before chargeability is consulted at all. Global
exclusion therefore already sits on top of the stack. Do not re-implement it
inside the new resolver.

## Decisions (confirmed)

1. **A standing rule, plus a per-entry override.** The rule is the unit people
   actually maintain — "her time on this task is never billable" — and it
   applies to entries that sync *later*, which is the whole point. The override
   exists because a rule cannot express a one-off.
2. **The resolved answer is stored on the time entry, not computed on read.**
   A new `clickup_time_entries.is_chargeable` column, written by the same code
   that already writes `cost_cents`, `rate_id` and `status`.

   Computing it on read would turn every Time Entries query — the filter at
   `report-filter.util.ts:205` and the aggregates at
   `time-entries-report.service.ts:215` and `:268` — into a three-way join
   against the task *and* the rules table, on the app's hottest report path. One
   indexable boolean is better. The price is a backfill and a column that drifts
   if a write path forgets it, which is what the guardrail below defends.
3. **`COST_EXCLUDED` entries store `is_chargeable = true`.** Those rows never
   reach the chargeability branch. They represent work that *is* billable but
   deliberately isn't costed here (the `expense` pseudo-user and similar). Also
   the conservative choice: writing `false` would move the chargeable-hours KPI
   for existing data the moment the backfill runs, which is a behavior change
   this feature has no business making.
4. **Three entry points**, as chosen: the task drawer, a bulk action on the Time
   Entries page, and a rules admin screen.
5. **Owner and Admin only**, audited automatically by living under
   `AdminController` — same as `PATCH /admin/tasks/chargeable`.
6. **The task pill becomes tri-state** — Chargeable / Partial / Non-chargeable —
   and the `chargeable=true|false` filter resolves per entry rather than through
   the task join.

## Data model

```prisma
/// Local annotation. No sync path may write this — see the guardrail below.
model TaskAssigneeChargeability {
  taskId     String   @map("task_id")
  userId     String   @map("user_id")   // ClickUp user id; same identity as clickup_time_entries.user_id
  chargeable Boolean
  note       String?
  setBy      String?  @map("set_by")    // session user, shown on the rules screen
  updatedAt  DateTime @updatedAt @map("updated_at")

  task       ClickupTask @relation(fields: [taskId], references: [taskId], onDelete: Cascade)

  @@id([taskId, userId])
  @@index([userId])
  @@map("task_assignee_chargeability")
}
```

On `ClickupTimeEntry`, in a **local annotations** block mirroring the one in
`ClickupTask`:

```prisma
chargeableOverride Boolean? @map("chargeable_override")  // null = no override
isChargeable       Boolean  @default(true) @map("is_chargeable")  // resolved; written with cost
```

The rule keys on `userId`, not on a name. After tag→assignee replacement the
entry's `user_id` is the mapped assignee, which is the identity that should be
billed or not.

`onDelete: Cascade` on the task relation: a task that is hard-deleted takes its
rules with it. Soft-deleted tasks keep theirs, since the task row survives.

### The guardrail that matters most

`clickup_time_entries` resyncs constantly — every webhook, every windowed
reconcile, every backfill. `chargeable_override` is a user decision living on
that table, and if a sync path ever writes it, the decision reverts silently.

`TimeEntriesRepository.upsert` (`time-entries.repository.ts:10`) builds both
`create` and `update` by spreading `NormalizedTimeEntry` plus the cost object.
Neither contains `chargeableOverride`, so it survives — but that safety is
incidental, exactly as it was for `clickup_tasks.is_chargeable`. It gets the same
three defenses the task flag already has:

- declared in a labelled local-annotations block in `schema.prisma`;
- a comment on the upsert saying why it must not be written;
- a test asserting the upsert payload never contains `chargeableOverride`,
  mirroring the existing task-repository test.

`is_chargeable` is different: it *is* written by the cost path, on every upsert,
alongside `cost_cents`. It is derived data, not a user decision.

## The resolver

One pure function, no I/O, exhaustively tested:

```ts
export type ChargeabilitySource = 'entry' | 'assignee' | 'task' | 'default';

export function resolveChargeability(input: {
  entryOverride?: boolean | null;
  rule?: boolean | null;
  taskChargeable?: boolean | null;
}): { chargeable: boolean; source: ChargeabilitySource };
```

`CostCalculatorService.calculate` keeps its current signature. Callers resolve
first and pass the answer through the existing `opts.chargeable`. The calculator
learns nothing new, so its blast radius is zero.

`source` is not decoration: it is what the drawer shows ("non-chargeable — rule
for this assignee") and what makes "why is this task showing zero cost?"
answerable months later.

## Write paths

Three call sites compute cost, and each needs the rule and the override:

| Call site | Today | Change |
|---|---|---|
| `time-entries.service.ts:262` | batch-fetches `{ dueDate, isChargeable }` per task | add a rules `Map` keyed `taskId\|userId` for the batch; read each entry's stored override |
| `cost-recalculation.service.ts:56` | selects the task's `{ dueDate, isChargeable }` per entry | same, per 1000-row batch; add `chargeableOverride` to the select |
| `assignee-replacement.service.ts:126` | single task lookup | single rule lookup for the *replacement* assignee |

The replacement path deserves care: a replacement entry is written for a
different `user_id` than the original, so it must resolve against the *new*
assignee's rule, not the original logger's.

## Recalculation

Changing a rule re-costs exactly one assignee's entries on one task:
`recalculate({ assigneeId: userId, taskIds: [taskId] })`. The existing `where` at
`cost-recalculation.service.ts:33` already ANDs those two scopes, so that
intersection works with **no service change**.

A bulk entry override needs a new `timeEntryIds` scope on the same method.

**Its job log must follow `8688ecb`.** `sync_job_logs.entity_id` is indexed, and
a btree tuple caps out near 2704 bytes; joining a few hundred ids into that
column made `jobLogs.started()` throw *outside* the try block, so the job
dead-lettered while the PATCH that queued it had already returned success. The
new scope stores the **first** id in `entity_id` and the full list in `payload`,
exactly as the task-scoped branch now does.

## API

| Endpoint | Body / params | Notes |
|---|---|---|
| `PATCH /admin/tasks/:taskId/assignee-chargeable` | `{ userId, chargeable: boolean \| null }` | `null` clears the rule. Upsert; enqueues the scoped recalc only when the stored value actually changes. |
| `PATCH /admin/time-entries/chargeable` | `{ timeEntryIds: string[], chargeable: boolean \| null }` | `null` clears the override. Capped, mirroring `MAX_CHARGEABLE_TASK_IDS` (500). |
| `GET /admin/chargeability-rules` | `?taskId=&userId=&limit=&offset=` | Backs the rules screen: task name, assignee, who set it, when, note. |
| `DELETE /admin/chargeability-rules` | `?taskId=&userId=` | Same effect as `chargeable: null`; separate verb for the screen. Params, not a body — a DELETE body is poorly supported by clients and proxies. |

All Owner/Admin, all audited by the existing `AuditLogInterceptor`. All
idempotent: writing the value a row already holds neither writes nor enqueues.

The existing confirmation-dialog pattern (`ChargeableConfirmModal` +
`GET /reports/tasks/chargeable-preview`) is reused for the bulk entry action,
with a preview counting entries and hours rather than tasks.

## Reporting

**The filter switches from the task join to the entry's own column.**
`report-filter.util.ts:205` becomes `where.isChargeable = true | false`. The
existing behavior for task-less entries is preserved for free: they default to
`true` in the column, which is what `NOT { task: { isChargeable: false } }`
achieved by hand.

The aggregates at `time-entries-report.service.ts:215` and `:268` switch the same
way.

**The grouped-by-task view carries a broken assumption that must be fixed.**
`time-entries-report.service.ts:~514` reads:

```ts
// A task is wholly chargeable or wholly not, so this is all-or-nothing
// rather than a split within the task.
chargeableHours: chargeable ? b.hours : 0,
```

That is precisely what this feature invalidates. The `groupBy` above it already
groups by `['taskId', 'userId', 'userName', 'status', 'currency']`; adding
`isChargeable` to that list makes `chargeableHours` a real sum over the buckets
with no extra query, and the row's pill becomes tri-state like the task's.

**The tri-state pill** on the Tasks page is *Partial* when the task has at least
one rule **or** its entries disagree. Rules alone is not enough (an override
without a rule still splits the task); entries alone is not enough either,
because a rule set *before* anyone logs time — the prospective case that
justified standing rules — has no entries to disagree about yet.

## Migration and backfill

One migration: the new table, plus `chargeable_override` and `is_chargeable` on
`clickup_time_entries`.

Backfill, so the new column agrees with what is already on screen:

```sql
UPDATE clickup_time_entries e SET is_chargeable = false
FROM clickup_tasks t
WHERE e.task_id = t.task_id AND t.is_chargeable = false;
```

Entries with no task, and `COST_EXCLUDED` entries, keep the column default
`true` (decision 3). No stored cost changes: every existing entry's resolved
chargeability equals its task's flag, which is what it was already costed
against.

**Verification gap:** there is no local Postgres running in the working
environment (nothing on 5433, no containers), so `prisma:deploy` and this
backfill cannot be exercised locally as written. How the migration gets tested
before it reaches production is an open item, not a solved one.

## Order of work

1. **Rules, end to end.** Schema + migration + backfill; the guardrail test; the
   pure resolver; the three write paths; the rule-scoped recalc; the report
   filter and aggregate switch; the `chargeableHours` split fix in the
   grouped-by-task view; the drawer's per-assignee control. *This phase alone
   delivers the thing that was asked for.*

   The `chargeableHours` fix belongs here rather than with the pill: the moment
   phase 1 lets a rule split a task, the all-or-nothing sum at
   `time-entries-report.service.ts:~514` starts reporting hours that contradict
   the costs beside them.
2. **Per-entry override.** The `chargeable_override` column's write path, the
   `timeEntryIds` recalc scope with its bounded job log, the drawer row toggle,
   the bulk action on the Time Entries page.
3. **Rules admin screen.** `GET`/`DELETE /admin/chargeability-rules` and the page.
4. **Tri-state pill.** Tasks page and grouped-by-task rows.

Phase 1 changes stored costs only for tasks where somebody sets a rule, so it is
safe to land before phases 2–4 exist.

## Out of scope

- **Rules do not cascade from parent to subtask.** A rule keys on one `task_id`.
  Setting one on a parent leaves its subtasks alone. Deliberate: subtask time is
  often a different kind of work, and inheritance here would be surprising and
  hard to see.
- **Rules have no effective dating.** Unlike `assignee_rates`, a rule is not
  time-bounded — it is all of that person's time on that task. Task-scoped work
  is already bounded in time by the task itself.
- **The global `excludedAssignees` setting is untouched**, in behavior and in UI.
- **No writing any of this back to ClickUp.** ClickUp has no field for it.
- **No report of "what did non-chargeable work cost us"**. The resolved rate is
  still stored on every entry, as decided in the previous spec, so the data for
  it exists; no surface is built here.

# One active rate per assignee — auto-close on overlap

**Date:** 2026-08-09
**Status:** Approved (design)

## Problem

An assignee can currently have multiple overlapping `assignee_rates` rows. Overlaps
silently misattribute time-entry cost (the cost calculator picks the row with the
later `valid_from`, so an accidental overlap quietly changes historical costs). We
want the invariant: **an assignee never has two rates whose effective ranges overlap**,
and adding a new rate should close the prior active rate for you instead of forcing
manual edits.

## Model recap

- `assignee_rates`: `assignee_id`, `valid_from` (`date`), `valid_to` (`date`, nullable
  = open-ended), unique `(assignee_id, valid_from)`.
- Ranges are **closed-closed `[valid_from, valid_to]`** (inclusive both ends) — matches
  `cost-calculator.service.ts` and CLAUDE.md. A rate ending Dec 31 covers Dec 31; the
  next rate starts Jan 1. This is why closing a prior rate uses `newStart − 1 day`.
  (Half-open `[from, to)` is the more common industry convention and avoids the −1
  arithmetic, but we keep closed-closed for consistency with the existing model.)

## Decisions (confirmed)

1. **Close behavior:** warn, then auto-close. The modal shows a specific warning; the
   explicit "Create rate" click is the confirmation. Backend caps + inserts atomically.
2. **"Active" = range-overlap:** cap whichever existing rate's `[from, to]` range
   contains the new `valid_from` (open-ended included). Directly enforces "no two active
   at once" and matches the modal's existing `hasOverlap` computation.
3. **Retroactive/out-of-order insert is blocked**, not auto-split. If an overlapping
   rate starts on/after the new `valid_from` (can't cap without `valid_to < valid_from`),
   reject with `400` and ask the user to adjust dates. Period-splitting for backdated
   corrections is intentionally out of scope (YAGNI for an internal admin tool).
4. **Enforcement = app auto-close + DB exclusion constraint** (belt-and-suspenders):
   app logic does the nice auto-close; the DB constraint guarantees the invariant for
   every write path and under concurrency.
5. Capping a prior rate is a rate change, so it enqueues the existing scoped
   `recalculate-costs` job for that assignee (one job covers both rows). Confirmed fine.

## Design

### Backend — `src/rates` (authoritative, atomic)

`RatesRepository` gains a transactional create that, in one `prisma.$transaction`:

1. Loads the assignee's rates whose range overlaps the new rate's range.
2. Splits them:
   - overlapping rate with `valid_from < newValidFrom` → `UPDATE valid_to = newValidFrom − 1 day`.
   - overlapping rate with `valid_from >= newValidFrom` → throw `BadRequestException`
     ("New rate starts on or before an existing rate for this assignee; adjust the dates").
     The `(assignee_id, valid_from)` unique key already covers an exact-same start.
3. Inserts the new rate.

Overlap test (closed-closed, open-ended = unbounded): existing `[f, t]` overlaps new
`[nf, nt]` when `nf <= (t ?? +∞)` **and** `f <= (nt ?? +∞)`. Capping the earlier row to
`nf − 1` removes the overlap iff `f < nf`; otherwise it's the blocked case above.

`RatesService.create` calls the transactional repo method, then `enqueueRecalc(assigneeId)`
(unchanged path). **Return shape is unchanged** (the created `Rate`) — the frontend derives
the warning/toast from data it already holds, so no API-contract or DTO change.

The controller `POST /admin/rates` is unchanged beyond now surfacing the possible `400`.

### Backend — migration (new `prisma/migrations/0017_assignee_rate_no_overlap`)

Raw-SQL migration (Prisma can't express `EXCLUDE`, so it lives in migration SQL only;
the constraint is intentionally out-of-schema):

1. `CREATE EXTENSION IF NOT EXISTS btree_gist;`
2. **Normalize legacy overlaps first** (an `EXCLUDE` constraint cannot be added while any
   overlap exists — exclusion constraints have no `NOT VALID` deferral). For each assignee,
   order rows by `valid_from`; where a row's `valid_to` is null or `>= next.valid_from`, set
   `valid_to = next.valid_from − 1 day` (chain them). Run a `SELECT` overlap count first and
   record it in the plan so the cleanup's blast radius is known before applying to prod.
3. ```sql
   ALTER TABLE assignee_rates
     ADD CONSTRAINT no_overlapping_rates
     EXCLUDE USING gist (
       assignee_id WITH =,
       daterange(valid_from, valid_to, '[]') WITH &&
     );
   ```
   `daterange(..., '[]')` treats a null `valid_to` as unbounded and inclusive upper —
   correct for open-ended, closed-closed rates.

### Frontend — `apps/web/src/components/RateModal.tsx` (warning only)

- Reuse the already-loaded rates to turn the current passive amber "review for overlaps"
  callout into a specific one when creating: *"Saving will close &lt;name&gt;'s current rate
  ($X from &lt;date&gt;) on &lt;newStart − 1&gt;."* Only shown for the auto-closeable case
  (overlapping rate that starts before the new `valid_from`); the blocked case keeps a plain
  "adjust the dates" warning.
- On create success, an info toast via the existing `useToast`: *"Rate created — previous
  rate closed on &lt;date&gt;."* (client-computed from the row it knows will be capped).
- React Query already invalidates `['rates']`, so the list reflects both the capped and new
  rows after save. No hook/api signature change.

## Testing

`src/rates/rates.service.spec.ts` (+ repo where needed):

- open-ended active rate + new rate later → old capped to `newStart − 1`, new created,
  recalc enqueued once.
- closed rate whose range covers `newStart` → capped.
- no overlap → nothing else touched, new created.
- overlapping rate starting on/after `newStart` → `BadRequestException`, **no** writes
  (transaction rolls back).

Migration: a lightweight check that the constraint rejects a direct overlapping insert
(and that the pre-cleanup step leaves no overlaps).

## Files

- `src/rates/rates.repository.ts` — transactional cap+insert; overlap query.
- `src/rates/rates.service.ts` — orchestrate + recalc (minimal change).
- `src/rates/rates.service.spec.ts` — cases above.
- `prisma/migrations/0017_assignee_rate_no_overlap/migration.sql` — extension + cleanup + constraint.
- `apps/web/src/components/RateModal.tsx` — specific warning + success toast.

No DTO, API-contract, or Prisma-schema-model changes.

## Risks

- **Migration cleanup rewrites legacy `valid_to` values.** Count/inspect overlaps in prod
  before applying; the chaining rule is deterministic but does alter data. Ship behind the
  normal nifty deploy after reviewing the count.
- Concurrency race in the app-level check is now backstopped by the DB constraint (a racing
  insert fails the constraint rather than creating an overlap).

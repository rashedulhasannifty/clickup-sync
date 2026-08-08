# One Active Rate Per Assignee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee an assignee never has two rates with overlapping effective ranges; adding a rate auto-closes the prior active rate (`newStart − 1 day`) and warns the user, backed by a Postgres exclusion constraint.

**Architecture:** A pure planner decides which existing rates to cap or whether to block; the repository applies cap+insert in one Prisma transaction; a DB `EXCLUDE` constraint enforces the invariant for every write path; the `RateModal` shows a specific warning and a success toast.

**Tech Stack:** NestJS 11, Prisma 7 (`@db.Date`), PostgreSQL (`btree_gist`), Jest (`--runInBand`), React + TanStack Query.

## Global Constraints

- Rates are **closed-closed `[valid_from, valid_to]`**; `valid_to = null` = open-ended. Closing a prior rate uses `newValidFrom − 1 day`.
- Prisma dates are `@db.Date`; the controller already builds `valid_from`/`valid_to` as UTC-midnight `Date`s. `day-before` = subtract 86,400,000 ms.
- Table `assignee_rates`; columns `assignee_id`, `valid_from`, `valid_to`; unique `(assignee_id, valid_from)`.
- No API/DTO/Prisma-schema-model changes. The create endpoint still returns the created `Rate`.
- Migrations are **hand-numbered sequentially** (`0016_…` is latest → this is `0017_…`); this migration is raw SQL (Prisma can't express `EXCLUDE`).
- Commit messages omit any `Co-Authored-By` trailer. Preserve Prettier formatting. Branch: `feat/one-active-rate-per-assignee`.

---

### Task 1: Pure rate-succession planner

**Files:**
- Create: `src/rates/rate-succession.ts`
- Test: `src/rates/rate-succession.spec.ts`

**Interfaces:**
- Produces:
  - `interface RateInterval { rateId: bigint; validFrom: Date; validTo: Date | null }`
  - `function dayBefore(d: Date): Date`
  - `type SuccessionPlan = { ok: true; caps: { rateId: bigint; validTo: Date }[] } | { ok: false; reason: string }`
  - `function planRateSuccession(input: { existing: RateInterval[]; newValidFrom: Date; newValidTo: Date | null }): SuccessionPlan`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/rates/rate-succession.spec.ts
import { planRateSuccession, dayBefore, RateInterval } from './rate-succession';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('dayBefore', () => {
  it('returns the previous UTC day', () => {
    expect(dayBefore(d('2026-06-01')).toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });
});

describe('planRateSuccession', () => {
  it('caps an open-ended active rate to newStart-1', () => {
    const existing: RateInterval[] = [{ rateId: 1n, validFrom: d('2026-01-01'), validTo: null }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan).toEqual({ ok: true, caps: [{ rateId: 1n, validTo: d('2026-05-31') }] });
  });

  it('caps a closed rate whose range covers the new start', () => {
    const existing: RateInterval[] = [{ rateId: 2n, validFrom: d('2026-01-01'), validTo: d('2026-12-31') }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan).toEqual({ ok: true, caps: [{ rateId: 2n, validTo: d('2026-05-31') }] });
  });

  it('leaves an adjacent non-overlapping rate untouched', () => {
    const existing: RateInterval[] = [{ rateId: 3n, validFrom: d('2026-01-01'), validTo: d('2026-05-31') }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan).toEqual({ ok: true, caps: [] });
  });

  it('blocks when an overlapping rate starts on/after the new start', () => {
    const existing: RateInterval[] = [{ rateId: 4n, validFrom: d('2026-06-01'), validTo: null }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan.ok).toBe(false);
  });

  it('blocks a new open-ended rate that would swallow a later rate', () => {
    const existing: RateInterval[] = [{ rateId: 5n, validFrom: d('2026-07-01'), validTo: null }];
    const plan = planRateSuccession({ existing, newValidFrom: d('2026-06-01'), newValidTo: null });
    expect(plan.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- rate-succession`
Expected: FAIL — `Cannot find module './rate-succession'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/rates/rate-succession.ts
export interface RateInterval {
  rateId: bigint;
  validFrom: Date;
  validTo: Date | null;
}

export type SuccessionPlan =
  | { ok: true; caps: { rateId: bigint; validTo: Date }[] }
  | { ok: false; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC date minus one day. Rates are @db.Date at UTC midnight. */
export function dayBefore(d: Date): Date {
  return new Date(d.getTime() - DAY_MS);
}

/**
 * Given all of ONE assignee's existing rates (excluding the row being created),
 * decide which rates to cap so the new rate can be inserted without overlap.
 * Closed-closed [from, to]; null = unbounded. A rate that overlaps and starts
 * before the new start is capped to newStart-1; an overlap that starts on/after
 * the new start cannot be capped and blocks the create.
 */
export function planRateSuccession(input: {
  existing: RateInterval[];
  newValidFrom: Date;
  newValidTo: Date | null;
}): SuccessionPlan {
  const { existing, newValidFrom, newValidTo } = input;
  const caps: { rateId: bigint; validTo: Date }[] = [];
  for (const r of existing) {
    const startsBeforeNewEnds = newValidTo === null || r.validFrom.getTime() <= newValidTo.getTime();
    const endsAfterNewStarts = r.validTo === null || r.validTo.getTime() >= newValidFrom.getTime();
    if (!(startsBeforeNewEnds && endsAfterNewStarts)) continue; // no overlap
    if (r.validFrom.getTime() >= newValidFrom.getTime()) {
      return {
        ok: false,
        reason: 'New rate starts on or before an existing rate for this assignee; adjust the dates.',
      };
    }
    caps.push({ rateId: r.rateId, validTo: dayBefore(newValidFrom) });
  }
  return { ok: true, caps };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- rate-succession`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/rates/rate-succession.ts src/rates/rate-succession.spec.ts
git commit -m "feat(rates): pure rate-succession planner (cap prior rate or block overlap)"
```

---

### Task 2: Repository transactional create-with-succession

**Files:**
- Modify: `src/rates/rates.repository.ts`
- Test: `src/rates/rates.repository.spec.ts` (create)

**Interfaces:**
- Consumes: `planRateSuccession`, `dayBefore` from Task 1.
- Produces: `RatesRepository.createWithSuccession(data: { assigneeId: string; assigneeName?: string; assigneeEmail?: string; currency: string; hourlyRateCents: number; validFrom: Date; validTo?: Date | null }): Promise<Rate>` — same input/return as the existing `create`, but caps overlapping rates first inside one transaction and throws `BadRequestException` on the block case.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rates/rates.repository.spec.ts
import { BadRequestException } from '@nestjs/common';
import { RatesRepository } from './rates.repository';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const row = (over: Record<string, unknown> = {}) => ({
  rateId: 9n, assigneeId: 'u1', assigneeName: null, assigneeEmail: null,
  currency: 'USD', hourlyRateCents: 100n, validFrom: d('2026-06-01'), validTo: null,
  updatedAt: d('2026-06-01'), ...over,
});

function makePrisma(existing: { rateId: bigint; validFrom: Date; validTo: Date | null }[]) {
  const tx = {
    assigneeRate: {
      findMany: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue(row()),
      create: jest.fn().mockResolvedValue(row()),
    },
  };
  const prisma = { $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)) };
  return { prisma, tx };
}

const input = { assigneeId: 'u1', currency: 'USD', hourlyRateCents: 100, validFrom: d('2026-06-01'), validTo: null };

describe('RatesRepository.createWithSuccession', () => {
  it('caps an open-ended active rate then creates the new one', async () => {
    const { prisma, tx } = makePrisma([{ rateId: 1n, validFrom: d('2026-01-01'), validTo: null }]);
    const repo = new RatesRepository(prisma as any);
    await repo.createWithSuccession(input);
    expect(tx.assigneeRate.update).toHaveBeenCalledWith({ where: { rateId: 1n }, data: { validTo: d('2026-05-31') } });
    expect(tx.assigneeRate.create).toHaveBeenCalledTimes(1);
  });

  it('creates without capping when there is no overlap', async () => {
    const { prisma, tx } = makePrisma([{ rateId: 1n, validFrom: d('2026-01-01'), validTo: d('2026-05-31') }]);
    const repo = new RatesRepository(prisma as any);
    await repo.createWithSuccession(input);
    expect(tx.assigneeRate.update).not.toHaveBeenCalled();
    expect(tx.assigneeRate.create).toHaveBeenCalledTimes(1);
  });

  it('throws BadRequest and does not create on the block case', async () => {
    const { prisma, tx } = makePrisma([{ rateId: 1n, validFrom: d('2026-06-01'), validTo: null }]);
    const repo = new RatesRepository(prisma as any);
    await expect(repo.createWithSuccession(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.assigneeRate.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rates.repository`
Expected: FAIL — `createWithSuccession is not a function`.

- [ ] **Step 3: Add the method**

At the top of `src/rates/rates.repository.ts`, extend the existing imports and add the new import:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { planRateSuccession } from './rate-succession';
```

Add this method to the `RatesRepository` class, immediately after `create(...)`:

```typescript
  /**
   * Insert a rate while keeping the "one active rate per assignee" invariant:
   * cap any overlapping earlier rate to newValidFrom-1, or reject (400) an
   * overlap that starts on/after the new start. All in one transaction so we
   * never leave two active rates or a capped rate without its replacement.
   */
  async createWithSuccession(data: {
    assigneeId: string;
    assigneeName?: string;
    assigneeEmail?: string;
    currency: string;
    hourlyRateCents: number;
    validFrom: Date;
    validTo?: Date | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.assigneeRate.findMany({
        where: { assigneeId: data.assigneeId },
        select: { rateId: true, validFrom: true, validTo: true },
      });
      const plan = planRateSuccession({
        existing,
        newValidFrom: data.validFrom,
        newValidTo: data.validTo ?? null,
      });
      if (!plan.ok) throw new BadRequestException(plan.reason);
      for (const cap of plan.caps) {
        await tx.assigneeRate.update({ where: { rateId: cap.rateId }, data: { validTo: cap.validTo } });
      }
      const r = await tx.assigneeRate.create({
        data: {
          assigneeId: data.assigneeId,
          assigneeName: data.assigneeName,
          assigneeEmail: data.assigneeEmail,
          currency: data.currency,
          hourlyRateCents: BigInt(data.hourlyRateCents),
          validFrom: data.validFrom,
          validTo: data.validTo ?? null,
        },
      });
      return mapRate(r);
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rates.repository`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/rates/rates.repository.ts src/rates/rates.repository.spec.ts
git commit -m "feat(rates): transactional createWithSuccession caps overlapping rates"
```

---

### Task 3: Wire the service to the succession path

**Files:**
- Modify: `src/rates/rates.service.ts`
- Modify: `src/rates/rates.service.spec.ts`

**Interfaces:**
- Consumes: `RatesRepository.createWithSuccession` from Task 2.
- Produces: `RatesService.create` now delegates to `createWithSuccession` (still returns the created `Rate`, still enqueues recalc on success).

- [ ] **Step 1: Update the service spec (failing)**

In `src/rates/rates.service.spec.ts`, `makeDeps`, add a `createWithSuccession` mock to `repo` (leave the existing `create` mock in place):

```typescript
  const repo = {
    create: jest.fn().mockResolvedValue(created),
    createWithSuccession: jest.fn().mockResolvedValue(created),
    update: jest.fn().mockResolvedValue({ ...created, assigneeId: 'u2' }),
    remove: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue({ ...created, assigneeId: 'u3' }),
  };
```

Change the first test to assert the new path and add a block-propagation test. Replace the existing `it('create writes then enqueues a scoped recalculation', ...)` with:

```typescript
  it('create writes via succession then enqueues a scoped recalculation', async () => {
    const { svc, repo, add } = makeDeps();
    const r = await svc.create({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 100, validFrom: new Date() } as any);
    expect(repo.createWithSuccession).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(JOBS.RECALCULATE_COSTS, { assigneeId: 'u1' }, {});
    expect(r.assigneeId).toBe('u1');
  });

  it('propagates a blocked create and does NOT enqueue recalc', async () => {
    const { svc, repo, add } = makeDeps();
    (repo.createWithSuccession as jest.Mock).mockRejectedValueOnce(new Error('overlap'));
    await expect(svc.create({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 100, validFrom: new Date() } as any)).rejects.toThrow('overlap');
    expect(add).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- rates.service`
Expected: FAIL — `repo.createWithSuccession` asserted but `RatesService.create` still calls `repo.create`.

- [ ] **Step 3: Update the service**

In `src/rates/rates.service.ts`, replace the `create` method:

```typescript
  async create(data: Parameters<RatesRepository['createWithSuccession']>[0]) {
    const rate = await this.repo.createWithSuccession(data);
    await this.enqueueRecalc(rate.assigneeId);
    return rate;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- rates.service`
Expected: PASS (all cases, including the auto-recalc-toggle block).

- [ ] **Step 5: Commit**

```bash
git add src/rates/rates.service.ts src/rates/rates.service.spec.ts
git commit -m "feat(rates): route create through the succession path"
```

---

### Task 4: Migration `0017` — extension, legacy cleanup, exclusion constraint

**Files:**
- Create: `prisma/migrations/0017_assignee_rate_no_overlap/migration.sql`

**Interfaces:**
- Produces: DB constraint `no_overlapping_rates` on `assignee_rates`.

- [ ] **Step 1: Count existing overlaps (pre-flight; run against the target DB)**

Run (needs `npm run dev:deps` up locally, or point `DATABASE_URL` at the target):

```bash
npx prisma db execute --config ./prisma.config.ts --stdin <<'SQL'
SELECT COUNT(*) AS overlap_pairs
FROM assignee_rates a
JOIN assignee_rates b
  ON a.assignee_id = b.assignee_id
 AND a.rate_id < b.rate_id
 AND daterange(a.valid_from, a.valid_to, '[]') && daterange(b.valid_from, b.valid_to, '[]');
SQL
```

Expected locally: `0`. If non-zero on prod, that count is the blast radius the cleanup step (below) will rewrite — record it before deploying.

- [ ] **Step 2: Write the migration SQL**

```sql
-- prisma/migrations/0017_assignee_rate_no_overlap/migration.sql
-- Invariant: at most one active rate per assignee (no overlapping [valid_from, valid_to]).

-- btree_gist lets a GiST exclusion constraint mix `=` (assignee_id) with `&&` (range).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Normalize any pre-existing overlaps first: an EXCLUDE constraint cannot be added
-- while violating rows exist (no NOT VALID for exclusion constraints). For each
-- assignee, cap every row that runs into the next row's start at (next start - 1 day).
-- The (assignee_id, valid_from) unique key guarantees next_from > valid_from, so the
-- capped range stays valid.
WITH ordered AS (
  SELECT rate_id,
         valid_to,
         LEAD(valid_from) OVER (PARTITION BY assignee_id ORDER BY valid_from) AS next_from
  FROM assignee_rates
)
UPDATE assignee_rates r
SET valid_to = o.next_from - 1
FROM ordered o
WHERE r.rate_id = o.rate_id
  AND o.next_from IS NOT NULL
  AND (r.valid_to IS NULL OR r.valid_to >= o.next_from);

-- Enforce the invariant for every write path (API, imports, concurrency).
ALTER TABLE assignee_rates
  ADD CONSTRAINT no_overlapping_rates
  EXCLUDE USING gist (
    assignee_id WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  );
```

- [ ] **Step 3: Apply the migration locally**

Run: `npm run prisma:deploy`
Expected: `Applying migration 0017_assignee_rate_no_overlap` then success. (`prisma:deploy` applies pending SQL folders in order; no schema-model change is needed.)

- [ ] **Step 4: Verify the constraint rejects an overlap**

Run:

```bash
npx prisma db execute --config ./prisma.config.ts --stdin <<'SQL'
INSERT INTO assignee_rates (assignee_id, currency, hourly_rate_cents, valid_from, valid_to)
VALUES ('__ov_test__', 'USD', 100, DATE '2026-01-01', NULL);
INSERT INTO assignee_rates (assignee_id, currency, hourly_rate_cents, valid_from, valid_to)
VALUES ('__ov_test__', 'USD', 200, DATE '2026-06-01', NULL);
SQL
```

Expected: the **second** insert fails with `conflicting key value violates exclusion constraint "no_overlapping_rates"`. Then clean up the first row:

```bash
npx prisma db execute --config ./prisma.config.ts --stdin <<'SQL'
DELETE FROM assignee_rates WHERE assignee_id = '__ov_test__';
SQL
```

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/0017_assignee_rate_no_overlap/migration.sql
git commit -m "feat(rates): DB exclusion constraint guaranteeing no overlapping rates"
```

---

### Task 5: RateModal — specific warning + success toast

**Files:**
- Modify: `apps/web/src/components/RateModal.tsx`

**Interfaces:**
- Consumes: existing `ratesList`, `assigneeId`, `validFrom`, `validTo`, `useToast` (`../components/ui/Toast`), `fmt.shortDate` (`../lib/formatters`).

- [ ] **Step 1: Add imports for the toast and formatter**

In `apps/web/src/components/RateModal.tsx`, add these imports alongside the existing ones:

```typescript
import { useToast } from './ui/Toast';
import { fmt } from '../lib/formatters';
```

- [ ] **Step 2: Replace `hasOverlap` with `overlapInfo` (mirrors the backend overlap test)**

Delete the existing `const hasOverlap = …;` block and replace it with:

```typescript
	const toast = useToast();

	// Mirror the backend succession rule so the warning matches what will happen.
	// Closed-closed [from, to]; null = unbounded.
	const overlapInfo = useMemo(() => {
		if (!validFrom || !assigneeId) return null;
		const nf = new Date(validFrom).getTime();
		const nt = validTo ? new Date(validTo).getTime() : null;
		const conflicts = ratesList.filter((r) => {
			if (rate && r.id === rate.id) return false;
			if (r.assigneeId !== assigneeId) return false;
			const f = new Date(r.validFrom).getTime();
			const t = r.validTo ? new Date(r.validTo).getTime() : null;
			const startsBeforeNewEnds = nt === null || f <= nt;
			const endsAfterNewStarts = t === null || t >= nf;
			return startsBeforeNewEnds && endsAfterNewStarts;
		});
		if (conflicts.length === 0) return null;
		const blocking = conflicts.some((r) => new Date(r.validFrom).getTime() >= nf);
		const capTarget = conflicts.find((r) => new Date(r.validFrom).getTime() < nf) ?? null;
		const capDate = new Date(nf - 24 * 60 * 60 * 1000);
		return { blocking, capTarget, capDate };
	}, [validFrom, validTo, assigneeId, rate, ratesList]);
```

- [ ] **Step 3: Toast on successful create (capped-rate case)**

In `handleSave`, replace the `createRate.mutate(payload, { onSuccess: () => onClose() });` call with:

```typescript
			createRate.mutate(payload, {
				onSuccess: () => {
					if (overlapInfo?.capTarget) {
						toast.success(`Rate created — previous rate closed on ${fmt.shortDate(overlapInfo.capDate)}.`);
					}
					onClose();
				},
				onError: (err) => {
					// Surface the backend's block message (e.g. "New rate starts on or
					// before an existing rate…") instead of failing silently.
					const e = err as { response?: { data?: { message?: string } }; message?: string };
					setFormError(e.response?.data?.message ?? e.message ?? 'Could not create rate.');
				},
			});
```

- [ ] **Step 4: Replace the passive overlap callout with the specific one**

Replace the existing `{hasOverlap && ( … )}` JSX block with:

```tsx
				{overlapInfo?.blocking && (
					<Callout tone="amber" icon={<AlertTriangle size={13} strokeWidth={2} />}>
						This overlaps an existing rate for this assignee that starts on or after
						this date. Adjust the dates — saving will be rejected.
					</Callout>
				)}

				{overlapInfo && !overlapInfo.blocking && overlapInfo.capTarget && (
					<Callout tone="amber" icon={<AlertTriangle size={13} strokeWidth={2} />}>
						Saving will close this assignee&apos;s current rate ($
						{(overlapInfo.capTarget.hourlyRateCents / 100).toFixed(2)}/hr from{' '}
						{fmt.shortDate(overlapInfo.capTarget.validFrom)}) on{' '}
						{fmt.shortDate(overlapInfo.capDate)}.
					</Callout>
				)}
```

- [ ] **Step 5: Typecheck the web app**

Run: `cd apps/web && npm run build`
Expected: compiles with no errors. (If it reports missing deps like `exceljs`, run `npm install` in `apps/web` first — that's an environment gap, not a code break.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/RateModal.tsx
git commit -m "feat(web): RateModal warns before auto-closing the prior active rate"
```

---

## Final verification

- [ ] Run the full backend suite: `npm test` — all green.
- [ ] Run backend build: `npm run build` — compiles.
- [ ] Confirm `git log --oneline` shows the five task commits on `feat/one-active-rate-per-assignee`.

## Deployment note

Both the migration and the frontend ship via the normal **nifty** image build (SPA is baked into the backend image). Before applying `0017` to prod, run Task 4 Step 1's overlap count against prod and eyeball the number the cleanup will rewrite.

# Client Budgets & Forecasting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add effective-dated per-client monthly budgets with month-to-date actuals (cost + hours) and dual month-end forecasts (linear run-rate + trailing-average), surfaced on a Budgets page and an Overview card. Dashboard-only, no notifications.

**Architecture:** A new `ClientBudget` Prisma model mirrors the existing `AssigneeRate` (effective-dated, `[validFrom, validTo]` closed-closed, latest-`validFrom`-wins). A new `src/budgets/` module holds a repository (CRUD) and a service that resolves the applicable budget per client and computes MTD/forecast/status using pure, unit-tested helpers plus one Dhaka-timezone-bucketed SQL query. CRUD is exposed on `AdminController` (audited, Admin+); read/status on `ReportsController`. The React app adds a Budgets page, a budget modal, and an Overview card.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), raw SQL with `Prisma.sql`, Vitest/Jest (`npm run test`), React + TanStack Query + Recharts (apps/web).

**Spec:** `docs/superpowers/specs/2026-06-14-client-budgets-forecasting-design.md`

**Branch:** `feat/budgets-forecasting`

---

## File structure (what gets created/modified)

Backend:
- `prisma/schema.prisma` — add `ClientBudget` model (modify)
- `prisma/migrations/0011_client_budgets/migration.sql` — new table (create)
- `src/budgets/budget-forecast.ts` — pure forecast/status helpers, no Nest/Prisma (create)
- `src/budgets/budgets.repository.ts` — CRUD over `client_budgets` (create)
- `src/budgets/budgets.service.ts` — resolve budget + build status rows (create)
- `src/budgets/budgets.module.ts` — module (create)
- `src/admin/dto/create-client-budget.dto.ts` (create)
- `src/admin/dto/update-client-budget.dto.ts` (create)
- `src/admin/admin.controller.ts` — budget CRUD endpoints (modify)
- `src/admin/admin.module.ts` — import `BudgetsModule` (modify)
- `src/reports/reports.controller.ts` — `GET /reports/budgets/status` (modify)
- `src/reports/reports.module.ts` — import `BudgetsModule` (modify)
- `src/app.module.ts` — register `BudgetsModule` (modify)

Tests:
- `test/budget-forecast.spec.ts` — pure helper unit tests (create)
- `test/budgets.repository.spec.ts` — repository tests (create)
- `test/budgets.service.spec.ts` — service tests with mocked Prisma (create)

Frontend:
- `apps/web/src/api/budgets.ts` — API client + types (create)
- `apps/web/src/lib/budget-status.ts` — mirrored status helper (create)
- `apps/web/src/hooks/useBudgets.ts` — query/mutation hooks (create)
- `apps/web/src/components/BudgetModal.tsx` — CRUD modal (create)
- `apps/web/src/pages/BudgetsPage.tsx` — page (create)
- `apps/web/src/App.tsx` — `/budgets` route (modify)
- `apps/web/src/components/layout/Sidebar.tsx` — nav entry (modify)
- `apps/web/src/components/layout/CommandPalette.tsx` — nav entry (modify)
- `apps/web/src/pages/OverviewPage.tsx` — budget card (modify)

---

## Task 1: Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0011_client_budgets/migration.sql`

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Add after the `AssigneeRate` model (around line 107):

```prisma
model ClientBudget {
  budgetId           BigInt    @id @default(autoincrement()) @map("budget_id")
  client             String
  monthlyAmountCents BigInt    @map("monthly_amount_cents")
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

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/0011_client_budgets/migration.sql`:

```sql
-- Per-client effective-dated monthly budgets. Mirrors assignee_rates:
-- closed-closed [valid_from, valid_to] interval, latest valid_from wins on overlap.
CREATE TABLE IF NOT EXISTS client_budgets (
  budget_id BIGSERIAL PRIMARY KEY,
  client TEXT NOT NULL,
  monthly_amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  valid_from DATE NOT NULL,
  valid_to DATE,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_budgets_client_valid_from_key UNIQUE (client, valid_from)
);
CREATE INDEX IF NOT EXISTS idx_client_budgets_lookup ON client_budgets(client, valid_from, valid_to);
```

> Do NOT run `prisma migrate dev` — the schema drifts from migrations 0001–0010. Apply with `prisma:deploy` only.

- [ ] **Step 3: Generate client and deploy migration**

Run: `npm run prisma:generate && npm run prisma:deploy`
Expected: client regenerates with `clientBudget` model; deploy reports `0011_client_budgets` applied with no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0011_client_budgets/migration.sql
git commit -m "feat(budgets): add ClientBudget model + migration"
```

---

## Task 2: Pure forecast/status helpers (TDD)

These are framework-free pure functions so the date/forecast/status math is tested in isolation (the riskiest logic — Dhaka boundaries, divide-by-zero, past months). Dhaka is a fixed UTC+6 offset (no DST), so all date math uses UTC components after shifting by +6h.

**Files:**
- Create: `src/budgets/budget-forecast.ts`
- Test: `test/budget-forecast.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/budget-forecast.spec.ts`:

```ts
import {
  dhakaTodayParts,
  monthBounds,
  countBusinessDays,
  forecastRunRate,
  forecastTrailing,
  deriveBudgetStatus,
} from '../src/budgets/budget-forecast';

describe('budget-forecast helpers', () => {
  describe('dhakaTodayParts', () => {
    it('rolls a late-UTC instant into the next Dhaka day', () => {
      // 2026-06-14T20:00:00Z = 2026-06-15T02:00 Dhaka
      expect(dhakaTodayParts(new Date('2026-06-14T20:00:00Z'))).toEqual({ year: 2026, month0: 5, day: 15 });
    });
  });

  describe('monthBounds', () => {
    it('returns first and last day of the month', () => {
      const b = monthBounds(2026, 1); // Feb 2026 (month0=1)
      expect(b.start).toBe('2026-02-01');
      expect(b.end).toBe('2026-02-28');
      expect(b.daysInMonth).toBe(28);
    });
  });

  describe('countBusinessDays', () => {
    it('counts Mon-Fri inclusive', () => {
      // 2026-06-01 is a Monday; 2026-06-05 Friday => 5 business days
      expect(countBusinessDays('2026-06-01', '2026-06-05')).toBe(5);
      // include the weekend 06-06 (Sat), 06-07 (Sun) => still 5
      expect(countBusinessDays('2026-06-01', '2026-06-07')).toBe(5);
    });
    it('returns 0 when end is before start', () => {
      expect(countBusinessDays('2026-06-05', '2026-06-01')).toBe(0);
    });
  });

  describe('forecastRunRate', () => {
    it('projects current pace to month end', () => {
      // 4000 cents over 10 business days elapsed, 22 business days in month => 8800
      expect(forecastRunRate(4000, 10, 22)).toBe(8800);
    });
    it('guards divide-by-zero (no business days elapsed yet)', () => {
      expect(forecastRunRate(0, 0, 22)).toBe(0);
      expect(forecastRunRate(500, 0, 22)).toBe(500);
    });
  });

  describe('forecastTrailing', () => {
    it('adds 7-day avg daily spend over remaining calendar days', () => {
      // last7 total 7000 => avg 1000/day; 5 remaining days => 5000 + mtd 3000 = 8000
      expect(forecastTrailing(3000, 7000, 5)).toBe(8000);
    });
    it('equals MTD when no remaining days (past/last day)', () => {
      expect(forecastTrailing(3000, 7000, 0)).toBe(3000);
    });
  });

  describe('deriveBudgetStatus', () => {
    const budget = 10000;
    it('over when actual >= budget', () => {
      expect(deriveBudgetStatus(10000, 12000, budget)).toBe('over');
    });
    it('projected-over when forecast >= budget but actual < budget', () => {
      expect(deriveBudgetStatus(5000, 11000, budget)).toBe('projected-over');
    });
    it('near when forecast >= 85% and not over', () => {
      expect(deriveBudgetStatus(5000, 8600, budget)).toBe('near');
    });
    it('under otherwise', () => {
      expect(deriveBudgetStatus(2000, 4000, budget)).toBe('under');
    });
    it('no-budget when budget is null/zero', () => {
      expect(deriveBudgetStatus(2000, 4000, null)).toBe('no-budget');
      expect(deriveBudgetStatus(2000, 4000, 0)).toBe('no-budget');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- budget-forecast`
Expected: FAIL — module `../src/budgets/budget-forecast` not found.

- [ ] **Step 3: Implement the helpers**

Create `src/budgets/budget-forecast.ts`:

```ts
/**
 * Pure, framework-free budget math. Dhaka is a fixed UTC+6 offset (no DST),
 * so every "Dhaka day" is computed by shifting the instant +6h and reading the
 * UTC calendar parts. Keeping this dependency-free makes the forecast/boundary
 * logic unit-testable without a DB. Mirrored on the frontend in
 * apps/web/src/lib/budget-status.ts — keep the thresholds in sync.
 */

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export interface DateParts { year: number; month0: number; day: number }

/** Calendar parts of `now` in Dhaka local time. */
export function dhakaTodayParts(now: Date): DateParts {
  const d = new Date(now.getTime() + DHAKA_OFFSET_MS);
  return { year: d.getUTCFullYear(), month0: d.getUTCMonth(), day: d.getUTCDate() };
}

function iso(year: number, month0: number, day: number): string {
  const mm = String(month0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export interface MonthBounds { start: string; end: string; daysInMonth: number }

/** First/last YYYY-MM-DD of the given month (month0 = 0..11). */
export function monthBounds(year: number, month0: number): MonthBounds {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return { start: iso(year, month0, 1), end: iso(year, month0, daysInMonth), daysInMonth };
}

/** Inclusive Mon–Fri count between two YYYY-MM-DD strings. 0 if end < start. */
export function countBusinessDays(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  if (end.getTime() < start.getTime()) return 0;
  let count = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    const dow = new Date(t).getUTCDay(); // 0=Sun..6=Sat
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

/** mtd / elapsed * total. Guards elapsed==0 by returning mtd (no projection yet). */
export function forecastRunRate(mtdCents: number, businessDaysElapsed: number, businessDaysInMonth: number): number {
  if (businessDaysElapsed <= 0) return Math.round(mtdCents);
  return Math.round((mtdCents / businessDaysElapsed) * businessDaysInMonth);
}

/** mtd + (last7Total/7) * remainingCalendarDays. */
export function forecastTrailing(mtdCents: number, last7TotalCents: number, remainingCalendarDays: number): number {
  if (remainingCalendarDays <= 0) return Math.round(mtdCents);
  return Math.round(mtdCents + (last7TotalCents / 7) * remainingCalendarDays);
}

export type BudgetStatus = 'over' | 'projected-over' | 'near' | 'under' | 'no-budget';

export const NEAR_THRESHOLD = 0.85;

/** Status from actual + forecast vs budget. budget null/0 => no-budget. */
export function deriveBudgetStatus(actualCents: number, forecastCents: number, budgetCents: number | null): BudgetStatus {
  if (!budgetCents || budgetCents <= 0) return 'no-budget';
  if (actualCents >= budgetCents) return 'over';
  if (forecastCents >= budgetCents) return 'projected-over';
  if (forecastCents >= budgetCents * NEAR_THRESHOLD) return 'near';
  return 'under';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- budget-forecast`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/budgets/budget-forecast.ts test/budget-forecast.spec.ts
git commit -m "feat(budgets): pure forecast/status helpers with tests"
```

---

## Task 3: BudgetsRepository (TDD)

CRUD over `client_budgets`, mirroring `RatesRepository`. Returns plain objects (BigInt → Number/string) so JSON serialization is safe.

**Files:**
- Create: `src/budgets/budgets.repository.ts`
- Test: `test/budgets.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/budgets.repository.spec.ts`:

```ts
import { BudgetsRepository } from '../src/budgets/budgets.repository';

function makePrismaMock() {
  return {
    clientBudget: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

const row = {
  budgetId: 1n,
  client: 'Acme',
  monthlyAmountCents: 2000000n,
  currency: 'USD',
  validFrom: new Date('2026-01-01'),
  validTo: null,
  notes: null,
  updatedAt: new Date('2026-06-01'),
};

describe('BudgetsRepository', () => {
  it('findAll maps BigInt to Number and returns pagination envelope', async () => {
    const prisma = makePrismaMock();
    prisma.clientBudget.findMany.mockResolvedValue([row]);
    prisma.clientBudget.count.mockResolvedValue(1);
    const repo = new BudgetsRepository(prisma as never);

    const res = await repo.findAll(1, 50);

    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ id: '1', client: 'Acme', monthlyAmountCents: 2000000, currency: 'USD' });
  });

  it('create converts amount to BigInt and null-defaults validTo', async () => {
    const prisma = makePrismaMock();
    prisma.clientBudget.create.mockResolvedValue(row);
    const repo = new BudgetsRepository(prisma as never);

    await repo.create({ client: 'Acme', monthlyAmountCents: 2000000, currency: 'USD', validFrom: new Date('2026-01-01') });

    expect(prisma.clientBudget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ client: 'Acme', monthlyAmountCents: 2000000n, validTo: null }),
    });
  });

  it('update only sets provided fields', async () => {
    const prisma = makePrismaMock();
    prisma.clientBudget.update.mockResolvedValue(row);
    const repo = new BudgetsRepository(prisma as never);

    await repo.update(1n, { monthlyAmountCents: 500000 });

    expect(prisma.clientBudget.update).toHaveBeenCalledWith({
      where: { budgetId: 1n },
      data: { monthlyAmountCents: 500000n },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- budgets.repository`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

Create `src/budgets/budgets.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

function mapBudget(r: {
  budgetId: bigint; client: string; monthlyAmountCents: bigint; currency: string;
  validFrom: Date; validTo: Date | null; notes: string | null; updatedAt: Date;
}) {
  return {
    id: r.budgetId.toString(),
    client: r.client,
    monthlyAmountCents: Number(r.monthlyAmountCents),
    currency: r.currency,
    validFrom: r.validFrom,
    validTo: r.validTo,
    notes: r.notes,
    updatedAt: r.updatedAt,
  };
}

@Injectable()
export class BudgetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    const skip = (page - 1) * safeLimit;
    const [items, total] = await Promise.all([
      this.prisma.clientBudget.findMany({ orderBy: [{ client: 'asc' }, { validFrom: 'desc' }], take: safeLimit, skip }),
      this.prisma.clientBudget.count(),
    ]);
    return { items: items.map(mapBudget), total, page, limit: safeLimit };
  }

  /** Every budget row, oldest-resolution-friendly order, for the status query. */
  async findAllRows() {
    const items = await this.prisma.clientBudget.findMany({ orderBy: [{ client: 'asc' }, { validFrom: 'desc' }] });
    return items.map(mapBudget);
  }

  async findById(id: bigint) {
    const r = await this.prisma.clientBudget.findUnique({ where: { budgetId: id } });
    return r ? mapBudget(r) : null;
  }

  async create(data: { client: string; monthlyAmountCents: number; currency: string; validFrom: Date; validTo?: Date | null; notes?: string | null }) {
    const r = await this.prisma.clientBudget.create({
      data: {
        client: data.client,
        monthlyAmountCents: BigInt(data.monthlyAmountCents),
        currency: data.currency,
        validFrom: data.validFrom,
        validTo: data.validTo ?? null,
        notes: data.notes ?? null,
      },
    });
    return mapBudget(r);
  }

  async update(id: bigint, data: { client?: string; monthlyAmountCents?: number; currency?: string; validFrom?: Date; validTo?: Date | null; notes?: string | null }) {
    const update: Record<string, unknown> = {};
    if (data.client !== undefined) update.client = data.client;
    if (data.monthlyAmountCents !== undefined) update.monthlyAmountCents = BigInt(data.monthlyAmountCents);
    if (data.currency !== undefined) update.currency = data.currency;
    if (data.validFrom !== undefined) update.validFrom = data.validFrom;
    if ('validTo' in data) update.validTo = data.validTo ?? null;
    if ('notes' in data) update.notes = data.notes ?? null;
    const r = await this.prisma.clientBudget.update({ where: { budgetId: id }, data: update });
    return mapBudget(r);
  }

  async remove(id: bigint) {
    await this.prisma.clientBudget.delete({ where: { budgetId: id } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- budgets.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/budgets/budgets.repository.ts test/budgets.repository.spec.ts
git commit -m "feat(budgets): BudgetsRepository CRUD with tests"
```

---

## Task 4: BudgetsService.clientBudgetStatus (TDD)

Resolves the applicable budget per client for a month, runs one Dhaka-bucketed SQL query for per-client per-day cost+hours, then assembles MTD/forecast/status via the Task 2 helpers. `now` is injectable for deterministic tests.

**Files:**
- Create: `src/budgets/budgets.service.ts`
- Test: `test/budgets.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/budgets.service.spec.ts`:

```ts
import { BudgetsService } from '../src/budgets/budgets.service';

function makeDeps(dailyRows: any[], budgetRows: any[]) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(dailyRows) };
  const repo = { findAllRows: jest.fn().mockResolvedValue(budgetRows) };
  return { prisma, repo, service: new BudgetsService(prisma as never, repo as never) };
}

describe('BudgetsService.clientBudgetStatus', () => {
  it('resolves the latest-validFrom budget covering the month and computes status', async () => {
    // Month June 2026, "today" mid-month on a weekday.
    const now = new Date('2026-06-15T08:00:00Z'); // Dhaka 14:00 on Mon 2026-06-15
    const daily = [
      { day: '2026-06-01', client: 'Acme', cost_cents: 300000n, hours: '20' },
      { day: '2026-06-10', client: 'Acme', cost_cents: 300000n, hours: '20' },
    ];
    const budgets = [
      { id: '2', client: 'Acme', monthlyAmountCents: 1000000, currency: 'USD', validFrom: new Date('2026-06-01'), validTo: null, notes: null },
      { id: '1', client: 'Acme', monthlyAmountCents: 500000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: new Date('2026-05-31'), notes: null },
    ];
    const { service } = makeDeps(daily, budgets);

    const rows = await service.clientBudgetStatus({ month: '2026-06', now });

    const acme = rows.find((r) => r.client === 'Acme')!;
    expect(acme.monthlyAmount).toBe(10000); // dollars, from the June row (latest validFrom)
    expect(acme.mtdCost).toBe(6000);
    expect(acme.mtdHours).toBe(40);
    expect(acme.forecastRunRate).toBeGreaterThan(acme.mtdCost);
    expect(['under', 'near', 'projected-over', 'over']).toContain(acme.status);
  });

  it('marks a client with spend but no budget row as no-budget', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    const daily = [{ day: '2026-06-05', client: 'NoBudgetCo', cost_cents: 100000n, hours: '5' }];
    const { service } = makeDeps(daily, []);

    const rows = await service.clientBudgetStatus({ month: '2026-06', now });

    expect(rows.find((r) => r.client === 'NoBudgetCo')!.status).toBe('no-budget');
  });

  it('for a fully past month, both forecasts equal the actual', async () => {
    const now = new Date('2026-06-15T08:00:00Z');
    const daily = [{ day: '2026-03-10', client: 'Acme', cost_cents: 400000n, hours: '25' }];
    const budgets = [{ id: '1', client: 'Acme', monthlyAmountCents: 1000000, currency: 'USD', validFrom: new Date('2026-01-01'), validTo: null, notes: null }];
    const { service } = makeDeps(daily, budgets);

    const rows = await service.clientBudgetStatus({ month: '2026-03', now });
    const acme = rows.find((r) => r.client === 'Acme')!;

    expect(acme.forecastRunRate).toBe(acme.mtdCost);
    expect(acme.forecastTrailing).toBe(acme.mtdCost);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- budgets.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `src/budgets/budgets.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { BudgetsRepository } from './budgets.repository';
import {
  dhakaTodayParts,
  monthBounds,
  countBusinessDays,
  forecastRunRate,
  forecastTrailing,
  deriveBudgetStatus,
  type BudgetStatus,
} from './budget-forecast';

const NO_CLIENT = 'No client';

export interface ClientBudgetStatusRow {
  client: string;
  monthlyAmount: number | null;   // dollars; null when no budget
  currency: string | null;
  mtdCost: number;                // dollars
  mtdHours: number;
  forecastRunRate: number;        // dollars
  forecastTrailing: number;       // dollars
  pctOfBudget: number | null;     // mtdCost / monthlyAmount
  forecastPct: number | null;     // run-rate forecast / monthlyAmount (server default)
  status: BudgetStatus;
  dailySeries: { date: string; cost: number }[];
}

interface DailyRow { day: string; client: string; cost_cents: bigint; hours: string }

function parseMonth(month: string | undefined, now: Date): { year: number; month0: number } {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  if (m) {
    const [y, mm] = m.split('-').map(Number);
    return { year: y, month0: mm - 1 };
  }
  const t = dhakaTodayParts(now);
  return { year: t.year, month0: t.month0 };
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: BudgetsRepository,
  ) {}

  async clientBudgetStatus(args: { month?: string; now?: Date }): Promise<ClientBudgetStatusRow[]> {
    const now = args.now ?? new Date();
    const { year, month0 } = parseMonth(args.month, now);
    const bounds = monthBounds(year, month0);

    // Clamp "today" to the target month: future month -> month start (no spend yet);
    // past month -> month end; current month -> actual Dhaka today.
    const t = dhakaTodayParts(now);
    const todayIso = `${t.year}-${String(t.month0 + 1).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    const effectiveToday =
      todayIso < bounds.start ? bounds.start :
      todayIso > bounds.end   ? bounds.end   :
      todayIso;

    const TZ = Prisma.raw(`'Asia/Dhaka'`);
    const dhakaDay = Prisma.sql`((e.start_time AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date)`;

    const dailyRows = await this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
      SELECT to_char(${dhakaDay}, 'YYYY-MM-DD')              AS day,
             COALESCE(NULLIF(t.client, ''), ${NO_CLIENT})    AS client,
             COALESCE(SUM(e.cost_cents), 0)::bigint          AS cost_cents,
             COALESCE(SUM(e.duration_hours), 0)::text        AS hours
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time IS NOT NULL
        AND ${dhakaDay} >= ${bounds.start}::date
        AND ${dhakaDay} <= ${effectiveToday}::date
        AND t.is_deleted = false
      GROUP BY 1, 2
    `);

    // Group daily rows by client.
    const byClient = new Map<string, DailyRow[]>();
    for (const r of dailyRows) {
      const list = byClient.get(r.client) ?? [];
      list.push(r);
      byClient.set(r.client, list);
    }

    // Resolve the applicable budget per client (latest validFrom covering the month;
    // validFrom <= month end AND (validTo null OR validTo >= month start)).
    const budgets = await this.repo.findAllRows(); // sorted client asc, validFrom desc
    const budgetFor = new Map<string, { amountCents: number; currency: string }>();
    for (const b of budgets) {
      if (budgetFor.has(b.client)) continue; // first match = latest validFrom (desc order)
      const vf = b.validFrom.toISOString().slice(0, 10);
      const vt = b.validTo ? b.validTo.toISOString().slice(0, 10) : null;
      if (vf <= bounds.end && (vt === null || vt >= bounds.start)) {
        budgetFor.set(b.client, { amountCents: b.monthlyAmountCents, currency: b.currency });
      }
    }

    // Every client that either has spend this month or has a budget row.
    const clients = new Set<string>([...byClient.keys(), ...budgetFor.keys()]);

    const businessDaysInMonth = countBusinessDays(bounds.start, bounds.end);
    const businessDaysElapsed = countBusinessDays(bounds.start, effectiveToday);
    const remainingCalendarDays = Math.max(
      0,
      Math.round((new Date(`${bounds.end}T00:00:00Z`).getTime() - new Date(`${effectiveToday}T00:00:00Z`).getTime()) / 86_400_000),
    );
    const last7Start = addDaysIso(effectiveToday, -6);

    const rows: ClientBudgetStatusRow[] = [];
    for (const client of clients) {
      const days = byClient.get(client) ?? [];
      const mtdCents = days.reduce((s, d) => s + Number(d.cost_cents), 0);
      const mtdHours = days.reduce((s, d) => s + Number(d.hours), 0);
      const last7Cents = days
        .filter((d) => d.day >= last7Start && d.day <= effectiveToday)
        .reduce((s, d) => s + Number(d.cost_cents), 0);

      const frCents = forecastRunRate(mtdCents, businessDaysElapsed, businessDaysInMonth);
      const ftCents = forecastTrailing(mtdCents, last7Cents, remainingCalendarDays);

      const budget = budgetFor.get(client) ?? null;
      const budgetCents = budget ? budget.amountCents : null;
      const status = deriveBudgetStatus(mtdCents, frCents, budgetCents);

      rows.push({
        client,
        monthlyAmount: budgetCents != null ? budgetCents / 100 : null,
        currency: budget?.currency ?? null,
        mtdCost: mtdCents / 100,
        mtdHours: Number(mtdHours.toFixed(2)),
        forecastRunRate: frCents / 100,
        forecastTrailing: ftCents / 100,
        pctOfBudget: budgetCents ? mtdCents / budgetCents : null,
        forecastPct: budgetCents ? frCents / budgetCents : null,
        status,
        dailySeries: days
          .slice()
          .sort((a, b) => a.day.localeCompare(b.day))
          .map((d) => ({ date: d.day, cost: Number(d.cost_cents) / 100 })),
      });
    }

    // Budgeted/active clients first (by MTD desc), no-budget rows last.
    rows.sort((a, b) => {
      if ((a.status === 'no-budget') !== (b.status === 'no-budget')) return a.status === 'no-budget' ? 1 : -1;
      return b.mtdCost - a.mtdCost;
    });
    return rows;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- budgets.service`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/budgets/budgets.service.ts test/budgets.service.spec.ts
git commit -m "feat(budgets): BudgetsService client status + forecast"
```

---

## Task 5: BudgetsModule + wiring

**Files:**
- Create: `src/budgets/budgets.module.ts`
- Modify: `src/app.module.ts`, `src/admin/admin.module.ts`, `src/reports/reports.module.ts`

- [ ] **Step 1: Create the module**

Create `src/budgets/budgets.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BudgetsRepository } from './budgets.repository';
import { BudgetsService } from './budgets.service';

@Module({
  providers: [BudgetsRepository, BudgetsService],
  exports: [BudgetsService, BudgetsRepository],
})
export class BudgetsModule {}
```

- [ ] **Step 2: Register in `src/app.module.ts`**

Add `import { BudgetsModule } from './budgets/budgets.module';` with the other imports, and add `BudgetsModule` to the `@Module({ imports: [...] })` array (next to `ReportsModule`).

- [ ] **Step 3: Import into AdminModule and ReportsModule**

In `src/admin/admin.module.ts`: add `import { BudgetsModule } from '../budgets/budgets.module';` and add `BudgetsModule` to that module's `imports` array (next to the existing `RatesModule` / similar import).

In `src/reports/reports.module.ts`: change to:

```ts
import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { BudgetsModule } from '../budgets/budgets.module';

@Module({
  imports: [BudgetsModule],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
```

> Note: `ReportsController` already injects `SettingsService` without `SettingsModule` appearing in `ReportsModule.imports`, which means `SettingsModule` is global. `BudgetsModule` is NOT global, so it must be imported wherever its providers are injected (Admin + Reports). PrismaService is available via the global database module (as in `ReportsService`).

- [ ] **Step 4: Verify the app compiles**

Run: `npm run build`
Expected: build succeeds (no DI resolution errors).

- [ ] **Step 5: Commit**

```bash
git add src/budgets/budgets.module.ts src/app.module.ts src/admin/admin.module.ts src/reports/reports.module.ts
git commit -m "feat(budgets): wire BudgetsModule into app/admin/reports"
```

---

## Task 6: DTOs + Admin CRUD endpoints

DTOs whitelist **every** editable field (including `client` on update) so `ValidationPipe({ whitelist: true })` never silently strips a field the UI sends — the bug class the tag-assignee map currently has.

**Files:**
- Create: `src/admin/dto/create-client-budget.dto.ts`, `src/admin/dto/update-client-budget.dto.ts`
- Modify: `src/admin/admin.controller.ts`

- [ ] **Step 1: Create the DTOs**

Create `src/admin/dto/create-client-budget.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateClientBudgetDto {
  @ApiProperty({ description: 'Client name (matches clickup_tasks.client)' })
  @IsString()
  @IsNotEmpty()
  client!: string;

  @ApiProperty({ description: 'Monthly budget in cents, e.g. 2000000 = $20,000.00', example: 2000000 })
  @IsInt()
  @Min(0)
  monthlyAmountCents!: number;

  @ApiProperty({ default: 'USD' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({ description: 'Effective from date (ISO 8601 date)', example: '2026-01-01' })
  @IsISO8601()
  validFrom!: string;

  @ApiPropertyOptional({ description: 'Effective until date (ISO 8601). Omit for open-ended.', example: '2026-12-31' })
  @IsISO8601()
  @IsOptional()
  validTo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
```

Create `src/admin/dto/update-client-budget.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class UpdateClientBudgetDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  client?: string;

  @ApiPropertyOptional({ description: 'Monthly budget in cents' })
  @IsInt()
  @Min(0)
  @IsOptional()
  monthlyAmountCents?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: 'Effective from date (ISO 8601)' })
  @IsISO8601()
  @IsOptional()
  validFrom?: string;

  @ApiPropertyOptional({ description: 'Effective until date (ISO 8601). Send null to make open-ended.' })
  @IsISO8601()
  @IsOptional()
  validTo?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string | null;
}
```

- [ ] **Step 2: Add CRUD endpoints to `src/admin/admin.controller.ts`**

Add imports near the other DTO/repo imports:

```ts
import { CreateClientBudgetDto } from './dto/create-client-budget.dto';
import { UpdateClientBudgetDto } from './dto/update-client-budget.dto';
import { BudgetsRepository } from '../budgets/budgets.repository';
```

Add to the constructor parameter list (alongside `private readonly ratesRepo: RatesRepository,`):

```ts
    private readonly budgetsRepo: BudgetsRepository,
```

Add a new section after the Rates CRUD block (after `deleteRate`, before the Tag-Assignee Map section):

```ts
  // ── Client Budgets CRUD ─────────────────────────────────────────────────────

  @Get('budgets')
  @ApiOperation({ summary: 'List all client budgets (paginated)' })
  listBudgets(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.budgetsRepo.findAll(Number(page) || 1, Number(limit) || 50);
  }

  @Post('budgets')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a client budget' })
  createBudget(@Body() dto: CreateClientBudgetDto) {
    const validFrom = new Date(`${dto.validFrom.slice(0, 10)}T00:00:00.000Z`);
    const validTo = dto.validTo ? new Date(`${dto.validTo.slice(0, 10)}T00:00:00.000Z`) : null;
    return this.budgetsRepo.create({
      client: dto.client,
      monthlyAmountCents: dto.monthlyAmountCents,
      currency: dto.currency ?? 'USD',
      validFrom,
      validTo,
      notes: dto.notes ?? null,
    });
  }

  @Patch('budgets/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a client budget' })
  updateBudget(@Param('id') id: string, @Body() dto: UpdateClientBudgetDto) {
    const data: Parameters<BudgetsRepository['update']>[1] = {};
    if (dto.client !== undefined) data.client = dto.client;
    if (dto.monthlyAmountCents !== undefined) data.monthlyAmountCents = dto.monthlyAmountCents;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.validFrom !== undefined) data.validFrom = new Date(`${dto.validFrom.slice(0, 10)}T00:00:00.000Z`);
    if ('validTo' in dto) data.validTo = dto.validTo ? new Date(`${dto.validTo!.slice(0, 10)}T00:00:00.000Z`) : null;
    if ('notes' in dto) data.notes = dto.notes ?? null;
    return this.budgetsRepo.update(parseId(id), data);
  }

  @Delete('budgets/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a client budget' })
  deleteBudget(@Param('id') id: string) {
    return this.budgetsRepo.remove(parseId(id));
  }
```

> The whole `AdminController` is `@Roles(Role.OWNER, Role.ADMIN)` and wrapped by `AuditLogInterceptor`, so these writes are gated and audited automatically — no extra decorators needed. `parseId`, `HttpCode`, `Body`, `Param`, `Query`, `Get/Post/Patch/Delete`, `ApiOperation` are already imported in this file.

- [ ] **Step 3: Build to verify wiring**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Manually verify endpoints (optional but recommended)**

Start the app (`npm run start:dev`) with deps running, then:
Run: `curl -s -X POST localhost:3002/admin/budgets -H "x-admin-key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{"client":"Acme","monthlyAmountCents":2000000,"currency":"USD","validFrom":"2026-06-01"}'`
Expected: `201` with the created budget JSON. (Port 3002 per the project's WSL note; adjust to your `PORT`.)

- [ ] **Step 5: Commit**

```bash
git add src/admin/dto/create-client-budget.dto.ts src/admin/dto/update-client-budget.dto.ts src/admin/admin.controller.ts
git commit -m "feat(budgets): admin CRUD endpoints for client budgets"
```

---

## Task 7: Reports status endpoint

**Files:**
- Modify: `src/reports/reports.controller.ts`

- [ ] **Step 1: Inject BudgetsService and add the endpoint**

Add import: `import { BudgetsService } from '../budgets/budgets.service';`

Add to the constructor (after `private readonly settings: SettingsService,`):

```ts
    private readonly budgets: BudgetsService,
```

Add an endpoint (place it near the other time-entry/report getters, e.g. after the cost-trend endpoints):

```ts
  @Get('budgets/status')
  @ApiOperation({ summary: 'Per-client monthly budget vs actual + month-end forecast. ?month=YYYY-MM (defaults to current Dhaka month).' })
  budgetStatus(@Query('month') month?: string) {
    return this.budgets.clientBudgetStatus({ month });
  }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Run full backend test suite**

Run: `npm run test`
Expected: all green (new budget specs + existing suite). Lint is known-broken project-wide; do not block on `npm run lint`.

- [ ] **Step 4: Commit**

```bash
git add src/reports/reports.controller.ts
git commit -m "feat(budgets): GET /reports/budgets/status endpoint"
```

---

## Task 8: Frontend API client + status helper + hooks

**Files:**
- Create: `apps/web/src/api/budgets.ts`, `apps/web/src/lib/budget-status.ts`, `apps/web/src/hooks/useBudgets.ts`

- [ ] **Step 1: Create the API client + types**

Create `apps/web/src/api/budgets.ts`:

```ts
import { apiClient } from './client';

export interface Budget {
  id: string;
  client: string;
  monthlyAmountCents: number;
  currency: string;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
  updatedAt: string;
}

export type BudgetStatus = 'over' | 'projected-over' | 'near' | 'under' | 'no-budget';

export interface BudgetStatusRow {
  client: string;
  monthlyAmount: number | null;
  currency: string | null;
  mtdCost: number;
  mtdHours: number;
  forecastRunRate: number;
  forecastTrailing: number;
  pctOfBudget: number | null;
  forecastPct: number | null;
  status: BudgetStatus;
  dailySeries: { date: string; cost: number }[];
}

function parseListResponse(data: unknown): Budget[] {
  if (Array.isArray(data)) return data as Budget[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: Budget[] }).items;
  }
  return [];
}

export const budgetsApi = {
  list: () =>
    apiClient.get('/admin/budgets', { params: { page: 1, limit: 200 } }).then((r) => parseListResponse(r.data)),
  create: (data: Omit<Budget, 'id' | 'updatedAt'>) =>
    apiClient.post('/admin/budgets', data).then((r) => r.data as Budget),
  update: (id: string, data: Partial<Omit<Budget, 'id' | 'updatedAt'>>) =>
    apiClient.patch(`/admin/budgets/${id}`, data).then((r) => r.data as Budget),
  remove: (id: string) => apiClient.delete(`/admin/budgets/${id}`).then((r) => r.data),
  status: (month?: string) =>
    apiClient.get('/reports/budgets/status', { params: month ? { month } : {} }).then((r) => r.data as BudgetStatusRow[]),
};
```

- [ ] **Step 2: Create the mirrored status helper**

Create `apps/web/src/lib/budget-status.ts`:

```ts
import type { BudgetStatus } from '../api/budgets';

/**
 * Mirror of src/budgets/budget-forecast.ts deriveBudgetStatus — used when the
 * Run-rate/Trailing toggle flips so the badge recomputes from the trailing
 * forecast without a refetch. Keep thresholds in sync with the backend.
 */
export const NEAR_THRESHOLD = 0.85;

export function deriveBudgetStatus(actual: number, forecast: number, budget: number | null): BudgetStatus {
  if (!budget || budget <= 0) return 'no-budget';
  if (actual >= budget) return 'over';
  if (forecast >= budget) return 'projected-over';
  if (forecast >= budget * NEAR_THRESHOLD) return 'near';
  return 'under';
}

export const STATUS_LABEL: Record<BudgetStatus, string> = {
  'over': 'Over budget',
  'projected-over': 'Projected over',
  'near': 'Near limit',
  'under': 'On track',
  'no-budget': 'No budget',
};
```

- [ ] **Step 3: Create the hooks**

Create `apps/web/src/hooks/useBudgets.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { budgetsApi } from '../api/budgets';
import type { Budget } from '../api/budgets';

export function useBudgets() {
  return useQuery({ queryKey: ['budgets'], queryFn: budgetsApi.list });
}

export function useBudgetStatus(month?: string) {
  return useQuery({ queryKey: ['budget-status', month ?? 'current'], queryFn: () => budgetsApi.status(month) });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['budget-status'] });
  };
}

export function useCreateBudget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: Omit<Budget, 'id' | 'updatedAt'>) => budgetsApi.create(data),
    onSuccess: invalidate,
  });
}

export function useUpdateBudget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<Budget, 'id' | 'updatedAt'>> }) => budgetsApi.update(id, data),
    onSuccess: invalidate,
  });
}

export function useDeleteBudget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => budgetsApi.remove(id),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 4: Typecheck the web app**

Run: `npm run build --workspace=apps/web`
Expected: success (these files are imported by later tasks; this just confirms they compile).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/budgets.ts apps/web/src/lib/budget-status.ts apps/web/src/hooks/useBudgets.ts
git commit -m "feat(web): budgets api client, status helper, hooks"
```

---

## Task 9: BudgetModal component

A create/edit modal modeled on `apps/web/src/components/RateModal.tsx`. Read `RateModal.tsx` first and copy its structure/styling (overlay, form fields, submit/cancel, error display), substituting the budget fields.

**Files:**
- Create: `apps/web/src/components/BudgetModal.tsx`

- [ ] **Step 1: Implement the modal**

Create `apps/web/src/components/BudgetModal.tsx`, mirroring `RateModal.tsx`'s layout and styling. Required behavior and fields:

- Props: `{ open: boolean; initial?: Budget | null; clientOptions: string[]; onClose: () => void; onSubmit: (data) => void; submitting?: boolean }`.
- Fields:
  - **Client** — text input with a `<datalist>` populated from `clientOptions` (autocomplete; allows a new name). Disabled-empty validation.
  - **Monthly amount** — a dollars input (number, step 0.01). Convert to cents on submit: `Math.round(parseFloat(amount) * 100)`. When editing, prefill from `initial.monthlyAmountCents / 100`.
  - **Currency** — text input defaulting to `'USD'`.
  - **Valid from** — `<input type="date">`, required. Prefill from `initial.validFrom.slice(0,10)`.
  - **Valid to** — `<input type="date">`, optional (empty → `null`).
  - **Notes** — optional `<textarea>`.
- On submit, call `onSubmit({ client, monthlyAmountCents, currency, validFrom, validTo: validTo || null, notes: notes || null })`.
- Reset local form state from `initial` whenever `open`/`initial` changes (use the same `useEffect(..., [open, initial])` pattern RateModal uses).

`clientOptions` will be passed from the page using `GET /reports/clients` (shape: `{ client, taskCount }[]` → map to `client` names).

- [ ] **Step 2: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/BudgetModal.tsx
git commit -m "feat(web): BudgetModal create/edit form"
```

---

## Task 10: BudgetsPage + route + nav

A page modeled on `apps/web/src/pages/AssigneeRatesPage.tsx` (read it first for the table/RequireRole/CSV-export patterns).

**Files:**
- Create: `apps/web/src/pages/BudgetsPage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/layout/Sidebar.tsx`, `apps/web/src/components/layout/CommandPalette.tsx`

- [ ] **Step 1: Implement the page**

Create `apps/web/src/pages/BudgetsPage.tsx` with:

- **Month picker** — `<input type="month">`, default empty (current month). Its value (`YYYY-MM` or undefined) feeds `useBudgetStatus(month)`.
- **Forecast toggle** — two buttons / segmented control: `Run-rate` | `Trailing`, held in `useState<'runrate' | 'trailing'>('runrate')`.
- **Data** — `useBudgetStatus(month)` for the status rows; `useBudgets()` for raw budget rows (to find the editable budget id per client when opening the edit modal); `reportsApi.clients` (via a small `useQuery`) for the modal's client autocomplete.
- **Status table** — columns: Client · Budget · MTD cost · MTD hours · % used · Forecast · Status badge · Actions.
  - `Forecast` column shows `forecastRunRate` or `forecastTrailing` based on the toggle.
  - The status **badge** is recomputed client-side when the toggle is `trailing`:
    ```ts
    import { deriveBudgetStatus, STATUS_LABEL } from '../lib/budget-status';
    const budgetCents = row.monthlyAmount != null ? Math.round(row.monthlyAmount * 100) : null;
    const forecast = mode === 'runrate' ? row.forecastRunRate : row.forecastTrailing;
    const status = mode === 'runrate'
      ? row.status
      : deriveBudgetStatus(Math.round(row.mtdCost * 100), Math.round(forecast * 100), budgetCents);
    ```
  - Badge colors: `over` red, `projected-over` amber, `near` amber/yellow, `under` green, `no-budget` gray. Use the existing badge/pill styling from `AssigneeRatesPage`/`MissingRatesPage` for consistency.
  - `no-budget` rows render a **Set budget** button (opens the modal with `initial=null`, client prefilled).
- **CRUD** — `RequireRole min="ADMIN"` gates an **Add budget** button (top) and per-row Edit/Delete actions (mirror how AssigneeRatesPage gates rate CRUD). Members see the table read-only. Wire `useCreateBudget`/`useUpdateBudget`/`useDeleteBudget`; Edit finds the budget id from `useBudgets()` data by matching `client` + covering the selected month (or simply the latest `validFrom` for that client). Delete behind a `window.confirm`.
- **Per-client expand → burn-down chart** — on row click, expand a Recharts chart from `row.dailySeries`:
  - X axis = day; build a **cumulative actual** line by running-summing `dailySeries[].cost`.
  - A horizontal **budget ceiling** reference line at `row.monthlyAmount` (skip if null).
  - An **ideal-pace** line from 0 → budget across the month.
  - A dashed **projection** from today's cumulative to the selected forecast at month end.
  - Follow the Recharts usage already in `apps/web/src/components/charts/` for styling/tooltip conventions.
- **CSV export** — a Download button using `lib/csv.ts`:
  ```ts
  import { csvFilename, downloadCsv, toCsv, type CsvColumn } from '../lib/csv';
  const cols: CsvColumn<BudgetStatusRow>[] = [
    { header: 'Client', value: 'client' },
    { header: 'Budget', value: (r) => r.monthlyAmount ?? '' },
    { header: 'MTD Cost', value: 'mtdCost' },
    { header: 'MTD Hours', value: 'mtdHours' },
    { header: 'Forecast (run-rate)', value: 'forecastRunRate' },
    { header: 'Forecast (trailing)', value: 'forecastTrailing' },
    { header: 'Status', value: 'status' },
  ];
  // onClick: downloadCsv(csvFilename('client-budgets'), toCsv(rows, cols));
  ```
- Export the component as a named export `export function BudgetsPage()` (matches the lazy-import convention in `App.tsx`).

- [ ] **Step 2: Add the route in `apps/web/src/App.tsx`**

Add the lazy import alongside the others (~line 42):

```tsx
const BudgetsPage = React.lazy(() =>
  import('./pages/BudgetsPage').then((m) => ({ default: m.BudgetsPage })),
);
```

Add the route inside the `AppLayout` route block (next to `/assignee-rates`):

```tsx
<Route
  path="/budgets"
  element={
    <React.Suspense fallback={Fallback}>
      <BudgetsPage />
    </React.Suspense>
  }
/>
```

> Members can view budgets, so the route itself is NOT wrapped in `RequireRole`. Editing is gated inside the page.

- [ ] **Step 3: Add nav entries**

In `apps/web/src/components/layout/Sidebar.tsx`, add to `navItems` (after the `/assignee-rates` entry, ~line 70). Pick an imported lucide icon already in the file, or add `Wallet` to the existing `lucide-react` import:

```tsx
{ to: "/budgets", label: "Budgets", icon: Wallet },
```

In `apps/web/src/components/layout/CommandPalette.tsx`, add to `NAV_ITEMS` (after Assignee Rates, ~line 16), importing `Wallet` from `lucide-react` if needed:

```tsx
{ label: 'Budgets', to: '/budgets', sub: '/budgets', icon: Wallet },
```

- [ ] **Step 4: Typecheck + build the web app**

Run: `npm run build --workspace=apps/web`
Expected: success.

- [ ] **Step 5: Manual smoke test**

Start backend + web (`npm run dev`), log in, open `/budgets`. Verify: table loads for the current month; toggling Run-rate/Trailing changes the Forecast column and any near/projected badges; as Admin/Owner, Add/Edit/Delete work and the table refreshes; a `no-budget` client (one with spend but no budget) appears at the bottom with **Set budget**.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/BudgetsPage.tsx apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/CommandPalette.tsx
git commit -m "feat(web): Budgets page with forecast toggle, burn-down, CRUD"
```

---

## Task 11: Overview budget card

**Files:**
- Modify: `apps/web/src/pages/OverviewPage.tsx`

- [ ] **Step 1: Add the card**

Read `OverviewPage.tsx` to match its card/grid pattern. Add a card that:
- Calls `useBudgetStatus()` (current month).
- Computes `overOrProjected = rows.filter(r => r.status === 'over' || r.status === 'projected-over')`.
- Shows the **count** as the headline metric (e.g. "2 clients over / projected over budget").
- Lists up to the top 3 offenders (client + `% used`), each linking to `/budgets`.
- When the count is 0, shows an "All clients within budget" empty state.
- Uses **real data only** — no synthetic sparkline or hard-coded delta (this card must not repeat the Overview's existing mock-trend pattern).

- [ ] **Step 2: Typecheck + build**

Run: `npm run build --workspace=apps/web`
Expected: success.

- [ ] **Step 3: Manual check**

On `/overview`, the budget card renders with a real count and links through to `/budgets`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/OverviewPage.tsx
git commit -m "feat(web): Overview card for clients over/projected over budget"
```

---

## Task 12: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend test suite**

Run: `npm run test`
Expected: all green, including `budget-forecast`, `budgets.repository`, `budgets.service`.

- [ ] **Step 2: Backend build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Web build**

Run: `npm run build --workspace=apps/web`
Expected: success.

- [ ] **Step 4: End-to-end manual pass**

With `npm run dev` and a budget created via the UI: create a budget for a client that has tracked time this month, confirm MTD/forecast/status are sensible, toggle forecast methods, export CSV, and confirm the Overview card reflects any over/projected-over clients.

> `npm run lint` is known-broken project-wide (ESLint v10, no root flat config) — do not treat lint failure as a blocker. Rely on build + test.

- [ ] **Step 5: Update the gaps doc (optional housekeeping)**

In `docs/FRONTEND-BACKEND-GAPS.md`, note that client budgets/forecasting is now implemented (the doc is the project's running ledger of wired vs unwired surfaces).

- [ ] **Step 6: Final commit (if Step 5 done)**

```bash
git add docs/FRONTEND-BACKEND-GAPS.md
git commit -m "docs: mark client budgets/forecasting as implemented"
```

---

## Notes for the implementer

- **Dhaka timezone is non-negotiable.** `start_time` is `timestamp without time zone` holding UTC. Always bucket via `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka'` (server SQL) or the `+6h` shift (pure JS helper). Skipping this shifts month boundaries by −6h.
- **Effective dating matches rates exactly:** closed-closed `[validFrom, validTo]`, latest `validFrom` wins on overlap, empty `validTo` = open-ended. The convention is "row ends last day of month, next starts first day of next month."
- **Currency is `USD`** by default and in the column default. Do not rename any existing `*Aud` fields here — that's the separate coordinated currency-rename effort.
- **Money is integer cents** end-to-end in storage and the helpers; convert to dollars only at the service boundary (status rows) and in the modal's amount input.
- **Do not run `prisma migrate dev`** — hand-authored migration + `prisma:deploy` only.
```

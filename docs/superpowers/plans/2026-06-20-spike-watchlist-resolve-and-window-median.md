# Spike Watchlist: Resolve, Window Median & Pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins resolve (hide) known spikes, compute the spike median from the selected date window (floored to 14 days), and page the watchlist past 20 rows with "Load 20 more".

**Architecture:** Backend `ReportsService.hourSpikes()` gains a selected-window median, a resolution filter, and a `limit`/`includeResolved`-driven slice returning `watchlistTotal`. A new `SpikeResolution` table + `SpikeResolutionService` + two admin endpoints record/clear resolutions. The React `HourSpikesPage` adds a "Show resolved" toggle, per-row Resolve/Unresolve, and a "Load 20 more" button.

**Tech Stack:** NestJS 11, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL, Jest, React + TanStack Query, axios.

## Global Constraints

- Node `>=22`, NestJS 11, Prisma 7 with hand-authored SQL migrations.
- **Migrations:** hand-author the SQL under `prisma/migrations/NNNN_name/migration.sql` and apply with `npm run prisma:deploy`. Do **NOT** run `prisma migrate dev` (schema/migration drift convention).
- **Lint is known-broken project-wide** (ESLint v10, no flat config). Do not gate on `npm run lint`; verify with `npm run build` and `npm run test`.
- `start_time` is `timestamp without time zone` holding UTC; Dhaka bucketing uses `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka'`. Do not change existing bucketing.
- `spike_date` / resolution dates are written as `new Date(\`${date}T00:00:00.000Z\`)` (the `dayStart()` convention) and recovered as `.toISOString().slice(0,10)`.
- Admin write endpoints return HTTP 200 (action endpoints), are audited by the existing `AuditLogInterceptor`, and are gated by the global `AuthGuard`/`RolesGuard` (ADMIN).
- Preserve Prettier formatting; prefer explicit DTOs/types over `any`.
- Resolution governs the **watchlist only** — the "Daily hours by user" chart is unchanged.

---

## File Structure

- `prisma/schema.prisma` — add `SpikeResolution` model (modify).
- `prisma/migrations/0011_spike_resolutions/migration.sql` — create table + unique index (create).
- `src/admin/spike-resolution.service.ts` — resolve/unresolve service (create).
- `test/spike-resolution.service.spec.ts` — service unit tests (create).
- `src/admin/dto/resolve-spike.dto.ts` — `ResolveSpikeDto`, `UnresolveSpikeDto` (create).
- `src/admin/admin.controller.ts` — two endpoints (modify).
- `src/admin/admin.module.ts` — register `SpikeResolutionService` (modify).
- `test/admin.controller.spec.ts` — endpoint delegation tests (modify).
- `src/reports/reports.service.ts` — `hourSpikes()` median/filter/pagination (modify).
- `test/reports.service.spec.ts` — new `hourSpikes` cases + `spikeResolution` mock (modify).
- `src/reports/reports.controller.ts` — `limit`/`includeResolved` params (modify).
- `test/reports.controller.spec.ts` — param forwarding (modify).
- `apps/web/src/api/reports.ts` — `hourSpikes` params (modify).
- `apps/web/src/api/admin.ts` — `resolveSpike`/`unresolveSpike` (modify).
- `apps/web/src/hooks/useReports.ts` — types + `useHourSpikes(limit, includeResolved)` + resolve hooks (modify).
- `apps/web/src/pages/HourSpikesPage.tsx` — toggle, resolve buttons, load-more (modify).

---

## Task 1: `SpikeResolution` model + migration

**Files:**
- Modify: `prisma/schema.prisma` (after the `SpikeNotification` model, ~line 264)
- Create: `prisma/migrations/0011_spike_resolutions/migration.sql`

**Interfaces:**
- Produces: Prisma model `spikeResolution` with fields `clickupUserId`, `spikeDate` (`@db.Date`), `userName?`, `note?`, `resolvedBy?`, `resolvedAt`; unique `(clickupUserId, spikeDate)` → composite key `clickupUserId_spikeDate`.

- [ ] **Step 1: Add the model to `schema.prisma`**

Insert immediately after the closing `}` of `model SpikeNotification` (the `@@map("spike_notifications")` block):

```prisma
model SpikeResolution {
  id            BigInt   @id @default(autoincrement())
  clickupUserId String   @map("clickup_user_id")
  spikeDate     DateTime @map("spike_date") @db.Date
  userName      String?  @map("user_name")
  note          String?
  resolvedBy    String?  @map("resolved_by")
  resolvedAt    DateTime @default(now()) @map("resolved_at")

  @@unique([clickupUserId, spikeDate])
  @@map("spike_resolutions")
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/0011_spike_resolutions/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "spike_resolutions" (
    "id" BIGSERIAL NOT NULL,
    "clickup_user_id" TEXT NOT NULL,
    "spike_date" DATE NOT NULL,
    "user_name" TEXT,
    "note" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spike_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spike_resolutions_clickup_user_id_spike_date_key" ON "spike_resolutions"("clickup_user_id", "spike_date");
```

- [ ] **Step 3: Generate the client and apply the migration**

Run: `npm run prisma:generate && npm run prisma:deploy`
Expected: client regenerates with `prisma.spikeResolution`; migration `0011_spike_resolutions` applied (or "already applied" on re-run).

- [ ] **Step 4: Verify the type exists**

Run: `npm run build`
Expected: PASS (the new model compiles; no consumers yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0011_spike_resolutions/migration.sql
git commit -m "feat(db): add spike_resolutions table"
```

---

## Task 2: `SpikeResolutionService`

**Files:**
- Create: `src/admin/spike-resolution.service.ts`
- Create: `test/spike-resolution.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`prisma.spikeResolution.upsert/deleteMany`).
- Produces:
  - `resolve(args: { userId: string; date: string; userName?: string; note?: string; resolvedBy?: string }): Promise<{ resolved: true; date: string }>`
  - `unresolve(args: { userId: string; date: string }): Promise<{ resolved: false; date: string }>`

- [ ] **Step 1: Write the failing test**

Create `test/spike-resolution.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { SpikeResolutionService } from '../src/admin/spike-resolution.service';

function makePrisma() {
  return {
    spikeResolution: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
}

describe('SpikeResolutionService', () => {
  it('resolve() upserts keyed by user+day (idempotent)', async () => {
    const prisma = makePrisma();
    const svc = new SpikeResolutionService(prisma);
    const res = await svc.resolve({ userId: 'u1', date: '2026-06-10', userName: 'Ann', note: 'ok', resolvedBy: 'admin@x' });
    expect(res).toEqual({ resolved: true, date: '2026-06-10' });
    expect(prisma.spikeResolution.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clickupUserId_spikeDate: { clickupUserId: 'u1', spikeDate: new Date('2026-06-10T00:00:00.000Z') } },
        create: expect.objectContaining({ clickupUserId: 'u1', userName: 'Ann', note: 'ok', resolvedBy: 'admin@x' }),
        update: expect.objectContaining({ note: 'ok', resolvedBy: 'admin@x' }),
      }),
    );
  });

  it('unresolve() deletes by user+day and is a no-op when absent', async () => {
    const prisma = makePrisma();
    prisma.spikeResolution.deleteMany.mockResolvedValue({ count: 0 });
    const svc = new SpikeResolutionService(prisma);
    const res = await svc.unresolve({ userId: 'u1', date: '2026-06-10' });
    expect(res).toEqual({ resolved: false, date: '2026-06-10' });
    expect(prisma.spikeResolution.deleteMany).toHaveBeenCalledWith({
      where: { clickupUserId: 'u1', spikeDate: new Date('2026-06-10T00:00:00.000Z') },
    });
  });

  it('rejects a malformed date', async () => {
    const svc = new SpikeResolutionService(makePrisma());
    await expect(svc.resolve({ userId: 'u1', date: '06/10/2026' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- spike-resolution.service`
Expected: FAIL — cannot find module `../src/admin/spike-resolution.service`.

- [ ] **Step 3: Implement the service**

Create `src/admin/spike-resolution.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (date: string) => new Date(`${date}T00:00:00.000Z`);

@Injectable()
export class SpikeResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(args: { userId: string; date: string; userName?: string; note?: string; resolvedBy?: string }) {
    const { userId, date, userName, note, resolvedBy } = args;
    if (!DATE_RE.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    await this.prisma.spikeResolution.upsert({
      where: { clickupUserId_spikeDate: { clickupUserId: userId, spikeDate: dayStart(date) } },
      create: { clickupUserId: userId, spikeDate: dayStart(date), userName: userName ?? null, note: note ?? null, resolvedBy: resolvedBy ?? null },
      update: { userName: userName ?? null, note: note ?? null, resolvedBy: resolvedBy ?? null },
    });
    return { resolved: true as const, date };
  }

  async unresolve(args: { userId: string; date: string }) {
    const { userId, date } = args;
    if (!DATE_RE.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    await this.prisma.spikeResolution.deleteMany({
      where: { clickupUserId: userId, spikeDate: dayStart(date) },
    });
    return { resolved: false as const, date };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- spike-resolution.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/admin/spike-resolution.service.ts test/spike-resolution.service.spec.ts
git commit -m "feat(admin): SpikeResolutionService (resolve/unresolve spike days)"
```

---

## Task 3: Admin DTOs, endpoints & module wiring

**Files:**
- Create: `src/admin/dto/resolve-spike.dto.ts`
- Modify: `src/admin/admin.controller.ts` (imports + two endpoints after `notifySpike`, ~line 130)
- Modify: `src/admin/admin.module.ts` (import + provider)
- Modify: `test/admin.controller.spec.ts`

**Interfaces:**
- Consumes: `SpikeResolutionService.resolve/unresolve`, `actorLabel(user)`, `@CurrentUser()`, `AuthPrincipal`.
- Produces: `POST /admin/hour-spikes/resolve`, `DELETE /admin/hour-spikes/resolve`.

- [ ] **Step 1: Create the DTOs**

Create `src/admin/dto/resolve-spike.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ResolveSpikeDto {
  @ApiProperty({ example: '12345678', description: 'ClickUp user id from the spike watchlist row' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;

  @ApiProperty({ example: '2026-06-10', description: 'Flagged local (Asia/Dhaka) day, YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({ example: 'Ann Smith', description: 'Member name, copied from the watchlist row' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  userName?: string;

  @ApiPropertyOptional({ example: 'Legit crunch day, confirmed with PM.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class UnresolveSpikeDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;

  @ApiProperty({ example: '2026-06-10', description: 'Flagged local (Asia/Dhaka) day, YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}
```

- [ ] **Step 2: Write the failing controller test**

In `test/admin.controller.spec.ts`, find how the controller is constructed (it news `AdminController` with mocked deps). Add a `SpikeResolutionService` mock and a describe block. First locate the existing spike-notification mock setup, then mirror it. Add:

```ts
describe('hour-spike resolutions', () => {
  it('resolveSpike delegates to the service with the actor', async () => {
    const resolutions = { resolve: jest.fn().mockResolvedValue({ resolved: true, date: '2026-06-10' }), unresolve: jest.fn() } as any;
    const ctrl = makeController({ resolutions }); // see note below
    const user = { id: 'admin@x', email: 'admin@x', role: 'OWNER' } as any;
    await ctrl.resolveSpike({ userId: 'u1', date: '2026-06-10', userName: 'Ann', note: 'ok' } as any, user);
    expect(resolutions.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', date: '2026-06-10', userName: 'Ann', note: 'ok' }),
    );
  });

  it('unresolveSpike delegates to the service', async () => {
    const resolutions = { resolve: jest.fn(), unresolve: jest.fn().mockResolvedValue({ resolved: false, date: '2026-06-10' }) } as any;
    const ctrl = makeController({ resolutions });
    await ctrl.unresolveSpike({ userId: 'u1', date: '2026-06-10' } as any);
    expect(resolutions.unresolve).toHaveBeenCalledWith({ userId: 'u1', date: '2026-06-10' });
  });
});
```

Note: `test/admin.controller.spec.ts` constructs the controller inline rather than via a `makeController` helper. Match the file's existing style — pass a `SpikeResolutionService`-shaped mock into the constructor in the same position the other services are passed, and call `new AdminController(...)` directly if there is no helper. Read the file's existing `new AdminController(` call and add the `resolutions` mock argument in the same constructor-parameter order defined in Step 4.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- admin.controller`
Expected: FAIL — `ctrl.resolveSpike is not a function`.

- [ ] **Step 4: Add the endpoints to the controller**

In `src/admin/admin.controller.ts`:

Add the import near the other DTO imports:

```ts
import { ResolveSpikeDto, UnresolveSpikeDto } from './dto/resolve-spike.dto';
import { SpikeResolutionService } from './spike-resolution.service';
```

Add `SpikeResolutionService` to the constructor (mirror how `SpikeNotificationService` is injected — find `private readonly spikeNotifications: SpikeNotificationService,` and add below it):

```ts
    private readonly spikeResolutions: SpikeResolutionService,
```

Add the endpoints immediately after the `notifySpike` method (after its closing `}`):

```ts
  @Post('hour-spikes/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a flagged spike day as resolved so it drops out of the watchlist. Idempotent.' })
  resolveSpike(@Body() dto: ResolveSpikeDto, @CurrentUser() user: AuthPrincipal) {
    return this.spikeResolutions.resolve({
      userId: dto.userId,
      date: dto.date,
      userName: dto.userName,
      note: dto.note,
      resolvedBy: actorLabel(user),
    });
  }

  @Delete('hour-spikes/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Un-resolve a spike day so it reappears in the watchlist. No-op if not resolved.' })
  unresolveSpike(@Body() dto: UnresolveSpikeDto) {
    return this.spikeResolutions.unresolve({ userId: dto.userId, date: dto.date });
  }
```

Ensure `Delete` is in the `@nestjs/common` import list at the top (add it if absent).

- [ ] **Step 5: Register the provider**

In `src/admin/admin.module.ts`:
- Add `import { SpikeResolutionService } from './spike-resolution.service';` near the `SpikeNotificationService` import.
- Add `SpikeResolutionService` to the `providers` array (next to `SpikeNotificationService`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- admin.controller`
Expected: PASS (existing + 2 new).

- [ ] **Step 7: Build to confirm wiring**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/admin/dto/resolve-spike.dto.ts src/admin/admin.controller.ts src/admin/admin.module.ts test/admin.controller.spec.ts
git commit -m "feat(admin): POST/DELETE /admin/hour-spikes/resolve endpoints"
```

---

## Task 4: `hourSpikes()` — window median, resolution filter, pagination

**Files:**
- Modify: `src/reports/reports.service.ts` (`hourSpikes()`, lines ~1315-1465)
- Modify: `test/reports.service.spec.ts` (`makePrisma` + new `hourSpikes` cases)

**Interfaces:**
- Consumes: `prisma.spikeResolution.findMany`, existing `parseDate`, `prisma.spikeNotification.findMany`.
- Produces: `hourSpikes(cap: number, fromParam?: string, toParam?: string, limit = 20, includeResolved = false): Promise<{ cap: number; watchlist: WatchRowEnriched[]; watchlistTotal: number; byUser: { buckets: string[]; users: ... } }>` where `WatchRowEnriched` adds `notified: boolean` and `resolved: boolean`.

- [ ] **Step 1: Add `spikeResolution` to the test prisma mock**

In `test/reports.service.spec.ts`, in `makePrisma`'s `base` object, add next to `spikeNotification`:

```ts
      spikeResolution: { findMany: jest.fn().mockResolvedValue([]) },
```

- [ ] **Step 2: Write the failing tests**

Add these inside the `describe('hourSpikes', ...)` block (the `stub` helper already stubs the 3 `$queryRaw` calls; `spikeResolution.findMany` defaults to `[]`):

```ts
    it('returns watchlistTotal and respects the limit', async () => {
      const prisma = makePrisma();
      const display: any[] = [];
      const axis: string[] = [];
      for (let i = 0; i < 25; i++) {
        const day = `2026-06-${String(i + 1).padStart(2, '0')}`;
        display.push({ user_id: `u${i}`, user_name: `U${i}`, day, hours: 100 - i });
        axis.push(day);
      }
      stub(prisma, [], display, axis);
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-01', '2026-06-25', 5);
      expect(r.watchlist).toHaveLength(5);
      expect(r.watchlistTotal).toBe(25);
      expect(r.watchlist[0].hours).toBe(100);
    });

    it('excludes resolved days by default and marks resolved=false on the rest', async () => {
      const prisma = makePrisma();
      stub(
        prisma,
        [],
        [
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-10', hours: 20 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-11', hours: 18 },
        ],
        ['2026-06-10', '2026-06-11'],
      );
      prisma.spikeResolution.findMany.mockResolvedValue([
        { clickupUserId: 'u1', spikeDate: new Date('2026-06-10T00:00:00.000Z') },
      ]);
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-01', '2026-06-30');
      expect(r.watchlist).toHaveLength(1);
      expect(r.watchlist[0]).toMatchObject({ userId: 'u2', resolved: false });
      expect(r.watchlistTotal).toBe(1);
    });

    it('includes resolved days (resolved=true) when includeResolved is set', async () => {
      const prisma = makePrisma();
      stub(
        prisma,
        [],
        [
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-10', hours: 20 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-11', hours: 18 },
        ],
        ['2026-06-10', '2026-06-11'],
      );
      prisma.spikeResolution.findMany.mockResolvedValue([
        { clickupUserId: 'u1', spikeDate: new Date('2026-06-10T00:00:00.000Z') },
      ]);
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-01', '2026-06-30', 20, true);
      expect(r.watchlist).toHaveLength(2);
      expect(r.watchlist.find((w: any) => w.userId === 'u1')!.resolved).toBe(true);
      expect(r.watchlist.find((w: any) => w.userId === 'u2')!.resolved).toBe(false);
      expect(r.watchlistTotal).toBe(2);
    });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- reports.service`
Expected: FAIL — `watchlistTotal` undefined / `resolved` missing / arity (the existing 20-cap test still passes since default `limit=20`).

- [ ] **Step 4: Update the median baseline window**

In `src/reports/reports.service.ts`, change the `hourSpikes` signature and the baseline:

Replace:
```ts
  async hourSpikes(cap: number, fromParam?: string, toParam?: string) {
```
with:
```ts
  async hourSpikes(cap: number, fromParam?: string, toParam?: string, limit = 20, includeResolved = false) {
```

After the `const from = ...` / `const to = ...` lines (just below `parseDate` usage), add:
```ts
    // Median baseline derives from the selected window, floored to 14 days so a
    // short pick doesn't produce a noisy median that flags nearly every day.
    const BASELINE_FLOOR_MS = 14 * 24 * 60 * 60 * 1000;
    const baselineFrom = new Date(Math.min(from.getTime(), to.getTime() - BASELINE_FLOOR_MS));
```

In the **baseline** raw query (the first of the three in `Promise.all`), replace:
```ts
        AND e.start_time >= now() - interval '30 days'
```
with:
```ts
        AND e.start_time >= ${baselineFrom}
        AND e.start_time <= ${to}
```

- [ ] **Step 5: Add the resolution filter + pagination**

Replace the watchlist tail of the method. Find this block:

```ts
    watchlist.sort((a, b) => b.hours - a.hours);
    const top = watchlist.slice(0, 20);
```

Replace it with:

```ts
    watchlist.sort((a, b) => b.hours - a.hours);

    // Resolved user-days drop out of the watchlist unless explicitly requested.
    // One range query (not a big OR); recover YYYY-MM-DD from the @db.Date the
    // same way the notified-enrichment below does.
    const resolutions = await this.prisma.spikeResolution.findMany({
      where: { spikeDate: { gte: new Date(`${buckets[0] ?? '1970-01-01'}T00:00:00.000Z`), lte: new Date(`${buckets[buckets.length - 1] ?? '1970-01-01'}T00:00:00.000Z`) } },
      select: { clickupUserId: true, spikeDate: true },
    });
    const resolvedSet = new Set(
      resolutions.map((r) => `${r.clickupUserId}|${r.spikeDate.toISOString().slice(0, 10)}`),
    );
    const withResolved = watchlist.map((w) => ({ ...w, resolved: resolvedSet.has(`${w.userId}|${w.date}`) }));
    const filtered = includeResolved ? withResolved : withResolved.filter((w) => !w.resolved);
    const watchlistTotal = filtered.length;
    const top = filtered.slice(0, limit);
```

Then update the notified-enrichment `enriched` line to keep `resolved`. Find:
```ts
    const enriched = top.map((w) => ({ ...w, notified: notifiedSet.has(`${w.userId}|${w.date}`) }));

    return { cap, watchlist: enriched, byUser: { buckets, users } };
```
Replace with:
```ts
    const enriched = top.map((w) => ({ ...w, notified: notifiedSet.has(`${w.userId}|${w.date}`) }));

    return { cap, watchlist: enriched, watchlistTotal, byUser: { buckets, users } };
```

(`top` already carries `resolved` from `filtered`, so `enriched` rows have both `resolved` and `notified`.)

Note: the notified-enrichment block above still references `top` and its `OR`/empty-guard — leave it intact; it now operates on the paginated slice.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- reports.service`
Expected: PASS (existing `hourSpikes` cases + 3 new). The existing "caps at 20" test still passes via the default `limit = 20`.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/reports/reports.service.ts test/reports.service.spec.ts
git commit -m "feat(reports): window median + resolution filter + pagination in hourSpikes"
```

---

## Task 5: Controller param wiring

**Files:**
- Modify: `src/reports/reports.controller.ts` (`hourSpikes`, lines ~73-77)
- Modify: `test/reports.controller.spec.ts`

**Interfaces:**
- Consumes: `ReportsService.hourSpikes(cap, from, to, limit, includeResolved)`.
- Produces: `GET /reports/time-entries/hour-spikes?from&to&limit&includeResolved`.

- [ ] **Step 1: Update the controller test**

In `test/reports.controller.spec.ts`, the existing `hourSpikes` test asserts `toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10')`. Update it and add a params case:

```ts
    it('passes the cap, range, limit and includeResolved through', async () => {
      const svc = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const settings = { getSpikeHoursCap: () => 10 } as any;
      const ctrl = new ReportsController(svc, settings); // match the file's existing constructor call/args
      await ctrl.hourSpikes('2026-06-01', '2026-06-10', '40', 'true');
      expect(svc.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 40, true);
    });
```

If the existing test (`toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10')`) remains, update its expectation to the new 5-arg form: `toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false)` and call `ctrl.hourSpikes('2026-06-01', '2026-06-10')`. Read the existing constructor invocation in the file and mirror its argument order/shape rather than assuming.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- reports.controller`
Expected: FAIL — called with 3 args, expected 5.

- [ ] **Step 3: Update the controller**

In `src/reports/reports.controller.ts`, replace the `hourSpikes` route:

```ts
  @Get('time-entries/hour-spikes')
  @ApiOperation({ summary: "Per-user daily-hour spikes: a team watchlist of days exceeding the absolute cap or 2x the user's median over the selected window (min 14 days), plus per-user daily-hours series for the chart. Supports limit + includeResolved." })
  hourSpikes(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('includeResolved') includeResolved?: string,
  ) {
    return this.reports.hourSpikes(this.settings.getSpikeHoursCap(), from, to, Number(limit) || 20, includeResolved === 'true');
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- reports.controller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.controller.ts test/reports.controller.spec.ts
git commit -m "feat(reports): hour-spikes route accepts limit + includeResolved"
```

---

## Task 6: Web API client + hooks

**Files:**
- Modify: `apps/web/src/api/reports.ts` (`hourSpikes`)
- Modify: `apps/web/src/api/admin.ts` (`resolveSpike`, `unresolveSpike`)
- Modify: `apps/web/src/hooks/useReports.ts` (types + `useHourSpikes` + resolve hooks)

**Interfaces:**
- Produces: `reportsApi.hourSpikes({ from, to, limit, includeResolved })`; `adminApi.resolveSpike(body)`, `adminApi.unresolveSpike(body)`; `useHourSpikes(limit, includeResolved)`, `useResolveSpike()`, `useUnresolveSpike()`; `HourSpikeWatchRow.resolved: boolean`; `HourSpikes.watchlistTotal: number`.

- [ ] **Step 1: Update the reports API client**

In `apps/web/src/api/reports.ts`, replace the `hourSpikes` entry:

```ts
  hourSpikes: (params?: { from?: string; to?: string; limit?: number; includeResolved?: boolean }) =>
    apiClient.get('/reports/time-entries/hour-spikes', { params }).then(r => r.data),
```

- [ ] **Step 2: Add the admin API calls**

In `apps/web/src/api/admin.ts`, add after `notifySpike` (before the `excludedAssignees` block):

```ts
  resolveSpike: (body: { userId: string; date: string; userName?: string; note?: string }) =>
    apiClient.post('/admin/hour-spikes/resolve', body).then((r) => r.data as { resolved: boolean; date: string }),
  unresolveSpike: (body: { userId: string; date: string }) =>
    apiClient.delete('/admin/hour-spikes/resolve', { data: body }).then((r) => r.data as { resolved: boolean; date: string }),
```

- [ ] **Step 3: Update types + hooks**

In `apps/web/src/hooks/useReports.ts`:

Add `resolved` to `HourSpikeWatchRow`:
```ts
  notified: boolean;
  resolved: boolean;
```

Add `watchlistTotal` to `HourSpikes`:
```ts
export interface HourSpikes {
  cap: number;
  watchlist: HourSpikeWatchRow[];
  watchlistTotal: number;
  byUser: { buckets: string[]; users: HourSpikeUser[] };
}
```

Replace `useHourSpikes`:
```ts
export function useHourSpikes(limit: number, includeResolved: boolean) {
  const { fromDate, toDate } = useGlobalFilters();
  return useQuery<HourSpikes>({
    queryKey: ['hour-spikes', fromDate, toDate, limit, includeResolved],
    queryFn: () => reportsApi.hourSpikes({ from: fromDate, to: toDate, limit, includeResolved }),
    placeholderData: keepPreviousData,
  });
}
```

Add resolve hooks after `useNotifySpike`:
```ts
export function useResolveSpike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; date: string; userName?: string; note?: string }) => adminApi.resolveSpike(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hour-spikes'] }),
  });
}

export function useUnresolveSpike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; date: string }) => adminApi.unresolveSpike(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hour-spikes'] }),
  });
}
```

Confirm `adminApi` is already imported in this file (it is — `useSpikeNoticePreview`/`useNotifySpike` use it).

- [ ] **Step 4: Build the web app**

Run: `npm run build`
Expected: FAIL — `HourSpikesPage.tsx` calls `useHourSpikes()` with no args and lacks `resolved`/`watchlistTotal` handling. This is expected; Task 7 fixes the page. (If the repo builds the web app separately, the type errors will be in `apps/web`; proceed to Task 7 before declaring build green.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/api/admin.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): hour-spikes pagination + resolve API hooks"
```

---

## Task 7: `HourSpikesPage` UI — toggle, resolve, load-more

**Files:**
- Modify: `apps/web/src/pages/HourSpikesPage.tsx`

**Interfaces:**
- Consumes: `useHourSpikes(limit, includeResolved)`, `useResolveSpike()`, `useUnresolveSpike()`, `HourSpikeWatchRow.resolved`, `HourSpikes.watchlistTotal`.

- [ ] **Step 1: Wire state and the updated hook**

In `HourSpikesPage.tsx`, replace the data fetch and add state. Replace:
```ts
  const q = useHourSpikes();
  const data = q.data;
```
with:
```ts
  const [limit, setLimit] = useState(20);
  const [showResolved, setShowResolved] = useState(false);
  const q = useHourSpikes(limit, showResolved);
  const data = q.data;

  const resolveSpike = useResolveSpike();
  const unresolveSpike = useUnresolveSpike();

  // Reset paging when the toggle changes so totals/buttons stay consistent.
  // (Date-range changes already remount the query via its key.)
  const onToggleResolved = (next: boolean) => { setShowResolved(next); setLimit(20); };
```

Update the import line:
```ts
import { useHourSpikes, useResolveSpike, useUnresolveSpike, type HourSpikeWatchRow } from '../hooks/useReports';
```

- [ ] **Step 2: Add the "Show resolved" toggle to the card header**

Change the watchlist `Card` opening tag to include an `action` (admins only). Replace:
```tsx
      <Card padding={0} title="Spike watchlist" subtitle="Days a user logged unusually high hours">
```
with:
```tsx
      <Card
        padding={0}
        title="Spike watchlist"
        subtitle="Days a user logged unusually high hours"
        action={
          canNotify ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showResolved} onChange={(e) => onToggleResolved(e.target.checked)} />
              Show resolved
            </label>
          ) : undefined
        }
      >
```

- [ ] **Step 3: Style resolved rows and add Resolve/Unresolve**

In the row `.map`, dim resolved rows and swap the action. Find the row wrapper `div` (the one with `borderBottom`) and add `opacity` when resolved — change its `style` to include:
```tsx
                  opacity: s.resolved ? 0.55 : 1,
```

Then, in the `{canNotify && ( ... )}` block, replace its contents so resolved rows show "Resolved + Unresolve" and unresolved rows show Notify + Resolve. Replace the entire `{canNotify && ( ... )}` expression with:

```tsx
                {canNotify && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {s.resolved ? (
                      <>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 7,
                          background: 'var(--muted-bg)', color: 'var(--text-muted)',
                        }}>
                          <Check size={12} /> Resolved
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Unresolve ${s.userName} on ${formatDate(s.date)}`}
                          disabled={unresolveSpike.isPending}
                          onClick={() => unresolveSpike.mutate({ userId: s.userId, date: s.date })}
                        >
                          Unresolve
                        </Button>
                      </>
                    ) : (
                      <>
                        {s.notified ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 7,
                            background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                          }}>
                            <Check size={12} /> Notified
                          </span>
                        ) : (
                          <Button size="sm" variant="caution" aria-label={`Notify ${s.userName} about ${formatDate(s.date)}`} onClick={() => setActiveRow(s)}>
                            Notify
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Resolve ${s.userName} on ${formatDate(s.date)}`}
                          disabled={resolveSpike.isPending}
                          onClick={() => resolveSpike.mutate({ userId: s.userId, date: s.date, userName: s.userName })}
                        >
                          Resolve
                        </Button>
                      </>
                    )}
                  </div>
                )}
```

Note: confirm `Button` supports a `ghost` variant. If it does not, read `apps/web/src/components/ui/Button.tsx` for the available variants and use the most neutral one (e.g. `secondary`/default) for Resolve/Unresolve. Do not invent a variant.

- [ ] **Step 4: Add the "Load 20 more" button**

After the watchlist list `div` (the `{data && data.watchlist.length > 0 && ( ... )}` block), before the closing `</Card>`, add:

```tsx
        {data && data.watchlist.length < data.watchlistTotal && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'center' }}>
            <Button size="sm" variant="ghost" disabled={q.isFetching} onClick={() => setLimit((n) => n + 20)}>
              Load 20 more ({data.watchlist.length} of {data.watchlistTotal})
            </Button>
          </div>
        )}
```

- [ ] **Step 5: Build the web app**

Run: `npm run build`
Expected: PASS (page now consumes the new hook signature, `resolved`, and `watchlistTotal`).

- [ ] **Step 6: Manual smoke (local)**

Run the app (`npm run start:dev` + the web dev server per `docs/OPERATIONS.md`), open **Time Spikes**:
- A range with >20 spikes shows "Load 20 more (20 of N)"; clicking grows the list.
- As an admin, "Resolve" on a row removes it (with "Show resolved" off); enabling "Show resolved" shows it dimmed with "Unresolve"; clicking "Unresolve" restores it.
- Pick a 2–3 day range: the median floor keeps the list from flagging every day.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/HourSpikesPage.tsx
git commit -m "feat(web): resolve/unresolve, show-resolved toggle, load-more on Time Spikes"
```

---

## Final verification

- [ ] Run: `npm run test` — Expected: PASS (all suites, including new spike-resolution + reports cases).
- [ ] Run: `npm run build` — Expected: PASS (API + web).
- [ ] Confirm `npm run prisma:deploy` reports migration `0011_spike_resolutions` applied.

---

## Self-review notes

- **Spec coverage:** window median (Task 4), 14-day floor (Task 4 Step 4), resolve-as-hide + reversible (Tasks 1–3, 7), admins-only (Task 7 `canNotify` gate + RolesGuard), pagination/Load-20-more + `watchlistTotal` (Tasks 4–7), chart unchanged (no chart edits). Notified-enrichment preserved (Task 4 Step 5). Idempotent resolve + no-op unresolve (Task 2).
- **Pattern parity:** `SpikeResolution`/service/DTOs/endpoints mirror the existing `SpikeNotification` equivalents; migration mirrors `0010`.
- **Known caveats baked in:** lint is broken (verify via build/test); migrations hand-authored + `prisma:deploy`; `dayStart()` date convention reused on both read and write so Set keys line up.

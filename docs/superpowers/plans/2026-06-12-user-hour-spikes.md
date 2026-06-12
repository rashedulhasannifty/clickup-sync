# User Daily-Hour Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Time Spikes" dashboard page that shows a team-wide watchlist of days where a user logged unusually high hours, plus a per-user daily-hours chart with spike days highlighted — backed by a configurable org-wide hour cap.

**Architecture:** A new `GET /reports/time-entries/hour-spikes` endpoint aggregates `duration_hours` per (user, local-day) in SQL, then does spike **detection/ranking in TypeScript** (so the rule logic is unit-testable against mocked `$queryRaw`). The relative-rule median uses a **fixed trailing 30-day baseline**; the chart/watchlist follow the **global date filter**. The absolute cap is a new `spike_hours_cap` column on the existing singleton `AppSettings` row, edited via the existing `PATCH /admin/settings` (Owner-only) and read by `ReportsController` (which injects the `@Global` `SettingsService`) and passed into the service.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), Jest, React 19 + React Router v6 + TanStack Query + Vite (hand-rolled SVG charts).

---

## Spike rules (reference for all tasks)

A user-day is a **spike** if **either** fires:
- **absolute:** `hours > cap` (cap = org setting, default 12)
- **relative:** `median > 0 AND hours > 2 * median AND hours >= 4` (4h floor)

Classification: both rules → `'both'`; only absolute → `'absolute'`; only relative → `'relative'`; neither → not a spike.

---

## File structure

**Backend (modify):**
- `prisma/schema.prisma` — add `spikeHoursCap` to `AppSettings`
- `prisma/migrations/0008_spike_hours_cap/migration.sql` — **create**
- `src/settings/settings.repository.ts` — add `spikeHoursCap` to `SettingsWrite`/`SettingsRow`
- `src/settings/settings.service.ts` — cache field, `getSpikeHoursCap()`, `getMasked()`, `update()`, `SettingsPatch`/`MaskedSettings`
- `src/admin/dto/update-settings.dto.ts` — add validated `spikeHoursCap?`
- `src/reports/reports.service.ts` — add `hourSpikes(cap, from?, to?)`
- `src/reports/reports.controller.ts` — inject `SettingsService`, add `hour-spikes` route
- `test/settings.service.spec.ts`, `test/reports.service.spec.ts`, `test/reports.controller.spec.ts` — tests

**Frontend (modify/create):**
- `apps/web/src/api/settings.ts` — add `spikeHoursCap` to `AppSettings`/`SettingsPatch`
- `apps/web/src/pages/SettingsPage.tsx` — cap input in the Sync tab's "Cost calculation" card
- `apps/web/src/api/reports.ts` — `hourSpikes()` method
- `apps/web/src/hooks/useReports.ts` — `HourSpikes*` types + `useHourSpikes()`
- `apps/web/src/pages/HourSpikesPage.tsx` — **create**
- `apps/web/src/App.tsx` — lazy import + route
- `apps/web/src/components/layout/Sidebar.tsx` — nav item
- `apps/web/src/components/layout/CommandPalette.tsx` — nav item

---

## Task 1: Add `spike_hours_cap` column to AppSettings

**Files:**
- Modify: `prisma/schema.prisma` (model `AppSettings`)
- Create: `prisma/migrations/0008_spike_hours_cap/migration.sql`

- [ ] **Step 1: Add the field to the Prisma model**

In `prisma/schema.prisma`, in `model AppSettings`, add the field after `webhookEvents`:

```prisma
  webhookEvents      String?  @map("webhook_events")
  spikeHoursCap      Int      @default(12) @map("spike_hours_cap")
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at")
```

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/0008_spike_hours_cap/migration.sql` with exactly:

```sql
-- Add configurable absolute daily-hours spike cap (default 12).
ALTER TABLE "app_settings"
  ADD COLUMN "spike_hours_cap" INTEGER NOT NULL DEFAULT 12;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npm run prisma:generate`
Expected: completes without error; `AppSettings` type now includes `spikeHoursCap`.

- [ ] **Step 4: Apply the migration locally**

Run: `npm run prisma:deploy`
Expected: applies `0008_spike_hours_cap` (or reports already applied). No error.

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0008_spike_hours_cap
git commit -m "feat: add spike_hours_cap column to app_settings"
```

---

## Task 2: Wire `spikeHoursCap` through SettingsService

**Files:**
- Modify: `src/settings/settings.repository.ts`
- Modify: `src/settings/settings.service.ts`
- Modify: `src/admin/dto/update-settings.dto.ts`
- Test: `test/settings.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/settings.service.spec.ts` (inside the top-level `describe('SettingsService', …)` block):

```ts
  it('defaults spikeHoursCap to 12 when no DB row exists', async () => {
    const svc = new SettingsService(makeRepo(null), makeCrypto());
    await svc.onModuleInit();
    expect(svc.getSpikeHoursCap()).toBe(12);
    expect(svc.getMasked().spikeHoursCap).toBe(12);
  });

  it('reads spikeHoursCap from the DB row', async () => {
    const repo = makeRepo({ id: 'singleton', spikeHoursCap: 10, updatedAt: new Date() });
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    expect(svc.getSpikeHoursCap()).toBe(10);
  });

  it('round-trips spikeHoursCap through update()', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    const masked = await svc.update({ spikeHoursCap: 16 }, 'tester');
    expect(masked.spikeHoursCap).toBe(16);
    expect(svc.getSpikeHoursCap()).toBe(16);
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ spikeHoursCap: 16, updatedBy: 'tester' }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- settings.service`
Expected: FAIL — `getSpikeHoursCap` not a function / `spikeHoursCap` missing on masked.

- [ ] **Step 3: Extend the repository types**

In `src/settings/settings.repository.ts`, add `spikeHoursCap` to both interfaces:

```ts
export interface SettingsWrite {
  clickupApiTokenEnc?: string | null;
  webhookSecretEnc?: string | null;
  clickupTeamId?: string | null;
  webhookEndpoint?: string | null;
  webhookEvents?: string | null;
  spikeHoursCap?: number;
  updatedBy?: string | null;
}

export interface SettingsRow extends SettingsWrite {
  id: string;
  updatedAt: Date;
}
```

- [ ] **Step 4: Extend SettingsService**

In `src/settings/settings.service.ts`:

(a) Add a default constant near the top, beside `DEFAULT_TEAM_ID`:

```ts
const DEFAULT_SPIKE_HOURS_CAP = 12;
```

(b) Add `spikeHoursCap` to the `SettingsPatch` interface:

```ts
export interface SettingsPatch {
  apiToken?: string;
  teamId?: string;
  webhookEndpoint?: string;
  webhookEvents?: string;
  webhookSecret?: string;
  spikeHoursCap?: number;
}
```

(c) Add `spikeHoursCap` to the `MaskedSettings` interface:

```ts
export interface MaskedSettings {
  apiTokenSet: boolean;
  apiTokenLast4: string | null;
  teamId: string;
  webhookEndpoint: string;
  webhookEvents: string;
  webhookSecretSet: boolean;
  spikeHoursCap: number;
  encryptionEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}
```

(d) Add `spikeHoursCap` to the `Cache` interface and `EMPTY`:

```ts
interface Cache {
  apiToken: string | null;
  webhookSecret: string | null;
  teamId: string | null;
  webhookEndpoint: string | null;
  webhookEvents: string | null;
  spikeHoursCap: number | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

const EMPTY: Cache = {
  apiToken: null,
  webhookSecret: null,
  teamId: null,
  webhookEndpoint: null,
  webhookEvents: null,
  spikeHoursCap: null,
  updatedAt: null,
  updatedBy: null,
};
```

(e) In `refresh()`, populate it from the row:

```ts
    this.cache = {
      apiToken: this.tryDecrypt(row?.clickupApiTokenEnc),
      webhookSecret: this.tryDecrypt(row?.webhookSecretEnc),
      teamId: row?.clickupTeamId ?? null,
      webhookEndpoint: row?.webhookEndpoint ?? null,
      webhookEvents: row?.webhookEvents ?? null,
      spikeHoursCap: row?.spikeHoursCap ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
```

(f) Add the getter beside the other synchronous getters:

```ts
  getSpikeHoursCap(): number {
    return this.cache.spikeHoursCap ?? DEFAULT_SPIKE_HOURS_CAP;
  }
```

(g) Add it to `getMasked()`'s returned object (after `webhookSecretSet`):

```ts
      webhookSecretSet: secret.length > 0,
      spikeHoursCap: this.getSpikeHoursCap(),
      encryptionEnabled: this.crypto.isEnabled,
```

(h) Handle it in `update()` (after the `webhookEvents` line, before the secret writes):

```ts
    if (patch.webhookEvents !== undefined) data.webhookEvents = patch.webhookEvents.trim() || null;
    if (patch.spikeHoursCap !== undefined) data.spikeHoursCap = patch.spikeHoursCap;
```

- [ ] **Step 5: Add validation to the DTO**

In `src/admin/dto/update-settings.dto.ts`, update the imports and add the field:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
```

Add at the end of the class (after `webhookSecret`):

```ts
  @ApiPropertyOptional({ description: 'Absolute daily-hours cap for spike detection (1–24). Default 12.', minimum: 1, maximum: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  spikeHoursCap?: number;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- settings.service`
Expected: PASS (all three new tests plus existing ones).

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/settings/settings.repository.ts src/settings/settings.service.ts src/admin/dto/update-settings.dto.ts test/settings.service.spec.ts
git commit -m "feat: surface spikeHoursCap through settings service + admin DTO"
```

---

## Task 3: Add `hourSpikes()` to ReportsService

**Files:**
- Modify: `src/reports/reports.service.ts`
- Test: `test/reports.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/reports.service.spec.ts` (inside the top-level `describe('ReportsService', …)`, after an existing `describe` block). These mock the three `$queryRaw` calls in call order: **baselineRows, displayRows, axisRows**.

```ts
  describe('hourSpikes', () => {
    // Helper: stub the 3 raw queries in the order hourSpikes calls them.
    function stub(prisma: any, baseline: any[], display: any[], axis: string[]) {
      prisma.$queryRaw
        .mockResolvedValueOnce(baseline)
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce(axis.map((bucket) => ({ bucket })));
    }

    it('flags an absolute-only spike (over cap, under 2x median)', async () => {
      const prisma = makePrisma();
      // median(8,8,8) = 8 → 2x = 16; 14h is > cap(12) but < 16 → absolute only.
      stub(
        prisma,
        [
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-01', hours: 8 },
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-02', hours: 8 },
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-03', hours: 8 },
        ],
        [{ user_id: 'u1', user_name: 'Ann', day: '2026-06-10', hours: 14 }],
        ['2026-06-10'],
      );
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.cap).toBe(12);
      expect(r.watchlist).toHaveLength(1);
      expect(r.watchlist[0]).toMatchObject({ userId: 'u1', userName: 'Ann', date: '2026-06-10', hours: 14, rule: 'absolute' });
      expect(r.byUser.users[0].points[0]).toEqual({ date: '2026-06-10', hours: 14, isSpike: true });
    });

    it('flags a relative-only spike (over 2x median and >= 4h, under cap)', async () => {
      const prisma = makePrisma();
      // median(3,3,3) = 3 → 2x = 6; 7h > 6 and >= 4, and 7 < cap(12) → relative only.
      stub(
        prisma,
        [
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-01', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-02', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-03', hours: 3 },
        ],
        [{ user_id: 'u2', user_name: 'Bob', day: '2026-06-10', hours: 7 }],
        ['2026-06-10'],
      );
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist[0]).toMatchObject({ rule: 'relative', hours: 7, median: 3 });
      expect(r.watchlist[0].multiplier).toBeCloseTo(7 / 3, 4);
    });

    it('does not flag when the 4h floor suppresses a small-median spike', async () => {
      const prisma = makePrisma();
      // median(1,1,1) = 1 → 2x = 2; 3h > 2 but 3 < 4 floor, and 3 < cap → no spike.
      stub(
        prisma,
        [
          { user_id: 'u3', user_name: 'Cy', day: '2026-06-01', hours: 1 },
          { user_id: 'u3', user_name: 'Cy', day: '2026-06-02', hours: 1 },
          { user_id: 'u3', user_name: 'Cy', day: '2026-06-03', hours: 1 },
        ],
        [{ user_id: 'u3', user_name: 'Cy', day: '2026-06-10', hours: 3 }],
        ['2026-06-10'],
      );
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist).toHaveLength(0);
      expect(r.byUser.users[0].points[0].isSpike).toBe(false);
    });

    it('does not flag a normal day (neither rule)', async () => {
      const prisma = makePrisma();
      // median 6 → 2x = 12; 6h is < cap(12) and < 12 → no spike.
      stub(
        prisma,
        [
          { user_id: 'u4', user_name: 'Di', day: '2026-06-01', hours: 6 },
          { user_id: 'u4', user_name: 'Di', day: '2026-06-02', hours: 6 },
        ],
        [{ user_id: 'u4', user_name: 'Di', day: '2026-06-10', hours: 6 }],
        ['2026-06-10'],
      );
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist).toHaveLength(0);
    });

    it("classifies a day as 'both' when over cap and over 2x median", async () => {
      const prisma = makePrisma();
      // median(5,5) = 5 → 2x = 10; 15h > cap(12) and > 10 → both.
      stub(
        prisma,
        [
          { user_id: 'u5', user_name: 'Ed', day: '2026-06-01', hours: 5 },
          { user_id: 'u5', user_name: 'Ed', day: '2026-06-02', hours: 5 },
        ],
        [{ user_id: 'u5', user_name: 'Ed', day: '2026-06-10', hours: 15 }],
        ['2026-06-10'],
      );
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist[0].rule).toBe('both');
    });

    it('ranks the watchlist by raw hours descending and caps at 20', async () => {
      const prisma = makePrisma();
      const baseline: any[] = [];
      const display: any[] = [];
      const axis: string[] = [];
      // 25 distinct users, each one spike day with hours 100..76 (all over cap).
      for (let i = 0; i < 25; i++) {
        const day = `2026-06-${String(i + 1).padStart(2, '0')}`;
        display.push({ user_id: `u${i}`, user_name: `U${i}`, day, hours: 100 - i });
        axis.push(day);
      }
      stub(prisma, baseline, display, axis);
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-01', '2026-06-25');
      expect(r.watchlist).toHaveLength(20);
      expect(r.watchlist[0].hours).toBe(100);
      expect(r.watchlist[19].hours).toBe(81);
    });

    it('zero-fills days with no entries in each user series', async () => {
      const prisma = makePrisma();
      stub(
        prisma,
        [],
        [{ user_id: 'u6', user_name: 'Fi', day: '2026-06-02', hours: 5 }],
        ['2026-06-01', '2026-06-02', '2026-06-03'],
      );
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-01', '2026-06-03');
      expect(r.byUser.buckets).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
      expect(r.byUser.users[0].points.map((p: any) => p.hours)).toEqual([0, 5, 0]);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- reports.service`
Expected: FAIL — `hourSpikes` is not a function.

- [ ] **Step 3: Implement `hourSpikes()`**

In `src/reports/reports.service.ts`, add this method inside the `ReportsService` class (e.g. right after `anomalies()`):

```ts
  /**
   * Per-user daily-hour spikes. SQL only aggregates hours per (user, local day);
   * detection, classification, ranking and zero-fill happen here in TS so the
   * rule logic is unit-testable. The relative-rule median uses a FIXED trailing
   * 30-day baseline (independent of the display window) so "2x median" stays
   * meaningful even when the chart is zoomed to a few days.
   */
  async hourSpikes(cap: number, fromParam?: string, toParam?: string) {
    const TZ = Prisma.raw(`'Asia/Dhaka'`);
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const from = parseDate(fromParam, defaultFrom);
    const to = parseDate(toParam, new Date());

    type DayRow = { user_id: string | null; user_name: string | null; day: string; hours: number };

    // Fixed trailing 30-day baseline (for medians).
    const baselineRows = await this.prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT COALESCE(e.user_id, 'unknown')                        AS user_id,
             COALESCE(NULLIF(e.user_name, ''), e.user_id, 'Unknown') AS user_name,
             to_char(date_trunc('day', e.start_time AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(e.duration_hours), 0)::float             AS hours
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time IS NOT NULL
        AND e.start_time >= now() - interval '30 days'
        AND t.is_deleted = false
      GROUP BY 1, 2, 3
    `);

    // Display window (for the chart + watchlist).
    const displayRows = await this.prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT COALESCE(e.user_id, 'unknown')                        AS user_id,
             COALESCE(NULLIF(e.user_name, ''), e.user_id, 'Unknown') AS user_name,
             to_char(date_trunc('day', e.start_time AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(e.duration_hours), 0)::float             AS hours
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time IS NOT NULL
        AND e.start_time >= ${from}
        AND e.start_time <= ${to}
        AND t.is_deleted = false
      GROUP BY 1, 2, 3
    `);

    // Continuous day axis over the display window.
    type BucketRow = { bucket: string };
    const axisRows = await this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT to_char(generate_series(
               date_trunc('day', (${from}::timestamptz AT TIME ZONE ${TZ})),
               date_trunc('day', (${to  }::timestamptz AT TIME ZONE ${TZ})),
               interval '1 day'), 'YYYY-MM-DD') AS bucket
      ORDER BY 1 ASC
    `);
    const buckets = axisRows.map((r) => r.bucket);

    // Median daily hours per user, from the fixed baseline (days with hours > 0).
    const baselineByUser = new Map<string, { name: string; hours: number[] }>();
    for (const r of baselineRows) {
      const id = r.user_id ?? 'unknown';
      const e = baselineByUser.get(id) ?? { name: r.user_name ?? 'Unknown', hours: [] };
      if (r.user_name) e.name = r.user_name;
      if (r.hours > 0) e.hours.push(r.hours);
      baselineByUser.set(id, e);
    }
    const median = (xs: number[]): number => {
      if (!xs.length) return 0;
      const s = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const medians = new Map<string, number>();
    for (const [id, e] of baselineByUser) medians.set(id, median(e.hours));

    // Display hours per user/day.
    const displayByUser = new Map<string, { name: string; days: Map<string, number> }>();
    for (const r of displayRows) {
      const id = r.user_id ?? 'unknown';
      const e = displayByUser.get(id) ?? { name: r.user_name ?? 'Unknown', days: new Map<string, number>() };
      if (r.user_name) e.name = r.user_name;
      e.days.set(r.day, (e.days.get(r.day) ?? 0) + r.hours);
      displayByUser.set(id, e);
    }

    type Rule = 'absolute' | 'relative' | 'both';
    const classify = (hours: number, med: number): Rule | null => {
      const abs = hours > cap;
      const rel = med > 0 && hours > 2 * med && hours >= 4;
      if (abs && rel) return 'both';
      if (abs) return 'absolute';
      if (rel) return 'relative';
      return null;
    };

    // Per-user zero-filled series.
    const users = [...displayByUser.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, e]) => {
        const med = medians.get(id) ?? 0;
        const points = buckets.map((b) => {
          const hours = e.days.get(b) ?? 0;
          return { date: b, hours, isSpike: classify(hours, med) !== null };
        });
        return { userId: id, userName: e.name, points };
      });

    // Watchlist: every flagged display day, ranked by raw hours desc, top 20.
    type WatchRow = {
      userId: string; userName: string; date: string; hours: number;
      median: number; multiplier: number | null; rule: Rule;
    };
    const watchlist: WatchRow[] = [];
    for (const [id, e] of displayByUser) {
      const med = medians.get(id) ?? 0;
      for (const [day, hours] of e.days) {
        const rule = classify(hours, med);
        if (!rule) continue;
        watchlist.push({
          userId: id, userName: e.name, date: day, hours,
          median: med, multiplier: med > 0 ? hours / med : null, rule,
        });
      }
    }
    watchlist.sort((a, b) => b.hours - a.hours);

    return { cap, watchlist: watchlist.slice(0, 20), byUser: { buckets, users } };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- reports.service`
Expected: PASS (all 7 new `hourSpikes` tests + existing).

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/reports/reports.service.ts test/reports.service.spec.ts
git commit -m "feat: add hourSpikes report (per-user daily-hour spike detection)"
```

---

## Task 4: Add the controller route reading the cap from settings

**Files:**
- Modify: `src/reports/reports.controller.ts`
- Test: `test/reports.controller.spec.ts`

- [ ] **Step 1: Write failing tests**

In `test/reports.controller.spec.ts`, first add a settings stub helper near the top (after the existing `makeService` function):

```ts
  function makeSettings(cap = 12) {
    return { getSpikeHoursCap: jest.fn().mockReturnValue(cap) } as any;
  }
```

Then add a new describe block (anywhere inside the top-level `describe`):

```ts
  describe('hourSpikes', () => {
    it('passes the settings cap + from/to into the service', async () => {
      const svc = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = new ReportsController(svc, settings);
      const result = await ctrl.hourSpikes('2026-06-01', '2026-06-10');
      expect(settings.getSpikeHoursCap).toHaveBeenCalledTimes(1);
      expect(svc.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10');
      expect(result.cap).toBe(10);
    });
  });
```

- [ ] **Step 2: Update existing controller instantiations**

The controller gains a second constructor argument, so the 7 existing `new ReportsController(svc)` calls must pass the settings stub. Replace every occurrence of `new ReportsController(svc)` with `new ReportsController(svc, makeSettings())` in `test/reports.controller.spec.ts`.

(There are 7: lines ~23, 30, 47, 58, 65, 72, 79 — a find/replace of `new ReportsController(svc)` → `new ReportsController(svc, makeSettings())` covers them.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- reports.controller`
Expected: FAIL — `hourSpikes` not a function on the controller (and/or arity error before the edit in Step 2 is applied — apply Step 2 first so only the new test fails for the right reason).

- [ ] **Step 4: Inject SettingsService and add the route**

In `src/reports/reports.controller.ts`:

(a) Add the import:

```ts
import { SettingsService } from '../settings/settings.service';
```

(b) Update the constructor:

```ts
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly settings: SettingsService,
  ) {}
```

(c) Add the route next to the other `time-entries/*` routes (e.g. after `anomalies()`):

```ts
  @Get('time-entries/hour-spikes')
  @ApiOperation({ summary: 'Per-user daily-hour spikes: a team watchlist of days exceeding the absolute cap or 2x the user’s 30-day median, plus per-user daily-hours series for the chart.' })
  hourSpikes(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.hourSpikes(this.settings.getSpikeHoursCap(), from, to);
  }
```

Note: `SettingsModule` is `@Global` and exports `SettingsService`, so no module-import change is needed — Nest resolves it for `ReportsController`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- reports.controller`
Expected: PASS (new test + the 7 updated instantiations).

- [ ] **Step 6: Verify the full suite + build**

Run: `npm run test && npm run build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add src/reports/reports.controller.ts test/reports.controller.spec.ts
git commit -m "feat: expose GET /reports/time-entries/hour-spikes (cap from settings)"
```

---

## Task 5: Settings UI — editable hour cap

**Files:**
- Modify: `apps/web/src/api/settings.ts`
- Modify: `apps/web/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Extend the frontend settings types**

In `apps/web/src/api/settings.ts`, add `spikeHoursCap` to both interfaces:

```ts
export interface AppSettings {
  apiTokenSet: boolean;
  apiTokenLast4: string | null;
  teamId: string;
  webhookEndpoint: string;
  webhookEvents: string;
  webhookSecretSet: boolean;
  spikeHoursCap: number;
  encryptionEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SettingsPatch {
  apiToken?: string;
  teamId?: string;
  webhookEndpoint?: string;
  webhookEvents?: string;
  webhookSecret?: string;
  spikeHoursCap?: number;
}
```

- [ ] **Step 2: Add a cap editor row to the Sync tab's "Cost calculation" card**

In `apps/web/src/pages/SettingsPage.tsx`, find the `Cost calculation` card (the `<Card>` with `<CardHeader title="Cost calculation" …/>`). Add local state for the input near the other Sync-tab `useState` hooks (around the `defaultCurrency`/`rateMatch` state):

```tsx
  const [capInput, setCapInput] = useState('');
  useEffect(() => {
    if (settingsQuery.data?.spikeHoursCap != null) setCapInput(String(settingsQuery.data.spikeHoursCap));
  }, [settingsQuery.data?.spikeHoursCap]);
```

(If `useEffect` is not already imported from React at the top of the file, add it to the existing React import.)

Then, inside the `Cost calculation` card's `<div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>`, add a new `SettingRow` after the existing rows:

```tsx
              <SettingRow
                label="Daily-hour spike cap"
                desc="Flag a user-day as a spike when logged hours exceed this absolute cap (also flags > 2× the user’s 30-day median). 1–24 hours."
                control={
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                      type="number"
                      value={capInput}
                      onChange={(e) => setCapInput(e.target.value)}
                      style={{ width: 80 }}
                    />
                    <Button
                      size="sm"
                      disabled={updateSettings.isPending || capInput === '' || Number(capInput) === settingsQuery.data?.spikeHoursCap}
                      onClick={() => {
                        const n = Math.round(Number(capInput));
                        if (!Number.isFinite(n) || n < 1 || n > 24) {
                          showBanner('Spike cap must be a whole number between 1 and 24.', 'red');
                          return;
                        }
                        updateSettings.mutate(
                          { spikeHoursCap: n },
                          { onError: (err) => showBanner(`Save failed: ${(err as Error).message}`, 'red') },
                        );
                      }}
                    >
                      Save
                    </Button>
                  </div>
                }
              />
```

Notes for the implementer:
- `Input`, `Button`, `updateSettings`, `settingsQuery`, `showBanner`, and `SettingRow` are already imported/defined in this file (the Connection tab uses all of them). Confirm `Button` accepts a `size="sm"` prop (it is used elsewhere in the app); if not, drop the `size` prop.
- This row lives in the `activeTab === 'sync'` block, which is gated `ADMIN+` for viewing; the write still requires Owner server-side (the endpoint enforces it). That is acceptable — an Admin clicking Save will get a 403 surfaced by `showBanner`.

- [ ] **Step 3: Verify the web build (typecheck + bundle)**

Run: `npm run build --workspace=apps/web`
Expected: succeeds (no TS errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/settings.ts apps/web/src/pages/SettingsPage.tsx
git commit -m "feat(web): edit daily-hour spike cap in Settings"
```

---

## Task 6: Frontend API + hook for hour spikes

**Files:**
- Modify: `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/hooks/useReports.ts`

- [ ] **Step 1: Add the API method**

In `apps/web/src/api/reports.ts`, add to the `reportsApi` object (next to `anomalies`):

```ts
  hourSpikes: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/hour-spikes', { params }).then(r => r.data),
```

- [ ] **Step 2: Add types + hook**

In `apps/web/src/hooks/useReports.ts`, add the types and hook (place near `useAnomalies`):

```ts
export interface HourSpikeWatchRow {
  userId: string;
  userName: string;
  date: string;
  hours: number;
  median: number;
  multiplier: number | null;
  rule: 'absolute' | 'relative' | 'both';
}

export interface HourSpikeUserPoint { date: string; hours: number; isSpike: boolean; }
export interface HourSpikeUser { userId: string; userName: string; points: HourSpikeUserPoint[]; }

export interface HourSpikes {
  cap: number;
  watchlist: HourSpikeWatchRow[];
  byUser: { buckets: string[]; users: HourSpikeUser[] };
}

export function useHourSpikes() {
  const { fromDate, toDate } = useGlobalFilters();
  return useQuery<HourSpikes>({
    queryKey: ['hour-spikes', fromDate, toDate],
    queryFn: () => reportsApi.hourSpikes({ from: fromDate, to: toDate }),
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 3: Verify the web build**

Run: `npm run build --workspace=apps/web`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): hourSpikes api client + useHourSpikes hook"
```

---

## Task 7: The Hour Spikes page

**Files:**
- Create: `apps/web/src/pages/HourSpikesPage.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/src/pages/HourSpikesPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, ChevronRight } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { BarChart, type BarData } from '../components/charts/BarChart';
import { useHourSpikes, type HourSpikeWatchRow } from '../hooks/useReports';

const SPIKE_COLOR = '#f59e0b'; // amber, matches the anomalies styling
const BASE_COLOR = '#7B68EE';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Single-day filtered link into Time Entries, in the Asia/Dhaka window.
function dayLink(userId: string, iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
  const startMs = Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;
  const endMs = startMs + 86_400_000 - 1;
  const from = new Date(startMs).toISOString();
  const to = new Date(endMs).toISOString();
  return `/time-entries?userId=${encodeURIComponent(userId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&spaceScope=all`;
}

function watchSubtitle(s: HourSpikeWatchRow, cap: number): string {
  if (s.rule === 'absolute') return `over the ${cap}h/day cap`;
  const mult = s.multiplier != null ? `${s.multiplier.toFixed(1)}× their ${s.median.toFixed(1)}h median` : 'above their median';
  if (s.rule === 'relative') return mult;
  return `${mult} · over the ${cap}h/day cap`;
}

export function HourSpikesPage() {
  const navigate = useNavigate();
  const q = useHourSpikes();
  const data = q.data;

  const users = data?.byUser.users ?? [];
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  // Default the dropdown to the first user once data arrives.
  const effectiveUserId = selectedUserId || users[0]?.userId || '';
  const selectedUser = users.find((u) => u.userId === effectiveUserId);

  const chartData: BarData[] = useMemo(
    () => (selectedUser?.points ?? []).map((p) => ({
      label: formatDate(p.date),
      value: p.hours,
      color: p.isSpike ? SPIKE_COLOR : BASE_COLOR,
    })),
    [selectedUser],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="Time Spikes" />

      <Card padding={0} title="Spike watchlist" subtitle="Days a user logged unusually high hours">
        {q.isLoading && (
          <div style={{ padding: 16 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 32, background: 'var(--muted-bg)', borderRadius: 6, marginBottom: 8, opacity: 0.6 }} />
            ))}
          </div>
        )}
        {q.isError && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--red)' }}>Couldn’t load spikes.</div>
        )}
        {data && data.watchlist.length === 0 && !q.isLoading && (
          <div style={{ padding: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No spikes in the selected range.</p>
          </div>
        )}
        {data && data.watchlist.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {data.watchlist.map((s, i) => (
              <button
                key={`${s.userId}-${s.date}`}
                type="button"
                onClick={() => navigate(dayLink(s.userId, s.date))}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
                  borderBottom: i < data.watchlist.length - 1 ? '1px solid var(--border-soft)' : 0,
                  background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--hover)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  background: 'var(--pill-amber-bg)', color: 'var(--pill-amber-text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <TrendingUp size={13} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                    {s.userName} logged {s.hours.toFixed(1)}h on {formatDate(s.date)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{watchSubtitle(s, data.cap)}</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  view <ChevronRight size={12} />
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Daily hours by user"
        subtitle={data ? `Spike days in amber · cap ${data.cap}h/day` : 'Daily hours'}
        action={
          users.length > 0 ? (
            <Select
              size="sm"
              value={effectiveUserId}
              onChange={setSelectedUserId}
              options={users.map((u) => ({ value: u.userId, label: u.userName }))}
            />
          ) : undefined
        }
      >
        <BarChart data={chartData} direction="vertical" height={240} formatValue={(v) => `${v.toFixed(1)}h`} />
      </Card>
    </div>
  );
}
```

Notes for the implementer:
- `BarChart` already supports a per-bar `color` and a `direction="vertical"` mode (verified in `components/charts/BarChart.tsx`); the amber/base colors drive the spike highlight.
- If `Card`'s `action` prop is not typed to accept a node, check `components/ui/Card.tsx` — it is destructured as `action` and rendered in the header; passing the `<Select>` is consistent with how other cards add header controls.

- [ ] **Step 2: Verify the web build**

Run: `npm run build --workspace=apps/web`
Expected: succeeds (the page is not yet routed, but it must typecheck).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/HourSpikesPage.tsx
git commit -m "feat(web): Hour Spikes page (watchlist + per-user daily-hours chart)"
```

---

## Task 8: Route + navigation wiring

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/components/layout/CommandPalette.tsx`

- [ ] **Step 1: Lazy-import and route the page in App.tsx**

In `apps/web/src/App.tsx`, add the lazy import near the other page imports (after `AnalyticsPage`):

```tsx
const HourSpikesPage = React.lazy(() =>
	import('./pages/HourSpikesPage').then((m) => ({ default: m.HourSpikesPage })),
);
```

Add the route inside `<Route element={<AppLayout />}>` (e.g. right after the `/analytics` route):

```tsx
								<Route
									path="/time-spikes"
									element={
										<React.Suspense fallback={Fallback}>
											<HourSpikesPage />
										</React.Suspense>
									}
								/>
```

- [ ] **Step 2: Add the sidebar nav item**

In `apps/web/src/components/layout/Sidebar.tsx`, add an icon import. The file already imports several `lucide-react` icons (e.g. `Clock`, `BarChart3`); add `Activity` to that import. Then add a nav item to the `navItems` array, after the `Analytics` entry:

```tsx
    { to: "/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/time-spikes", label: "Time Spikes", icon: Activity },
```

- [ ] **Step 3: Add the command-palette entry**

In `apps/web/src/components/layout/CommandPalette.tsx`, add `Activity` to the existing `lucide-react` import, then add to `NAV_ITEMS` after the Analytics line:

```tsx
  { label: 'Analytics', to: '/analytics', sub: '/analytics', icon: BarChart3 },
  { label: 'Time Spikes', to: '/time-spikes', sub: '/time-spikes', icon: Activity },
```

- [ ] **Step 4: Verify the web build**

Run: `npm run build --workspace=apps/web`
Expected: succeeds.

- [ ] **Step 5: Manual smoke check (visual)**

Start the stack (`npm run start:dev` for backend on :3002, `npm run dev:web` for web on :5174 — see the `web-visual-verification-setup` memory). Log in, open **Time Spikes** from the sidebar. Confirm:
- The watchlist renders (or an empty state) and clicking a row navigates to `/time-entries` filtered to that user + day.
- The user dropdown switches the chart; spike days render amber.
- Settings → Sync → "Daily-hour spike cap": change the value, Save, reload Time Spikes, and confirm the cap label and flags reflect the new value.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/CommandPalette.tsx
git commit -m "feat(web): route + nav for the Time Spikes page"
```

---

## Final verification

- [ ] **Backend:** `npm run test && npm run build` — both pass.
- [ ] **Frontend:** `npm run build --workspace=apps/web` — passes.
- [ ] **Spec coverage check:** watchlist (Task 3/7), per-user chart (Task 3/7), either-rule detection + 4h floor (Task 3), fixed 30-day baseline vs display window (Task 3), top-20 hours-desc ranking (Task 3), zero-fill (Task 3), configurable cap end-to-end (Tasks 1, 2, 4, 5), nav/route (Task 8).

---

## Notes / decisions carried from the spec

- Cap is **org-wide** (singleton `AppSettings`), Owner-editable, read by the controller — not per-request overridable.
- Spike color is **amber** (`#f59e0b` bars; `--pill-amber-*` for watchlist markers).
- Detection/ranking is **TypeScript-side** over SQL aggregates so the rule logic is unit-tested; the relative median uses a **fixed trailing 30-day** baseline independent of the chart's date filter.
- No new background job or materialized table — computed on the fly over the indexed `start_time`.

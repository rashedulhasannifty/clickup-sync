# Median Spike Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Owner-only Settings switch that turns the median ("relative") spike rule on or off; when off, the Time Spikes page, Overview Anomalies panel, NotificationCenter, and spike emails keep showing the same rows but with all median-derived numbers and wording removed.

**Architecture:** A new `preferences.spike.medianEnabled` boolean (default `true`) is read by `SettingsService.isSpikeMedianEnabled()`. The reports controller passes that flag into `ReportsService.hourSpikes()` and `ReportsService.anomalies()`. Detection is unchanged; when the flag is off the service nulls out median-derived numeric fields on each returned row and adds `medianEnabled: false` to the payload. Each frontend surface reads the flag (and the now-null numbers) to render neutral wording.

**Tech Stack:** NestJS 11, Prisma 7, Jest (backend, `test/`); React + Vite + TypeScript (frontend, `apps/web/`).

## Global Constraints

- Default `medianEnabled` is `true` — existing behavior must be byte-for-byte preserved until an Owner turns it off.
- No DB migration: the toggle lives in the existing `app_settings.preferences` JSON column.
- The Settings switch is Owner-only (wrap in `RequireRole min="OWNER"`, like the spike-cap row).
- Keep all rows (detection unchanged). Only median *display* (value, multiplier, "× median"/"vs typical" wording) is removed when off.
- Do not change detection constants (`2×`, `>= 4h`, cap).
- Preserve Prettier formatting. `npm run lint` is known-broken project-wide — verify with `npm run test` and `npm run build` (backend) / `npm run build:web` (frontend) instead.
- Backend tests run with `npm run test` from the repo root.

---

### Task 1: Settings preference + getter

**Files:**
- Modify: `src/settings/settings.service.ts` (interface `SettingsPreferences`, `DEFAULT_PREFERENCES`, new getter `isSpikeMedianEnabled`)
- Test: `test/settings.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SettingsService.isSpikeMedianEnabled(): boolean`; `SettingsPreferences.spike: { medianEnabled: boolean }`.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `test/settings.service.spec.ts`, immediately before the closing `});` of the top-level `describe('SettingsService', ...)` (i.e. after the `getBackfillMaxLookbackDays` block ends at line 161):

```ts
  describe('isSpikeMedianEnabled', () => {
    it('defaults to true when no DB row exists', async () => {
      const svc = new SettingsService(makeRepo(null), makeCrypto());
      await svc.onModuleInit();
      expect(svc.isSpikeMedianEnabled()).toBe(true);
    });

    it('reflects a stored false preference', async () => {
      const repo = makeRepo({ id: 'singleton', preferences: { spike: { medianEnabled: false } }, updatedAt: new Date() });
      const svc = new SettingsService(repo, makeCrypto());
      await svc.onModuleInit();
      expect(svc.isSpikeMedianEnabled()).toBe(false);
    });

    it('round-trips through update()', async () => {
      const repo = makeRepo(null);
      const svc = new SettingsService(repo, makeCrypto());
      await svc.onModuleInit();
      await svc.update({ preferences: { spike: { medianEnabled: false } } }, 'tester');
      expect(svc.isSpikeMedianEnabled()).toBe(false);
      expect(svc.getPreferences().spike.medianEnabled).toBe(false);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- settings.service`
Expected: FAIL — `svc.isSpikeMedianEnabled is not a function` (and `getPreferences().spike` is undefined).

- [ ] **Step 3: Add the `spike` field to the interface**

In `src/settings/settings.service.ts`, in the `SettingsPreferences` interface (currently lines 12–21), add the `spike` line after the `failure` line:

```ts
  failure: { webhookRetryAttempts: number };
  spike: { medianEnabled: boolean };
  spaces: Record<string, { enabled: boolean }>;
```

- [ ] **Step 4: Add the default**

In `DEFAULT_PREFERENCES` (currently lines 23–32), add the `spike` default after the `failure` line:

```ts
  failure: { webhookRetryAttempts: 5 },
  spike: { medianEnabled: true },
  spaces: {},
```

- [ ] **Step 5: Add the getter**

In `src/settings/settings.service.ts`, add this method right after `getBackfillMaxLookbackDays()` (which ends at line 187, before `getExcludedAssigneeIds`):

```ts
  /** Whether the median ("relative") spike rule contributes median numbers and
   *  wording to spike surfaces. Detection is unaffected; this only controls
   *  whether median-derived display is shown. Defaults to true. */
  isSpikeMedianEnabled(): boolean {
    return this.cache.preferences.spike?.medianEnabled ?? true;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- settings.service`
Expected: PASS (all `SettingsService` tests, including the new block).

- [ ] **Step 7: Commit**

```bash
git add src/settings/settings.service.ts test/settings.service.spec.ts
git commit -m "feat(settings): add spike.medianEnabled preference + getter"
```

---

### Task 2: Reports service — strip median when disabled + carry flag

**Files:**
- Modify: `src/reports/reports.service.ts` (`hourSpikes` signature + watchlist push + return; `anomalies` signature + return)
- Test: `test/reports.service.spec.ts`

**Interfaces:**
- Consumes: nothing new (flag is a plain boolean param).
- Produces:
  - `hourSpikes(cap: number, fromParam?: string, toParam?: string, limit = 20, includeResolved = false, medianEnabled = true)` — return object gains `medianEnabled: boolean`; when `medianEnabled` is false each watchlist row has `median: 0` and `multiplier: null`.
  - `anomalies(medianEnabled = true)` — return object gains `medianEnabled: boolean`; when false, `dailySpikes[].medianAud`, `dailySpikes[].multiplier`, `clientSpikes[].baselineMedianAud`, `clientSpikes[].multiplier` are `null`.

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `describe('hourSpikes', ...)` block in `test/reports.service.spec.ts` (e.g. right after the `stub` helper's first test, anywhere within the block — they use the same `stub` helper):

```ts
    it('keeps rows but strips median fields when medianEnabled is false', async () => {
      const prisma = makePrisma();
      // relative-only spike: median(3,3,3)=3 → 2x=6; 7h > 6, >= 4, < cap(12).
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
      const r = await new ReportsService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10', 20, false, false);
      expect(r.medianEnabled).toBe(false);
      expect(r.watchlist).toHaveLength(1); // detection unchanged — row kept
      expect(r.watchlist[0]).toMatchObject({ rule: 'relative', median: 0, multiplier: null });
    });

    it('defaults medianEnabled true and preserves median fields', async () => {
      const prisma = makePrisma();
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
      expect(r.medianEnabled).toBe(true);
      expect(r.watchlist[0]).toMatchObject({ rule: 'relative', median: 3 });
      expect(r.watchlist[0].multiplier).toBeCloseTo(7 / 3, 4);
    });
```

Add this test inside the existing `describe('anomalies', ...)` block:

```ts
    it('strips median fields and sets medianEnabled false when disabled', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([{
          date: '2026-05-04',
          total_cost_cents: BigInt(192000),
          median_cost_cents: 45600,
          multiplier: 4.21,
        }])
        .mockResolvedValueOnce([{
          client: 'Acme',
          week_cost_cents: BigInt(210000),
          baseline_median_cents: 67000,
          multiplier: 3.13,
        }]);
      const result = await new ReportsService(prisma).anomalies(false);
      expect(result.medianEnabled).toBe(false);
      expect(result.dailySpikes).toEqual([{ date: '2026-05-04', totalCostAud: 1920, medianAud: null, multiplier: null }]);
      expect(result.clientSpikes).toEqual([{ client: 'Acme', lastWeekCostAud: 2100, baselineMedianAud: null, multiplier: null }]);
    });
```

Also UPDATE the existing "returns empty arrays when no spikes" test (currently around line 915–919): change its assertion from

```ts
      expect(result).toEqual({ dailySpikes: [], clientSpikes: [] });
```

to

```ts
      expect(result).toEqual({ medianEnabled: true, dailySpikes: [], clientSpikes: [] });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- reports.service`
Expected: FAIL — `hourSpikes` ignores the 6th arg (median still 3, multiplier non-null), `r.medianEnabled` is undefined, and the anomalies result lacks `medianEnabled` / still has numeric medians.

- [ ] **Step 3: Update the `hourSpikes` signature**

In `src/reports/reports.service.ts`, change the `hourSpikes` declaration (currently line 1333):

```ts
  async hourSpikes(cap: number, fromParam?: string, toParam?: string, limit = 20, includeResolved = false, medianEnabled = true) {
```

- [ ] **Step 4: Strip median fields in the watchlist push**

In the watchlist-building loop (currently lines 1450–1459), replace the `watchlist.push({...})` call with the conditional version:

```ts
    for (const [id, e] of displayByUser) {
      const med = medians.get(id) ?? 0;
      for (const [day, hours] of e.days) {
        const rule = classify(hours, med);
        if (!rule) continue;
        watchlist.push({
          userId: id, userName: e.name, date: day, hours,
          median: medianEnabled ? med : 0,
          multiplier: medianEnabled && med > 0 ? hours / med : null,
          rule,
        });
      }
    }
```

(`classify` is unchanged — detection still uses the real median, so the same rows are flagged. Only the displayed `median`/`multiplier` are stripped.)

- [ ] **Step 5: Add `medianEnabled` to the `hourSpikes` return**

Change the final return (currently line 1502) from:

```ts
    return { cap, watchlist: enriched, watchlistTotal, byUser: { buckets, users } };
```

to:

```ts
    return { cap, medianEnabled, watchlist: enriched, watchlistTotal, byUser: { buckets, users } };
```

- [ ] **Step 6: Update `anomalies` signature + return**

Change the `anomalies` declaration (currently line 1505):

```ts
  async anomalies(medianEnabled = true) {
```

Then replace the return block (currently lines 1595–1608) with:

```ts
    return {
      medianEnabled,
      dailySpikes: dailyRows.map(r => ({
        date: r.date,
        totalCostAud: Number(r.total_cost_cents) / 100,
        medianAud: medianEnabled ? Number(r.median_cost_cents) / 100 : null,
        multiplier: medianEnabled ? Number(r.multiplier) : null,
      })),
      clientSpikes: clientRows.map(r => ({
        client: r.client,
        lastWeekCostAud: Number(r.week_cost_cents) / 100,
        baselineMedianAud: medianEnabled ? Number(r.baseline_median_cents) / 100 : null,
        multiplier: medianEnabled ? Number(r.multiplier) : null,
      })),
    };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test -- reports.service`
Expected: PASS — all existing `hourSpikes`/`anomalies` tests plus the three new ones.

- [ ] **Step 8: Commit**

```bash
git add src/reports/reports.service.ts test/reports.service.spec.ts
git commit -m "feat(reports): strip median fields + carry medianEnabled flag in hourSpikes/anomalies"
```

---

### Task 3: Reports controller — pass the setting through

**Files:**
- Modify: `src/reports/reports.controller.ts` (`anomalies()` at lines 69–71, `hourSpikes()` at lines 75–82)
- Test: `test/reports.controller.spec.ts`

**Interfaces:**
- Consumes: `SettingsService.isSpikeMedianEnabled()` (Task 1); `ReportsService.hourSpikes(..., medianEnabled)` and `ReportsService.anomalies(medianEnabled)` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Update the failing tests**

In `test/reports.controller.spec.ts`, update `makeSettings` (lines 11–13) to also stub the new getter:

```ts
  function makeSettings(cap = 12, medianEnabled = true) {
    return {
      getSpikeHoursCap: jest.fn().mockReturnValue(cap),
      isSpikeMedianEnabled: jest.fn().mockReturnValue(medianEnabled),
    } as any;
  }
```

Update the first `hourSpikes` test assertion (line 100) from:

```ts
      expect(svc.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false);
```

to:

```ts
      expect(svc.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false, true);
```

Update the second `hourSpikes` test: its inline settings stub (line 106) lacks the new getter, so replace it with `makeSettings(10)` and update the assertion (lines 106–109):

```ts
      const svc = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = new ReportsController(svc, settings, makeBudgets());
      await ctrl.hourSpikes('2026-06-01', '2026-06-10', '40', 'true');
      expect(svc.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 40, true, true);
```

Add a new test in the `describe('hourSpikes', ...)` block proving the flag is forwarded:

```ts
    it('forwards medianEnabled=false from settings into the service', async () => {
      const svc = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const ctrl = new ReportsController(svc, makeSettings(10, false), makeBudgets());
      await ctrl.hourSpikes('2026-06-01', '2026-06-10');
      expect(svc.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false, false);
    });
```

Add a new test in the `describe('anomalies', ...)` block proving the flag is forwarded:

```ts
    it('forwards medianEnabled from settings into the service', async () => {
      const svc = { anomalies: jest.fn().mockResolvedValue({ medianEnabled: false, dailySpikes: [], clientSpikes: [] }) } as any;
      const ctrl = new ReportsController(svc, makeSettings(12, false), makeBudgets());
      await ctrl.anomalies();
      expect(svc.anomalies).toHaveBeenCalledWith(false);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- reports.controller`
Expected: FAIL — controller still calls `hourSpikes(...)` with 5 args and `anomalies()` with none.

- [ ] **Step 3: Update `anomalies()` in the controller**

In `src/reports/reports.controller.ts`, change the `anomalies()` method body (line 70):

```ts
  anomalies() {
    return this.reports.anomalies(this.settings.isSpikeMedianEnabled());
  }
```

- [ ] **Step 4: Update `hourSpikes()` in the controller**

Change the `hourSpikes(...)` return (line 81):

```ts
    return this.reports.hourSpikes(this.settings.getSpikeHoursCap(), from, to, Number(limit) || 20, includeResolved === 'true', this.settings.isSpikeMedianEnabled());
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- reports.controller`
Expected: PASS.

- [ ] **Step 6: Run the full backend build + test suite**

Run: `npm run build && npm run test`
Expected: build succeeds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/reports/reports.controller.ts test/reports.controller.spec.ts
git commit -m "feat(reports): gate spike median display behind isSpikeMedianEnabled setting"
```

---

### Task 4: Frontend types — carry the flag and nullable medians

**Files:**
- Modify: `apps/web/src/hooks/useReports.ts` (`DailySpike`, `ClientSpike`, `Anomalies`, `HourSpikes`)
- Modify: `apps/web/src/api/settings.ts` (`SettingsPreferences` interface)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Anomalies.medianEnabled: boolean`; `DailySpike.medianAud: number | null`; `DailySpike.multiplier: number | null`; `ClientSpike.baselineMedianAud: number | null`; `ClientSpike.multiplier: number | null`.
  - `HourSpikes.medianEnabled: boolean`.
  - `SettingsPreferences.spike: { medianEnabled: boolean }`.

- [ ] **Step 1: Update the anomalies/hour-spike types**

In `apps/web/src/hooks/useReports.ts`, replace the `DailySpike`, `ClientSpike`, and `Anomalies` interfaces (lines 221–238) with:

```ts
export interface DailySpike {
  date: string;
  totalCostAud: number;
  medianAud: number | null;
  multiplier: number | null;
}

export interface ClientSpike {
  client: string;
  lastWeekCostAud: number;
  baselineMedianAud: number | null;
  multiplier: number | null;
}

export interface Anomalies {
  medianEnabled: boolean;
  dailySpikes: DailySpike[];
  clientSpikes: ClientSpike[];
}
```

Then add `medianEnabled` to the `HourSpikes` interface (lines 265–270):

```ts
export interface HourSpikes {
  cap: number;
  medianEnabled: boolean;
  watchlist: HourSpikeWatchRow[];
  watchlistTotal: number;
  byUser: { buckets: string[]; users: HourSpikeUser[] };
}
```

- [ ] **Step 2: Update the settings preferences type**

In `apps/web/src/api/settings.ts`, add the `spike` field to `SettingsPreferences` (after the `failure` line at line 10):

```ts
  failure: { webhookRetryAttempts: number };
  spike: { medianEnabled: boolean };
  spaces: Record<string, { enabled: boolean }>;
```

- [ ] **Step 3: Typecheck the web app**

Run: `npm run build:web`
Expected: FAIL — `AnomaliesPanel.tsx` and `NotificationCenter.tsx` now reference possibly-null `multiplier`/`medianAud` with `.toFixed(...)`, and `SettingsPage` may reference `prefs.spike` not yet used. These are fixed in Tasks 5–6. (If you are running tasks strictly one-at-a-time, expect this build to fail until Task 5; that is acceptable — the type change is correct and the consumers are updated next. Do not "fix" by reverting the type.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useReports.ts apps/web/src/api/settings.ts
git commit -m "feat(web): type medianEnabled flag + nullable median fields in reports/settings"
```

---

### Task 5: Frontend rendering — neutral wording when median is off

**Files:**
- Modify: `apps/web/src/pages/HourSpikesPage.tsx` (`watchSubtitle` at lines 38–43; call site at line 186)
- Modify: `apps/web/src/components/AnomaliesPanel.tsx` (rows builder, lines 17–34)
- Modify: `apps/web/src/components/layout/NotificationCenter.tsx` (anomalies + hour-spike builders, lines 128–165)

**Interfaces:**
- Consumes: `HourSpikes.medianEnabled`, `HourSpikeWatchRow.multiplier|median`, `Anomalies.medianEnabled`, nullable `DailySpike`/`ClientSpike` fields (Task 4).
- Produces: nothing.

- [ ] **Step 1: Update `watchSubtitle` on the Time Spikes page**

In `apps/web/src/pages/HourSpikesPage.tsx`, replace the `watchSubtitle` function (lines 38–43) with a version that takes `medianEnabled` and never says "median" when off:

```ts
function watchSubtitle(s: HourSpikeWatchRow, cap: number, medianEnabled: boolean): string {
  const capText = `over the ${cap}h/day cap`;
  if (s.rule === 'absolute') return capText;
  if (!medianEnabled || s.multiplier == null) {
    // Median display is off (or unavailable): keep the row, drop median wording.
    return s.rule === 'both' ? capText : 'unusually high for this person';
  }
  const mult = `${s.multiplier.toFixed(1)}× their ${s.median.toFixed(1)}h median`;
  if (s.rule === 'relative') return mult;
  return `${mult} · ${capText}`;
}
```

- [ ] **Step 2: Update the `watchSubtitle` call site**

In `apps/web/src/pages/HourSpikesPage.tsx`, the subtitle render (line 186) currently reads:

```tsx
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 29 }}>{watchSubtitle(s, data.cap)}</div>
```

Change it to pass the flag:

```tsx
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 29 }}>{watchSubtitle(s, data.cap, data.medianEnabled)}</div>
```

- [ ] **Step 3: Update the Anomalies panel rows builder**

In `apps/web/src/components/AnomaliesPanel.tsx`, replace the `if (data) { ... }` rows-building block (lines 17–34) with a version that relabels neutrally when `medianEnabled` is off:

```tsx
  if (data) {
    const med = data.medianEnabled;
    for (const s of data.dailySpikes) {
      rows.push({
        key: `daily-${s.date}`,
        title: med && s.multiplier != null
          ? `${formatDate(s.date)} was ${s.multiplier.toFixed(1)}× the 30-day median`
          : `${formatDate(s.date)} had an unusually high cost day`,
        subtitle: med && s.medianAud != null
          ? `${moneyAud(s.totalCostAud)} vs ${moneyAud(s.medianAud)} typical`
          : `${moneyAud(s.totalCostAud)} total`,
        onClick: () => navigate(dailyLink(s.date)),
      });
    }
    for (const s of data.clientSpikes) {
      rows.push({
        key: `client-${s.client}`,
        title: med && s.multiplier != null
          ? `${s.client} is up ${s.multiplier.toFixed(1)}× vs their 90-day baseline`
          : `${s.client} had unusually high spend last week`,
        subtitle: med && s.baselineMedianAud != null
          ? `${moneyAud(s.lastWeekCostAud)} last 7d, ${moneyAud(s.baselineMedianAud)} typical weekly`
          : `${moneyAud(s.lastWeekCostAud)} last 7d`,
        onClick: () => navigate(clientLink(s.client)),
      });
    }
  }
```

- [ ] **Step 4: Update the NotificationCenter cost-anomaly lines**

In `apps/web/src/components/layout/NotificationCenter.tsx`, replace the cost-anomalies block (lines 128–150) with:

```tsx
    // Cost anomalies
    if (anomalies.data) {
      const med = anomalies.data.medianEnabled;
      for (const d of anomalies.data.dailySpikes) {
        out.push({
          id: `anomaly-daily-${d.date}`,
          severity: 'amber',
          title: med && d.multiplier != null
            ? `${d.date} cost was ${d.multiplier.toFixed(1)}× typical`
            : `${d.date} had an unusually high cost day`,
          subtitle: med && d.medianAud != null
            ? `${moneyAud(d.totalCostAud)} vs ${moneyAud(d.medianAud)} median`
            : `${moneyAud(d.totalCostAud)} total`,
          target: '/overview',
          icon: <TrendingUp size={14} strokeWidth={1.75} />,
        });
      }
      for (const c of anomalies.data.clientSpikes) {
        out.push({
          id: `anomaly-client-${c.client}`,
          severity: 'amber',
          title: med && c.multiplier != null
            ? `${c.client} up ${c.multiplier.toFixed(1)}× vs baseline`
            : `${c.client} had unusually high spend last week`,
          subtitle: `${moneyAud(c.lastWeekCostAud)} last 7d`,
          target: '/overview',
          icon: <TrendingUp size={14} strokeWidth={1.75} />,
        });
      }
    }
```

- [ ] **Step 5: Update the NotificationCenter hour-spike fallback**

In the hour-spike loop (lines 152–165), change the `subtitle` line (line 160) so the no-median fallback is neutral rather than "Above the daily cap":

```tsx
          subtitle: w.multiplier != null ? `${w.multiplier.toFixed(1)}× their median day` : 'Unusually high day',
```

- [ ] **Step 6: Typecheck + build the web app**

Run: `npm run build:web`
Expected: PASS — no remaining references to possibly-null medians without a guard.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/HourSpikesPage.tsx apps/web/src/components/AnomaliesPanel.tsx apps/web/src/components/layout/NotificationCenter.tsx
git commit -m "feat(web): neutral spike wording when median display is disabled"
```

---

### Task 6: Settings UI — the median toggle switch

**Files:**
- Modify: `apps/web/src/pages/SettingsPage.tsx` (spike-cap row desc at line 995; add a Switch row after the cap row at lines 992–1025)

**Interfaces:**
- Consumes: `prefs?.spike?.medianEnabled` (Task 4 type), existing `patchPrefs`, `Switch`, `SettingRow`, `RequireRole`, `isOwner`, `updateSettings`.
- Produces: nothing.

- [ ] **Step 1: Reword the spike-cap description**

In `apps/web/src/pages/SettingsPage.tsx`, the cap `SettingRow` desc (line 995) currently states the median behavior as always-on:

```tsx
                  desc="Flag a user-day as a spike when logged hours exceed this absolute cap (also flags > 2× the user's 30-day median). 1–24 hours."
```

Replace it with a cap-only description:

```tsx
                  desc="Flag a user-day as a spike when logged hours exceed this absolute cap. 1–24 hours."
```

- [ ] **Step 2: Add the median toggle row**

Still inside the same `<RequireRole min="OWNER">` block, add a second `SettingRow` immediately after the closing `/>` of the cap `SettingRow` (i.e. between the cap row's closing `/>` on line 1024 and the `</RequireRole>` on line 1025):

```tsx
                <SettingRow
                  label="Median spike rule"
                  desc="When on, also flag a day as a spike at > 2× the user's median and show median context across Time Spikes, Anomalies, and notifications. When off, those median numbers are hidden."
                  control={
                    <Switch
                      checked={prefs?.spike?.medianEnabled ?? true}
                      disabled={!isOwner || updateSettings.isPending}
                      onChange={(v) => patchPrefs({ spike: { medianEnabled: v } })}
                    />
                  }
                />
```

- [ ] **Step 3: Typecheck + build the web app**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SettingsPage.tsx
git commit -m "feat(web): Owner toggle for the median spike rule in Settings"
```

---

## Manual verification (after all tasks)

1. Start backend + web (`npm run dev:all`), log in as an Owner.
2. Settings → Spike detection: confirm the new **Median spike rule** switch appears under the cap, defaulting to **on**.
3. With it **on**: Time Spikes rows that are relative/both show "… × their … h median"; Overview Anomalies show "× median" / "vs typical"; NotificationCenter shows "× their median day".
4. Toggle it **off** (Save/auto-save via `patchPrefs`), reload the relevant pages:
   - Time Spikes: same rows still appear; relative-only rows read "unusually high for this person", both/absolute read "over the Nh/day cap"; no "median" text anywhere.
   - Anomalies panel: same rows; titles read "… had an unusually high cost day" / "… unusually high spend last week"; no multiplier or median-dollar comparison.
   - NotificationCenter: anomaly + hour-spike entries show neutral wording; no "× median".
5. Send a spike notification email for a relative spike while off: the email reason wording is median-free (handled automatically by `reasonText`'s fallback since the row's `median` is now null).

## Self-Review notes

- **Spec coverage:** storage/getter (Task 1) ✓; server-side strip + flag for both `hourSpikes` and `anomalies` (Task 2) ✓; controller wiring (Task 3) ✓; FE types (Task 4) ✓; FE wording for Time Spikes, Anomalies, NotificationCenter (Task 5) ✓; Settings switch + cap-desc reword (Task 6) ✓; email path needs no change — verified in spec, covered by manual step 5.
- **Type consistency:** `isSpikeMedianEnabled()` used identically in Tasks 1/3; `medianEnabled` 6th param of `hourSpikes` consistent across Tasks 2/3 tests; nullable median fields defined in Task 4 and guarded in Task 5.
- **Known broken lint:** verification uses `npm run test` + `npm run build` + `npm run build:web`, not `npm run lint`.

# Settings Persistence & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six dashboard/admin gaps — three quiet data bugs (tag-map fields, rates metadata, deep link) and three small features (settings persistence, command-palette search, per-task history trail).

**Architecture:** Backend is NestJS + Prisma; UI preferences persist as one `app_settings.preferences` JSONB column read through `SettingsService`. Space toggles gate **only** the scheduled sync loop. Search and history endpoints read existing tables (`clickup_tasks`, `assignee_rates`, `sync_job_logs`, `clickup_task_events`). Frontend is React + react-query.

**Tech Stack:** NestJS 11, Prisma 7 (hand-authored migrations + `prisma:deploy`), PostgreSQL, Jest, React + Vite, TanStack Query.

**Conventions:**
- `npm run test` and `npm run build` after each task. **Do not** run `npm run lint` (known-broken project-wide).
- Hand-author migrations; **never** `migrate dev`. Apply with `npm run prisma:deploy`, regen with `npm run prisma:generate`.
- BigInt ids must be serialized with `.toString()` (Prisma BigInt is not JSON-safe) — mirror `src/admin/audit-log.repository.ts:67`.
- Commit after each task.

---

## File Structure

**Backend create:**
- `prisma/migrations/0012_app_settings_preferences/migration.sql` — add JSONB column
- `src/admin/search.repository.ts` — task + assignee search query
- `src/admin/task-history.repository.ts` — merged per-task trail query
- `test/settings.preferences.spec.ts`, `test/search.repository.spec.ts`, `test/task-history.repository.spec.ts`

**Backend modify:**
- `prisma/schema.prisma` — `AppSettings.preferences Json?`
- `src/settings/settings.service.ts` — preferences cache/merge/getters
- `src/settings/settings.repository.ts` — `preferences` writable column
- `src/admin/dto/update-settings.dto.ts` — `preferences` field
- `src/admin/dto/create-tag-assignee.dto.ts` — `active`
- `src/admin/dto/update-tag-assignee.dto.ts` — `tagName`
- `src/admin/dto/update-rate.dto.ts` — `assigneeName`, `assigneeEmail`
- `src/time-entries/tag-assignee-map.repository.ts` — `active` on create, `tagName` on update
- `src/rates/rates.repository.ts` — `assigneeName`/`assigneeEmail` on update
- `src/admin/admin.controller.ts` — pass `active`/`tagName`/rate metadata; add search + history endpoints; expose `configuredSpaces`
- `src/admin/admin.module.ts` — register the two new repositories
- `src/sync/sync.scheduler.ts` — inject `SettingsService`, skip disabled spaces
- `test/sync.scheduler.spec.ts` — update constructor calls

**Frontend modify:**
- `apps/web/src/api/settings.ts` — preferences + configuredSpaces types
- `apps/web/src/pages/SettingsPage.tsx` — persist notifications/reconcile/space toggles
- `apps/web/src/components/RateModal.tsx` — editable name/email on edit
- `apps/web/src/pages/AssigneeRatesPage.tsx` — read `?userId=`
- `apps/web/src/components/layout/CommandPalette.tsx` — wire search
- `apps/web/src/pages/TasksPage.tsx` — render history trail

**Frontend create:**
- `apps/web/src/api/search.ts` + `apps/web/src/hooks/useSearch.ts`
- `apps/web/src/api/task-history.ts` + `apps/web/src/hooks/useTaskHistory.ts`

---

## Task 1: Migration — `app_settings.preferences` JSONB column

**Files:**
- Create: `prisma/migrations/0012_app_settings_preferences/migration.sql`
- Modify: `prisma/schema.prisma:156` (inside `model AppSettings`)

- [ ] **Step 1: Write the migration SQL**

Create `prisma/migrations/0012_app_settings_preferences/migration.sql`:

```sql
-- Non-secret UI preferences (notification alerts/channels, reconcile lookback,
-- per-space scheduled-sync enable map). Nullable: existing rows read as defaults.
ALTER TABLE "app_settings"
  ADD COLUMN "preferences" JSONB;
```

- [ ] **Step 2: Add the column to the Prisma schema**

In `prisma/schema.prisma`, inside `model AppSettings`, add after the `spikeHoursCap` line:

```prisma
  preferences        Json?    @map("preferences")
```

- [ ] **Step 3: Apply + regenerate**

Run: `npm run prisma:deploy && npm run prisma:generate`
Expected: migration `0012_app_settings_preferences` applied; client regenerates with no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0012_app_settings_preferences
git commit -m "feat(db): add app_settings.preferences column"
```

---

## Task 2: Tag-map DTO bug — `active` on create, `tagName` on rename

**Files:**
- Modify: `src/admin/dto/create-tag-assignee.dto.ts`
- Modify: `src/admin/dto/update-tag-assignee.dto.ts`
- Modify: `src/time-entries/tag-assignee-map.repository.ts:20-26`
- Modify: `src/admin/admin.controller.ts:541-549`
- Test: `test/tag-assignee-map.repository.spec.ts` (extend)

- [ ] **Step 1: Write failing repository tests**

Append to `test/tag-assignee-map.repository.spec.ts`:

```typescript
describe('TagAssigneeMapRepository.create with active', () => {
  it('forwards active when provided', async () => {
    const create = jest.fn().mockResolvedValue({ id: BigInt(1) });
    const prisma = { tagAssigneeMap: { create } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    await repo.create({ tagName: 'sayem', clickupUserId: '5', active: false });

    expect(create).toHaveBeenCalledWith({
      data: { tagName: 'sayem', clickupUserId: '5', active: false },
    });
  });
});

describe('TagAssigneeMapRepository.update with tagName', () => {
  it('forwards a tagName rename', async () => {
    const update = jest.fn().mockResolvedValue({ id: BigInt(3) });
    const prisma = { tagAssigneeMap: { update } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    await repo.update(BigInt(3), { tagName: 'renamed' });

    expect(update).toHaveBeenCalledWith({
      where: { id: BigInt(3) },
      data: { tagName: 'renamed' },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tag-assignee-map`
Expected: FAIL — TypeScript rejects `active` / `tagName` (not in the param types).

- [ ] **Step 3: Update the repository types**

In `src/time-entries/tag-assignee-map.repository.ts`, change `create` and `update`:

```typescript
  create(data: { tagName: string; clickupUserId: string; clickupUserName?: string; clickupEmail?: string; active?: boolean }) {
    return this.prisma.tagAssigneeMap.create({ data });
  }

  update(id: bigint, data: { tagName?: string; clickupUserId?: string; clickupUserName?: string; clickupEmail?: string; active?: boolean }) {
    return this.prisma.tagAssigneeMap.update({ where: { id }, data });
  }
```

- [ ] **Step 4: Whitelist `active` on create DTO**

In `src/admin/dto/create-tag-assignee.dto.ts`, add the import `IsBoolean` and append:

```typescript
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  active?: boolean;
```

(Change the import line to: `import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';`)

- [ ] **Step 5: Whitelist `tagName` on update DTO**

In `src/admin/dto/update-tag-assignee.dto.ts`, add as the first property in the class:

```typescript
  @ApiPropertyOptional({ description: 'Rename the tag (must stay unique).' })
  @IsString()
  @IsOptional()
  tagName?: string;
```

- [ ] **Step 6: Pass `active` through the controller create + handle rename conflict**

In `src/admin/admin.controller.ts`, add `ConflictException` to the `@nestjs/common` import. Replace `createTagAssignee` (line ~541) and `updateTagAssignee` (line ~548):

```typescript
  @Post('tag-assignee-map')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a tag → assignee mapping' })
  createTagAssignee(@Body() dto: CreateTagAssigneeDto) {
    return this.tagAssigneeRepo.create({ tagName: dto.tagName, clickupUserId: dto.clickupUserId, clickupUserName: dto.clickupUserName, clickupEmail: dto.clickupEmail, active: dto.active });
  }

  @Patch('tag-assignee-map/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a tag → assignee mapping' })
  async updateTagAssignee(@Param('id') id: string, @Body() dto: UpdateTagAssigneeDto) {
    try {
      return await this.tagAssigneeRepo.update(parseId(id), dto);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException(`A tag named "${dto.tagName}" already exists.`);
      }
      throw e;
    }
  }
```

- [ ] **Step 7: Run tests + build**

Run: `npm run test -- tag-assignee-map && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/admin/dto/create-tag-assignee.dto.ts src/admin/dto/update-tag-assignee.dto.ts src/time-entries/tag-assignee-map.repository.ts src/admin/admin.controller.ts test/tag-assignee-map.repository.spec.ts
git commit -m "fix(tags): persist active on create and tagName rename"
```

---

## Task 3: Rates PATCH — assignee metadata editable

**Files:**
- Modify: `src/admin/dto/update-rate.dto.ts`
- Modify: `src/rates/rates.repository.ts:44-52`
- Modify: `src/admin/admin.controller.ts:469-476`
- Modify: `apps/web/src/components/RateModal.tsx` (edit branch)
- Test: `test/rates.repository.spec.ts` (create)

- [ ] **Step 1: Write a failing repository test**

Create `test/rates.repository.spec.ts`:

```typescript
import { RatesRepository } from '../src/rates/rates.repository';

describe('RatesRepository.update with assignee metadata', () => {
  it('forwards assigneeName and assigneeEmail', async () => {
    const update = jest.fn().mockResolvedValue({
      rateId: BigInt(1), assigneeId: 'u1', assigneeName: 'New Name', assigneeEmail: 'new@x.co',
      currency: 'USD', hourlyRateCents: BigInt(5000), validFrom: new Date('2024-01-01'), validTo: null, updatedAt: new Date(),
    });
    const prisma = { assigneeRate: { update } } as any;
    const repo = new RatesRepository(prisma);

    await repo.update(BigInt(1), { assigneeName: 'New Name', assigneeEmail: 'new@x.co' });

    expect(update).toHaveBeenCalledWith({
      where: { rateId: BigInt(1) },
      data: { assigneeName: 'New Name', assigneeEmail: 'new@x.co' },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- rates.repository`
Expected: FAIL — `assigneeName`/`assigneeEmail` not accepted by `update`.

- [ ] **Step 3: Extend the repository update**

In `src/rates/rates.repository.ts`, replace `update`:

```typescript
  async update(id: bigint, data: { assigneeName?: string; assigneeEmail?: string; currency?: string; hourlyRateCents?: number; validFrom?: Date; validTo?: Date | null }) {
    const update: Record<string, unknown> = {};
    if (data.assigneeName !== undefined) update.assigneeName = data.assigneeName;
    if (data.assigneeEmail !== undefined) update.assigneeEmail = data.assigneeEmail;
    if (data.currency !== undefined) update.currency = data.currency;
    if (data.hourlyRateCents !== undefined) update.hourlyRateCents = BigInt(data.hourlyRateCents);
    if (data.validFrom !== undefined) update.validFrom = data.validFrom;
    if ('validTo' in data) update.validTo = data.validTo ?? null;
    const r = await this.prisma.assigneeRate.update({ where: { rateId: id }, data: update });
    return mapRate(r);
  }
```

(`RatesService.update` uses `Parameters<RatesRepository['update']>[1]`, so it picks up the new fields automatically — no change there.)

- [ ] **Step 4: Whitelist on the DTO**

In `src/admin/dto/update-rate.dto.ts`, add as the first two properties:

```typescript
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  assigneeName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  assigneeEmail?: string;
```

- [ ] **Step 5: Pass them through the controller**

In `src/admin/admin.controller.ts`, in `updateRate` add after the `data` declaration (line ~470):

```typescript
    if (dto.assigneeName !== undefined) data.assigneeName = dto.assigneeName;
    if (dto.assigneeEmail !== undefined) data.assigneeEmail = dto.assigneeEmail;
```

- [ ] **Step 6: Run tests + build**

Run: `npm run test -- rates.repository && npm run build`
Expected: PASS.

- [ ] **Step 7: Make name/email editable in the edit branch of RateModal**

In `apps/web/src/components/RateModal.tsx`, the `rate ?` branch (the edit case, ~line 367-377) currently shows only a disabled assignee `Select`. Wrap it so the name/email become editable. Replace that `<Field label="Assignee">...</Field>` block with:

```tsx
						<>
							<Field label="Assignee">
								<Select
									fullWidth
									size="md"
									value={assigneePicker}
									onChange={() => undefined}
									options={assigneeSelectOptions.filter((o) => o.value !== MANUAL_VALUE)}
									disabled
								/>
							</Field>
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
								<Field label="Name">
									<Input
										value={assigneeName}
										onChange={(e) => setAssigneeName(e.target.value)}
										placeholder="Display name"
									/>
								</Field>
								<Field label="Email">
									<Input
										value={assigneeEmail}
										onChange={(e) => setAssigneeEmail(e.target.value)}
										placeholder="Email"
										type="email"
									/>
								</Field>
							</div>
						</>
```

The save payload already includes `assigneeName`/`assigneeEmail` (RateModal.tsx ~line 289-291), so no `handleSave` change is needed.

- [ ] **Step 8: Build the web app**

Run: `cd apps/web && npm run build`
Expected: PASS. (Then `cd ../..`.)

- [ ] **Step 9: Commit**

```bash
git add src/admin/dto/update-rate.dto.ts src/rates/rates.repository.ts src/admin/admin.controller.ts apps/web/src/components/RateModal.tsx test/rates.repository.spec.ts
git commit -m "feat(rates): allow editing assignee name/email on a rate"
```

---

## Task 4: AssigneeRatesPage `?userId=` deep link

**Files:**
- Modify: `apps/web/src/pages/AssigneeRatesPage.tsx`

- [ ] **Step 1: Read the param on mount and seed the filter**

In `apps/web/src/pages/AssigneeRatesPage.tsx`:

1. Change the router import (line 2) to:
```tsx
import { useNavigate, useSearchParams } from 'react-router-dom';
```
2. After `const navigate = useNavigate();` (line 47) add:
```tsx
  const [searchParams, setSearchParams] = useSearchParams();
```
3. After the `const [search, setSearch] = useState('');` line (~line 81), add:
```tsx
  // Deep link from the command palette / other pages: ?userId=<id> seeds the
  // assignee filter (the filter below already matches assigneeId). Consume the
  // param once so it doesn't fight manual edits to the search box afterward.
  useEffect(() => {
    const urlUserId = searchParams.get('userId');
    if (urlUserId) {
      setSearch(urlUserId);
      searchParams.delete('userId');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

(`useEffect` is already imported on line 1.)

- [ ] **Step 2: Build the web app**

Run: `cd apps/web && npm run build` (then `cd ../..`)
Expected: PASS.

- [ ] **Step 3: Manual verification**

Start the app, open `/assignee-rates?userId=<a real assignee id>`. Expected: the search box is pre-filled with that id and the list narrows to that assignee; the URL drops `?userId=` after load.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AssigneeRatesPage.tsx
git commit -m "fix(rates-ui): honor ?userId= deep link on AssigneeRatesPage"
```

---

## Task 5: SettingsService — preferences cache, merge, getters

**Files:**
- Modify: `src/settings/settings.service.ts`
- Modify: `src/settings/settings.repository.ts`
- Modify: `src/admin/dto/update-settings.dto.ts`
- Modify: `src/admin/admin.controller.ts` (expose `configuredSpaces` is via `getMasked`, no controller change; verify)
- Test: `test/settings.preferences.spec.ts` (create)

- [ ] **Step 1: Write failing preferences tests**

Create `test/settings.preferences.spec.ts`:

```typescript
import { SettingsService } from '../src/settings/settings.service';

function makeCrypto() {
  return { isEnabled: true, encrypt: (s: string) => `enc:${s}`, decrypt: (b: string) => b.slice(4) } as any;
}
function makeRepo(row: any = null) {
  const store: { row: any } = { row };
  return {
    get: jest.fn(async () => store.row),
    upsert: jest.fn(async (data: any) => {
      store.row = { id: 'singleton', ...(store.row ?? {}), ...data, updatedAt: new Date() };
      return store.row;
    }),
  } as any;
}

describe('SettingsService preferences', () => {
  it('returns defaults when preferences column is null', async () => {
    const svc = new SettingsService(makeRepo(null), makeCrypto());
    await svc.onModuleInit();
    const prefs = svc.getMasked().preferences;
    expect(prefs.notifications.alerts.syncFail).toBe(true);
    expect(prefs.notifications.channels.pagerduty).toBe(false);
    expect(prefs.sync.reconcileLookbackDays).toBe(365);
    expect(prefs.spaces).toEqual({});
  });

  it('deep-merges a partial preferences patch over current values', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    await svc.update({ preferences: { notifications: { channels: { slack: false } } } }, 'alice');
    const prefs = svc.getMasked().preferences;
    expect(prefs.notifications.channels.slack).toBe(false);
    // untouched siblings survive the merge
    expect(prefs.notifications.channels.email).toBe(true);
    expect(prefs.notifications.alerts.syncFail).toBe(true);
  });

  it('isSpaceEnabled defaults to true and honors an explicit false', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    expect(svc.isSpaceEnabled('3577824')).toBe(true);
    await svc.update({ preferences: { spaces: { '3577824': { enabled: false } } } });
    expect(svc.isSpaceEnabled('3577824')).toBe(false);
    expect(svc.isSpaceEnabled('9999999')).toBe(true);
  });

  it('exposes configuredSpaces from the static config', async () => {
    const svc = new SettingsService(makeRepo(null), makeCrypto());
    await svc.onModuleInit();
    const ids = svc.getMasked().configuredSpaces.map((s) => s.id);
    expect(ids).toContain('3577824');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- settings.preferences`
Expected: FAIL — `preferences`/`configuredSpaces`/`isSpaceEnabled` don't exist.

- [ ] **Step 3: Add the preferences type + defaults + deep-merge helper**

In `src/settings/settings.service.ts`, add near the top (after the existing `const DEFAULT_EVENTS` line) and the import for the static spaces:

```typescript
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

export interface SettingsPreferences {
  notifications: {
    alerts: { syncFail: boolean; webhookSpike: boolean; missingRate: boolean; tokenExpiring: boolean };
    channels: { email: boolean; slack: boolean; pagerduty: boolean };
  };
  sync: { reconcileLookbackDays: number };
  spaces: Record<string, { enabled: boolean }>;
}

export const DEFAULT_PREFERENCES: SettingsPreferences = {
  notifications: {
    alerts: { syncFail: true, webhookSpike: true, missingRate: true, tokenExpiring: true },
    channels: { email: true, slack: true, pagerduty: false },
  },
  sync: { reconcileLookbackDays: 365 },
  spaces: {},
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Recursively merge `patch` onto `base`, returning a new object. Plain objects
 *  merge key-by-key; everything else (incl. the per-space leaf objects) replaces. */
function deepMergePrefs(base: SettingsPreferences, patch: DeepPartial<SettingsPreferences>): SettingsPreferences {
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    const cur = (base as any)[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = deepMergePrefs(cur, v as any);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as SettingsPreferences;
}
```

- [ ] **Step 4: Add `preferences` to the cache, patch type, getMasked, and getters**

In `src/settings/settings.service.ts`:

1. Add to `SettingsPatch`:
```typescript
  preferences?: DeepPartial<SettingsPreferences>;
```
2. Add to `MaskedSettings`:
```typescript
  preferences: SettingsPreferences;
  configuredSpaces: { id: string; name: string }[];
```
3. Add to the `Cache` interface and `EMPTY`:
```typescript
  // Cache interface:
  preferences: SettingsPreferences;
  // EMPTY:
  preferences: DEFAULT_PREFERENCES,
```
4. In `refresh()`, set the cache field by merging the stored JSON over defaults:
```typescript
      preferences: deepMergePrefs(DEFAULT_PREFERENCES, (row?.preferences as DeepPartial<SettingsPreferences>) ?? {}),
```
5. Add getters:
```typescript
  getPreferences(): SettingsPreferences {
    return this.cache.preferences;
  }

  isSpaceEnabled(spaceId: string): boolean {
    return this.cache.preferences.spaces[spaceId]?.enabled ?? true;
  }
```
6. In `getMasked()`, add to the returned object:
```typescript
      preferences: this.cache.preferences,
      configuredSpaces: CLICKUP_SPACES.map((s) => ({ id: s.id, name: s.name })),
```
7. In `update()`, before `await this.repo.upsert(data);`, handle the preferences patch by deep-merging onto the current cache and persisting the full object:
```typescript
    if (patch.preferences !== undefined) {
      data.preferences = deepMergePrefs(this.cache.preferences, patch.preferences);
    }
```

- [ ] **Step 5: Add `preferences` to the writable columns**

In `src/settings/settings.repository.ts`, add to `SettingsWrite`:

```typescript
  preferences?: unknown;
```

(`upsert` already spreads `data`, so no other change. Prisma accepts a JSON value here.)

- [ ] **Step 6: Whitelist `preferences` on the settings DTO**

In `src/admin/dto/update-settings.dto.ts`, add the import `IsObject` and append:

```typescript
  @ApiPropertyOptional({ description: 'Non-secret UI preferences (notifications, sync rules, per-space enable map). Deep-merged.' })
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
```

(Change import to: `import { IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';`)

> Note: `preferences` flows through the existing OWNER-only `@Patch('settings')`. The frontend (Task 7) gates the persisted controls behind `hasRole('OWNER')`, matching the existing spike-cap pattern.

- [ ] **Step 7: Run tests + build**

Run: `npm run test -- settings && npm run build`
Expected: PASS (both `settings.service` and `settings.preferences` specs green).

- [ ] **Step 8: Commit**

```bash
git add src/settings/settings.service.ts src/settings/settings.repository.ts src/admin/dto/update-settings.dto.ts test/settings.preferences.spec.ts
git commit -m "feat(settings): persist UI preferences (notifications, sync, space toggles)"
```

---

## Task 6: Scheduler honors space toggles

**Files:**
- Modify: `src/sync/sync.scheduler.ts`
- Modify: `test/sync.scheduler.spec.ts`

- [ ] **Step 1: Update the scheduler tests for the new constructor + skip behavior**

Replace `test/sync.scheduler.spec.ts` with:

```typescript
import { SyncScheduler } from '../src/sync/sync.scheduler';
import { JOBS } from '../src/queues/queue.constants';
import { CLICKUP_SPACES } from '../src/config/clickup-spaces.config';

function makeQueues(liveJobs: any[] = []) {
  const queue = { add: jest.fn().mockResolvedValue(undefined), getJobs: jest.fn().mockResolvedValue(liveJobs) };
  const queues = { get: jest.fn().mockReturnValue(queue), defaultJobOptions: jest.fn().mockReturnValue({}) };
  return { queues, queue };
}
function makeSettings(disabled: string[] = []) {
  return { isSpaceEnabled: (id: string) => !disabled.includes(id) } as any;
}

describe('SyncScheduler.reconcileRecentUpdates', () => {
  it('enqueues one bounded backfill per enabled space', async () => {
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings()).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length);
    for (const space of CLICKUP_SPACES) {
      expect(queue.add).toHaveBeenCalledWith(
        JOBS.BACKFILL_CLICKUP_SPACE,
        { spaceId: space.id, lookbackDays: 1, timeEntryLookbackDays: 7 },
        {},
      );
    }
  });

  it('skips a space whose backfill is still in flight (overlap guard)', async () => {
    const busy = CLICKUP_SPACES[0].id;
    const { queues, queue } = makeQueues([{ data: { spaceId: busy } }]);
    await new SyncScheduler(queues as any, makeSettings()).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length - 1);
    const enqueued = queue.add.mock.calls.map((c: any[]) => c[1].spaceId);
    expect(enqueued).not.toContain(busy);
  });

  it('skips a space disabled in settings', async () => {
    const off = CLICKUP_SPACES[0].id;
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings([off])).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length - 1);
    const enqueued = queue.add.mock.calls.map((c: any[]) => c[1].spaceId);
    expect(enqueued).not.toContain(off);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- sync.scheduler`
Expected: FAIL — constructor takes one arg; no disabled-skip logic.

- [ ] **Step 3: Inject SettingsService and skip disabled spaces**

In `src/sync/sync.scheduler.ts`:

1. Add import: `import { SettingsService } from '../settings/settings.service';`
2. Change the constructor:
```typescript
  constructor(
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
  ) {}
```
3. In the `for (const space of CLICKUP_SPACES)` loop, add right after the `if (busy.has(space.id))` block:
```typescript
      if (!this.settings.isSpaceEnabled(space.id)) {
        this.logger.log(`Skipping recurring reconcile for space ${space.id}: disabled in settings`);
        continue;
      }
```

- [ ] **Step 4: Verify the scheduler's module can inject SettingsService**

Confirm the module that provides `SyncScheduler` imports the module exporting `SettingsService`. Run:
`grep -rn "SyncScheduler" src/**/*.module.ts`
Then ensure that module's `imports` includes `SettingsModule` (the module exporting `SettingsService`). If missing, add `SettingsModule` to its `imports`. Verify `SettingsModule` `exports: [SettingsService]` (it must, since `AdminModule`/others already inject it).

- [ ] **Step 5: Run tests + build**

Run: `npm run test -- sync.scheduler && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sync/sync.scheduler.ts test/sync.scheduler.spec.ts
git commit -m "feat(sync): scheduled loop skips spaces disabled in settings"
```

---

## Task 7: Settings frontend — persist notifications, reconcile default, space toggles

**Files:**
- Modify: `apps/web/src/api/settings.ts`
- Modify: `apps/web/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Extend the settings API types**

In `apps/web/src/api/settings.ts`, add the preferences shape and extend `AppSettings` + `SettingsPatch`:

```typescript
export interface SettingsPreferences {
  notifications: {
    alerts: { syncFail: boolean; webhookSpike: boolean; missingRate: boolean; tokenExpiring: boolean };
    channels: { email: boolean; slack: boolean; pagerduty: boolean };
  };
  sync: { reconcileLookbackDays: number };
  spaces: Record<string, { enabled: boolean }>;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
```

Add to `AppSettings`:
```typescript
  preferences: SettingsPreferences;
  configuredSpaces: { id: string; name: string }[];
```
Add to `SettingsPatch`:
```typescript
  preferences?: DeepPartial<SettingsPreferences>;
```

- [ ] **Step 2: Wire notification toggles to persisted preferences**

In `apps/web/src/pages/SettingsPage.tsx`, replace the seven local notification `useState` declarations (lines ~270-276: `alertSyncFail`…`chPager`) with values derived from `settingsQuery.data?.preferences`, and make each `Switch` `onChange` call `updateSettings.mutate` with a scoped `preferences` patch. Add a helper near the other handlers:

```tsx
  const prefs = settingsQuery.data?.preferences;
  const isOwner = hasRole('OWNER');

  function patchPrefs(patch: SettingsPatch['preferences']) {
    updateSettings.mutate(
      { preferences: patch },
      { onError: (err) => showBanner(`Save failed: ${(err as Error).message}`, 'red') },
    );
  }
```

Then in the **notifications** tab, replace each alert `Switch` like so (example for "Sync run failed"; apply the same shape to `webhookSpike`, `missingRate`, `tokenExpiring`, and the three channels under their respective keys):

```tsx
control={
  <Switch
    ariaLabel="Sync run failed alerts"
    checked={prefs?.notifications.alerts.syncFail ?? true}
    disabled={!isOwner || updateSettings.isPending}
    onChange={(v) => patchPrefs({ notifications: { alerts: { syncFail: v } } })}
  />
}
```

Channels map to `{ notifications: { channels: { email|slack|pagerduty: v } } }`. Remove the now-unused `useState` lines and their setters. Keep the existing "Preview only — no notifications delivered yet" callout (delivery is still out of scope).

- [ ] **Step 3: Seed the reconcile lookback from preferences**

Replace `const [reconcileDays, setReconcileDays] = useState('365');` (line ~261) with a value seeded from prefs, and persist it when the user runs a reconcile. Add an effect mirroring the spike-cap pattern:

```tsx
  const [reconcileDays, setReconcileDays] = useState('365');
  useEffect(() => {
    if (prefs?.sync.reconcileLookbackDays != null) setReconcileDays(String(prefs.sync.reconcileLookbackDays));
  }, [prefs?.sync.reconcileLookbackDays]);
```

In the existing reconcile "Run now" `onSuccess` handler, persist the chosen value (Owners only — guard to avoid a 403 for others):

```tsx
                          onSuccess: (res) => {
                            if (isOwner) patchPrefs({ sync: { reconcileLookbackDays: days } });
                            showBanner(/* …existing message… */, 'blue');
                            reconcileProgress.refetch();
                          },
```

- [ ] **Step 4: Add per-space enable/disable toggles to the Scope filters tab**

In the `activeTab === 'scopes'` block, render the union of `configuredSpaces` and synced `spaceRows`, each with a persisted `Switch`. Replace the inner list rendering of the "Synced spaces" card with a merged list:

```tsx
            {(() => {
              const configured = settingsQuery.data?.configuredSpaces ?? [];
              const byId = new Map<string, { id: string; name: string }>();
              for (const c of configured) byId.set(c.id, { id: c.id, name: c.name });
              for (const s of spaceRows) {
                const sid = (s as { spaceId?: string }).spaceId ?? '';
                if (!sid) continue;
                const nameRaw = (s as { spaceName?: string | null }).spaceName?.trim();
                if (!byId.has(sid)) byId.set(sid, { id: sid, name: nameRaw || `Space ${sid}` });
              }
              const rows = Array.from(byId.values());
              if (rows.length === 0) {
                return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No spaces configured or synced yet.</p>;
              }
              return rows.map((s) => {
                const enabled = prefs?.spaces[s.id]?.enabled ?? true;
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, background: 'var(--muted-bg)', marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: spaceColor(s.id), flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                        {s.id}{enabled ? '' : ' · scheduled sync paused'}
                      </div>
                    </div>
                    <Switch
                      ariaLabel={`Scheduled sync for ${s.name}`}
                      checked={enabled}
                      disabled={!isOwner || updateSettings.isPending}
                      onChange={(v) => patchPrefs({ spaces: { [s.id]: { enabled: v } } })}
                    />
                  </div>
                );
              });
            })()}
```

Update the blue callout in that tab to explain the new behavior:

```tsx
          <Callout tone="blue" icon={<Info size={13} />}>
            Toggling a space off pauses its <strong>scheduled</strong> hourly sync. Manual backfills and existing reports are unaffected. The set of spaces still comes from{' '}
            <code style={{ fontFamily: 'ui-monospace, monospace' }}>src/config/clickup-spaces.config.ts</code>; add or remove a space there and restart.
          </Callout>
```

- [ ] **Step 5: Build the web app**

Run: `cd apps/web && npm run build` (then `cd ../..`)
Expected: PASS — no unused-variable errors (confirm all removed `useState` setters are gone).

- [ ] **Step 6: Manual verification**

As an Owner: toggle a notification alert, reload — it sticks. Toggle a space off in Scope filters, reload — it stays off and shows "scheduled sync paused". As a non-Owner: the controls are disabled.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/settings.ts apps/web/src/pages/SettingsPage.tsx
git commit -m "feat(settings-ui): persist notification, reconcile, and space toggles"
```

---

## Task 8: Search endpoint — tasks + assignees

**Files:**
- Create: `src/admin/search.repository.ts`
- Modify: `src/admin/admin.module.ts`
- Modify: `src/admin/admin.controller.ts`
- Test: `test/search.repository.spec.ts` (create)

- [ ] **Step 1: Write a failing repository test**

Create `test/search.repository.spec.ts`:

```typescript
import { SearchRepository } from '../src/admin/search.repository';

describe('SearchRepository.search', () => {
  it('returns empty arrays for short queries without hitting the db', async () => {
    const prisma = { clickupTask: { findMany: jest.fn() }, assigneeRate: { findMany: jest.fn() } } as any;
    const repo = new SearchRepository(prisma);
    const out = await repo.search('a');
    expect(out).toEqual({ tasks: [], assignees: [] });
    expect(prisma.clickupTask.findMany).not.toHaveBeenCalled();
  });

  it('queries tasks by name and dedupes assignees from rates', async () => {
    const clickupTask = {
      findMany: jest.fn().mockResolvedValue([
        { taskId: 't1', taskName: 'Landing page', status: 'open', client: 'Acme' },
      ]),
    };
    const assigneeRate = {
      findMany: jest.fn().mockResolvedValue([
        { assigneeId: 'u1', assigneeName: 'Ada', assigneeEmail: 'ada@x.co' },
        { assigneeId: 'u1', assigneeName: 'Ada', assigneeEmail: 'ada@x.co' },
        { assigneeId: 'u2', assigneeName: 'Bo', assigneeEmail: null },
      ]),
    };
    const repo = new SearchRepository({ clickupTask, assigneeRate } as any);

    const out = await repo.search('a');
    // 'a' is too short; use a real query:
    const out2 = await repo.search('ad');

    expect(clickupTask.findMany).toHaveBeenCalled();
    expect(out2.tasks).toEqual([{ taskId: 't1', taskName: 'Landing page', status: 'open', client: 'Acme' }]);
    expect(out2.assignees).toEqual([
      { userId: 'u1', name: 'Ada', email: 'ada@x.co' },
      { userId: 'u2', name: 'Bo', email: null },
    ]);
    void out;
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- search.repository`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

Create `src/admin/search.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface SearchResult {
  tasks: { taskId: string; taskName: string; status: string | null; client: string | null }[];
  assignees: { userId: string; name: string | null; email: string | null }[];
}

@Injectable()
export class SearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(qRaw: string): Promise<SearchResult> {
    const q = (qRaw ?? '').trim();
    if (q.length < 2) return { tasks: [], assignees: [] };

    const [tasks, rates] = await Promise.all([
      this.prisma.clickupTask.findMany({
        where: {
          isDeleted: false,
          OR: [
            { taskName: { contains: q, mode: 'insensitive' } },
            { taskId: q },
          ],
        },
        select: { taskId: true, taskName: true, status: true, client: true },
        orderBy: { updatedDate: 'desc' },
        take: 8,
      }),
      this.prisma.assigneeRate.findMany({
        where: {
          OR: [
            { assigneeName: { contains: q, mode: 'insensitive' } },
            { assigneeEmail: { contains: q, mode: 'insensitive' } },
            { assigneeId: q },
          ],
        },
        select: { assigneeId: true, assigneeName: true, assigneeEmail: true },
        orderBy: { assigneeName: 'asc' },
        take: 20,
      }),
    ]);

    const seen = new Set<string>();
    const assignees: SearchResult['assignees'] = [];
    for (const r of rates) {
      if (seen.has(r.assigneeId)) continue;
      seen.add(r.assigneeId);
      assignees.push({ userId: r.assigneeId, name: r.assigneeName, email: r.assigneeEmail });
      if (assignees.length >= 6) break;
    }

    return { tasks, assignees };
  }
}
```

- [ ] **Step 4: Register the repository**

In `src/admin/admin.module.ts`, add `SearchRepository` to `providers`. In `src/admin/admin.controller.ts`, import it and add `private readonly searchRepo: SearchRepository` to the constructor.

```typescript
// admin.module.ts import:
import { SearchRepository } from './search.repository';
// providers: [..., SearchRepository]
```

- [ ] **Step 5: Add the endpoint**

In `src/admin/admin.controller.ts`, add (place near the other GET endpoints):

```typescript
  @Get('search')
  @ApiOperation({ summary: 'Quick search across tasks and assignees (command palette).' })
  search(@Query('q') q = '') {
    return this.searchRepo.search(q);
  }
```

- [ ] **Step 6: Run tests + build**

Run: `npm run test -- search.repository && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/admin/search.repository.ts src/admin/admin.module.ts src/admin/admin.controller.ts test/search.repository.spec.ts
git commit -m "feat(admin): add /admin/search endpoint for tasks and assignees"
```

---

## Task 9: Command palette — wire search results

**Files:**
- Create: `apps/web/src/api/search.ts`, `apps/web/src/hooks/useSearch.ts`
- Modify: `apps/web/src/components/layout/CommandPalette.tsx`

- [ ] **Step 1: Add the search API client**

Create `apps/web/src/api/search.ts`:

```typescript
import { apiClient } from './client';

export interface SearchResult {
  tasks: { taskId: string; taskName: string; status: string | null; client: string | null }[];
  assignees: { userId: string; name: string | null; email: string | null }[];
}

export const searchApi = {
  query: (q: string): Promise<SearchResult> =>
    apiClient.get('/admin/search', { params: { q } }).then((r) => r.data),
};
```

- [ ] **Step 2: Add the hook (debounced, gated on length)**

Create `apps/web/src/hooks/useSearch.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { searchApi, type SearchResult } from '../api/search';

const EMPTY: SearchResult = { tasks: [], assignees: [] };

export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => searchApi.query(q),
    enabled: q.length >= 2,
    placeholderData: (prev) => prev ?? EMPTY,
    staleTime: 10_000,
  });
}
```

- [ ] **Step 3: Render task + assignee groups in the palette**

In `apps/web/src/components/layout/CommandPalette.tsx`, build a single flat `filtered` list of typed items so existing keyboard nav keeps working. Add `import { useSearch } from '../../hooks/useSearch';` and a debounced query value:

```tsx
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);
  const { data: results } = useSearch(debounced);
```

Replace the `filtered` memo with a merged, typed action list:

```tsx
  type Action = { key: string; label: string; sub: string; icon: typeof Home; run: () => void };

  const filtered = useMemo<Action[]>(() => {
    const q = query.trim().toLowerCase();
    const nav: Action[] = NAV_ITEMS
      .filter((r) => !q || (r.label + ' ' + r.sub).toLowerCase().includes(q))
      .map((r) => ({ key: 'nav:' + r.to, label: `Go to ${r.label}`, sub: r.sub, icon: r.icon, run: () => select(r.to) }));

    if (q.length < 2) return nav.slice(0, 8);

    const taskActions: Action[] = (results?.tasks ?? []).map((t) => ({
      key: 'task:' + t.taskId,
      label: t.taskName,
      sub: t.client ? `Task · ${t.client}` : 'Task',
      icon: CheckSquare,
      run: () => select(`/tasks?search=${encodeURIComponent(t.taskName)}`),
    }));
    const assigneeActions: Action[] = (results?.assignees ?? []).map((a) => ({
      key: 'assignee:' + a.userId,
      label: a.name ?? a.userId,
      sub: a.email ?? 'Assignee',
      icon: DollarSign,
      run: () => select(`/assignee-rates?userId=${encodeURIComponent(a.userId)}`),
    }));

    return [...taskActions, ...assigneeActions, ...nav].slice(0, 20);
  }, [query, results, select]);
```

Update `select` to accept a full path string (it already does — `navigate(to)`), and change the Enter handler + click handler to call `filtered[active].run()` instead of `select(filtered[active].to)`. Change the row `key` to `item.key` and the button `onClick` to `item.run`. Update the placeholder to remain `"Search tasks, assignees, navigate…"` (now accurate).

- [ ] **Step 4: Build the web app**

Run: `cd apps/web && npm run build` (then `cd ../..`)
Expected: PASS (ensure `CheckSquare` and `DollarSign` are imported — they already are in the lucide import block).

- [ ] **Step 5: Manual verification**

Open the palette (its existing shortcut), type a task name → task results appear and Enter navigates to `/tasks?search=…`; type an assignee name → selecting navigates to `/assignee-rates?userId=…` and the rates page filters (Task 4).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/search.ts apps/web/src/hooks/useSearch.ts apps/web/src/components/layout/CommandPalette.tsx
git commit -m "feat(palette): real task + assignee search"
```

---

## Task 10: Task history endpoint — merged trail

**Files:**
- Create: `src/admin/task-history.repository.ts`
- Modify: `src/admin/admin.module.ts`, `src/admin/admin.controller.ts`
- Test: `test/task-history.repository.spec.ts` (create)

- [ ] **Step 1: Write a failing repository test**

Create `test/task-history.repository.spec.ts`:

```typescript
import { TaskHistoryRepository } from '../src/admin/task-history.repository';

describe('TaskHistoryRepository.forTask', () => {
  it('merges job logs and task events newest-first with string ids', async () => {
    const syncJobLog = {
      findMany: jest.fn().mockResolvedValue([
        { id: BigInt(10), queueName: 'clickup-tasks', jobName: 'sync', status: 'completed',
          errorMessage: null, startedAt: new Date('2026-06-01T10:00:00Z'), finishedAt: new Date('2026-06-01T10:00:05Z') },
      ]),
    };
    const clickupTaskEvent = {
      findMany: jest.fn().mockResolvedValue([
        { id: BigInt(20), eventType: 'taskStatusUpdated', occurredAt: new Date('2026-06-02T09:00:00Z'),
          changedByUserName: 'Ada', before: { status: 'open' }, after: { status: 'done' } },
      ]),
    };
    const repo = new TaskHistoryRepository({ syncJobLog, clickupTaskEvent } as any);

    const out = await repo.forTask('t1');

    expect(syncJobLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType: 'task', entityId: 't1' },
    }));
    expect(out[0].kind).toBe('event');     // 2026-06-02 is newer
    expect(out[1].kind).toBe('job');
    expect(out[0].id).toBe('20');          // BigInt serialized
    expect(out[1].id).toBe('10');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- task-history`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

Create `src/admin/task-history.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type HistoryItem =
  | { kind: 'job'; id: string; at: Date | null; queueName: string; jobName: string; status: string; error: string | null }
  | { kind: 'event'; id: string; at: Date; eventType: string; changedByUserName: string | null; before: unknown; after: unknown };

@Injectable()
export class TaskHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async forTask(taskId: string): Promise<HistoryItem[]> {
    const [jobs, events] = await Promise.all([
      this.prisma.syncJobLog.findMany({
        where: { entityType: 'task', entityId: taskId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.clickupTaskEvent.findMany({
        where: { taskId },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
    ]);

    const jobItems: HistoryItem[] = jobs.map((j) => ({
      kind: 'job',
      id: j.id.toString(),
      at: j.finishedAt ?? j.startedAt ?? j.createdAt,
      queueName: j.queueName,
      jobName: j.jobName,
      status: j.status,
      error: j.errorMessage,
    }));
    const eventItems: HistoryItem[] = events.map((e) => ({
      kind: 'event',
      id: e.id.toString(),
      at: e.occurredAt,
      eventType: e.eventType,
      changedByUserName: e.changedByUserName,
      before: e.before,
      after: e.after,
    }));

    return [...jobItems, ...eventItems].sort(
      (a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0),
    );
  }
}
```

> Note: `syncJobLog` test stub omits `createdAt`; the test rows provide `finishedAt`, so `at` resolves. In production `createdAt` always exists.

- [ ] **Step 4: Register + add endpoint**

In `src/admin/admin.module.ts` add `TaskHistoryRepository` to `providers` (and import). In `src/admin/admin.controller.ts` import it, add to the constructor, and add the endpoint:

```typescript
  @Get('tasks/:taskId/history')
  @ApiOperation({ summary: 'Merged sync-job + status-event history for one task.' })
  taskHistory(@Param('taskId') taskId: string) {
    return this.taskHistoryRepo.forTask(taskId);
  }
```

- [ ] **Step 5: Run tests + build**

Run: `npm run test -- task-history && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/admin/task-history.repository.ts src/admin/admin.module.ts src/admin/admin.controller.ts test/task-history.repository.spec.ts
git commit -m "feat(admin): per-task history endpoint (job logs + status events)"
```

---

## Task 11: Task drawer — render the history trail

**Files:**
- Create: `apps/web/src/api/task-history.ts`, `apps/web/src/hooks/useTaskHistory.ts`
- Modify: `apps/web/src/pages/TasksPage.tsx` (the `tab === 'sync'` block, ~line 210)

- [ ] **Step 1: Add the API client + hook**

Create `apps/web/src/api/task-history.ts`:

```typescript
import { apiClient } from './client';

export type HistoryItem =
  | { kind: 'job'; id: string; at: string | null; queueName: string; jobName: string; status: string; error: string | null }
  | { kind: 'event'; id: string; at: string; eventType: string; changedByUserName: string | null; before: unknown; after: unknown };

export const taskHistoryApi = {
  get: (taskId: string): Promise<HistoryItem[]> =>
    apiClient.get(`/admin/tasks/${encodeURIComponent(taskId)}/history`).then((r) => r.data),
};
```

Create `apps/web/src/hooks/useTaskHistory.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { taskHistoryApi } from '../api/task-history';

export function useTaskHistory(taskId: string | null) {
  return useQuery({
    queryKey: ['task-history', taskId],
    queryFn: () => taskHistoryApi.get(taskId as string),
    enabled: !!taskId,
  });
}
```

- [ ] **Step 2: Render the trail in the Sync history tab**

In `apps/web/src/pages/TasksPage.tsx`, identify the drawer component that renders the `tab === 'sync'` block (it has access to the selected `task`). Add `import { useTaskHistory } from '../hooks/useTaskHistory';` and, in that component, call the hook with the selected task id (the field is `task.taskId ?? task.task_id`). Keep the existing `syncCount`/`syncedAt` summary, then append the trail below it:

```tsx
{tab === 'sync' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {/* existing syncCount / syncedAt summary block stays here */}
    {(() => {
      const taskId = String(task.taskId ?? task.task_id ?? '');
      const history = useTaskHistory(taskId || null);
      if (history.isLoading) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading activity…</div>;
      const items = history.data ?? [];
      if (items.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No recorded sync jobs or status changes yet.</div>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it) => (
            <div key={it.kind + it.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: 'var(--muted-bg)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: it.kind === 'event' ? 'var(--accent)' : it.error ? 'var(--red)' : 'var(--text-muted)', minWidth: 52 }}>
                {it.kind === 'event' ? 'EVENT' : 'SYNC'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text)' }}>
                  {it.kind === 'event'
                    ? `${it.eventType}${it.changedByUserName ? ` · ${it.changedByUserName}` : ''}`
                    : `${it.jobName} (${it.queueName}) · ${it.status}`}
                </div>
                {it.kind === 'job' && it.error && (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2, wordBreak: 'break-word' }}>{it.error}</div>
                )}
                {it.at && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{fmt.relative(it.at)}</div>}
              </div>
            </div>
          ))}
        </div>
      );
    })()}
  </div>
)}
```

> Note: calling a hook inside an IIFE in JSX violates the rules of hooks. Instead, hoist `const history = useTaskHistory(...)` to the top of the drawer component body (with the other hooks) and reference `history` in the `tab === 'sync'` block. Confirm the drawer is its own component (the file defines a `Tabs`-driven drawer component around line 100); if the `sync` block lives directly in the page component alongside other hooks, place the `useTaskHistory` call there. `fmt` is already imported.

- [ ] **Step 3: Build the web app**

Run: `cd apps/web && npm run build` (then `cd ../..`)
Expected: PASS — no rules-of-hooks or unused-var errors.

- [ ] **Step 4: Manual verification**

Open a task that has synced at least once → the Sync history tab shows the summary plus a chronological list of sync jobs (and status-change events if any). Open a never-synced/empty task → shows the empty hint.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/task-history.ts apps/web/src/hooks/useTaskHistory.ts apps/web/src/pages/TasksPage.tsx
git commit -m "feat(tasks-ui): real per-task sync + status history trail"
```

---

## Final verification

- [ ] Run the full backend suite: `npm run test` → all green.
- [ ] Build backend: `npm run build` → PASS.
- [ ] Build web: `cd apps/web && npm run build && cd ../..` → PASS.
- [ ] Spot-check each of the six items per its manual-verification step.

---

## Self-Review notes (coverage map)

- **Settings persistence (spec Item 1):** Tasks 1, 5, 6, 7. Space toggles gate only the scheduler (Task 6); manual backfill/reports untouched. Notification channels persist but don't deliver (callout retained). Cost/failure placeholder selects intentionally left as preview (not persisted).
- **Tag-map DTO bug (Item 2):** Task 2.
- **Rates PATCH metadata (Item 3):** Task 3, per-row semantics.
- **Command palette (Item 4):** Tasks 8, 9.
- **Task drawer history (Item 5):** Tasks 10, 11.
- **Deep link ?userId= (Item 6):** Task 4 (and consumed by Task 9 assignee results).

Type consistency: `SettingsPreferences` shape is identical in `settings.service.ts` and `api/settings.ts`; `HistoryItem`/`SearchResult` shapes match between backend repo and frontend api. `isSpaceEnabled` name consistent across service, scheduler, and tests.

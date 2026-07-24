# Archived-task Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optionally pull archived ClickUp tasks (and their tracked time) during space sync via a second pagination pass, gated by a runtime settings toggle that defaults on.

**Architecture:** `getAllTasksBySpace` runs the existing page loop once for active tasks and, when enabled, a second time with `archived=true`, merging results deduped by task id and OR-ing the truncation flags. A new `preferences.sync.includeArchived` setting (default true) is read by the backfill and surfaced as a Settings → Sync toggle. Archived tasks flow through the unchanged upsert + time-entry fan-out, so their hours sync automatically. No reports query changes — archived tasks count in the Spaces rollup by design.

**Tech Stack:** NestJS 11, TypeScript, Prisma, Jest (backend unit tests), React + Vite (`apps/web`, no test runner — verified via typecheck/build).

## Global Constraints

- Node.js `>=22`; preserve Prettier formatting.
- Untrusted ClickUp payloads: prefer explicit types; use `unknown` + guards, not `any`, in new production code (existing `as any` casts on payload access may be matched where already idiomatic).
- Never log API tokens/secrets.
- Backend tests: `npx jest <path>`; full suite `npm run test`. Build/typecheck: `npm run build`.
- `apps/web` has no test runner. Verify frontend with `npm --prefix apps/web install` (required — missing deps produce phantom `exceljs` type errors) then `npm --prefix apps/web run build`.
- Commit after each task. Do NOT add a `Co-Authored-By: Claude` trailer (project convention).
- ClickUp API assumption: `GET /team/{team_id}/task?archived=true` returns archived tasks; `archived=false` (default) returns non-archived. Two calls are needed for both states. The design does not depend on whether `archived=true` returns only-archived vs. archived+active — results are deduped by id, so overlap is harmless.

---

### Task 1: `getTasksBySpace` — add `archived` query param

**Files:**
- Modify: `src/clickup/clickup.client.ts:105-128` (`getTasksBySpace`)
- Test: `src/clickup/clickup.client.spec.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getTasksBySpace(spaceId, { teamId, dateUpdatedGt?, page?, includeClosed?, subtasks?, limit?, archived? })` — new optional `archived?: boolean` that appends `archived=<bool>` to the query (`?? false`, preserving current behavior).

- [ ] **Step 1: Write the failing test**

Create `src/clickup/clickup.client.spec.ts`:

```ts
import { ClickupClient } from './clickup.client';

function makeClient(): ClickupClient {
  // Only getApiToken() is exercised by these tests; the rest is unused.
  return new ClickupClient({} as never, { getApiToken: () => 'tok' } as never);
}

describe('ClickupClient.getTasksBySpace', () => {
  it('sends archived=false by default and archived=true when requested', async () => {
    const client = makeClient();
    const request = jest
      .spyOn(client as unknown as { request: (...a: unknown[]) => Promise<unknown> }, 'request')
      .mockResolvedValue({ tasks: [] });

    await client.getTasksBySpace('sp1', { teamId: 'team1' });
    await client.getTasksBySpace('sp1', { teamId: 'team1', archived: true });

    const url1 = request.mock.calls[0][1] as string;
    const url2 = request.mock.calls[1][1] as string;
    expect(url1).toContain('archived=false');
    expect(url2).toContain('archived=true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/clickup/clickup.client.spec.ts -t "sends archived"`
Expected: FAIL — `url1` does not contain `archived=false` (param not yet appended).

- [ ] **Step 3: Add the param**

In `src/clickup/clickup.client.ts`, add `archived?: boolean;` to the `getTasksBySpace` options object (after `limit?: number;`), and append it in the body after the `subtasks` line:

```ts
    params.append("include_closed", String(options.includeClosed ?? true));
    params.append("subtasks", String(options.subtasks ?? true));
    params.append("archived", String(options.archived ?? false));
    params.append("page", String(options.page ?? 0));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/clickup/clickup.client.spec.ts -t "sends archived"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/clickup/clickup.client.ts src/clickup/clickup.client.spec.ts
git commit -m "feat(clickup): add archived query param to getTasksBySpace"
```

---

### Task 2: `getAllTasksBySpace` — second archived pass + dedupe

**Files:**
- Modify: `src/clickup/clickup.client.ts:130-167` (`getAllTasksBySpace`)
- Test: `src/clickup/clickup.client.spec.ts` (extend)

**Interfaces:**
- Consumes: `getTasksBySpace(..., { archived })` from Task 1.
- Produces: `getAllTasksBySpace(spaceId, { teamId, dateUpdatedGt?, includeClosed?, subtasks?, includeArchived? })` → `Promise<{ tasks: ClickUpTask[]; truncated: boolean }>`. New optional `includeArchived?: boolean`; when true, runs a second `archived=true` pass, merges deduped by task `id`, and ORs both passes' `truncated`. Extracts a private `fetchAllPages(spaceId, options, archived)` helper.

- [ ] **Step 1: Write the failing tests**

Append to `src/clickup/clickup.client.spec.ts`:

```ts
describe('ClickupClient.getAllTasksBySpace', () => {
  function makeClient(): ClickupClient {
    return new ClickupClient({} as never, { getApiToken: () => 'tok' } as never);
  }

  it('runs a single active pass when includeArchived is not set', async () => {
    const client = makeClient();
    const spy = jest
      .spyOn(client, 'getTasksBySpace')
      .mockResolvedValue({ tasks: [{ id: 'a' }] } as never);

    const res = await client.getAllTasksBySpace('sp1', { teamId: 'team1' });

    expect(spy).toHaveBeenCalledTimes(1); // one short page => one call, no archived pass
    expect((spy.mock.calls[0][1] as { archived?: boolean }).archived).toBe(false);
    expect(res.tasks.map((t) => (t as { id: string }).id)).toEqual(['a']);
    expect(res.truncated).toBe(false);
  });

  it('paginates a pass until a short page', async () => {
    const client = makeClient();
    const fullPage = { tasks: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })) };
    const shortPage = { tasks: [{ id: 'last' }] };
    const spy = jest
      .spyOn(client, 'getTasksBySpace')
      .mockResolvedValueOnce(fullPage as never)
      .mockResolvedValueOnce(shortPage as never);

    const res = await client.getAllTasksBySpace('sp1', { teamId: 'team1' });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.tasks).toHaveLength(101);
  });

  it('runs a second archived pass and dedupes by id when includeArchived', async () => {
    const client = makeClient();
    const spy = jest
      .spyOn(client, 'getTasksBySpace')
      .mockImplementation((_sp, opts) =>
        (opts as { archived?: boolean }).archived
          ? (Promise.resolve({ tasks: [{ id: 'b' }, { id: 'a' }] }) as never) // 'a' overlaps
          : (Promise.resolve({ tasks: [{ id: 'a' }] }) as never),
      );

    const res = await client.getAllTasksBySpace('sp1', { teamId: 'team1', includeArchived: true });

    expect(spy.mock.calls.some((c) => (c[1] as { archived?: boolean }).archived === true)).toBe(true);
    expect(res.tasks.map((t) => (t as { id: string }).id).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/clickup/clickup.client.spec.ts -t "getAllTasksBySpace"`
Expected: FAIL — `includeArchived` unsupported / no second pass / no dedupe (e.g. the archived test yields 3 tasks, not 2).

- [ ] **Step 3: Refactor to two-pass with dedupe**

Replace the whole `getAllTasksBySpace` method (`src/clickup/clickup.client.ts:130-167`) with:

```ts
  private async fetchAllPages(
    spaceId: string,
    options: {
      teamId: string;
      dateUpdatedGt?: number;
      includeClosed?: boolean;
      subtasks?: boolean;
    },
    archived: boolean,
  ): Promise<{ tasks: ClickUpTask[]; truncated: boolean }> {
    // ~500k tasks (5000 * 100). High enough that a multi-year backfill of any
    // real space stops on a short page well before the cap; the cap only exists
    // as a runaway guard, and `truncated` makes hitting it observable.
    const MAX_PAGES = 5000;
    const all: ClickUpTask[] = [];
    let page = 0;
    for (; page < MAX_PAGES; page++) {
      const res = await this.getTasksBySpace(spaceId, {
        ...options,
        archived,
        page,
        limit: 100,
      });
      const tasks = res.tasks || [];
      all.push(...tasks);
      if (tasks.length < 100) break;
    }
    if (page === MAX_PAGES) {
      // Ran the full cap without a short page — there are very likely more tasks
      // we did not fetch. Surface it instead of silently treating the truncated
      // list as complete (which would make downstream reconciliation soft-delete
      // the missing tail as "no longer in ClickUp").
      this.logger.warn(
        `getAllTasksBySpace(${spaceId}, archived=${archived}) hit the ${MAX_PAGES}-page cap (~${all.length} tasks); results may be truncated and tasks beyond this window were not fetched`,
      );
      return { tasks: all, truncated: true };
    }
    return { tasks: all, truncated: false };
  }

  async getAllTasksBySpace(
    spaceId: string,
    options: {
      teamId: string;
      dateUpdatedGt?: number;
      includeClosed?: boolean;
      subtasks?: boolean;
      includeArchived?: boolean;
    },
  ): Promise<{ tasks: ClickUpTask[]; truncated: boolean }> {
    const active = await this.fetchAllPages(spaceId, options, false);
    if (!options.includeArchived) return active;

    const archived = await this.fetchAllPages(spaceId, options, true);
    // Dedupe by task id. A task should appear in only one pass, but ClickUp's
    // `archived=true` semantics are handled defensively so any overlap is
    // harmless. Tasks without an id (should not happen) are kept as-is.
    const seen = new Set<string>();
    const merged: ClickUpTask[] = [];
    for (const t of [...active.tasks, ...archived.tasks]) {
      const id = (t as { id?: string }).id;
      if (id == null) {
        merged.push(t);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(t);
    }
    return { tasks: merged, truncated: active.truncated || archived.truncated };
  }
```

> **Truncation note:** the `truncated` OR is `active.truncated || archived.truncated` by construction. It is intentionally NOT unit-tested — triggering it requires hitting the 5000-page runaway cap (500k tasks), which no reasonable test should simulate. The non-truncating case (`truncated === false`) is asserted in the first test; the cap logic itself is unchanged from the pre-refactor single-pass code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/clickup/clickup.client.spec.ts`
Expected: PASS (all `getTasksBySpace` + `getAllTasksBySpace` tests).

- [ ] **Step 5: Commit**

```bash
git add src/clickup/clickup.client.ts src/clickup/clickup.client.spec.ts
git commit -m "feat(clickup): add optional archived second pass to getAllTasksBySpace"
```

---

### Task 3: Settings — `includeArchived` preference + accessor

**Files:**
- Modify: `src/settings/settings.service.ts` (interface `SettingsPreferences.sync`, `DEFAULT_PREFERENCES.sync`, new accessor near line 186)
- Test: `src/settings/settings.service.spec.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SettingsPreferences.sync.includeArchived: boolean` (default `true`); `SettingsService.getIncludeArchived(): boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/settings/settings.service.spec.ts`:

```ts
describe('SettingsService.getIncludeArchived', () => {
  it('defaults to true when unset', async () => {
    const svc = makeService({});
    await svc.refresh();
    expect(svc.getIncludeArchived()).toBe(true);
  });

  it('reflects the stored value', async () => {
    const svc = makeService({ sync: { includeArchived: false } });
    await svc.refresh();
    expect(svc.getIncludeArchived()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/settings/settings.service.spec.ts -t "getIncludeArchived"`
Expected: FAIL — `svc.getIncludeArchived is not a function`.

- [ ] **Step 3: Add the field, default, and accessor**

In `src/settings/settings.service.ts`:

Add `includeArchived: boolean` to the `sync` type in the `SettingsPreferences` interface:

```ts
  sync: { reconcileLookbackDays: number; realtimeWebhooks: boolean; backfillOnConnect: boolean; maxBackfillLookbackDays: number; includeArchived: boolean };
```

Add the default to `DEFAULT_PREFERENCES.sync`:

```ts
  sync: { reconcileLookbackDays: 365, realtimeWebhooks: true, backfillOnConnect: true, maxBackfillLookbackDays: DEFAULT_MAX_BACKFILL_LOOKBACK, includeArchived: true },
```

Add the accessor (place it after `getBackfillMaxLookbackDays()`, ~line 197):

```ts
  /** Whether a space backfill runs a second pass to pull archived tasks (and
   *  their tracked time). Defaults to true; runtime-toggleable via Settings. */
  getIncludeArchived(): boolean {
    return this.cache.preferences.sync?.includeArchived ?? true;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/settings/settings.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings.service.ts src/settings/settings.service.spec.ts
git commit -m "feat(settings): add includeArchived sync preference (default on)"
```

---

### Task 4: Backfill wiring — pass `includeArchived` from settings

**Files:**
- Modify: `src/sync/backfill.service.ts:27-33` (the `getAllTasksBySpace` call)
- Test: `src/sync/backfill.service.spec.ts` (create)

**Interfaces:**
- Consumes: `getAllTasksBySpace(..., { includeArchived })` (Task 2); `SettingsService.getIncludeArchived()` (Task 3).
- Produces: no new public interface — behavior change only.

- [ ] **Step 1: Write the failing test**

Create `src/sync/backfill.service.spec.ts`:

```ts
import { BackfillService } from './backfill.service';

function makeService(getIncludeArchived: () => boolean) {
  const clickup = {
    getAllTasksBySpace: jest.fn().mockResolvedValue({ tasks: [], truncated: false }),
  };
  const tasks = {
    syncTasks: jest.fn().mockResolvedValue(0),
    syncMissingParents: jest.fn().mockResolvedValue(0),
    patchSpaceNames: jest.fn().mockResolvedValue(0),
  };
  const checkpoints = { markAttempt: jest.fn(), markSuccess: jest.fn() };
  const queues = { get: () => ({ add: jest.fn() }), defaultJobOptions: () => ({}) };
  const settings = { getTeamId: () => 'team1', getIncludeArchived };
  const service = new BackfillService(
    clickup as never,
    tasks as never,
    checkpoints as never,
    queues as never,
    settings as never,
  );
  return { service, clickup };
}

describe('BackfillService.backfillSpace', () => {
  it('passes includeArchived from settings into getAllTasksBySpace', async () => {
    const { service, clickup } = makeService(() => true);
    await service.backfillSpace('3577824', 30);
    expect(clickup.getAllTasksBySpace).toHaveBeenCalledWith(
      '3577824',
      expect.objectContaining({ includeArchived: true }),
    );
  });

  it('passes includeArchived=false when the setting is off', async () => {
    const { service, clickup } = makeService(() => false);
    await service.backfillSpace('3577824', 30);
    expect(clickup.getAllTasksBySpace).toHaveBeenCalledWith(
      '3577824',
      expect.objectContaining({ includeArchived: false }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/backfill.service.spec.ts`
Expected: FAIL — the `getAllTasksBySpace` call object has no `includeArchived` key.

- [ ] **Step 3: Wire the setting into the call**

In `src/sync/backfill.service.ts`, add the `includeArchived` line to the `getAllTasksBySpace` options:

```ts
    const { tasks: rawTasks, truncated } = await this.clickup.getAllTasksBySpace(spaceId, {
      teamId,
      dateUpdatedGt: subtractDays(days).getTime(),
      includeClosed: true,
      subtasks: true,
      includeArchived: this.settings.getIncludeArchived(),
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/backfill.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/backfill.service.ts src/sync/backfill.service.spec.ts
git commit -m "feat(sync): backfill pulls archived tasks per includeArchived setting"
```

---

### Task 5: Frontend — Settings → Sync "Include archived tasks" toggle

**Files:**
- Modify: `apps/web/src/api/settings.ts:8` (the `sync` preference type)
- Modify: `apps/web/src/pages/SettingsPage.tsx` (add a `SettingRow` after the "Backfill on connect" row, ~line 1032)

**Interfaces:**
- Consumes: `preferences.sync.includeArchived` from the backend (Task 3); the page's existing `prefs`, `patchPrefs`, `isOwner`, `updateSettings`, `SettingRow`, `Switch`.
- Produces: no new interface — UI only.

- [ ] **Step 1: Add the field to the frontend settings type**

In `apps/web/src/api/settings.ts` line 8, extend the `sync` type:

```ts
  sync: { reconcileLookbackDays: number; realtimeWebhooks: boolean; backfillOnConnect: boolean; maxBackfillLookbackDays: number; includeArchived: boolean };
```

- [ ] **Step 2: Add the toggle row**

In `apps/web/src/pages/SettingsPage.tsx`, immediately after the closing `/>` of the "Backfill on connect" `SettingRow` (the block ending around line 1032), insert:

```tsx
              <SettingRow
                label="Include archived tasks"
                desc="When on, space syncs also pull archived tasks (and their tracked time). Archived tasks count toward space totals."
                control={
                  <Switch
                    checked={prefs?.sync.includeArchived ?? true}
                    disabled={!isOwner || updateSettings.isPending}
                    onChange={(v) => patchPrefs({ sync: { includeArchived: v } })}
                  />
                }
              />
```

- [ ] **Step 3: Typecheck / build the web app**

Run: `npm --prefix apps/web install && npm --prefix apps/web run build`
Expected: build succeeds with no type errors. (If you see phantom `exceljs` errors, deps aren't installed — the `install` step fixes this.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/settings.ts apps/web/src/pages/SettingsPage.tsx
git commit -m "feat(web): add Include archived tasks toggle to Settings → Sync"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite**

Run: `npm run test`
Expected: all suites pass (including the new `clickup.client`, `settings.service`, `backfill.service` specs).

- [ ] **Step 2: Build the backend**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3 (optional, requires a real token): spot-check the ClickUp `archived` semantics**

With a valid `CLICKUP_API_TOKEN`, confirm `GET /team/{team_id}/task?archived=true&space_ids[]=<id>` returns archived tasks and that ids don't wholesale duplicate the `archived=false` result. The dedupe makes the code correct regardless, but this confirms the second pass actually surfaces archived rows. If it returns nothing, verify the space actually has archived tasks updated within the lookback window.

---

## Notes for the implementer

- **Order matters:** Task 4 depends on Tasks 2 and 3; Task 5 depends on Task 3. Do them in order.
- **No reports change:** archived tasks intentionally count in the Spaces rollup (`tasks-report.service.ts spaces()` is untouched). The task-list endpoint's existing `archived=exclude|include|only` filter still works for drill-in.
- **Memory:** the second pass is bounded by the same lookback window, but a large archived backlog adds in-memory tasks + time-entry jobs on the 2GB host. The Settings toggle is the escape hatch.
- **No retroactive pull:** archived tasks appear as spaces are synced (scheduled sweep or manual backfill) after deploy, not automatically on deploy.

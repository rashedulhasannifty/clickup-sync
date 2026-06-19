# Exclude Assignees From Costing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin mark specific assignees as "excluded from costing" so their tasks and time entries stay fully visible but never require a rate, never show as "missing rate", and cost $0 with a clear "Excluded" marker.

**Architecture:** A new cost status `COST_EXCLUDED` is produced in the single chokepoint `CostCalculatorService.calculate()`. The excluded-assignee list lives in `app_settings` preferences JSON (`cost.excludedAssignees`), read synchronously from `SettingsService`'s in-memory cache. Toggling the list enqueues a scoped `recalculate-costs` job per changed assignee. Status-based "missing rate" surfaces self-heal once entries are recalced; the two rate-existence surfaces (`missingRates()` SQL, `stats().missingRateEntries`) get explicit exclusion filtering, fed from the controller (which already injects `SettingsService`) so `ReportsService`'s constructor — and its many tests — stay unchanged.

**Tech Stack:** NestJS 11, Prisma 7 (Postgres), BullMQ, React 18 + TanStack Query, Vite.

**Spec:** `docs/superpowers/specs/2026-06-19-exclude-assignees-from-costing-design.md`

---

## File Structure

Backend:
- `src/settings/settings.service.ts` — add `excludedAssignees` to preferences type + default + `getExcludedAssigneeIds()` (modify)
- `src/time-entries/cost-calculator.service.ts` — `COST_EXCLUDED` branch (modify)
- `src/time-entries/cost-calculator.service.spec.ts` — branch tests + mock update (modify)
- `src/time-entries/cost-recalculation.service.ts` — count only `NO_RATE_FOUND` in the `noRate` log (modify, tiny)
- `src/reports/reports.service.ts` — `missingRates(excludedIds)`, `stats(excludedIds)`, new `timeEntriesAssignees()` (modify)
- `src/reports/reports.controller.ts` — pass excluded ids into `missingRates`/`stats`; add `GET /reports/time-entries/assignees` (modify)
- `src/admin/dto/update-excluded-assignees.dto.ts` — PUT body DTO (create)
- `src/admin/admin.controller.ts` — `GET` + `PUT /admin/excluded-assignees` (modify)

Frontend:
- `apps/web/src/api/settings.ts` — add `excludedAssignees` to the `cost` preferences type (modify)
- `apps/web/src/api/admin.ts` — `ExcludedAssignee` type + `adminApi.excludedAssignees.get/put` (modify)
- `apps/web/src/api/reports.ts` — `timeEntriesAssignees()` (modify)
- `apps/web/src/hooks/useReports.ts` — `useTimeEntriesAssignees()` (modify)
- `apps/web/src/hooks/useRates.ts` — `useExcludedAssignees()` + `useUpdateExcludedAssignees()` (modify)
- `apps/web/src/components/ExcludeAssigneeModal.tsx` — picker + confirm-warning modal (create)
- `apps/web/src/pages/AssigneeRatesPage.tsx` — "Excluded assignees" card (modify)
- `apps/web/src/pages/TimeEntriesPage.tsx` — status pill / filter option / cost column (modify)

---

## Task 1: Settings — store the excluded list

**Files:**
- Modify: `src/settings/settings.service.ts`
- Test: `src/settings/settings.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/extend `src/settings/settings.service.spec.ts`:

```ts
import { SettingsService } from './settings.service';

function makeService(prefs: any) {
  const repo = { get: jest.fn().mockResolvedValue({ preferences: prefs }), upsert: jest.fn() } as any;
  const crypto = { isEnabled: false, encrypt: (s: string) => s, decrypt: (s: string) => s } as any;
  return new SettingsService(repo, crypto);
}

describe('SettingsService.getExcludedAssigneeIds', () => {
  it('returns an empty set when no excluded assignees are configured', async () => {
    const svc = makeService({});
    await svc.refresh();
    expect(svc.getExcludedAssigneeIds().size).toBe(0);
  });

  it('returns a set of the configured excluded assignee ids', async () => {
    const svc = makeService({ cost: { excludedAssignees: [{ id: 'u1', name: 'A', email: null }, { id: 'u2', name: 'B', email: null }] } });
    await svc.refresh();
    const ids = svc.getExcludedAssigneeIds();
    expect(ids.has('u1')).toBe(true);
    expect(ids.has('u2')).toBe(true);
    expect(ids.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/settings/settings.service.spec.ts -t getExcludedAssigneeIds`
Expected: FAIL — `getExcludedAssigneeIds is not a function`.

- [ ] **Step 3: Implement**

In `src/settings/settings.service.ts`:

Add the field to the `cost` shape in `SettingsPreferences`:

```ts
  cost: { autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due'; nonBillableZero: boolean; excludedAssignees: { id: string; name: string | null; email: string | null }[] };
```

Add the default in `DEFAULT_PREFERENCES.cost`:

```ts
  cost: { autoRecalcOnRateChange: true, rateMatching: 'start', nonBillableZero: false, excludedAssignees: [] },
```

Add the getter near `getPreferences()`:

```ts
  /** Sync set of assignee ids excluded from costing. Read on the per-entry cost
   *  hot path, so it must stay synchronous (backed by the in-memory cache). */
  getExcludedAssigneeIds(): Set<string> {
    return new Set((this.cache.preferences.cost.excludedAssignees ?? []).map((a) => a.id));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/settings/settings.service.spec.ts -t getExcludedAssigneeIds`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings.service.ts src/settings/settings.service.spec.ts
git commit -m "feat(settings): store excluded-from-costing assignee list"
```

---

## Task 2: CostCalculator — produce COST_EXCLUDED

**Files:**
- Modify: `src/time-entries/cost-calculator.service.ts`
- Test: `src/time-entries/cost-calculator.service.spec.ts`

- [ ] **Step 1: Update the test mock + add failing tests**

In `src/time-entries/cost-calculator.service.spec.ts`, replace `makeSettings` so it also supplies the new getter (the service will call it):

```ts
function makeSettings(
  cost: Partial<{ autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due'; nonBillableZero: boolean }> = {},
  excludedIds: string[] = [],
) {
  return {
    getPreferences: () => ({ cost: { autoRecalcOnRateChange: true, rateMatching: 'start', nonBillableZero: false, excludedAssignees: [], ...cost } }),
    getExcludedAssigneeIds: () => new Set(excludedIds),
  } as any;
}
```

Add these tests at the end of the `describe` block:

```ts
  it('returns COST_EXCLUDED with zero cost when the assignee is excluded', async () => {
    const { prisma, findFirst } = makePrisma({ rateId: 7n, currency: 'USD', hourlyRateCents: 15000n });
    const svc = new CostCalculatorService(prisma, makeSettings({}, ['user-1']));

    const r = await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2);

    expect(r.status).toBe('COST_EXCLUDED');
    expect(r.costCents).toBe(0n);
    expect(r.rateId).toBeNull();
    expect(findFirst).not.toHaveBeenCalled(); // short-circuits before the rate lookup
  });

  it('exclusion wins over nonBillableZero and over an existing rate', async () => {
    const { prisma } = makePrisma({ rateId: 7n, currency: 'USD', hourlyRateCents: 15000n });
    const svc = new CostCalculatorService(prisma, makeSettings({ nonBillableZero: true }, ['user-1']));

    const r = await svc.calculate('user-1', new Date('2024-06-15T10:00:00.000Z'), 2, undefined, { billable: true });

    expect(r.status).toBe('COST_EXCLUDED');
    expect(r.costCents).toBe(0n);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/time-entries/cost-calculator.service.spec.ts -t COST_EXCLUDED`
Expected: FAIL — status is `COST_CALCULATED`, not `COST_EXCLUDED`.

- [ ] **Step 3: Implement**

In `src/time-entries/cost-calculator.service.ts`, inside `calculate()`, add the exclusion branch immediately after the `if (!userId || !startTime)` guard and **before** the `nonBillableZero` block:

```ts
    if (!userId || !startTime) return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND' };
    if (this.settings.getExcludedAssigneeIds().has(userId)) {
      return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'COST_EXCLUDED' };
    }
    const cost = this.settings.getPreferences().cost;
```

- [ ] **Step 4: Run the full spec to verify pass (and no regressions)**

Run: `npx jest src/time-entries/cost-calculator.service.spec.ts`
Expected: PASS (all existing tests still green — the updated `makeSettings` keeps the old call sites working since `excludedIds` defaults to `[]`).

- [ ] **Step 5: Commit**

```bash
git add src/time-entries/cost-calculator.service.ts src/time-entries/cost-calculator.service.spec.ts
git commit -m "feat(cost): emit COST_EXCLUDED for excluded assignees"
```

---

## Task 3: Recalc log accuracy (tiny)

**Files:**
- Modify: `src/time-entries/cost-recalculation.service.ts:61`

The recalc log counts `noRate` for any non-`COST_CALCULATED` status; with `COST_EXCLUDED` now common, narrow it to genuine misses so the log stays meaningful.

- [ ] **Step 1: Change the counter condition**

Replace line 61:

```ts
        if (cost.status !== 'COST_CALCULATED') noRate += 1;
```

with:

```ts
        if (cost.status === 'NO_RATE_FOUND') noRate += 1;
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/time-entries/cost-recalculation.service.ts
git commit -m "chore(cost): count only NO_RATE_FOUND in recalc noRate log"
```

---

## Task 4: Reports — exclude from `missingRates()` and `stats()`

**Files:**
- Modify: `src/reports/reports.service.ts` (`missingRates`, `stats`)
- Modify: `src/reports/reports.controller.ts`

Both methods gain an optional `excludedIds: string[] = []` parameter (default keeps existing `reports.service.spec.ts` `new ReportsService(prisma)` call sites and their `.stats()` / `.missingRates()` calls working unchanged). The controller, which already injects `SettingsService`, supplies the ids.

- [ ] **Step 1: Update `stats()`**

In `src/reports/reports.service.ts`, change the signature and the `missingRateEntries` count:

```ts
  async stats(excludedIds: string[] = []) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [failedJobsLast24h, deadLetterPending, webhooksLast24h, missingRateEntries] = await Promise.all([
      this.prisma.syncJobLog.count({ where: { status: 'failed', finishedAt: { gte: since24h } } }),
      this.prisma.deadLetterJob.count({ where: { retriedAt: null, resolvedAt: null } }),
      this.prisma.clickupWebhookEvent.count({ where: { receivedAt: { gte: since24h } } }),
      this.prisma.clickupTimeEntry.count({
        where: {
          status: { notIn: ['COST_CALCULATED', 'COST_EXCLUDED'] },
          ...(excludedIds.length ? { userId: { notIn: excludedIds } } : {}),
        },
      }),
    ]);
    return { failedJobsLast24h, deadLetterPending, webhooksLast24h, missingRateEntries };
  }
```

- [ ] **Step 2: Update `missingRates()`**

Change the signature to `async missingRates(excludedIds: string[] = []) {` and add the exclusion filter inside the `missing` CTE's `WHERE`, right after `WHERE e.user_id IS NOT NULL` and before the `AND NOT EXISTS (…)` clause:

```sql
        WHERE e.user_id IS NOT NULL
          AND e.user_id <> ALL(${Prisma.sql`array[${Prisma.join(excludedIds.length ? excludedIds : [''])}]::text[]`})
          AND NOT EXISTS (
```

Note: `<> ALL(array['']::text[])` is `true` for every real user id (the placeholder `''` never matches a ClickUp user id), so the empty-list case is safe and needs no branching. `Prisma.join` interpolates the ids as bound parameters.

- [ ] **Step 3: Update the controller to pass excluded ids**

In `src/reports/reports.controller.ts`:

```ts
  @Get('ops/stats')
  // ...existing decorators...
  stats() { return this.reports.stats([...this.settings.getExcludedAssigneeIds()]); }

  @Get('ops/missing-rates')
  @ApiOperation({ summary: 'Assignees with NO_RATE_FOUND time entries, grouped by user' })
  missingRates() { return this.reports.missingRates([...this.settings.getExcludedAssigneeIds()]); }
```

(If `ops/stats` is currently a one-liner `stats() { return this.reports.stats(); }`, replace it as above. `this.settings` is already injected — see constructor at `reports.controller.ts:11-15`.)

- [ ] **Step 4: Verify build + existing reports tests**

Run: `npm run build && npx jest test/reports.service.spec.ts`
Expected: build succeeds; all existing reports tests PASS (default `excludedIds = []` preserves behavior).

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts
git commit -m "feat(reports): drop excluded assignees from missing-rates and stats"
```

---

## Task 5: Reports — assignees-with-time-entries endpoint (picker source)

**Files:**
- Modify: `src/reports/reports.service.ts` (add `timeEntriesAssignees()`)
- Modify: `src/reports/reports.controller.ts` (add `GET /reports/time-entries/assignees`)

- [ ] **Step 1: Add the service method**

In `src/reports/reports.service.ts`, add:

```ts
  /** Distinct assignees that have at least one time entry. Feeds the
   *  "Exclude assignee" picker (all assignees with tracked time, so an admin
   *  can pre-emptively exclude someone who currently has a rate). */
  async timeEntriesAssignees() {
    type Row = { user_id: string; user_name: string | null; user_email: string | null };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT user_id,
             MAX(user_name)  AS user_name,
             MAX(user_email) AS user_email
      FROM clickup_time_entries
      WHERE user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY MAX(user_name) NULLS LAST
    `);
    return rows.map((r) => ({ id: r.user_id, name: r.user_name, email: r.user_email }));
  }
```

- [ ] **Step 2: Add the controller route**

In `src/reports/reports.controller.ts`, near the other `tasks/*` distinct routes:

```ts
  @Get('time-entries/assignees')
  @ApiOperation({ summary: 'Distinct assignees that have time entries. Feeds the exclude-from-costing picker.' })
  timeEntriesAssignees() { return this.reports.timeEntriesAssignees(); }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Smoke-test the route (optional, requires running deps)**

Run: `curl -s -H "x-admin-key: $ADMIN_API_KEY" http://127.0.0.1:3002/reports/time-entries/assignees | head`
Expected: JSON array of `{ id, name, email }`.

- [ ] **Step 5: Commit**

```bash
git add src/reports/reports.service.ts src/reports/reports.controller.ts
git commit -m "feat(reports): GET /reports/time-entries/assignees for exclude picker"
```

---

## Task 6: Admin — GET/PUT excluded-assignees endpoints

**Files:**
- Create: `src/admin/dto/update-excluded-assignees.dto.ts`
- Modify: `src/admin/admin.controller.ts`

- [ ] **Step 1: Create the DTO**

`src/admin/dto/update-excluded-assignees.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ExcludedAssigneeDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  email?: string | null;
}

export class UpdateExcludedAssigneesDto {
  @ApiProperty({ type: [ExcludedAssigneeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExcludedAssigneeDto)
  assignees!: ExcludedAssigneeDto[];
}
```

- [ ] **Step 2: Add the endpoints**

In `src/admin/admin.controller.ts`, import the DTO at the top:

```ts
import { UpdateExcludedAssigneesDto } from './dto/update-excluded-assignees.dto';
```

Add, in the rates section (after `deleteRate`, around line 513):

```ts
  // ── Excluded-from-costing assignees ────────────────────────────────────────

  @Get('excluded-assignees')
  @ApiOperation({ summary: 'List assignees excluded from costing' })
  listExcludedAssignees() {
    return { assignees: this.settings.getPreferences().cost.excludedAssignees };
  }

  @Put('excluded-assignees')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace the whole excluded-from-costing assignee list; recalcs changed assignees' })
  async updateExcludedAssignees(@Body() dto: UpdateExcludedAssigneesDto, @CurrentUser() user: AuthPrincipal) {
    const prev = new Set(this.settings.getPreferences().cost.excludedAssignees.map((a) => a.id));
    const next = dto.assignees.map((a) => ({ id: a.id, name: a.name ?? null, email: a.email ?? null }));
    const nextIds = new Set(next.map((a) => a.id));

    await this.settings.update({ preferences: { cost: { excludedAssignees: next } } }, actorLabel(user));

    // Recalc anyone whose excluded-ness changed: added (now COST_EXCLUDED) and
    // removed (back to rate-based costing / NO_RATE_FOUND).
    const changed = new Set<string>();
    for (const id of nextIds) if (!prev.has(id)) changed.add(id);
    for (const id of prev) if (!nextIds.has(id)) changed.add(id);
    for (const id of changed) {
      this.queues.get(QUEUES.MAINTENANCE).add(JOBS.RECALCULATE_COSTS, { assigneeId: id }, this.queues.defaultJobOptions());
    }

    return { assignees: next, recalculated: [...changed] };
  }
```

Add `Put` to the `@nestjs/common` import on line 1 (it currently imports `Patch`, `Post`, etc. but not `Put`):

```ts
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Logger, NotFoundException, Param, Patch, Post, Put, Query, UseInterceptors } from '@nestjs/common';
```

Note: `SettingsService.update`'s `deepMergePrefs` replaces arrays wholesale, so passing the full `excludedAssignees` array replaces the stored one (no element-merge surprises). The `AuditLogInterceptor` on `AdminController` records this write automatically.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Smoke-test (optional, requires running deps)**

```bash
curl -s -X PUT -H "x-admin-key: $ADMIN_API_KEY" -H 'content-type: application/json' \
  -d '{"assignees":[{"id":"123","name":"Test","email":null}]}' \
  http://127.0.0.1:3002/admin/excluded-assignees
curl -s -H "x-admin-key: $ADMIN_API_KEY" http://127.0.0.1:3002/admin/excluded-assignees
```
Expected: PUT returns `{ assignees: [...], recalculated: ["123"] }`; GET returns the stored list.

- [ ] **Step 5: Commit**

```bash
git add src/admin/dto/update-excluded-assignees.dto.ts src/admin/admin.controller.ts
git commit -m "feat(admin): GET/PUT excluded-from-costing assignees with scoped recalc"
```

---

## Task 7: Frontend API + hooks

**Files:**
- Modify: `apps/web/src/api/settings.ts`
- Modify: `apps/web/src/api/admin.ts`
- Modify: `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/hooks/useReports.ts`
- Modify: `apps/web/src/hooks/useRates.ts`

- [ ] **Step 1: Extend the settings preferences type**

In `apps/web/src/api/settings.ts`, update the `cost` line in `SettingsPreferences`:

```ts
  cost: { autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due'; nonBillableZero: boolean; excludedAssignees: { id: string; name: string | null; email: string | null }[] };
```

- [ ] **Step 2: Add admin API methods**

In `apps/web/src/api/admin.ts`, add the type and methods:

```ts
export type ExcludedAssignee = { id: string; name: string | null; email: string | null };
```

Add to the `adminApi` object:

```ts
  excludedAssignees: {
    get: (): Promise<ExcludedAssignee[]> =>
      apiClient.get('/admin/excluded-assignees').then((r) => (Array.isArray(r.data?.assignees) ? r.data.assignees : [])),
    put: (assignees: ExcludedAssignee[]) =>
      apiClient.put('/admin/excluded-assignees', { assignees }).then((r) => r.data as { assignees: ExcludedAssignee[]; recalculated: string[] }),
  },
```

- [ ] **Step 3: Add reports API + hook for the picker source**

In `apps/web/src/api/reports.ts`, add to `reportsApi`:

```ts
  timeEntriesAssignees: () => apiClient.get('/reports/time-entries/assignees').then(r => r.data),
```

In `apps/web/src/hooks/useReports.ts`, add:

```ts
export interface TimeEntryAssignee { id: string; name: string | null; email: string | null; }

export function useTimeEntriesAssignees() {
  return useQuery<TimeEntryAssignee[]>({
    queryKey: ['time-entries-assignees'],
    queryFn: reportsApi.timeEntriesAssignees,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 4: Add the excluded-assignees hooks**

In `apps/web/src/hooks/useRates.ts`, import and add:

```ts
import type { ExcludedAssignee } from '../api/admin';

export function useExcludedAssignees() {
  return useQuery<ExcludedAssignee[]>({ queryKey: ['excluded-assignees'], queryFn: adminApi.excludedAssignees.get });
}

export function useUpdateExcludedAssignees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignees: ExcludedAssignee[]) => adminApi.excludedAssignees.put(assignees),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['excluded-assignees'] });
      qc.invalidateQueries({ queryKey: ['rates'] });
      qc.invalidateQueries({ queryKey: ['missing-rates'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['time-entries-list'] });
      qc.invalidateQueries({ queryKey: ['time-entries-aggregates'] });
    },
  });
}
```

- [ ] **Step 5: Verify the web app type-checks/builds**

Run: `npm run build --prefix apps/web` (or the repo's web build script — check `apps/web/package.json`; commonly `cd apps/web && npm run build`).
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/settings.ts apps/web/src/api/admin.ts apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts apps/web/src/hooks/useRates.ts
git commit -m "feat(web): API + hooks for excluded-from-costing assignees"
```

---

## Task 8: Frontend — ExcludeAssigneeModal (picker + warning)

**Files:**
- Create: `apps/web/src/components/ExcludeAssigneeModal.tsx`

This modal does both jobs: pick an assignee from those with time entries, then show the warning and confirm. It calls back to the parent with the chosen assignee on confirm.

- [ ] **Step 1: Create the component**

`apps/web/src/components/ExcludeAssigneeModal.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { ClickupAvatar } from './ui/ClickupAvatar';
import { useTimeEntriesAssignees } from '../hooks/useReports';
import type { ExcludedAssignee } from '../api/admin';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Already-excluded ids, hidden from the picker. */
  excludedIds: Set<string>;
  /** Called with the assignee to add once the admin confirms the warning. */
  onConfirm: (assignee: ExcludedAssignee) => void;
  saving?: boolean;
}

export function ExcludeAssigneeModal({ open, onClose, excludedIds, onConfirm, saving }: Props) {
  const { data: assignees, isLoading } = useTimeEntriesAssignees();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ExcludedAssignee | null>(null);

  const candidates = useMemo(() => {
    const list = (assignees ?? []).filter((a) => !excludedIds.has(a.id));
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((a) => (a.name ?? '').toLowerCase().includes(q) || (a.email ?? '').toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
  }, [assignees, excludedIds, search]);

  function close() {
    setSearch('');
    setSelected(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Exclude assignee from costing"
      subtitle={selected ? undefined : 'Pick an assignee. Their tasks and time entries stay visible — only costing changes.'}
      footer={
        selected ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={saving}>Back</Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              <Button variant="accent" loading={saving} onClick={() => onConfirm(selected)}>Exclude assignee</Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {selected ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ClickupAvatar userId={selected.id} email={selected.email} name={selected.name ?? selected.id} size={36} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{selected.name ?? selected.id}</div>
              {selected.email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.email}</div>}
            </div>
          </div>
          <Callout tone="amber" icon={<AlertTriangle size={14} />}>
            <strong>{selected.name ?? selected.id}</strong> will be excluded from costing. Their existing and future time
            entries will be set to <strong>$0 (Excluded)</strong>, they will no longer appear as missing a rate, and any
            active rate they have will be <strong>ignored while excluded</strong>. Their hours still count toward totals.
            You can undo this any time by removing them from the excluded list.
          </Callout>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input icon={<Search size={14} />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assignee…" aria-label="Search assignees" />
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {isLoading ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>Loading…</div>
            ) : candidates.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>No assignees to exclude.</div>
            ) : (
              candidates.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelected(a)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: 0, background: 'transparent', borderRadius: 8, cursor: 'pointer', textAlign: 'left', width: '100%' }}
                >
                  <ClickupAvatar userId={a.id} email={a.email} name={a.name ?? a.id} size={28} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.name ?? a.id}</div>
                    {a.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.email}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
```

> `Callout` takes `{ tone, icon, children }` (verified in `apps/web/src/components/ui/Callout.tsx`); `tone="amber"` is valid.

- [ ] **Step 2: Verify the web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ExcludeAssigneeModal.tsx
git commit -m "feat(web): exclude-assignee picker + confirmation warning modal"
```

---

## Task 9: Frontend — "Excluded assignees" card on Assignee Rates page

**Files:**
- Modify: `apps/web/src/pages/AssigneeRatesPage.tsx`

- [ ] **Step 1: Wire hooks + modal state**

Near the other hooks at the top of `AssigneeRatesPage()`:

```ts
  const excludedQuery = useExcludedAssignees();
  const updateExcluded = useUpdateExcludedAssignees();
  const [excludeModalOpen, setExcludeModalOpen] = useState(false);
  const excluded = excludedQuery.data ?? [];
  const excludedIds = useMemo(() => new Set(excluded.map((a) => a.id)), [excluded]);

  function addExclusion(a: { id: string; name: string | null; email: string | null }) {
    updateExcluded.mutate([...excluded, a], {
      onSuccess: () => {
        toast.success(`${a.name ?? a.id} excluded — recalculation queued, costs update shortly.`);
        setExcludeModalOpen(false);
      },
      onError: (err) => toast.error(`Could not exclude assignee: ${(err as Error).message}`),
    });
  }

  function removeExclusion(id: string) {
    const a = excluded.find((x) => x.id === id);
    updateExcluded.mutate(excluded.filter((x) => x.id !== id), {
      onSuccess: () => toast.success(`${a?.name ?? id} re-included — recalculation queued.`),
      onError: (err) => toast.error(`Could not update: ${(err as Error).message}`),
    });
  }
```

Add the imports at the top of the file:

```ts
import { useExcludedAssignees, useUpdateExcludedAssignees } from '../hooks/useRates';
import { ExcludeAssigneeModal } from '../components/ExcludeAssigneeModal';
import { UserMinus } from 'lucide-react';
```

(`useMemo`, `useState`, `Card`, `Button`, `ClickupAvatar`, `Pill`, `EmptyState` are already imported.)

- [ ] **Step 2: Render the card**

Insert this card just above the existing filter bar (the `<div>` containing the search `Input`, around line 262), so it sits between the metric cards and the rates list:

```tsx
      <Card padding={0}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: excluded.length ? '1px solid var(--border-soft)' : undefined }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Excluded from costing</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              These assignees need no rate. Their tasks and time entries stay visible; cost is $0 and marked “Excluded”.
            </div>
          </div>
          {isAdmin && (
            <Button size="sm" variant="default" icon={<UserMinus size={12} />} onClick={() => setExcludeModalOpen(true)}>
              Exclude assignee
            </Button>
          )}
        </div>
        {excluded.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {excluded.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--border-soft)' }}>
                <ClickupAvatar userId={a.id} email={a.email} name={a.name ?? a.id} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.name ?? a.id}</div>
                  {a.email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.email}</div>}
                </div>
                <Pill tone="gray" size="xs">excluded</Pill>
                {isAdmin && (
                  <Button size="sm" variant="ghost" loading={updateExcluded.isPending} onClick={() => removeExclusion(a.id)}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
```

- [ ] **Step 3: Render the modal**

Next to the existing `<RateModal … />` near the end of the JSX:

```tsx
      <ExcludeAssigneeModal
        open={excludeModalOpen}
        onClose={() => setExcludeModalOpen(false)}
        excludedIds={excludedIds}
        onConfirm={addExclusion}
        saving={updateExcluded.isPending}
      />
```

- [ ] **Step 4: Verify the web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual check (optional, requires running app)**

Start the app, open Assignee Rates, click "Exclude assignee", pick someone, read the warning, confirm. The assignee appears in the card with an "excluded" pill; a toast confirms recalc queued.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/AssigneeRatesPage.tsx
git commit -m "feat(web): Excluded-from-costing card on Assignee Rates page"
```

---

## Task 10: Frontend — Time Entries page shows "Excluded"

**Files:**
- Modify: `apps/web/src/pages/TimeEntriesPage.tsx`

- [ ] **Step 1: Add the status filter option**

In the `STATUS_OPTIONS` array (around line 38-40), add a third option:

```ts
  { value: '', label: 'Any status' },
  { value: 'COST_CALCULATED', label: 'Cost calculated' },
  { value: 'NO_RATE_FOUND', label: 'No rate found' },
  { value: 'COST_EXCLUDED', label: 'Excluded' },
```

- [ ] **Step 2: Fix the status pill (currently binary)**

Replace the status column `render` (around line 467-471) so `COST_EXCLUDED` is its own grey pill instead of falling through to "no rate found":

```tsx
      render: (row) =>
        row.status === 'COST_CALCULATED'
          ? <Pill tone="green" size="xs" icon={<CircleCheck size={10} strokeWidth={2} />}>cost calculated</Pill>
          : row.status === 'COST_EXCLUDED'
            ? <Pill tone="gray" size="xs">excluded</Pill>
            : <Pill tone="amber" size="xs" icon={<AlertTriangle size={10} strokeWidth={2} />}>no rate found</Pill>,
```

- [ ] **Step 3: Mark the cost column "Excluded"**

Replace the `costAud` column `render` (around line 454-461) so excluded rows read "Excluded" rather than "—":

```tsx
      render: (row) => {
        const cur = row.currency ?? 'USD';
        if (row.status === 'COST_EXCLUDED') {
          return <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Excluded</span>;
        }
        return row.costAud > 0 ? (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt.money(row.costAud * 100, cur)}</span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>—</span>
        );
      },
```

> Confirm the row type exposes `status` (it is used at line 468 already, so it does).

- [ ] **Step 4: Verify the web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/TimeEntriesPage.tsx
git commit -m "feat(web): render COST_EXCLUDED on the Time Entries page"
```

---

## Task 11: Full verification

- [ ] **Step 1: Backend tests**

Run: `npm run test`
Expected: PASS (note: `npm run lint` is known-broken project-wide — do not block on it; rely on build + test).

- [ ] **Step 2: Backend build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: End-to-end smoke (requires `npm run dev:deps` + `npm run start:dev`)**

1. Exclude an assignee who currently shows on Missing Rates.
2. Confirm the warning dialog appears and names them.
3. After recalc, confirm they drop off Missing Rates and the "Without rate" badge.
4. On Time Entries (filter status = Excluded), confirm their entries show the grey "excluded" pill and "Excluded" cost.
5. Remove the exclusion; after recalc they return to NO_RATE_FOUND (or costed, if they have a rate).

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "test: verify exclude-from-costing end to end"
```

---

## Self-review notes

- **Spec coverage:** storage (Task 1), `COST_EXCLUDED` chokepoint (Task 2), recalc-on-toggle (Task 6), `missingRates()` empty-safe `<> ALL` filter (Task 4), `stats().missingRateEntries` `notIn` + userId filter (Task 4), picker endpoint = all assignees with time entries (Task 5), PUT-whole-list admin API (Task 6), confirmation warning before exclude (Task 8), Excluded card (Task 9), Time Entries pill/filter/cost (Task 10), cost-calculator branch test (Task 2). All present.
- **`ReportsService` constructor untouched** — excluded ids are passed as method params from the controller, so the existing `new ReportsService(prisma)` test call sites keep working (avoids a wide test rewrite).
- **Type consistency:** `ExcludedAssignee = { id, name, email }` is used identically across `api/admin.ts`, hooks, the modal, the card, and the backend DTO/preferences shape.
- **Empty-list safety:** SQL uses `<> ALL(array[…'']…)`; Prisma `userId.notIn` clause is only added when `excludedIds.length`.

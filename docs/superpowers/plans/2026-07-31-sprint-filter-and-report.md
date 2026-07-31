# Sprint Filter & Sprint Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted sprint/list catalog, a folder-scoped Active/Completed/All sprint filter on Tasks & Time Entries, and a `/sprints` analytics page (per-sprint completion, hours, cost, cycle time, plus a folder velocity trend).

**Architecture:** A new `clickup_lists` table is the authoritative sprint catalog, populated from ClickUp's folder/list endpoints during backfills and a new daily scheduled catalog sync, plus opportunistic minimal upserts from live task webhooks. New `/reports/sprints*` endpoints aggregate tasks and time entries by `list_id`; the React app gains a `SprintPicker` and a `/sprints` page. Sprint == ClickUp list; `archived` (list or folder archived) == completed sprint.

**Tech Stack:** NestJS 11, Prisma 7 (`$queryRaw` for report SQL), PostgreSQL, BullMQ; React 19 + Vite, TanStack Query v5, custom SVG charts, Tailwind v4.

## Global Constraints

- Node `>=22`, NestJS 11, Prisma `7.8.0` — do not change dependency versions.
- Sprint identity is `list_id`. The `sprint_name` / `sprint_points` custom fields are dead and MUST NOT be used for any sprint metric.
- "Completed / archived sprint" == `clickup_lists.archived == true` (list OR its folder archived), sourced from the existing `getSpaceLists` `archivedContainer` OR-accumulation. Never inferred from task done-ratio.
- All sprint metrics are task-count and hours/cost based. No story points, no daily burndown snapshots.
- Repository unit tests mock Prisma with `jest.fn()` and assert call args/mapping. Report-service tests mock `$queryRaw` and assert both the returned mapping and key SQL text fragments (see `test/cost-trend-report.service.spec.ts`, `test/budgets.repository.spec.ts`).
- Money is stored in `_cents` (BigInt) and mapped to a dollar Number in report output; the field name convention in existing report output is `*Aud` even though values are USD (see `currency-aud-usd-debt`). Follow the existing naming in files you touch.
- No `Co-Authored-By: Claude` trailer on commits (project convention).
- Migrations are hand-numbered `00NN_name`; the next is `0015_clickup_lists`.
- Timezone for date bucketing in SQL is `Asia/Dhaka` (see cost-trend service), not Australia/Sydney.

## File Structure

**Backend — create:**
- `src/lists/lists.repository.ts` — `ListsRepository`: catalog upserts + finders.
- `src/lists/list-catalog.service.ts` — `ListCatalogService.syncSpace(spaceId)`.
- `src/lists/lists.module.ts` — provides/exports both; imports `ClickupModule`, `DatabaseModule`.
- `src/reports/sprints-report.service.ts` — `SprintsReportService`: `sprints`, `sprintFolders`, `sprintDetail`, `velocity`.
- `src/workers/list-catalog.processor.ts` — `ListCatalogProcessor` for `SYNC_LIST_CATALOG`.
- Tests: `test/lists.repository.spec.ts`, `test/list-catalog.service.spec.ts`, `test/sprints-report.service.spec.ts`, `test/clickup-list-catalog.spec.ts`, `test/list-catalog.processor.spec.ts`.

**Backend — modify:**
- `prisma/schema.prisma` — add `ClickupList` model.
- `prisma/migrations/0015_clickup_lists/migration.sql` — new migration.
- `src/clickup/clickup.client.ts` — add `getSpaceListCatalog`, refactor `getSpaceLists` to derive from it.
- `src/tasks/tasks.service.ts` + `src/tasks/tasks.module.ts` — opportunistic list upsert.
- `src/sync/backfill.service.ts` + `src/sync/sync.scheduler.ts` + `src/sync/sync.module.ts` — catalog sync on backfill + daily cron.
- `src/queues/queue.constants.ts` — add `SYNC_LIST_CATALOG` job name.
- `src/workers/workers.module.ts` — register `ListCatalogProcessor`.
- `src/admin/admin-sync.controller.ts` — `POST /admin/lists/sync` manual trigger.
- `src/reports/reports.controller.ts` + `src/reports/reports.module.ts` — sprint routes + `sprintStatus` filter on tasks/time-entries lists.
- `src/reports/tasks-report.service.ts` + `src/reports/time-entries-report.service.ts` — join `clickup_lists` for `sprintStatus`.

**Frontend — (detailed in Tasks 8–11, finalized against current conventions).**

---

### Task 1: `clickup_lists` schema, migration & `ListsRepository`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0015_clickup_lists/migration.sql`
- Create: `src/lists/lists.repository.ts`
- Test: `test/lists.repository.spec.ts`

**Interfaces:**
- Produces: `ListsRepository` with
  - `upsertMany(rows: ListCatalogRow[]): Promise<number>` — authoritative upsert by `list_id` (writes archived + dates).
  - `upsertMinimalFromTasks(tasks: Array<{ listId: string|null; listName: string|null; folderId: string|null; folderName: string|null; spaceId: string|null; spaceName: string|null }>): Promise<number>` — opportunistic; updates only name/folder/space, never archived/dates.
  - `type ListCatalogRow = { listId: string; name: string; folderId: string|null; folderName: string|null; spaceId: string|null; spaceName: string|null; archived: boolean; startDate: Date|null; dueDate: Date|null }`

- [ ] **Step 1: Add the Prisma model**

In `prisma/schema.prisma` add:

```prisma
model ClickupList {
  listId     String    @id @map("list_id")
  name       String
  folderId   String?   @map("folder_id")
  folderName String?   @map("folder_name")
  spaceId    String?   @map("space_id")
  spaceName  String?   @map("space_name")
  archived   Boolean   @default(false)
  startDate  DateTime? @map("start_date")
  dueDate    DateTime? @map("due_date")
  syncedAt   DateTime  @default(now()) @map("synced_at")

  @@index([folderId])
  @@index([spaceId])
  @@index([archived])
  @@map("clickup_lists")
}
```

- [ ] **Step 2: Create the migration & generate the client**

Run: `npm run prisma:migrate -- --name clickup_lists`
Then rename the generated migration folder to `0015_clickup_lists` to match the repo's hand-numbered convention, and review `migration.sql` — it must be a single `CREATE TABLE "clickup_lists"` with the three indexes, no changes to other tables. Then run `npm run prisma:generate`.
Expected: `ClickupList` available on `PrismaService`.

- [ ] **Step 3: Write the failing repository test**

```ts
// test/lists.repository.spec.ts
import { ListsRepository } from '../src/lists/lists.repository';

function makePrisma() {
  return {
    clickupList: { upsert: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;
}

describe('ListsRepository', () => {
  it('upsertMany writes archived + dates keyed by list_id', async () => {
    const prisma = makePrisma();
    const repo = new ListsRepository(prisma);
    await repo.upsertMany([{ listId: 'l1', name: 'Sprint 1', folderId: 'f1', folderName: 'X Sprint', spaceId: 's1', spaceName: 'X', archived: true, startDate: new Date('2026-07-01'), dueDate: new Date('2026-07-07') }]);
    expect(prisma.clickupList.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { listId: 'l1' },
      create: expect.objectContaining({ listId: 'l1', archived: true }),
      update: expect.objectContaining({ archived: true, name: 'Sprint 1' }),
    }));
  });

  it('upsertMinimalFromTasks dedupes by listId and never sets archived/dates', async () => {
    const prisma = makePrisma();
    const repo = new ListsRepository(prisma);
    await repo.upsertMinimalFromTasks([
      { listId: 'l1', listName: 'Sprint 1', folderId: 'f1', folderName: 'X', spaceId: 's1', spaceName: 'X' },
      { listId: 'l1', listName: 'Sprint 1', folderId: 'f1', folderName: 'X', spaceId: 's1', spaceName: 'X' },
      { listId: null, listName: null, folderId: null, folderName: null, spaceId: null, spaceName: null },
    ]);
    expect(prisma.clickupList.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.clickupList.upsert.mock.calls[0][0];
    expect(arg.update).not.toHaveProperty('archived');
    expect(arg.update).not.toHaveProperty('startDate');
  });
});
```

- [ ] **Step 4: Run it — verify it fails**

Run: `npm test -- lists.repository`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement the repository**

```ts
// src/lists/lists.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type ListCatalogRow = {
  listId: string; name: string;
  folderId: string | null; folderName: string | null;
  spaceId: string | null; spaceName: string | null;
  archived: boolean; startDate: Date | null; dueDate: Date | null;
};

type MinimalTaskList = {
  listId: string | null; listName: string | null;
  folderId: string | null; folderName: string | null;
  spaceId: string | null; spaceName: string | null;
};

@Injectable()
export class ListsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMany(rows: ListCatalogRow[]): Promise<number> {
    if (!rows.length) return 0;
    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.clickupList.upsert({
          where: { listId: r.listId },
          create: { ...r, syncedAt: new Date() },
          update: { ...r, syncedAt: new Date() },
        }),
      ),
    );
    return rows.length;
  }

  async upsertMinimalFromTasks(tasks: MinimalTaskList[]): Promise<number> {
    const byId = new Map<string, MinimalTaskList>();
    for (const t of tasks) if (t.listId) byId.set(t.listId, t);
    if (!byId.size) return 0;
    await this.prisma.$transaction(
      [...byId.values()].map((t) => {
        const fields = {
          name: t.listName ?? 'Unknown List',
          folderId: t.folderId, folderName: t.folderName,
          spaceId: t.spaceId, spaceName: t.spaceName,
        };
        return this.prisma.clickupList.upsert({
          where: { listId: t.listId! },
          create: { listId: t.listId!, ...fields },
          update: fields, // deliberately omits archived/startDate/dueDate
        });
      }),
    );
    return byId.size;
  }
}
```

- [ ] **Step 6: Run tests — verify pass**

Run: `npm test -- lists.repository`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0015_clickup_lists src/lists/lists.repository.ts test/lists.repository.spec.ts
git commit -m "feat(lists): add clickup_lists catalog table and repository"
```

---

### Task 2: ClickUp client — `getSpaceListCatalog`

**Files:**
- Modify: `src/clickup/clickup.client.ts:154-194` (`getSpaceLists`)
- Test: `test/clickup-list-catalog.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ClickupClient.getSpaceListCatalog(spaceId: string): Promise<ListCatalogEntry[]>` where
  `type ListCatalogEntry = { id: string; name: string; folderId: string|null; folderName: string|null; spaceId: string|null; spaceName: string|null; archived: boolean; startDate: Date|null; dueDate: Date|null }`.
  `getSpaceLists` keeps returning `Array<{ id, archivedContainer }>` by mapping `{ id: e.id, archivedContainer: e.archived }` — no behavior change for `streamAllTasksBySpace`.

- [ ] **Step 1: Write the failing test**

```ts
// test/clickup-list-catalog.spec.ts
import { ClickupClient } from '../src/clickup/clickup.client';

function clientWith(responses: Record<string, any>) {
  const c = new ClickupClient({ getToken: () => 't' } as any, { get: () => undefined } as any);
  (c as any).request = jest.fn((_m: string, path: string) => Promise.resolve(responses[path] ?? {}));
  return c;
}

describe('getSpaceListCatalog', () => {
  it('projects name/folder/space/dates and OR-accumulates archived across states', async () => {
    const c = clientWith({
      '/space/s1/list?archived=false': { lists: [{ id: 'lf', name: 'Folderless', start_date: '1751328000000', due_date: null, space: { id: 's1', name: 'X' } }] },
      '/space/s1/list?archived=true': { lists: [] },
      '/space/s1/folder?archived=false': { folders: [{ id: 'f1' }] },
      '/space/s1/folder?archived=true': { folders: [] },
      '/folder/f1/list?archived=false': { lists: [{ id: 'l1', name: 'Sprint 1', folder: { id: 'f1', name: 'X Sprint' }, space: { id: 's1', name: 'X' } }] },
      '/folder/f1/list?archived=true': { lists: [{ id: 'l1', name: 'Sprint 1', folder: { id: 'f1', name: 'X Sprint' }, space: { id: 's1', name: 'X' } }] },
    });
    const cat = await c.getSpaceListCatalog('s1');
    const l1 = cat.find((e) => e.id === 'l1')!;
    expect(l1.archived).toBe(true);          // seen in archived=true folder-list scan
    expect(l1.folderName).toBe('X Sprint');
    const lf = cat.find((e) => e.id === 'lf')!;
    expect(lf.archived).toBe(false);
    expect(lf.startDate).toEqual(new Date(1751328000000));
    expect(lf.dueDate).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- clickup-list-catalog`
Expected: FAIL (`getSpaceListCatalog` is not a function). Adjust the `clientWith` constructor args in Step 1 to match `ClickupClient`'s actual constructor signature before running (inspect the top of `clickup.client.ts`); the test asserts behavior, not construction.

- [ ] **Step 3: Implement**

Replace the body of `getSpaceLists` (lines ~154-194) with a thin wrapper over a new `getSpaceListCatalog`, preserving the enumeration order (folderless active+archived, then folders active+archived, per-folder lists both states, OR-accumulated archived):

```ts
export type ListCatalogEntry = {
  id: string; name: string;
  folderId: string | null; folderName: string | null;
  spaceId: string | null; spaceName: string | null;
  archived: boolean; startDate: Date | null; dueDate: Date | null;
};

async getSpaceListCatalog(spaceId: string): Promise<ListCatalogEntry[]> {
  const byId = new Map<string, ListCatalogEntry>();
  const toMillis = (v: unknown): Date | null => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) && n > 0 ? new Date(n) : null;
  };
  type RawList = { id?: string; name?: string; start_date?: unknown; due_date?: unknown; folder?: { id?: string; name?: string }; space?: { id?: string; name?: string } };
  const add = (l: RawList, archivedContainer: boolean, folderId: string | null, folderName: string | null) => {
    if (!l.id) return;
    const prev = byId.get(l.id);
    const entry: ListCatalogEntry = {
      id: l.id,
      name: l.name ?? prev?.name ?? 'Unknown List',
      folderId: folderId ?? l.folder?.id ?? prev?.folderId ?? null,
      folderName: folderName ?? l.folder?.name ?? prev?.folderName ?? null,
      spaceId: l.space?.id ?? prev?.spaceId ?? spaceId,
      spaceName: l.space?.name ?? prev?.spaceName ?? null,
      archived: (prev?.archived ?? false) || archivedContainer,
      startDate: toMillis(l.start_date) ?? prev?.startDate ?? null,
      dueDate: toMillis(l.due_date) ?? prev?.dueDate ?? null,
    };
    byId.set(l.id, entry);
  };

  for (const archived of [false, true]) {
    const res = await this.request<{ lists?: RawList[] }>('GET', `/space/${spaceId}/list?archived=${archived}`);
    for (const l of res.lists ?? []) add(l, archived, l.folder?.id ?? null, l.folder?.name ?? null);
  }
  const folders: Array<{ id: string; name: string | null; archived: boolean }> = [];
  for (const archived of [false, true]) {
    const res = await this.request<{ folders?: Array<{ id?: string; name?: string }> }>('GET', `/space/${spaceId}/folder?archived=${archived}`);
    for (const f of res.folders ?? []) if (f.id) folders.push({ id: f.id, name: f.name ?? null, archived });
  }
  for (const folder of folders) {
    for (const listArchived of [false, true]) {
      const res = await this.request<{ lists?: RawList[] }>('GET', `/folder/${folder.id}/list?archived=${listArchived}`);
      for (const l of res.lists ?? []) add(l, folder.archived || listArchived, folder.id, folder.name);
    }
  }
  return [...byId.values()];
}

private async getSpaceLists(spaceId: string): Promise<Array<{ id: string; archivedContainer: boolean }>> {
  const cat = await this.getSpaceListCatalog(spaceId);
  return cat.map((e) => ({ id: e.id, archivedContainer: e.archived }));
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test -- clickup-list-catalog` then `npm test -- clickup` (ensure no regression in existing client/archived-sync tests).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/clickup/clickup.client.ts test/clickup-list-catalog.spec.ts
git commit -m "feat(clickup): getSpaceListCatalog captures list name/folder/dates/archived"
```

---

### Task 3: `ListCatalogService` + `ListsModule`

**Files:**
- Create: `src/lists/list-catalog.service.ts`
- Create: `src/lists/lists.module.ts`
- Test: `test/list-catalog.service.spec.ts`

**Interfaces:**
- Consumes: `ClickupClient.getSpaceListCatalog` (Task 2), `ListsRepository.upsertMany` (Task 1).
- Produces: `ListCatalogService.syncSpace(spaceId: string): Promise<{ synced: number }>`. `ListsModule` exports `ListsRepository` and `ListCatalogService`; imports `ClickupModule` and `DatabaseModule`.

- [ ] **Step 1: Write the failing test**

```ts
// test/list-catalog.service.spec.ts
import { ListCatalogService } from '../src/lists/list-catalog.service';

describe('ListCatalogService', () => {
  it('maps catalog entries to repo rows and upserts them', async () => {
    const clickup = { getSpaceListCatalog: jest.fn().mockResolvedValue([
      { id: 'l1', name: 'Sprint 1', folderId: 'f1', folderName: 'X Sprint', spaceId: 's1', spaceName: 'X', archived: true, startDate: new Date('2026-07-01'), dueDate: null },
    ]) } as any;
    const repo = { upsertMany: jest.fn().mockResolvedValue(1) } as any;
    const svc = new ListCatalogService(clickup, repo);
    const res = await svc.syncSpace('s1');
    expect(clickup.getSpaceListCatalog).toHaveBeenCalledWith('s1');
    expect(repo.upsertMany).toHaveBeenCalledWith([expect.objectContaining({ listId: 'l1', archived: true })]);
    expect(res).toEqual({ synced: 1 });
  });
});
```

- [ ] **Step 2: Run — verify fails**

Run: `npm test -- list-catalog.service`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement service + module**

```ts
// src/lists/list-catalog.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { ListsRepository } from './lists.repository';

@Injectable()
export class ListCatalogService {
  private readonly logger = new Logger(ListCatalogService.name);
  constructor(private readonly clickup: ClickupClient, private readonly repo: ListsRepository) {}

  async syncSpace(spaceId: string): Promise<{ synced: number }> {
    const cat = await this.clickup.getSpaceListCatalog(spaceId);
    const rows = cat.map((e) => ({
      listId: e.id, name: e.name,
      folderId: e.folderId, folderName: e.folderName,
      spaceId: e.spaceId, spaceName: e.spaceName,
      archived: e.archived, startDate: e.startDate, dueDate: e.dueDate,
    }));
    const synced = await this.repo.upsertMany(rows);
    this.logger.log(`Synced ${synced} list(s) into catalog for space ${spaceId}`);
    return { synced };
  }
}
```

```ts
// src/lists/lists.module.ts
import { Module } from '@nestjs/common';
import { ListsRepository } from './lists.repository';
import { ListCatalogService } from './list-catalog.service';
import { ClickupModule } from '../clickup/clickup.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [ClickupModule, DatabaseModule],
  providers: [ListsRepository, ListCatalogService],
  exports: [ListsRepository, ListCatalogService],
})
export class ListsModule {}
```

Confirm the exact `ClickupModule`/`DatabaseModule` import paths and that `ClickupModule` exports `ClickupClient` (adjust imports to match how other modules consume the client, e.g. `TasksModule`).

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test -- list-catalog.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lists/list-catalog.service.ts src/lists/lists.module.ts test/list-catalog.service.spec.ts
git commit -m "feat(lists): ListCatalogService.syncSpace + ListsModule"
```

---

### Task 4: Opportunistic catalog upsert from task sync

**Files:**
- Modify: `src/tasks/tasks.service.ts`, `src/tasks/tasks.module.ts`
- Test: `test/tasks.service.spec.ts` (add cases; create if absent)

**Interfaces:**
- Consumes: `ListsRepository.upsertMinimalFromTasks` (Task 1), exported by `ListsModule` (Task 3).
- Produces: no new public signature; `syncTasks` and `syncTask` now also upsert their tasks' lists (best-effort).

- [ ] **Step 1: Write the failing test**

```ts
// test/tasks.service.spec.ts (add)
it('syncTasks upserts distinct lists opportunistically', async () => {
  const clickup = {} as any;
  const normalizer = { normalizeTask: (t: any) => ({ taskId: t.id, listId: t.list?.id ?? null, listName: t.list?.name ?? null, folderId: null, folderName: null, spaceId: null, spaceName: null, raw: t }) } as any;
  const repo = { upsert: jest.fn().mockResolvedValue({}) } as any;
  const lists = { upsertMinimalFromTasks: jest.fn().mockResolvedValue(1) } as any;
  const svc = new TasksService(clickup, normalizer, repo, lists);
  await svc.syncTasks([{ id: 't1', list: { id: 'l1', name: 'Sprint 1' } }, { id: 't2', list: { id: 'l1', name: 'Sprint 1' } }]);
  expect(lists.upsertMinimalFromTasks).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ listId: 'l1' })]));
});
```

- [ ] **Step 2: Run — verify fails**

Run: `npm test -- tasks.service`
Expected: FAIL (constructor arity / `upsertMinimalFromTasks` not called).

- [ ] **Step 3: Implement**

Inject `ListsRepository` into `TasksService` (4th constructor param). In `syncTasks`, after the per-task loop, collect the normalized `{ listId, listName, folderId, folderName, spaceId, spaceName }` of successfully-normalized tasks and call `await this.lists.upsertMinimalFromTasks(...)` inside a `try/catch` that logs and swallows (catalog freshness must never fail a task batch). In `syncTask` (single), call it with a one-element array, same guard. Add `ListsModule` to `TasksModule` imports.

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test -- tasks.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/tasks.service.ts src/tasks/tasks.module.ts test/tasks.service.spec.ts
git commit -m "feat(tasks): opportunistically upsert list catalog on task sync"
```

---

### Task 5: Catalog sync on backfill + daily cron + job + processor + admin trigger

**Files:**
- Modify: `src/queues/queue.constants.ts` (add `SYNC_LIST_CATALOG`)
- Create: `src/workers/list-catalog.processor.ts`
- Modify: `src/workers/workers.module.ts`, `src/sync/backfill.service.ts`, `src/sync/sync.scheduler.ts`, `src/sync/sync.module.ts`, `src/admin/admin-sync.controller.ts`
- Test: `test/list-catalog.processor.spec.ts`

**Interfaces:**
- Consumes: `ListCatalogService.syncSpace` (Task 3).
- Produces: job name `JOBS.SYNC_LIST_CATALOG`, `ListCatalogProcessor`, cron `@Cron` daily, `POST /admin/lists/sync` (body `{ spaceId?: string }`; all configured spaces if omitted).

- [ ] **Step 1: Add the job constant**

In `src/queues/queue.constants.ts`, add `SYNC_LIST_CATALOG: 'sync-list-catalog'` to `JOBS`. Reuse the existing `CLICKUP_BACKFILLS` queue.

- [ ] **Step 2: Write the failing processor test**

```ts
// test/list-catalog.processor.spec.ts
import { ListCatalogProcessor } from '../src/workers/list-catalog.processor';

it('processes a SYNC_LIST_CATALOG job by syncing the space catalog', async () => {
  const svc = { syncSpace: jest.fn().mockResolvedValue({ synced: 3 }) } as any;
  const proc = new ListCatalogProcessor(svc);
  const res = await proc.process({ data: { spaceId: 's1' } } as any);
  expect(svc.syncSpace).toHaveBeenCalledWith('s1');
  expect(res).toEqual({ synced: 3 });
});
```

- [ ] **Step 3: Run — verify fails**

Run: `npm test -- list-catalog.processor`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement processor**

Mirror an existing processor (e.g. `src/workers/backfill.processor.ts`) for the `@Processor(QUEUES.CLICKUP_BACKFILLS)` decorator, `WorkerHost` base, and how it switches on `job.name`. The processor calls `this.catalog.syncSpace(job.data.spaceId)` for `job.name === JOBS.SYNC_LIST_CATALOG`. Register it in `workers.module.ts` providers and ensure `WorkersModule` imports `ListsModule`.

- [ ] **Step 5: Wire backfill + scheduler + admin**

- `BackfillService`: inject `ListCatalogService`; after `markSuccess`, `await this.listCatalog.syncSpace(spaceId)` inside a try/catch that logs and does not fail the backfill. Add `ListsModule` to `SyncModule` imports.
- `SyncScheduler`: add `@Cron('0 0 3 * * *') async syncListCatalogs()` that, for each `CLICKUP_SPACES` space enabled in settings, enqueues `JOBS.SYNC_LIST_CATALOG` with `{ spaceId }` on the `CLICKUP_BACKFILLS` queue using `defaultJobOptions()`.
- `admin-sync.controller.ts`: add `@Post('lists/sync')` (roles OWNER/ADMIN, matching the file's existing guards) that enqueues `SYNC_LIST_CATALOG` for the given `spaceId` or all configured spaces; return `{ queued: n }`.

- [ ] **Step 6: Run tests — verify pass**

Run: `npm test -- list-catalog.processor` then `npm run build`
Expected: PASS + compiles.

- [ ] **Step 7: Commit**

```bash
git add src/queues/queue.constants.ts src/workers/list-catalog.processor.ts src/workers/workers.module.ts src/sync/backfill.service.ts src/sync/sync.scheduler.ts src/sync/sync.module.ts src/admin/admin-sync.controller.ts test/list-catalog.processor.spec.ts
git commit -m "feat(sync): populate list catalog on backfill, daily cron, and admin trigger"
```

---

### Task 6: `SprintsReportService`

**Files:**
- Create: `src/reports/sprints-report.service.ts`
- Modify: `src/reports/reports.module.ts` (add provider)
- Test: `test/sprints-report.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService.$queryRaw`; `CycleTimeReportService` (existing) for `sprintDetail` cycle time.
- Produces `SprintsReportService` with:
  - `sprints(p: { spaceId?; folderId?; status?: 'active'|'completed'|'all'; search?; limit?; offset? }): Promise<{ items: SprintRow[]; total: number }>` where `SprintRow = { listId; name; folderName; spaceName; archived; startDate; dueDate; taskTotal; taskDone; pctDone; hours; costAud }`.
  - `sprintFolders(spaceId?): Promise<{ folderId; folderName; spaceName; activeCount; completedCount }[]>`
  - `sprintDetail(listId): Promise<{ list: SprintRow; byStatus: { status; color; count }[]; byAssignee: { userName; hours; costAud }[]; assigneeCount: number; cycleTimeHours: number | null }>` — `cycleTimeHours` is the mean open→done hours for the sprint's tasks (from `clickup_task_events`), or `null` if none.
  - `velocity(folderId, limit=12): Promise<{ listId; name; dueDate; taskDone; hours }[]>`

- [ ] **Step 1: Write the failing test**

```ts
// test/sprints-report.service.spec.ts
import { SprintsReportService } from '../src/reports/sprints-report.service';

function makePrisma() { return { $queryRaw: jest.fn().mockResolvedValue([]) } as any; }

describe('SprintsReportService', () => {
  it('sprints() maps rows and status=completed filters archived=true', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ list_id: 'l1', name: 'Sprint 1', folder_name: 'X Sprint', space_name: 'X', archived: true, start_date: null, due_date: null, task_total: 10n, task_done: 7n, hours: 12.5, cost_cents: 45000n }])
      .mockResolvedValueOnce([{ total: 1n }]);
    const svc = new SprintsReportService(prisma, {} as any);
    const res = await svc.sprints({ status: 'completed' });
    expect(res.items[0]).toMatchObject({ listId: 'l1', taskTotal: 10, taskDone: 7, pctDone: 70, hours: 12.5, costAud: 450, archived: true });
    expect(res.total).toBe(1);
    const sql = String(prisma.$queryRaw.mock.calls[0][0].sql ?? prisma.$queryRaw.mock.calls[0][0]);
    expect(sql).toMatch(/archived/);
  });

  it('velocity() orders by due_date and caps to limit', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([{ list_id: 'l1', name: 'Sprint 1', due_date: new Date('2026-07-07'), task_done: 7n, hours: 12 }]);
    const svc = new SprintsReportService(prisma, {} as any);
    const res = await svc.velocity('f1', 5);
    expect(res[0]).toMatchObject({ listId: 'l1', taskDone: 7, hours: 12 });
  });
});
```

- [ ] **Step 2: Run — verify fails**

Run: `npm test -- sprints-report`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service**

Use `Prisma.sql`/`$queryRaw` with composable fragments (mirror `tasks-report.service.ts` and `cost-trend-report.service.ts` for the `Prisma.sql`/`Prisma.join`/`Prisma.empty` idiom and BigInt→Number mapping). Core query shape for `sprints()`:

```sql
SELECT l.list_id, l.name, l.folder_name, l.space_name, l.archived, l.start_date, l.due_date,
       count(t.task_id)                                             AS task_total,
       count(t.task_id) FILTER (WHERE t.status_type IN ('closed','done')) AS task_done,
       COALESCE(sum(te.duration_hours), 0)                          AS hours,
       COALESCE(sum(te.cost_cents), 0)                              AS cost_cents
FROM clickup_lists l
LEFT JOIN clickup_tasks t ON t.list_id = l.list_id AND t.is_deleted = false
LEFT JOIN clickup_time_entries te ON te.task_id = t.task_id
WHERE (/* status */ l.archived = false | l.archived = true | TRUE)
  AND (/* spaceId */) AND (/* folderId */) AND (/* search: l.name ILIKE */)
GROUP BY l.list_id
ORDER BY l.due_date DESC NULLS LAST, l.name
LIMIT $limit OFFSET $offset;
```

`pctDone = task_total ? round(task_done/task_total*100) : 0`. `costAud = cost_cents/100`. Confirm the time-entry cost column name against `schema.prisma` (`cost_cents` / `costCents`). For `sprintDetail`, run: the single sprint row (same aggregate, filtered to one `list_id`), a `GROUP BY status` breakdown with color, and a `GROUP BY user_name` hours/cost breakdown; call `this.cycleTime.cycleTime({ ... , listId })` if the existing signature supports a list scope, otherwise compute cycle time inline over `clickup_task_events` filtered to the sprint's task ids (note which path you took in the commit body).

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test -- sprints-report`
Expected: PASS.

- [ ] **Step 5: Add provider & commit**

Add `SprintsReportService` to `reports.module.ts` providers. Then:

```bash
git add src/reports/sprints-report.service.ts src/reports/reports.module.ts test/sprints-report.service.spec.ts
git commit -m "feat(reports): SprintsReportService (list, folders, detail, velocity)"
```

---

### Task 7: Sprint report routes + `sprintStatus` filter on tasks/time-entries

**Files:**
- Modify: `src/reports/reports.controller.ts`
- Modify: `src/reports/tasks-report.service.ts`, `src/reports/time-entries-report.service.ts`
- Modify: `src/reports/report-filter.util.ts` (if the join filter belongs there)
- Test: `test/reports.controller.spec.ts` (extend), `test/sprints-report.service.spec.ts` (extend for filter)

**Interfaces:**
- Consumes: `SprintsReportService` (Task 6).
- Produces routes: `GET /reports/sprints`, `GET /reports/sprints/folders`, `GET /reports/sprints/velocity`, `GET /reports/sprints/:listId`; and a new `sprintStatus=active|completed|all` (default `all`) query param on `GET /reports/tasks` and `GET /reports/time-entries`.

- [ ] **Step 1: Write the failing controller test**

```ts
// test/reports.controller.spec.ts (add)
it('GET /reports/sprints delegates status + paging to the service', async () => {
  const sprints = { sprints: jest.fn().mockResolvedValue({ items: [], total: 0 }), sprintFolders: jest.fn(), velocity: jest.fn(), sprintDetail: jest.fn() } as any;
  const controller = new ReportsController(/* existing deps... */, sprints);
  await controller.sprints('s1', 'f1', 'completed', 'foo', '25', '0');
  expect(sprints.sprints).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 's1', folderId: 'f1', status: 'completed', search: 'foo', limit: 25, offset: 0 }));
});
```

- [ ] **Step 2: Run — verify fails**

Run: `npm test -- reports.controller`
Expected: FAIL.

- [ ] **Step 3: Implement routes + filter**

- Add the four sprint routes to `reports.controller.ts` (follow the `@Get`/`@Query`/`@ApiOperation` style already in the file; register `SprintsReportService` in the constructor). Validate `status`/`sprintStatus` to the allowed enum (default `all` for tasks/time-entries; `active` for `/reports/sprints`).
- In `tasks-report.service.ts` and `time-entries-report.service.ts`, thread a `sprintStatus` param that, when not `all`, adds `AND t.list_id IN (SELECT list_id FROM clickup_lists WHERE archived = <bool>)` (or a `JOIN`) to the existing filtered query. When `all` or absent, emit no extra clause (backward compatible). Add the param to the controller `tasks(...)`/`timeEntries(...)` signatures and pass through.

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test -- reports` then `npm run build`
Expected: PASS + compiles.

- [ ] **Step 5: Commit**

```bash
git add src/reports/
git commit -m "feat(reports): sprint routes + sprintStatus filter on tasks/time-entries"
```

---

### Task 8: Web API client + React Query hooks

**Files:**
- Modify: `apps/web/src/api/reports.ts`
- Modify: `apps/web/src/hooks/useReports.ts`

**Interfaces:**
- Consumes: backend routes from Task 7.
- Produces: `reportsApi.sprints`, `.sprintFolders`, `.sprintVelocity`, `.sprintDetail`; hooks `useSprints`, `useSprintFolders`, `useSprintVelocity`, `useSprintDetail`; exported interfaces `SprintRow`, `SprintFolder`, `SprintVelocityPoint`, `SprintDetail`.

- [ ] **Step 1: Add API thunks** to the `reportsApi` object in `apps/web/src/api/reports.ts` (mirror the existing `tasks`/`lists`/`sprintPoints` style):

```ts
sprints: (params: Record<string, string | number | undefined>) =>
  apiClient.get('/reports/sprints', { params }).then((r) => r.data),
sprintFolders: (params?: { spaceId?: string }) =>
  apiClient.get('/reports/sprints/folders', { params }).then((r) => r.data),
sprintVelocity: (params: { folderId: string; limit?: number }) =>
  apiClient.get('/reports/sprints/velocity', { params }).then((r) => r.data),
sprintDetail: (listId: string) =>
  apiClient.get(`/reports/sprints/${listId}`).then((r) => r.data),
```

- [ ] **Step 2: Add hooks + response interfaces** to `apps/web/src/hooks/useReports.ts`:

```ts
export interface SprintRow {
  listId: string; name: string; folderName: string | null; spaceName: string | null;
  archived: boolean; startDate: string | null; dueDate: string | null;
  taskTotal: number; taskDone: number; pctDone: number; hours: number; costAud: number;
}
export interface SprintFolder { folderId: string; folderName: string; spaceName: string | null; activeCount: number; completedCount: number; }
export interface SprintVelocityPoint { listId: string; name: string; dueDate: string | null; taskDone: number; hours: number; }
export interface SprintDetail {
  list: SprintRow;
  byStatus: { status: string; color: string | null; count: number }[];
  byAssignee: { userName: string; hours: number; costAud: number }[];
  assigneeCount: number;
  cycleTimeHours: number | null;
}

export function useSprints(params: Record<string, string | number | undefined>) {
  return useQuery({ queryKey: ['sprints', params], queryFn: () => reportsApi.sprints(params) as Promise<{ items: SprintRow[]; total: number }>, placeholderData: keepPreviousData });
}
export function useSprintFolders(spaceId?: string) {
  return useQuery({ queryKey: ['sprint-folders', spaceId ?? 'all'], queryFn: () => reportsApi.sprintFolders(spaceId ? { spaceId } : undefined) as Promise<SprintFolder[]> });
}
export function useSprintVelocity(folderId: string | undefined, limit = 12) {
  return useQuery({ queryKey: ['sprint-velocity', folderId, limit], queryFn: () => reportsApi.sprintVelocity({ folderId: folderId!, limit }) as Promise<SprintVelocityPoint[]>, enabled: !!folderId });
}
export function useSprintDetail(listId: string | undefined) {
  return useQuery({ queryKey: ['sprint-detail', listId], queryFn: () => reportsApi.sprintDetail(listId!) as Promise<SprintDetail>, enabled: !!listId });
}
```

- [ ] **Step 3: Verify build**

Run: `cd apps/web && npm run build`
Expected: type-checks (see `web-tsc-needs-npm-install` — run `npm install` first if phantom errors appear).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/reports.ts apps/web/src/hooks/useReports.ts
git commit -m "feat(web): sprint report API client + hooks"
```

---

### Task 9: `sprintStatus` filter on Tasks & Time Entries

**Files:**
- Modify: `apps/web/src/pages/TasksPage.tsx`, `apps/web/src/pages/TimeEntriesPage.tsx`

**Interfaces:**
- Consumes: the `sprintStatus` backend param (Task 7).
- Produces: an Active/Completed/All `Select` on both pages; the selected value flows into the existing `taskParams`/time-entry params object as `sprintStatus`.

- [ ] **Step 1: Add the static options** at module scope in each page:

```ts
const SPRINT_STATUS_OPTIONS = [
  { value: 'all', label: 'All sprints' },
  { value: 'active', label: 'Active sprints' },
  { value: 'completed', label: 'Completed sprints' },
];
```

- [ ] **Step 2: Add state + control.** Add `const [sprintStatus, setSprintStatus] = useState('all');` and render next to the existing archived `Select` in the toolbar:

```tsx
<Select ariaLabel="Filter by sprint status" size="md"
  value={sprintStatus} onChange={(v) => { setSprintStatus(v); setPage(1); }} options={SPRINT_STATUS_OPTIONS} />
```

- [ ] **Step 3: Thread into params.** In the `taskParams` (TasksPage) and the equivalent time-entry params `useMemo`, add:

```ts
sprintStatus: sprintStatus !== 'all' ? sprintStatus : undefined,
```

- [ ] **Step 4: Verify build & manual check**

Run: `cd apps/web && npm run build`. Then (optional) run the app (`web-visual-verification-setup`) and confirm switching to "Completed sprints" narrows the Tasks table.
Expected: builds; filter changes the result set.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/TasksPage.tsx apps/web/src/pages/TimeEntriesPage.tsx
git commit -m "feat(web): sprint status (active/completed) filter on Tasks & Time Entries"
```

---

### Task 10: `/sprints` analytics page

**Files:**
- Create: `apps/web/src/pages/SprintsPage.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import + route), `apps/web/src/components/layout/Sidebar.tsx` (nav item)

**Interfaces:**
- Consumes: `useSprintFolders`, `useSprints`, `useSprintVelocity`, `useSprintDetail` (Task 8); `useGlobalFilters` for `space`; `DataTable`, `Select`, `BarChart`, `DonutChart`, `Card`, `Pill`/`StatusBadge`, `QueryError`, `downloadCsv`/`toCsv`/`csvFilename`.
- Produces: `export function SprintsPage()`.

- [ ] **Step 1: Build the page skeleton.** `export function SprintsPage()` with:
  - `const { space } = useGlobalFilters();`
  - A folder `Select` (options from `useSprintFolders(space !== 'all' ? space : undefined)`, label `folderName (activeCount active / completedCount done)`), plus a status `Select` (`SPRINT_STATUS_OPTIONS` reused, default `active`), and a debounced search input.
  - `const sprintsQuery = useSprints({ spaceId: space !== 'all' ? space : undefined, folderId, status, search, limit, offset });`
  - Wrap page queries with `<QueryError queries={[sprintsQuery]} />` (existing helper).

- [ ] **Step 2: Sprint table.** Render a `DataTable<SprintRow>` (server-paginated: pass `total={sprintsQuery.data?.total}`, `page`, `onPageChange`, `layout="design"`, `rowKey="listId"`, `initialSort={{ key: 'dueDate', dir: 'desc' }}`). Columns: name; date range (`startDate`–`dueDate`); status badge (`archived ? 'Completed' : 'Active'`); a `%done` bar with `taskDone/taskTotal`; hours; cost (`fmt.money(costAud)`). `onRowClick` sets `selectedListId`.

- [ ] **Step 3: Detail panel.** When `selectedListId` set, `const detail = useSprintDetail(selectedListId);` render a `Card` with: a `DonutChart` of `byStatus` (value=count, color=status color) with `centerLabel="Done"` `centerValue={pctDone + '%'}`; metric row (tasks done/total, open, hours, cost, assignee count, `cycleTimeHours != null ? fmt duration : '—'`); a `BarChart` (horizontal) of `byAssignee` hours.

- [ ] **Step 4: Velocity chart.** `const velocity = useSprintVelocity(folderId);` render a `BarChart` (vertical) of `velocity.map(v => ({ label: v.name, value: v.taskDone }))` titled "Velocity — done tasks per sprint". Guard on `folderId` selected.

- [ ] **Step 5: CSV export.** Add an Export button: `downloadCsv(csvFilename('sprints'), toCsv(rows, cols))` where `rows` is the current `sprintsQuery.data?.items ?? []` and `cols: CsvColumn<SprintRow>[]` cover name/folder/status/dates/done/total/pctDone/hours/costAud (import from `../lib/csv`).

- [ ] **Step 6: Route + nav.**
  - `App.tsx`: `const SprintsPage = React.lazy(() => import('./pages/SprintsPage').then((m) => ({ default: m.SprintsPage })));` and `<Route path="/sprints" element={<SuspenseRoute><SprintsPage /></SuspenseRoute>} />` inside the protected group (member-visible; not admin-gated — it is a read-only report).
  - `Sidebar.tsx`: import `Rocket` from `lucide-react`; add `{ to: "/sprints", label: "Sprints", icon: Rocket }` to `navItems` (near Tasks/Analytics).

- [ ] **Step 7: Verify build**

Run: `cd apps/web && npm run build`
Expected: builds; `/sprints` renders folder/status filters, table, detail panel, velocity chart.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/SprintsPage.tsx apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(web): /sprints analytics page (table, detail, velocity, CSV)"
```

---

### Task 11: Docs + full verification

**Files:**
- Modify: `docs/OPERATIONS.md` (catalog population note), `CLAUDE.md` (move "archived sprint filter" from pending to shipped, note `clickup_lists`).

- [ ] **Step 1: Document catalog population** in `docs/OPERATIONS.md`: the `clickup_lists` catalog is populated by (a) every manual space backfill, (b) the daily `SYNC_LIST_CATALOG` cron (03:00), (c) `POST /admin/lists/sync`, and opportunistically from task webhooks (name/folder only). Note that `archived`/dates require path (a)/(b)/(c). Add a one-line bootstrap instruction: run `POST /admin/lists/sync` once after deploy to populate before the first cron.

- [ ] **Step 2: Update `CLAUDE.md`** — move the archived-sprint capability out of "Known starter limitations" and add `clickup_lists` to the data-model section and the sprint reports to the reports list.

- [ ] **Step 3: Full test + build gate**

Run: `npm test` (backend) and `npm run build` (backend), then `cd apps/web && npm run build`.
Expected: all green. (`npm run lint` is known-broken — see `lint-broken-no-root-eslint-config`; do not gate on it.)

- [ ] **Step 4: Commit**

```bash
git add docs/OPERATIONS.md CLAUDE.md
git commit -m "docs: document sprint catalog population and mark archived-sprint filter shipped"
```

---

## Self-review notes

- **Spec coverage:** catalog table (T1), client capture (T2), catalog service (T3), opportunistic population (T4), backfill+cron+admin population (T5), report service incl. velocity (T6), routes + `sprintStatus` filter (T7), web API/hooks (T8), Tasks/TimeEntries filter (T9), full `/sprints` page (T10), docs (T11). All spec sections mapped.
- **Deviation from spec §4/§7:** `CycleTimeCard` self-fetches unscoped, so per-sprint cycle time is delivered as a `sprintDetail.cycleTimeHours` metric, not the shared card. The sprint "picker" on Tasks/TimeEntries is the `sprintStatus` Select (those pages already have folder/list MultiSelects); the folder→sprint picker proper lives on `/sprints`. Noted for the reviewer.
- **Open verification during impl:** confirm the time-entry cost column name (`cost_cents`), the `ClickupClient` constructor signature for the Task 2 test, and whether `CycleTimeReportService.cycleTime` accepts a `listId` scope (else compute inline in `sprintDetail`).


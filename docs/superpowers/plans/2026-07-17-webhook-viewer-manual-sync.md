# Webhook status viewer + manual single-task sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only viewer of the ClickUp webhooks actually registered (with drift vs. the configured events), and a Settings form to force-sync a single task (task record + its time entries) by ID.

**Architecture:** One new read-only endpoint `GET /admin/webhooks` backed by a new `ClickupWebhooksService.listRegistered()` that wraps the existing `client.getWebhooks()` and computes drift against `settings.getWebhookEvents()`. Manual sync reuses the existing `POST /admin/tasks/sync` and `POST /admin/time-entries/sync-task` endpoints, fired together from one button. All new UI lives on the Settings page.

**Tech Stack:** NestJS 11, Prisma 7, React + @tanstack/react-query, existing `apiClient`, existing UI kit (`Card`, `Button`, `Input`, `Callout`, `EmptyState`, `Pill`, `useToast`).

## Global Constraints

- Node `>=22`, NestJS 11, Prisma 7. No dependency additions.
- No schema/migration changes (purely additive endpoint + UI).
- Commits omit the `Co-Authored-By: Claude` trailer (project convention).
- `npm run lint` is known-broken (no root ESLint config) — do NOT gate on it; use `npm run test` and `npm run build`.
- Preserve Prettier formatting. Prefer explicit types over `any` for new code.
- New admin endpoint inherits the controller's `@Roles(Role.OWNER, Role.ADMIN)` — do not loosen it.
- Manual-sync UI copy must say **"queued"** (jobs are async), never "done"/"synced".

---

### Task 1: Backend — `listRegistered()` + `GET /admin/webhooks`

**Files:**
- Modify: `src/clickup/clickup-webhooks.service.ts`
- Modify: `src/admin/admin.controller.ts`
- Test: `test/clickup-webhooks.service.spec.ts`

**Interfaces:**
- Consumes: `ClickupClient.getWebhooks(teamId): Promise<ClickUpWebhook[]>` where `ClickUpWebhook = { id: string; endpoint?: string; events?: string[]; health?: { status: string; fail_count: number } }`; `SettingsService.getTeamId()`, `getWebhookEndpoint()`, `getWebhookEvents(): string` (comma-separated).
- Produces:
  ```ts
  interface RegisteredWebhook {
    id: string;
    endpoint: string | null;
    events: string[];
    health: { status: string; failCount: number } | null;
    missingEvents: string[]; // desired but not registered on ClickUp
    extraEvents: string[];   // registered on ClickUp but not desired
  }
  interface ListRegisteredResult {
    desiredEvents: string[];
    configuredEndpoint: string;
    webhooks: RegisteredWebhook[];
  }
  ClickupWebhooksService.listRegistered(): Promise<ListRegisteredResult>
  ```
  Endpoint: `GET /admin/webhooks` → `ListRegisteredResult`.

- [ ] **Step 1: Write the failing test**

Add to `test/clickup-webhooks.service.spec.ts` (reuses the file's `makeService`/`makeSettings` helpers — `makeSettings` already exposes `getWebhookEndpoint`/`getWebhookEvents`):

```ts
describe('listRegistered', () => {
  it('maps webhooks and computes drift vs the configured events', async () => {
    // Configured (desired) = 4 default events. Registered webhook is missing
    // taskTimeTrackedUpdated and has an extra taskCommentPosted.
    const registered = [
      {
        id: 'wh-1',
        endpoint: ENDPOINT,
        events: ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskCommentPosted'],
        health: { status: 'active', fail_count: 0 },
      },
    ];
    const { svc } = makeService(registered);
    const result = await svc.listRegistered();

    expect(result.configuredEndpoint).toBe(ENDPOINT);
    expect(result.desiredEvents).toEqual(DEFAULT_EVENTS);
    expect(result.webhooks).toHaveLength(1);
    const w = result.webhooks[0];
    expect(w.id).toBe('wh-1');
    expect(w.endpoint).toBe(ENDPOINT);
    expect(w.health).toEqual({ status: 'active', failCount: 0 });
    expect(w.missingEvents).toEqual(['taskTimeTrackedUpdated']);
    expect(w.extraEvents).toEqual(['taskCommentPosted']);
  });

  it('returns an empty list (no throw) when no webhooks are registered', async () => {
    const { svc } = makeService([]);
    const result = await svc.listRegistered();
    expect(result.webhooks).toEqual([]);
    expect(result.desiredEvents).toEqual(DEFAULT_EVENTS);
  });

  it('normalizes a webhook with missing events/health to empty array / null', async () => {
    const { svc } = makeService([{ id: 'wh-2', endpoint: undefined }]);
    const [w] = (await svc.listRegistered()).webhooks;
    expect(w.endpoint).toBeNull();
    expect(w.events).toEqual([]);
    expect(w.health).toBeNull();
    expect(w.missingEvents).toEqual(DEFAULT_EVENTS); // nothing registered → all desired missing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/clickup-webhooks.service.spec.ts -t "listRegistered"`
Expected: FAIL — `svc.listRegistered is not a function`.

- [ ] **Step 3: Implement `listRegistered()`**

In `src/clickup/clickup-webhooks.service.ts`, add the exported types above the class (next to `RegisterWebhookResult`):

```ts
export interface RegisteredWebhook {
  id: string;
  endpoint: string | null;
  events: string[];
  health: { status: string; failCount: number } | null;
  missingEvents: string[];
  extraEvents: string[];
}

export interface ListRegisteredResult {
  desiredEvents: string[];
  configuredEndpoint: string;
  webhooks: RegisteredWebhook[];
}
```

Add the method to the class (e.g. right after `register()`):

```ts
/**
 * Read-only view of the webhooks ClickUp actually has registered for this
 * team, plus drift against the configured (desired) event list. The Settings
 * "desired events" checkboxes only take effect once `register()` pushes them
 * to ClickUp, so this surfaces the gap between intent and live registration.
 */
async listRegistered(): Promise<ListRegisteredResult> {
  const teamId = this.settings.getTeamId();
  const configuredEndpoint = this.settings.getWebhookEndpoint();
  const desiredEvents = this.settings
    .getWebhookEvents()
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const desiredSet = new Set(desiredEvents);

  const webhooks = await this.client.getWebhooks(teamId);
  return {
    desiredEvents,
    configuredEndpoint,
    webhooks: webhooks.map((w) => {
      const events = w.events ?? [];
      const eventSet = new Set(events);
      return {
        id: w.id,
        endpoint: w.endpoint ?? null,
        events,
        health: w.health ? { status: w.health.status, failCount: w.health.fail_count } : null,
        missingEvents: desiredEvents.filter((e) => !eventSet.has(e)),
        extraEvents: events.filter((e) => !desiredSet.has(e)),
      };
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/clickup-webhooks.service.spec.ts -t "listRegistered"`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the controller endpoint**

In `src/admin/admin.controller.ts`, add next to `registerWebhook` (the class already declares `@Roles(Role.OWNER, Role.ADMIN)`, so it's inherited — no per-method role needed):

```ts
@Get('webhooks')
@ApiOperation({ summary: 'List ClickUp webhooks actually registered for this team, with drift vs the configured event list.' })
listWebhooks() {
  return this.webhooks.listRegistered();
}
```

- [ ] **Step 6: Verify build + full test suite**

Run: `npm run build && npm run test`
Expected: build succeeds; all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/clickup/clickup-webhooks.service.ts src/admin/admin.controller.ts test/clickup-webhooks.service.spec.ts
git commit -m "feat(admin): GET /admin/webhooks — list registered webhooks with event drift"
```

---

### Task 2: Frontend — API client + hooks

**Files:**
- Modify: `apps/web/src/api/admin.ts`
- Modify: `apps/web/src/hooks/useAdmin.ts`

**Interfaces:**
- Consumes: existing `apiClient` (axios-like: `apiClient.get`, `apiClient.post` → `{ data }`); existing `adminApi.syncTask(taskId)`.
- Produces:
  ```ts
  // api/admin.ts
  interface RegisteredWebhookDto {
    id: string;
    endpoint: string | null;
    events: string[];
    health: { status: string; failCount: number } | null;
    missingEvents: string[];
    extraEvents: string[];
  }
  interface WebhooksListDto {
    desiredEvents: string[];
    configuredEndpoint: string;
    webhooks: RegisteredWebhookDto[];
  }
  adminApi.listWebhooks(): Promise<WebhooksListDto>
  adminApi.syncTaskTimeEntries(taskId: string): Promise<unknown>
  // hooks/useAdmin.ts
  useWebhooks(enabled?: boolean)          // useQuery<WebhooksListDto>
  useSyncTaskFull()                        // useMutation<{taskId}, Error, string>
  ```

- [ ] **Step 1: Add API methods**

In `apps/web/src/api/admin.ts`, export the DTO types (near the top, with the other exported interfaces) and add two methods inside the `adminApi` object:

```ts
export interface RegisteredWebhookDto {
  id: string;
  endpoint: string | null;
  events: string[];
  health: { status: string; failCount: number } | null;
  missingEvents: string[];
  extraEvents: string[];
}
export interface WebhooksListDto {
  desiredEvents: string[];
  configuredEndpoint: string;
  webhooks: RegisteredWebhookDto[];
}
```

```ts
  listWebhooks: (): Promise<WebhooksListDto> =>
    apiClient.get('/admin/webhooks').then((r) => r.data),
  syncTaskTimeEntries: (taskId: string) =>
    apiClient.post('/admin/time-entries/sync-task', { taskId }).then((r) => r.data),
```

- [ ] **Step 2: Add hooks**

In `apps/web/src/hooks/useAdmin.ts`, add next to `useSyncTask`:

```ts
export function useWebhooks(enabled = true) {
  return useQuery({
    queryKey: ['registered-webhooks'],
    queryFn: adminApi.listWebhooks,
    enabled,
  });
}

/**
 * Force-sync a single task from the UI: enqueues BOTH the task sync and its
 * time-entry sync (both idempotent job enqueues). Resolves once both are queued.
 */
export function useSyncTaskFull() {
  return useMutation({
    mutationFn: async (taskId: string) => {
      await Promise.all([adminApi.syncTask(taskId), adminApi.syncTaskTimeEntries(taskId)]);
      return { taskId };
    },
  });
}
```

- [ ] **Step 3: Typecheck the web app**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/admin.ts apps/web/src/hooks/useAdmin.ts
git commit -m "feat(web): admin api + hooks for registered webhooks and full single-task sync"
```

---

### Task 3: Frontend — Settings page UI (two cards)

**Files:**
- Modify: `apps/web/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `useWebhooks()`, `useSyncTaskFull()` (Task 2); existing `Card`, local `CardHeader`, `Button`, `Input`, `Callout`, `Pill`, `EmptyState`, `Field`, `useToast` (`showBanner(text, tone)` helper already defined at ~line 396). New cards are inserted **immediately after** the existing webhook `Card` (the one closing at ~line 774, right before the `<div style={{ ...surface-alt }}>` block).

- [ ] **Step 1: Import the hooks**

Extend the `useAdmin` import at `apps/web/src/pages/SettingsPage.tsx:14`:

```ts
import { useRegisterWebhook, useTestClickupConnection, useReconcileTasks, useReconcileActive, useWebhooks, useSyncTaskFull } from '../hooks/useAdmin';
```

- [ ] **Step 2: Wire the hooks in the component body**

Near the other admin hooks (`const registerWebhook = useRegisterWebhook();` ~line 349) add:

```ts
  const webhooksList = useWebhooks();
  const syncTaskFull = useSyncTaskFull();
  const [manualTaskId, setManualTaskId] = useState('');
```

(`useState` is already imported in this file.)

- [ ] **Step 3: Add the "Registered webhooks" card**

Immediately after the closing `</Card>` of the webhook card (~line 774), insert:

```tsx
          <Card>
            <CardHeader
              title="Registered on ClickUp"
              subtitle="What ClickUp actually delivers to. Differs from the checkboxes above until you Register."
              action={
                <Button variant="ghost" onClick={() => webhooksList.refetch()} loading={webhooksList.isFetching}>
                  Refresh
                </Button>
              }
            />
            <div style={{ padding: '4px 0' }}>
              {webhooksList.isError ? (
                <Callout tone="red">
                  Couldn’t read webhooks from ClickUp: {(webhooksList.error as Error)?.message ?? 'unknown error'}. Check the API token.
                </Callout>
              ) : !webhooksList.data || webhooksList.data.webhooks.length === 0 ? (
                <EmptyState title="No webhook registered" description="Click Register Webhook above to create one." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {webhooksList.data.webhooks.map((w) => (
                    <div key={w.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Pill tone={w.health?.status === 'active' ? 'green' : 'amber'}>
                          {w.health?.status ?? 'unknown'}
                        </Pill>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{w.endpoint ?? '(no endpoint)'}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>id {w.id}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {w.events.length === 0 ? (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No events subscribed.</span>
                        ) : (
                          w.events.map((e) => <Pill key={e} tone="neutral">{e}</Pill>)
                        )}
                      </div>
                      {w.missingEvents.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <Callout tone="amber">
                            Not registered for: {w.missingEvents.join(', ')}. Click Register Webhook to sync these.
                          </Callout>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
```

Note: if `Pill` does not accept a `tone` value used here (`green`/`amber`/`neutral`), use whatever tone values `Pill` already supports in this file — grep `Pill` usages first and match them.

- [ ] **Step 4: Add the "Manual sync" card**

Immediately after the card from Step 3, insert:

```tsx
          <Card>
            <CardHeader
              title="Manual task sync"
              subtitle="Force a re-pull of one task and its time entries by ClickUp task ID."
            />
            <Field label="Task ID" hint="e.g. 86eyajwq8. Runs in the background — watch Sync Logs for results.">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Input
                  value={manualTaskId}
                  placeholder="86eyajwq8"
                  onChange={(e) => setManualTaskId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
                <Button
                  loading={syncTaskFull.isPending}
                  disabled={!manualTaskId.trim()}
                  onClick={() => {
                    const id = manualTaskId.trim();
                    if (!id) return;
                    syncTaskFull.mutate(id, {
                      onSuccess: () => {
                        showBanner(`Queued sync for ${id} (task + time entries). Check Sync Logs shortly.`, 'blue');
                        setManualTaskId('');
                      },
                      onError: (err) => showBanner(`Sync failed to queue: ${(err as Error).message}`, 'red'),
                    });
                  }}
                >
                  Sync task
                </Button>
              </div>
            </Field>
          </Card>
```

- [ ] **Step 5: Typecheck the web app**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors. (If `Pill`/`Callout`/`Button` prop names differ, adjust to the real signatures found by grepping their component files.)

- [ ] **Step 6: Manual verification**

Start backend (`npm run start:dev`) + web (`:5174`) + Redis. On the Settings page:
1. "Registered on ClickUp" card lists the live webhook(s) with event chips; if `taskTimeTrackedUpdated` isn't registered, an amber "Not registered for:" callout shows. If the token is bad, a red error callout shows instead.
2. In "Manual task sync", enter a known task ID → "Sync task" → a blue "Queued sync…" toast appears, and within a few seconds `/job-logs` shows `sync-clickup-task` + `sync-task-time-entries` jobs for that task.

Record what you observed (the two job-log rows) in the commit or PR description.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/SettingsPage.tsx
git commit -m "feat(web): Settings — registered-webhooks viewer + manual single-task sync"
```

---

## Self-Review

- **Spec coverage:** Part 1 viewer → Task 1 (endpoint/service + drift) + Task 3 Step 3 (card). Part 2 manual sync → Task 2 (api/hook) + Task 3 Step 4 (card). Drift (`missingEvents`/`extraEvents`) → Task 1. RBAC (OWNER/ADMIN inherited) → Task 1 Step 5. Error state → Task 3 Step 3. "Queued" wording → Task 3 Step 4. Unit test for drift → Task 1. All covered.
- **Placeholder scan:** none — every code step is concrete. The only conditional notes ("if `Pill` tone differs…") are grep-and-match instructions, not TODOs.
- **Type consistency:** `RegisteredWebhook`/`ListRegisteredResult` (backend) mirror `RegisteredWebhookDto`/`WebhooksListDto` (frontend); `health.failCount` (camelCase) used consistently in both; `useSyncTaskFull` mutate takes `string`, matching Task 3 usage. Consistent.

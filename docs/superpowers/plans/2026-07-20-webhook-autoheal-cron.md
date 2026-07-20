# Webhook Auto-Heal Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 15-minute scheduled health-check that reactivates a suspended/failing ClickUp webhook, but only when the endpoint is verifiably reachable and not flapping.

**Architecture:** A new `WebhookHealthService` (`@Cron`) reads live webhook state via the existing `ClickupWebhooksService.listRegistered()`, probes the configured endpoint's reachability via a small injectable `EndpointProbe`, and — when a non-active webhook is found on a reachable endpoint — calls the existing `ClickupWebhooksService.register()` to re-subscribe in place. Successful heals are written to `admin_audit_log` via `AuditLogRepository`. Both new providers live in a dedicated `WebhookHealthModule` (imports `ClickupModule` + `AdminModule`) to avoid the `AdminModule → ClickupModule` circular dependency.

**Tech Stack:** NestJS 11, `@nestjs/schedule` (`@Cron`), `@nestjs/config` (`ConfigService`), zod env validation, Node 22 global `fetch`, Jest.

## Global Constraints

- Reuse `ClickupWebhooksService.register()` for reactivation — do NOT duplicate the ClickUp `PUT status:active` call.
- Never touch webhooks whose endpoint ≠ the configured endpoint (those are `prune-stale`'s job).
- Only successful heals are audited; skips (endpoint down, backoff cap) are logged only.
- Cron expression MUST be the 6-field seconds-first form `'0 */15 * * * *'` (fires :00 :15 :30 :45). The 5-field `'0 */15 * * *'` is WRONG (fires twice daily).
- Read the enable flag defensively: `const enabled = raw === true || raw === 'true'` — do NOT rely on `ConfigService` returning a real boolean.
- Commits in this repo omit the `Co-Authored-By: Claude` trailer.
- Tests instantiate services directly with plain mocked deps (`new Service(...)`), no NestJS `TestingModule` — match `test/clickup-webhooks.service.spec.ts`.
- Preserve Prettier formatting.

## File Structure

- `src/clickup/endpoint-probe.ts` (new) — `EndpointProbe`, one responsibility: is a URL reachable via GET.
- `src/clickup/webhook-health.service.ts` (new) — `WebhookHealthService`, the cron + heal decision logic.
- `src/clickup/webhook-health.module.ts` (new) — wires both providers, imports `ClickupModule` + `AdminModule`.
- `src/config/env.validation.ts` (modify) — add `WEBHOOK_AUTOHEAL_ENABLED` flag.
- `src/app.module.ts` (modify) — import `WebhookHealthModule`.
- `.env.example` (modify) — document the flag.
- `test/endpoint-probe.spec.ts` (new)
- `test/webhook-health.service.spec.ts` (new)

---

### Task 1: EndpointProbe

**Files:**
- Create: `src/clickup/endpoint-probe.ts`
- Test: `test/endpoint-probe.spec.ts`

**Interfaces:**
- Consumes: nothing (uses Node 22 global `fetch`).
- Produces: `class EndpointProbe { probe(url: string, timeoutMs?: number): Promise<boolean> }` — `true` when the URL returns an HTTP status `< 500`; `false` on `5xx`, network error, or timeout.

- [ ] **Step 1: Write the failing test**

Create `test/endpoint-probe.spec.ts`:

```ts
import { EndpointProbe } from '../src/clickup/endpoint-probe';

describe('EndpointProbe', () => {
  const probe = new EndpointProbe();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns true for a <500 response (e.g. 405 from the POST-only route)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 405 }) as any;
    await expect(probe.probe('https://app.example.com/webhooks/clickup')).resolves.toBe(true);
  });

  it('returns false for a 5xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 503 }) as any;
    await expect(probe.probe('https://app.example.com/webhooks/clickup')).resolves.toBe(false);
  });

  it('returns false when fetch throws (network error / DNS / timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    await expect(probe.probe('https://app.example.com/webhooks/clickup')).resolves.toBe(false);
  });

  it('issues a GET request to the given url', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 404 });
    global.fetch = fetchMock as any;
    await probe.probe('https://app.example.com/webhooks/clickup');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/webhooks/clickup',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/endpoint-probe.spec.ts`
Expected: FAIL — cannot find module `../src/clickup/endpoint-probe`.

- [ ] **Step 3: Write minimal implementation**

Create `src/clickup/endpoint-probe.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';

/**
 * Verifies that ClickUp's delivery path to our public webhook endpoint is up
 * (DNS + TLS + reverse proxy + app), by issuing an outbound GET to the same URL
 * ClickUp POSTs to. The route is POST-only and signature-guarded, so a GET
 * returns 401/404/405 — any HTTP response below 500 still proves the path works.
 */
@Injectable()
export class EndpointProbe {
  private readonly logger = new Logger(EndpointProbe.name);

  async probe(url: string, timeoutMs = 5000): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      return res.status < 500;
    } catch (err) {
      this.logger.warn(`Endpoint probe failed for ${url}: ${(err as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/endpoint-probe.spec.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add src/clickup/endpoint-probe.ts test/endpoint-probe.spec.ts
git commit -m "feat(clickup): endpoint reachability probe for webhook auto-heal"
```

---

### Task 2: WebhookHealthService

**Files:**
- Create: `src/clickup/webhook-health.service.ts`
- Test: `test/webhook-health.service.spec.ts`

**Interfaces:**
- Consumes:
  - `ClickupWebhooksService.listRegistered(): Promise<{ configuredEndpoint: string; webhooks: Array<{ id: string; endpoint: string | null; events: string[]; health: { status: string; failCount: number } | null; missingEvents: string[]; extraEvents: string[] }> }>`
  - `ClickupWebhooksService.register(): Promise<RegisterWebhookResult>`
  - `AuditLogRepository.create(input: AuditLogCreateInput): unknown` where `AuditLogCreateInput = { actor: string|null; method: string; path: string; routePattern: string|null; statusCode: number; durationMs: number|null; ip: string|null; userAgent: string|null; requestBody: unknown; errorMessage: string|null }`
  - `ConfigService.get(key: string, defaultValue?: unknown): unknown`
  - `EndpointProbe.probe(url: string): Promise<boolean>` (Task 1)
- Produces: `class WebhookHealthService { checkAndHeal(): Promise<void> }` — invoked by `@Cron('0 */15 * * * *')`.

- [ ] **Step 1: Write the failing test**

Create `test/webhook-health.service.spec.ts`:

```ts
import { WebhookHealthService } from '../src/clickup/webhook-health.service';

describe('WebhookHealthService', () => {
  const ENDPOINT = 'https://app.example.com/webhooks/clickup';

  function suspendedList() {
    return {
      configuredEndpoint: ENDPOINT,
      webhooks: [
        { id: 'wh1', endpoint: ENDPOINT, events: [], health: { status: 'suspended', failCount: 7 }, missingEvents: [], extraEvents: [] },
      ],
    };
  }

  function make(opts: { listResult?: any; configValue?: any; probeResult?: boolean } = {}) {
    const listResult = opts.listResult ?? suspendedList();
    const webhooks = {
      listRegistered: jest.fn().mockResolvedValue(listResult),
      register: jest.fn().mockResolvedValue({ action: 'updated', webhookId: 'wh1', endpoint: ENDPOINT, events: [], addedEvents: [] }),
    } as any;
    const auditLog = { create: jest.fn().mockResolvedValue(undefined) } as any;
    const config = { get: jest.fn().mockReturnValue(opts.configValue ?? true) } as any;
    const probe = { probe: jest.fn().mockResolvedValue(opts.probeResult ?? true) } as any;
    const svc = new WebhookHealthService(webhooks, auditLog, config, probe);
    return { svc, webhooks, auditLog, config, probe };
  }

  it('does nothing when disabled via boolean false', async () => {
    const { svc, webhooks } = make({ configValue: false });
    await svc.checkAndHeal();
    expect(webhooks.listRegistered).not.toHaveBeenCalled();
  });

  it('does nothing when disabled via string "false" (ConfigService may return the raw string)', async () => {
    const { svc, webhooks } = make({ configValue: 'false' });
    await svc.checkAndHeal();
    expect(webhooks.listRegistered).not.toHaveBeenCalled();
  });

  it('proceeds when enabled via string "true"', async () => {
    const { svc, webhooks } = make({ configValue: 'true' });
    await svc.checkAndHeal();
    expect(webhooks.listRegistered).toHaveBeenCalled();
  });

  it('does not heal when the configured webhook is active', async () => {
    const listResult = {
      configuredEndpoint: ENDPOINT,
      webhooks: [{ id: 'wh1', endpoint: ENDPOINT, events: [], health: { status: 'active', failCount: 0 }, missingEvents: [], extraEvents: [] }],
    };
    const { svc, webhooks, auditLog } = make({ listResult });
    await svc.checkAndHeal();
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('does not heal when no webhook matches the configured endpoint', async () => {
    const listResult = {
      configuredEndpoint: ENDPOINT,
      webhooks: [{ id: 'stale', endpoint: 'https://old.example.com/webhooks/clickup', events: [], health: { status: 'suspended', failCount: 3 }, missingEvents: [], extraEvents: [] }],
    };
    const { svc, webhooks, auditLog } = make({ listResult });
    await svc.checkAndHeal();
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('skips heal (no register, no audit) when the endpoint probe reports down', async () => {
    const { svc, webhooks, auditLog, probe } = make({ probeResult: false });
    await svc.checkAndHeal();
    expect(probe.probe).toHaveBeenCalledWith(ENDPOINT);
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('heals a suspended webhook when the endpoint probe reports up, writing one audit row', async () => {
    const { svc, webhooks, auditLog } = make();
    await svc.checkAndHeal();
    expect(webhooks.register).toHaveBeenCalledTimes(1);
    expect(auditLog.create).toHaveBeenCalledTimes(1);
    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'system:webhook-autoheal',
        method: 'CRON',
        path: '/system/webhook-autoheal',
        routePattern: '/system/webhook-autoheal',
        statusCode: 200,
        requestBody: { webhookId: 'wh1', previousStatus: 'suspended', failCount: 7 },
      }),
    );
  });

  it('only targets the configured-endpoint webhook when a stale one is also suspended', async () => {
    const listResult = {
      configuredEndpoint: ENDPOINT,
      webhooks: [
        { id: 'stale', endpoint: 'https://old.example.com/webhooks/clickup', events: [], health: { status: 'suspended', failCount: 9 }, missingEvents: [], extraEvents: [] },
        { id: 'wh1', endpoint: ENDPOINT, events: [], health: { status: 'suspended', failCount: 2 }, missingEvents: [], extraEvents: [] },
      ],
    };
    const { svc, webhooks, auditLog, probe } = make({ listResult });
    await svc.checkAndHeal();
    expect(probe.probe).toHaveBeenCalledWith(ENDPOINT);
    expect(webhooks.register).toHaveBeenCalledTimes(1);
    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { webhookId: 'wh1', previousStatus: 'suspended', failCount: 2 } }),
    );
  });

  it('stops healing after 3 heals of the same webhook within an hour', async () => {
    const { svc, webhooks, auditLog } = make();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    expect(webhooks.register).toHaveBeenCalledTimes(3);
    expect(auditLog.create).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/webhook-health.service.spec.ts`
Expected: FAIL — cannot find module `../src/clickup/webhook-health.service`.

- [ ] **Step 3: Write minimal implementation**

Create `src/clickup/webhook-health.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ClickupWebhooksService } from './clickup-webhooks.service';
import { EndpointProbe } from './endpoint-probe';
import { AuditLogRepository } from '../admin/audit-log.repository';

@Injectable()
export class WebhookHealthService {
  private readonly logger = new Logger(WebhookHealthService.name);
  private static readonly MAX_HEALS_PER_HOUR = 3;
  private static readonly HOUR_MS = 60 * 60 * 1000;
  // In-memory, per-webhook heal timestamps — a best-effort anti-flap valve.
  // Resets on restart / is per-instance; acceptable because register() is idempotent.
  private readonly healAttempts = new Map<string, number[]>();

  constructor(
    private readonly webhooks: ClickupWebhooksService,
    private readonly auditLog: AuditLogRepository,
    private readonly config: ConfigService,
    private readonly probe: EndpointProbe,
  ) {}

  // 6-field, seconds-first: sec=0, min=*/15 → fires at :00 :15 :30 :45.
  @Cron('0 */15 * * * *')
  async checkAndHeal(): Promise<void> {
    // ConfigService may hand back the raw env string ("false" is truthy), so
    // normalize both representations rather than trusting a boolean.
    const raw = this.config.get('WEBHOOK_AUTOHEAL_ENABLED', true);
    const enabled = raw === true || raw === 'true';
    if (!enabled) return;

    const { configuredEndpoint, webhooks } = await this.webhooks.listRegistered();
    const target = webhooks.find((w) => w.endpoint === configuredEndpoint);
    if (!target || !target.health || target.health.status === 'active') {
      this.logger.debug('Configured webhook is healthy or absent; nothing to heal');
      return;
    }

    const { status, failCount } = target.health;

    if (this.attemptsInLastHour(target.id) >= WebhookHealthService.MAX_HEALS_PER_HOUR) {
      this.logger.error(
        `Auto-heal not sticking for webhook ${target.id} (status ${status}); manual intervention needed`,
      );
      return;
    }

    const reachable = await this.probe.probe(configuredEndpoint);
    if (!reachable) {
      this.logger.warn(`Skipping heal for webhook ${target.id}; endpoint still unreachable`);
      return;
    }

    await this.webhooks.register();
    this.recordAttempt(target.id);
    this.logger.log(`Auto-healed webhook ${target.id} (was ${status}, failCount ${failCount})`);
    await this.auditLog.create({
      actor: 'system:webhook-autoheal',
      method: 'CRON',
      path: '/system/webhook-autoheal',
      routePattern: '/system/webhook-autoheal',
      statusCode: 200,
      durationMs: null,
      ip: null,
      userAgent: null,
      requestBody: { webhookId: target.id, previousStatus: status, failCount },
      errorMessage: null,
    });
  }

  private attemptsInLastHour(id: string): number {
    const cutoff = Date.now() - WebhookHealthService.HOUR_MS;
    const recent = (this.healAttempts.get(id) ?? []).filter((t) => t >= cutoff);
    this.healAttempts.set(id, recent);
    return recent.length;
  }

  private recordAttempt(id: string): void {
    const recent = this.healAttempts.get(id) ?? [];
    recent.push(Date.now());
    this.healAttempts.set(id, recent);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/webhook-health.service.spec.ts`
Expected: PASS (10 passing).

- [ ] **Step 5: Commit**

```bash
git add src/clickup/webhook-health.service.ts test/webhook-health.service.spec.ts
git commit -m "feat(clickup): webhook auto-heal service (verify-then-heal + backoff cap)"
```

---

### Task 3: Env flag, module wiring, and build

**Files:**
- Create: `src/clickup/webhook-health.module.ts`
- Modify: `src/config/env.validation.ts` (add flag inside the `z.object({...})`, before `}).superRefine`)
- Modify: `src/app.module.ts` (import + register `WebhookHealthModule`)
- Modify: `.env.example` (document the flag)

**Interfaces:**
- Consumes: `WebhookHealthService`, `EndpointProbe` (Tasks 1–2); `ClickupModule` (exports `ClickupWebhooksService`); `AdminModule` (exports `AuditLogRepository`).
- Produces: `WebhookHealthModule` registered in `AppModule` — activates the `@Cron`.

- [ ] **Step 1: Add the env flag**

In `src/config/env.validation.ts`, add this line inside the `z.object({ ... })` block, immediately after the `MAIL_FROM: ...` line and before the closing `})` that begins `.superRefine`:

```ts
  // Auto-heal suspended ClickUp webhooks on a 15-min cron. Enum+transform (not
  // z.coerce.boolean, which treats the string "false" as true) so it can be disabled.
  WEBHOOK_AUTOHEAL_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
```

- [ ] **Step 2: Document the flag in `.env.example`**

Append to `.env.example`:

```env
# Auto-heal (reactivate) a suspended ClickUp webhook on a 15-minute cron.
# Set to false to disable. Default: true.
WEBHOOK_AUTOHEAL_ENABLED=true
```

- [ ] **Step 3: Create the module**

Create `src/clickup/webhook-health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ClickupModule } from './clickup.module';
import { AdminModule } from '../admin/admin.module';
import { WebhookHealthService } from './webhook-health.service';
import { EndpointProbe } from './endpoint-probe';

// Separate module (not folded into ClickupModule) because it needs AuditLogRepository
// from AdminModule, and AdminModule already imports ClickupModule — importing it back
// would be a circular dependency. ScheduleModule.forRoot() is global in AppModule, so
// the @Cron in WebhookHealthService is picked up without importing ScheduleModule here.
@Module({
  imports: [ClickupModule, AdminModule],
  providers: [WebhookHealthService, EndpointProbe],
})
export class WebhookHealthModule {}
```

- [ ] **Step 4: Register the module in AppModule**

In `src/app.module.ts`, add the import near the other module imports (after the `AdminModule` import line):

```ts
import { WebhookHealthModule } from './clickup/webhook-health.module';
```

Then add `WebhookHealthModule` to the `imports: [...]` array (place it right after `AdminModule`):

```ts
    AdminModule,
    WebhookHealthModule,
```

- [ ] **Step 5: Build and run the full test suite**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (confirms module wiring and DI graph resolve — no circular-dependency error).

Run: `npx jest test/endpoint-probe.spec.ts test/webhook-health.service.spec.ts`
Expected: PASS (14 passing total).

- [ ] **Step 6: Commit**

```bash
git add src/clickup/webhook-health.module.ts src/config/env.validation.ts src/app.module.ts .env.example
git commit -m "feat(clickup): wire webhook auto-heal cron + WEBHOOK_AUTOHEAL_ENABLED flag"
```

---

### Task 4: Verification gate — drive the real reactivation flow

This task verifies the core unverified assumption from the spec: that ClickUp's `PUT status:active` (via `register()`) actually reactivates a **suspended** webhook, rather than requiring delete + recreate. Unit tests cannot prove this. **Do not skip.**

**Files:** none (observation/verification only).

- [ ] **Step 1: Confirm a suspended webhook exists**

Load the Settings page ("Registered on ClickUp" card) or call `GET /admin/webhooks`. Confirm the configured webhook shows `health.status` = `suspended` (at time of writing, id `1299de6e-f1cc-4a23-af20-b3097770f4d8`). If none is suspended, note that the live reactivation path could not be exercised and flag it — do not claim it verified.

- [ ] **Step 2: Verify the endpoint is actually reachable**

Confirm `CLICKUP_WEBHOOK_ENDPOINT` responds to an outbound GET with a status `< 500` (e.g. `curl -s -o /dev/null -w "%{http_code}" https://log.niftyitsolution.com/api/webhooks/clickup` → expect `401`/`404`/`405`). This is the same signal `EndpointProbe` uses; if it returns `000`/`5xx`, the cron would (correctly) skip healing.

- [ ] **Step 3: Trigger the heal path**

Either wait for the next 15-minute cron tick with the app running, or trigger the equivalent action manually via `POST /admin/webhooks/register` (the same `register()` call the cron makes). Re-fetch `GET /admin/webhooks`.

Expected: the configured webhook's `health.status` is now `active`.

- [ ] **Step 4: Confirm the audit trail (cron path only)**

If the heal happened via the cron (not the manual endpoint), open `/audit-log` (or query `admin_audit_log` filtered by `routePattern = '/system/webhook-autoheal'`). Expect one row with `actor = 'system:webhook-autoheal'` and `requestBody` containing the healed `webhookId` and `previousStatus`.

- [ ] **Step 5: Record the result**

If `PUT status:active` reactivated the webhook → the design holds; note it verified. If ClickUp did NOT reactivate it (status stayed suspended / required delete+recreate) → STOP and report: the heal action in `WebhookHealthService` and `ClickupWebhooksService.register()` both need to switch to delete-then-recreate. This is a design change, not a bug fix — surface it before proceeding.

---

## Self-Review

**1. Spec coverage:**
- Component / new service + module → Tasks 2, 3. ✓
- Cron schedule (6-field) → Task 2 (Global Constraints + code comment). ✓
- Heal logic (flag → listRegistered → select configured → healthy no-op → verify-then-heal) → Task 2. ✓
- Endpoint probe (GET, <500 = reachable, 5s timeout, injectable) → Task 1. ✓
- Backoff cap (in-memory, 3/hour) → Task 2 (code + test). ✓
- Env flag (enum+transform) + defensive read + `.env.example` → Tasks 2 (read) & 3 (schema + docs). ✓
- Audit log (synthetic shape, `/system/webhook-autoheal`) → Task 2. ✓
- Module wiring (new module, no cycle) → Task 3. ✓
- Testing (all listed unit cases) → Tasks 1–2. ✓
- Verification gate (real reactivation) → Task 4. ✓
- Multi-instance note → accepted, no task required (documented in spec). ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**3. Type consistency:** `checkAndHeal`, `probe`, `listRegistered`, `register`, `create`, `health.status`/`health.failCount`, `configuredEndpoint`, and the `AuditLogCreateInput` shape are used identically across tasks and match the verified source signatures. ✓

# Webhook auto-heal cron — design

Date: 2026-07-20
Status: Approved (pending spec review)

## Problem

ClickUp auto-suspends a webhook after a run of consecutive delivery failures
(endpoint down during a deploy, TLS/proxy hiccup, timeouts, non-2xx responses).
Once suspended, ClickUp stops delivering real-time events to
`CLICKUP_WEBHOOK_ENDPOINT`. Today nothing reactivates it: the only code path that
re-subscribes a suspended webhook is the **manual** `POST /admin/webhooks/register`
action (`ClickupWebhooksService.register()`). Until an Owner clicks Register, the
webhook stays suspended — real-time sync is silently degraded (the 12h backfill
reconciliation in `src/sync/sync.scheduler.ts` still recovers the data, just late).

The Settings "Registered on ClickUp" card surfaces the suspended state as an amber
pill but takes no action.

## Goal

Add a scheduled health-check that **auto-heals** a suspended/failing webhook —
but only when it's safe to do so, and without creating a flapping loop against a
still-broken endpoint.

## Non-goals

- No new UI. The existing amber pill already reflects live status; heals appear in
  `/audit-log`.
- No change to the 12h backfill reconciliation — it remains the data-loss safety
  net for any window where the endpoint is down.
- No touching of stale/duplicate webhooks (endpoint ≠ configured). Those are
  `prune-stale`'s job, not auto-heal's.

## Component

New `WebhookHealthService` (`src/clickup/webhook-health.service.ts`) with one
`@Cron` method that runs every 15 minutes.

New `WebhookHealthModule` (`src/clickup/webhook-health.module.ts`) that:
- imports `ClickupModule` (for `ClickupWebhooksService`),
- imports `AdminModule` (for `AuditLogRepository`),
- declares `WebhookHealthService` as a provider,
- is imported by `AppModule`.

### Why a new module (not ClickupModule, not SyncModule)

`AdminModule` already imports `ClickupModule`, so importing `AdminModule` back into
`ClickupModule` would create a circular dependency. A dedicated `WebhookHealthModule`
that imports both `ClickupModule` and `AdminModule` avoids the cycle (`AdminModule`
does not import `WebhookHealthModule`), needs no `forwardRef`, and keeps
`ClickupModule` clean. `ScheduleModule.forRoot()` is already global in `AppModule`,
so the `@Cron` decorator is picked up with no extra import.

## Cron schedule

```ts
@Cron('0 */15 * * * *') // 6-field, seconds-first: sec=0, min=*/15 → :00 :15 :30 :45
```

This is the **6-field** form matching `SyncScheduler` (`'0 0 */12 * * *'`). It fires
four times an hour. NOTE: the 5-field form `'0 */15 * * *'` would mean
`min=0, hour=*/15` → only 00:00 and 15:00 daily. The seconds-first 6-field form is
required. The implementation must confirm the schedule enumerates 15-minute
intervals.

## Heal logic (per run)

1. **Flag check.** If auto-heal is disabled (see Env flag), return immediately.
2. **Read state.** Call the existing `ClickupWebhooksService.listRegistered()` to get
   the configured endpoint + every registered webhook with its `health.status` /
   `health.failCount`.
3. **Select target.** Find the single webhook whose `endpoint === configuredEndpoint`.
   Never consider webhooks on other endpoints (stale/duplicate).
4. **Healthy → done.** If no matching webhook exists, or its `health.status` is
   `active` (or health is absent), log at debug and return. No audit row.
5. **Not active → verify then heal.** If `health.status !== 'active'`
   (suspended/failing):
   a. **Backoff cap check** (see below). If this webhook has already been healed
      `MAX_HEALS_PER_HOUR` times in the trailing hour, do NOT heal again — instead
      `logger.error("auto-heal not sticking for <id>; manual intervention needed")`
      and return. No audit row (the failure is logged, not audited as a heal).
   b. **Endpoint probe.** Verify the public endpoint is reachable (see Endpoint
      probe). If **down** → `logger.warn("skipping heal; endpoint still unreachable")`,
      no reactivation, no audit row, no attempt recorded. Retry next run.
   c. **Heal.** If reachable → call `ClickupWebhooksService.register()`. This
      re-subscribes in place via ClickUp `PUT status:active`, corrects any event
      drift, and preserves the signing secret. Record the heal attempt timestamp
      (for the backoff cap). Write one audit row + `logger.log` an info line.

Reusing `register()` keeps all ClickUp-facing webhook logic in one place — no
duplicated PUT and no divergence from the manual Register behavior.

## Endpoint probe

The cron runs *inside* the app, so "is the app alive" is meaningless. The
meaningful check is that ClickUp's delivery path works end-to-end: DNS + TLS +
reverse proxy + app.

- Outbound `GET` to the public `CLICKUP_WEBHOOK_ENDPOINT` using Node 22 global
  `fetch` with a 5s `AbortController` timeout.
- **Reachable** = an HTTP response with status `< 500`. The route is POST-only and
  signature-guarded, so a `GET` returns `404`/`405`/`401` — that still proves the
  whole path is up.
- **Down** = network error, DNS failure, timeout, or a `5xx` response.

For testability the probe lives behind a tiny injectable `EndpointProbe`
(`src/clickup/endpoint-probe.ts`) with `probe(url: string): Promise<boolean>`,
mocked in unit tests so we never touch global `fetch` in tests.

### Known limitation (accepted)

The probe closes the **endpoint-down** flavor of flapping, but a webhook can be
GET-reachable while ClickUp's **POST** deliveries still fail (e.g. wrong signing
secret, guard rejecting legitimate deliveries, 5xx only on POST). In that case:
probe passes → heal → ClickUp re-suspends → next run heals again. The **backoff
cap** (below) bounds this loop; it is the intended safety valve for this tail case.

## Backoff cap (anti-flap safety valve)

In-memory per-webhook attempt tracker on the service instance:

```ts
private healAttempts = new Map<string /*webhookId*/, number[] /*timestamps*/>();
const MAX_HEALS_PER_HOUR = 3;
```

Before healing, prune timestamps older than 1 hour; if `>= MAX_HEALS_PER_HOUR`
remain, skip + `logger.error`. Otherwise heal and push `Date.now()`.

Caveat (documented, not fixed): the tracker is in-memory, so a process restart or a
second app instance resets it. This is an acceptable safety valve, not a
distributed guarantee. Worst case is a few extra heals per hour — `register()` is
idempotent.

## Env flag

Add to the zod schema in `src/config/env.validation.ts`:

```ts
WEBHOOK_AUTOHEAL_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
```

Rationale: `z.coerce.boolean()` treats the non-empty string `"false"` as `true`, so
operators could not actually disable the feature. The enum+transform makes
`WEBHOOK_AUTOHEAL_ENABLED=false` genuinely disable it.

Add `WEBHOOK_AUTOHEAL_ENABLED=true` to `.env.example` with a short comment.

### Defensive read (do NOT trust ConfigService to return a boolean)

There is no existing boolean env flag in this codebase, so there is no proven
representation. `ConfigService.get()` can return the raw `process.env` string
(`"false"`, which is truthy) rather than zod's transformed boolean, depending on how
the validated config merges with `process.env`. Boolean is uniquely exposed to this
(numeric flags are masked by JS coercion). The service must normalize defensively:

```ts
const raw = this.config.get('WEBHOOK_AUTOHEAL_ENABLED', true);
const enabled = raw === true || raw === 'true';
```

This resolves correctly whether `raw` is a boolean or a string. A unit test must
cover BOTH representations (`true`/`false` booleans and `'true'`/`'false'` strings),
and the implementer must check `typeof this.config.get('WEBHOOK_AUTOHEAL_ENABLED')`
at real runtime and confirm the disable path fires.

## Audit log

The `admin_audit_log` table is HTTP-request-shaped
(`actor`/`method`/`path`/`routePattern`/`statusCode`/`requestBody` JSON) — no
action/target/metadata columns. Each successful heal writes one row via
`AuditLogRepository.create()` (the same repository the interceptor uses) with a
synthetic, clearly-non-HTTP shape:

```ts
await this.auditLog.create({
  actor: 'system:webhook-autoheal',
  method: 'CRON',
  path: '/system/webhook-autoheal',
  routePattern: '/system/webhook-autoheal',
  statusCode: 200,
  durationMs: null,
  ip: null,
  userAgent: null,
  requestBody: { webhookId, previousStatus, failCount },
  errorMessage: null,
});
```

A **distinct** `/system/webhook-autoheal` path (not the real `/admin/webhooks/register`
route) makes it unambiguous in `/audit-log` that this was an automated system action,
not a masquerading HTTP call. The `actor` `system:webhook-autoheal` reinforces it.

Only successful heals are audited. Skips (endpoint down, backoff cap reached) are
logged (`warn`/`error`) but not audited.

## Verification gate (must run before declaring done)

The core assumption — that ClickUp's `PUT status:active` **reactivates a suspended
webhook** (vs. requiring delete + recreate) — is unverified. It is the same path
manual Register uses, but nobody has clicked Register against the currently-suspended
webhook. Before completion, drive the real flow against the live suspended webhook
(id `1299de6e-f1cc-4a23-af20-b3097770f4d8` at the time of writing) and confirm the
status flips to `active`. If ClickUp requires delete+recreate instead, the heal
action in step 5c changes (and `register()`'s reactivation behavior would need
revisiting too). Unit tests alone cannot verify this.

### Multi-instance note (accepted)

If the app ever runs multiple instances, each instance's cron fires → N heals + N
audit rows per suspended window. This is benign (`register()` is idempotent) and
consistent with the existing crons (`SyncScheduler`, `SessionCleanupService`), which
are likewise unguarded against multi-instance duplication. Not fixed here.

## Testing

`WebhookHealthService` unit tests with mocked `ClickupWebhooksService`,
`AuditLogRepository`, `ConfigService`, and `EndpointProbe`:

1. Flag off (both `false` boolean and `'false'` string) → no `listRegistered`, no heal.
2. Flag on via `'true'` string → proceeds (guards the ConfigService-string trap).
3. Configured webhook `active` → no heal, no audit.
4. No matching webhook for configured endpoint → no heal, no audit.
5. Suspended + probe returns down → `warn`, no `register()`, no audit, no attempt recorded.
6. Suspended + probe returns up → `register()` called once, one audit row with the
   expected synthetic shape.
7. Suspended + probe up, healed `MAX_HEALS_PER_HOUR` times already → `error`, no
   `register()`, no audit.
8. Only the configured-endpoint webhook is targeted when multiple webhooks exist
   (stale ones ignored).

`EndpointProbe` unit tests (mocked `fetch`): `<500` → true; `5xx` → false; thrown
error/timeout → false.

## Files touched

- `src/clickup/webhook-health.service.ts` (new)
- `src/clickup/webhook-health.module.ts` (new)
- `src/clickup/endpoint-probe.ts` (new)
- `src/config/env.validation.ts` (add flag)
- `src/app.module.ts` (import `WebhookHealthModule`)
- `.env.example` (document flag)
- `test/webhook-health.service.spec.ts` (new)
- `test/endpoint-probe.spec.ts` (new)

---

## Post-implementation update — ClickUp webhook health docs verified (2026-07-20)

Verified the design against https://developer.clickup.com/docs/webhookhealth after implementation. Outcomes:

- **Core assumption CONFIRMED.** The docs state: "To reactivate it, change the webhook's status back to active using the `PUT /api/v2/webhook/{webhook_id}` request." So `register()`'s `PUT status:active` reactivates a suspended webhook — no delete+recreate needed. The Task 4 verification gate's central risk is resolved.
- **Refinement APPLIED (commit efed672): heal only `suspended`, not any non-active.** ClickUp has three states — Active, Failing, Suspended. A `failing` webhook "still receives events" and "will automatically return to the active state" once a delivery succeeds; only `suspended` stops delivery ("We will stop sending events to that webhook") and requires manual reactivation. So the cron now heals `status === 'suspended'` only, leaving `failing` to self-recover (avoids audit noise and fighting ClickUp's own recovery).
- **Suspension triggers (informs the anti-flap cap):** `fail_count` reaching 100 (after up to 5 retries/event), OR an **immediate** suspend on a `401` or `410` response. `fail_count` resets automatically on recovery. Failed events are NOT resent (the 12h backfill remains the recovery net).
- **Likely root cause + flap risk identified.** Our `WebhookSignatureGuard` throws `UnauthorizedException` (**401**) on a missing/invalid signature (`src/webhooks/webhook-signature.guard.ts:33,36,43`). Per the docs a 401 causes **immediate** suspension. If the stored signing secret is stale/rotated, every ClickUp POST → 401 → immediate re-suspend. Auto-heal would then reactivate → next POST 401 → re-suspend, until the backoff cap stops it. The cap's error message now names this cause and the fix (re-register to refresh the stored secret). Whether to return 403 instead of 401 on bad signatures (403 is NOT an immediate-suspend trigger) is a separate security decision, deliberately NOT changed here.

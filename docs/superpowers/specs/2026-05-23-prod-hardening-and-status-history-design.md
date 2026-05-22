# Production hardening + status-change history — design

Date: 2026-05-23
Author: Rashedul + Claude
Status: approved (brainstorm phase)

## Goal

Three additions, all part of the same production-readiness pass for the internal-only sync service:

1. **Hardening:** in production, missing `CLICKUP_WEBHOOK_SECRET` or `ADMIN_API_KEY` must cause the app to refuse to boot. Today these are silently bypassed with a warning, which is correct for local dev but a landmine for prod.
2. **Admin audit log:** record every write action (`POST | PATCH | DELETE`) against `/admin/*` to a new table. Identity comes from a new `X-Admin-User` header (the existing single shared API key stays).
3. **Status-change history v1:** subscribe to ClickUp's `taskStatusUpdated` webhook event, persist each transition to a new table, expose two report endpoints, and render a cycle-time card on the Overview page. No historical backfill.

## Non-goals

- Real per-user authentication (login, sessions, password hashing). The audit identity is an advisory header, not a gated identity. Internal-only tool, small team. The single shared `ADMIN_API_KEY` continues to be the only gate.
- Per-user API keys / key rotation.
- A deny-by-default hardening mode (always-require keys unless `ALLOW_INSECURE_DEV=true`). NODE_ENV gate is sufficient for this team.
- Auditing GET requests against `/admin/*`. The dashboard polls `/admin/backfill/active` on a tight interval; capturing reads would balloon the table for no investigative value.
- Capturing webhook events other than `taskStatusUpdated` (no `taskMoved`, `taskAssigneeUpdated`, `taskCommentPosted`, etc.). v2 work.
- Backfilling historical status changes from before ship date. ClickUp's API doesn't expose a clean retroactive feed and per-task history fetching would burn the rate-limit budget for incomplete data.
- A snapshot-at-ship row for existing tasks. Reports will simply say "data available from {first occurredAt} onward" and exclude older tasks.
- A REST endpoint for the audit log beyond a simple paginated viewer; the audit log itself is not audited.
- Alerts on audit gaps, audit-row failures, or unattributed actions (no `X-Admin-User` header). v2.

## Decisions locked in (from brainstorm)

- **Admin identity model:** single shared `ADMIN_API_KEY` + advisory `X-Admin-User` header. Recorded on every audit row; absent → `actor = null`.
- **Hardening trigger:** `NODE_ENV === 'production'`. Anything else (`development`, unset, `test`) preserves today's "bypass with warning" dev behavior.
- **Audit scope:** write methods only (`POST | PATCH | DELETE`). GETs skipped at the top of the interceptor.
- **Events to capture in v1:** only `taskStatusUpdated`. Table shape is generic so v2 can add types without migration.
- **Seed strategy:** no backfill. History starts at ship time.
- **Consumer in v1:** captured table + report endpoints + an in-app cycle-time card on the existing Overview page (not just SQL examples).
- **Audit capture mechanism:** NestJS interceptor on `AdminController` (not per-endpoint decorator). Internal-only tool — interceptor cannot be silently bypassed by a forgotten annotation on a new endpoint.
- **Event table shape:** generic `(task_id, event_type, before, after, ...)` with JSON before/after columns. v2 event types add a new `event_type` value, no schema migration.

---

## Section 1 — Architecture

Three features, each contained within its existing module. No new NestJS modules. No new BullMQ queues. No new workers.

```
Feature 1: Production hardening
  src/config/env.validation.ts                  — extend: prod requires secrets present
  src/webhooks/webhook-signature.guard.ts       — change: bypass branch only reachable outside prod
  src/admin/admin-api-key.guard.ts              — same change

Feature 2: Admin audit log
  prisma/schema.prisma                          — new model: AdminAuditLog
  src/admin/audit-log.interceptor.ts            — new: NestJS interceptor, applied to AdminController
  src/admin/audit-log.repository.ts             — new: write + paginated read
  src/admin/admin.controller.ts                 — add: @Get('audit-log') paginated viewer
  apps/web/src/pages/AuditLogPage.tsx           — new: read-only dashboard page
  apps/web/src/components/layout/Sidebar.tsx    — add link under a new "Operations" group

Feature 3: Status-change history v1
  prisma/schema.prisma                          — new model: ClickupTaskEvent
  src/clickup/clickup-webhooks.service.ts       — add 'taskStatusUpdated' to subscribed events
  src/webhooks/webhook-parser.service.ts        — extend parser to extract per-history_item status changes
  src/workers/clickup-event.processor.ts        — add branch to persist status-change rows
  src/reports/reports.service.ts                — add cycleTime() + timeInStatus() methods
  src/reports/reports.controller.ts             — add GET /reports/cycle-time, GET /reports/time-in-status
  apps/web/src/components/charts/CycleTimeCard.tsx  — new tabbed chart card
  apps/web/src/pages/OverviewPage.tsx           — add CycleTimeCard
```

**Cross-feature contract.** The audit interceptor only sees `AdminController`. The status-event flow stays inside the existing `webhooks → clickup-webhooks queue → clickup-event.processor` pipeline; it does not interact with audit at all (webhooks don't carry an admin identity). The hardening change is observable at boot and at request time; neither audit nor status-history depends on it semantically.

---

## Section 2 — Schema changes

One Prisma migration: `0002_admin_audit_and_task_events`. Pure additive — no changes to existing models, no backfill.

### 2.1 AdminAuditLog

```prisma
model AdminAuditLog {
  id           BigInt   @id @default(autoincrement())
  occurredAt   DateTime @default(now()) @map("occurred_at")
  actor        String?                                       // value of X-Admin-User header; null if absent
  method       String                                        // 'POST' | 'PATCH' | 'DELETE'
  path         String                                        // e.g. /admin/rates/42
  routePattern String?  @map("route_pattern")                // e.g. /admin/rates/:id — for grouping
  statusCode   Int      @map("status_code")
  durationMs   Int?     @map("duration_ms")
  ip           String?
  userAgent    String?  @map("user_agent")
  requestBody  Json?    @map("request_body")                 // captured pre-handler, redacted, ≤16 KB
  errorMessage String?  @map("error_message")                // populated on non-2xx

  @@index([occurredAt])
  @@index([actor, occurredAt])
  @@index([routePattern, occurredAt])
  @@map("admin_audit_log")
}
```

**Notes:**
- `requestBody` is captured before the handler runs. Recursive walk redacts any key matching `/(secret|token|api[_-]?key|password|signature)/i` to `"[REDACTED]"`. Webhook secrets and rate amounts (the latter non-sensitive) still land in the row.
- `routePattern` is sourced from `request.route?.path` (Express populates this from `@Post('rates/:id')`). Falls back to the literal `path` if unavailable.
- No `currency` field — operational/analytics table, not money. The `currency-aud-usd-debt` rename does not apply.

### 2.2 ClickupTaskEvent

```prisma
model ClickupTaskEvent {
  id                BigInt   @id @default(autoincrement())
  taskId            String   @map("task_id")
  eventType         String   @map("event_type")              // 'taskStatusUpdated' in v1
  occurredAt        DateTime @map("occurred_at")             // history_items[].date from ClickUp
  changedByUserId   String?  @map("changed_by_user_id")      // history_items[].user.id (coerced to string)
  changedByUserName String?  @map("changed_by_user_name")
  before            Json?                                    // { status: "open", color: "#…", type: "open" }
  after             Json?                                    // { status: "in progress", color: "#…", type: "custom" }
  fingerprint       String   @unique                         // sha256(taskId + eventType + occurredAt + before + after)
  raw               Json?                                    // the history_item entry verbatim

  @@index([taskId, occurredAt])
  @@index([eventType, occurredAt])
  @@map("clickup_task_events")
}
```

**Notes:**
- `fingerprint` is the dedupe key. Re-receiving a webhook (ClickUp retries) inserts once. Same idea as `ClickupWebhookSeen` but at the *history-item* level, not the *delivery* level — one webhook can carry multiple `history_items` and they're each their own change.
- **No FK** from `taskId` → `ClickupTask`. Status events for tasks not (yet) in our DB still write. The existing webhook flow already enqueues a task sync separately; we do not couple status capture to task presence.
- `before` may be null on initial status assignment (task created with status). Reports filter accordingly.

---

## Section 3 — Component & flow details

### 3.1 Feature 1: Production hardening

**`src/config/env.validation.ts`** — the file uses Zod. Replace the two `.optional().default('')` lines with a refinement that's prod-aware:

```ts
const schema = z.object({
  // … existing fields unchanged …
  CLICKUP_WEBHOOK_SECRET: z.string().default(''),
  ADMIN_API_KEY:          z.string().default(''),
  // … rest unchanged …
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.CLICKUP_WEBHOOK_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['CLICKUP_WEBHOOK_SECRET'],
      message: 'Required when NODE_ENV=production' });
  }
  if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY.length < 32) {
    ctx.addIssue({ code: 'custom', path: ['ADMIN_API_KEY'],
      message: 'Required (min 32 chars) when NODE_ENV=production' });
  }
});
```

The existing `validateEnv()` function already throws on `safeParse` failure, which aborts Nest startup. No new boot-path code.

**Also extend the `CLICKUP_WEBHOOK_EVENTS` default** (same file) to include `taskStatusUpdated`:

```ts
CLICKUP_WEBHOOK_EVENTS: z.string().default(
  'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated'
),
```

**Guards** — `webhook-signature.guard.ts` and `admin-api-key.guard.ts` keep their runtime check as defense-in-depth, but the bypass branch becomes prod-aware:

```ts
if (!secret) {
  if (process.env.NODE_ENV === 'production') {
    // Should never reach — env validation catches this at boot — defense-in-depth only.
    throw new InternalServerErrorException('Secret missing in production');
  }
  this.logger.warn('… not set — bypassing auth (dev mode only)');
  return true;
}
```

**Behavior:**
- `NODE_ENV=production` + key missing → app refuses to start with a clear error
- `NODE_ENV=production` + key present → normal verification on every request
- `NODE_ENV` unset / `development` / `test` → today's behavior (warn + bypass) preserved

### 3.2 Feature 2: Admin audit log

**`AuditLogInterceptor`** — registered on `AdminController` via `@UseInterceptors(AuditLogInterceptor)` at the controller class level.

Flow:

```
incoming /admin/* request
  ↓
  if method ∈ {GET}: pass through, no row written
  if method ∈ {POST, PATCH, DELETE}:
    record startTime
    capture method, path, routePattern, actor (X-Admin-User), ip, userAgent
    redact + truncate requestBody
  ↓
  invoke handler via .pipe(tap(success), catchError(error))
  ↓                          ↓
  success                    error
  ↓                          ↓
  write row                  write row
  (statusCode, durationMs)   (statusCode from exception filter, errorMessage)
```

**Implementation notes:**

- **Body redaction.** Recursive walk of the request body. Keys matching `/(secret|token|api[_-]?key|password|signature)/i` (case-insensitive) → replaced with `"[REDACTED]"`. Runs before any JSON serialization.
- **Body truncation.** If `JSON.stringify(body).length > 16384`, store `{ "_truncated": true, "preview": <first 16 KB> }`.
- **Redaction failure.** The redaction walk is wrapped in try/catch. On failure (cyclic object, weird payload), store `{ "_redactionError": true }` as the body. Never blocks the audit insert.
- **Audit write is fire-and-forget.** `.catch(logger.error)`. A failed audit insert must not break the admin action. We accept silent gaps as a v1 trade-off; alerting is v2.
- **No transaction with the handler.** Audit only writes on response emit (or caught error), so the inverse (audit succeeds, handler doesn't) can't happen. The forward case (handler succeeds, audit fails) is acceptable per above.
- **Interceptor robustness.** The `intercept()` body is itself wrapped in try/catch; on any internal interceptor error, the request passes through unaudited with a log line. The interceptor cannot break admin requests.

**Viewer endpoint** — `GET /admin/audit-log`:

```
Query params:
  limit         number, default 50, max 200
  offset        number, default 0
  actor         string, optional
  routePattern  string, optional
  from          ISO date, optional
  to            ISO date, optional

Returns: { items: AuditRow[], total: number }
```

Same response shape as the existing `/admin/dead-letters` endpoint. Not audited (it's a GET).

**Dashboard page** — `apps/web/src/pages/AuditLogPage.tsx`:

- Read-only `DataTable` built on the existing primitive in `components/ui/DataTable.tsx`.
- Columns: occurredAt (relative + absolute on hover), actor, method (Pill), path, statusCode (color-coded), durationMs.
- Click a row → drawer (reusing `Drawer` primitive) showing full `requestBody` and `errorMessage`.
- Routed at `/audit-log`. Added to `Sidebar.tsx` in the same group as `SyncLogsPage` (operational/diagnostic links), placed directly beneath it.

### 3.3 Feature 3: Status-change history v1

**Webhook subscription** — `clickup-webhooks.service.ts` `register()` already builds the events list. Add `'taskStatusUpdated'`. Re-running `register()` is idempotent (the service diffs against the existing webhook).

**Parser** — `webhook-parser.service.ts`. Extend with an `extractStatusChanges(payload)` helper that:

1. Returns `[]` if `payload.history_items` is missing or empty.
2. For each `history_items[i]` where `field === 'status'`, emit:
   ```ts
   {
     occurredAt: new Date(Number(item.date)),       // ms epoch
     changedByUserId: item.user?.id != null ? String(item.user.id) : null,
     changedByUserName: item.user?.username ?? null,
     before: item.before ?? null,
     after:  item.after  ?? null,
     raw:    item,
   }
   ```
3. ClickUp doc explicitly notes `history_items[].user.id` is an integer, not a string. Coerce.

The existing parsed event continues to flow through the existing webhook write path unchanged. The extracted status changes are passed through alongside as an optional property; the existing webhook event row in `ClickupWebhookEvent` is unaffected.

**Worker** — `clickup-event.processor.ts`. Add a branch on `eventType === 'taskStatusUpdated'`:

```ts
for (const item of statusChanges) {
  const fingerprint = sha256(
    [taskId, eventType, item.occurredAt.toISOString(),
     JSON.stringify(item.before), JSON.stringify(item.after)].join('|')
  );
  try {
    await prisma.clickupTaskEvent.upsert({
      where: { fingerprint },
      create: {
        taskId,
        eventType,
        occurredAt: item.occurredAt,
        changedByUserId: item.changedByUserId,
        changedByUserName: item.changedByUserName,
        before: item.before,
        after: item.after,
        fingerprint,
        raw: item.raw,
      },
      update: {},  // dedupe — re-deliveries are no-ops
    });
  } catch (err) {
    // Per-item catch so one bad item in a batch doesn't fail the whole job.
    this.logger.error(`Failed to persist task event for ${taskId}`, err);
  }
}
```

Event-item-layer dedupe via `fingerprint`. The existing `ClickupWebhookSeen` delivery-layer dedupe remains as the outer guard.

**Reports** — two new methods on `reports.service.ts`:

```ts
cycleTime(args: { from: Date; to: Date; groupBy: 'week' | 'client' | 'department' }):
  Promise<{ bucket: string; meanHours: number; medianHours: number; p90Hours: number; taskCount: number }[]>

timeInStatus(args: { from: Date; to: Date }):
  Promise<{ status: string; color: string | null; totalHours: number; taskCount: number }[]>
```

**`cycleTime()` semantics:**
- Window scope is by *completion date* — a task counts in a bucket if its last `after.type === 'done'` event is in `[from, to)`.
- "Cycle time" for a task = hours between the first event whose `after.type === 'open'` and the last event whose `after.type === 'done'`.
- Tasks that bounced (done → in-progress → done) use first-open to last-done — represents end-to-end calendar time, not just the final pass.
- Tasks without both endpoints in the table are excluded.

**`timeInStatus()` semantics:**
- For each `(task_id)`, walk events in `occurredAt` order. For each consecutive pair, attribute `(next.occurredAt - prev.occurredAt)` to `prev.after.status`. The currently-active status (last event without a successor) attributes time up to `to`.
- Sum across tasks, grouped by status. Returns hours and count of contributing tasks.
- `status` strings come from `after.status`; `color` from `after.color`.

**Endpoints** — `reports.controller.ts`:

```
GET /reports/cycle-time?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=week|client|department
GET /reports/time-in-status?from=YYYY-MM-DD&to=YYYY-MM-DD
```

Response shape matches what the new `CycleTimeCard` consumes; no transformation in the client.

**Widget** — `apps/web/src/components/charts/CycleTimeCard.tsx`:

- Single card. Uses the existing `Tabs` UI primitive with two tabs:
  - **"Cycle time"** — `LineChart` (reusing the existing chart primitive), X = week, Y = mean cycle hours, with median as a fainter line and p90 as a dashed overlay.
  - **"Time in status"** — `BarChart`, X = status name, Y = total hours, bar color = `after.color`.
- Empty state: `"Cycle-time data is captured from {MIN_OCCURRED_AT} onward — older tasks not included."` Both report endpoints return `{ items: […], meta: { minOccurredAt: ISO | null } }` so the card can render the copy without a second round-trip.
- Card placement: new row in `OverviewPage.tsx` beneath the existing cost-trend section. Respects the page's existing date-range scope (uses the same `from`/`to` from the topbar state).

---

## Section 4 — Error handling

Principle: **operational features must not break primary features.** Audit failures don't break admin actions; status-event failures don't break webhook ingestion.

### 4.1 Hardening

| Scenario | Behavior |
|---|---|
| Missing key at boot in prod | Nest startup throws (env validation). Container crash-loops; CI/deploy logs surface. No fallback. |
| Wrong key at runtime | Existing `UnauthorizedException` (401). Unchanged. |
| `req.rawBody` missing (mis-wired middleware) | Existing `UnauthorizedException('Raw body unavailable')`. Unchanged. Smoke test in CI catches regressions in raw-body wiring. |
| `NODE_ENV` accidentally unset in prod | App behaves as dev: keys bypassed. The chosen design does **not** catch this case (deny-by-default was explicitly rejected). Mitigation: startup log line `"App starting in <env> mode"` and a callout in `docs/OPERATIONS.md`. |

### 4.2 Admin audit log

| Scenario | Behavior |
|---|---|
| Audit row insert fails (DB blip) | Caught with `.catch(logger.error)`. Admin action still succeeds. Silent gap accepted. |
| Body redaction throws (cyclic / weird payload) | try/catch wraps walk; store `{ "_redactionError": true }` as body. Insert still happens. |
| Body > 16 KB | Truncate to 16 KB, prepend `{ "_truncated": true }` marker. |
| Missing `X-Admin-User` header | `actor = null`. Row still written. (v2: dashboard alert "N unattributed actions today".) |
| Interceptor itself throws | try/catch wraps the whole `intercept()` body. On any caught error, pass request through unaudited with a log line. Cannot break admin requests. |

### 4.3 Status-change history

| Scenario | Behavior |
|---|---|
| Parser can't find `history_items` | Emit zero events, log at warn. Existing webhook flow unaffected. |
| `before` / `after` missing one side | Still write the row; affected side null. Reports filter for "transition" metrics. |
| Status event arrives for a task not in `clickup_tasks` | Write the event anyway (no FK). Existing webhook flow enqueues the task sync separately. Do not enqueue extra fetches from this path. |
| Fingerprint collision (sha256, vanishingly unlikely) | Upsert is no-op. Acceptable silent dedupe. |
| Worker throws on a single event in a multi-event payload | Per-item try/catch. Other items still written. Failed item logged with task/event context. |
| ClickUp re-emits old `taskStatusUpdated` (post-webhook-registration backfill) | `occurredAt` from `history_items[].date` is source of truth, not `now`. Reports use `occurredAt`, so this is correct by construction. |

---

## Section 5 — Testing

Stack: existing Jest + Supertest pattern (`.spec.ts` colocated). No new test infra.

### 5.1 Hardening

**Unit:**
- `env.validation.spec.ts` — table of `{NODE_ENV, hasSecret, hasAdminKey, expectThrow}`:
  - prod + both → ok
  - prod + missing webhook secret → throws
  - prod + missing admin key → throws
  - dev + both missing → ok
- `webhook-signature.guard.spec.ts` — extend (or add): `NODE_ENV=production` + missing secret throws `InternalServerErrorException`.
- `admin-api-key.guard.spec.ts` — same shape.

**Integration:** none specific — env validation runs at module init and is exercised by every other integration test that boots the app.

### 5.2 Admin audit log

**Unit:** `audit-log.interceptor.spec.ts`
- GET request → no row written.
- POST 2xx → row written with method, path, statusCode, durationMs.
- POST 4xx → row written with errorMessage and non-2xx statusCode.
- Body `{ secret: 'pk_…', apiKey: '…', signature: '…' }` → all replaced with `[REDACTED]`.
- Body `{ outer: { token: '…' } }` → nested key redacted.
- Body > 16 KB → truncated, `_truncated` marker set.
- Cyclic body → `_redactionError` marker set, insert still happens.
- Repository `.create` rejects → caught; handler result still returned.
- `X-Admin-User` missing → row written with `actor: null`.

**Unit:** `audit-log.repository.spec.ts`
- Find/filter (actor, routePattern, from/to) returns correct rows in correct order.

**Integration (Supertest):**
- `POST /admin/rates` with body and `X-Admin-User: rashedul` → row in `admin_audit_log` with that actor and method=POST.
- `GET /admin/audit-log` → returns rows, no audit row written for the GET itself.

### 5.3 Status-change history

**Unit:** `webhook-parser.service.spec.ts` (extend)
- `taskStatusUpdated` payload with one status `history_item` → one normalized record, before/after/changedByUserId correct.
- Payload with mixed `history_items` (status, priority, due) → only the status items emitted.
- Payload with `history_items` missing or empty → zero, no throw.
- `history_items[].user.id` as integer → coerced to string.

**Unit:** `clickup-event.processor.spec.ts` (extend)
- Receives a status-change event → upserts row.
- Second delivery of same event → no duplicate (fingerprint dedupe).
- One history_item in a 3-item batch throws → other two still written; failed one logged.

**Unit:** `reports.service.spec.ts` (new)
- `cycleTime()` with seeded events for 5 tasks (3 reached done, 2 didn't) → 3 in the result; mean/median/p90 match hand-calculated values.
- `cycleTime()` with no events in window → empty.
- `timeInStatus()` with seeded events → status durations match hand-calculated sums.
- Task that bounces (done → in-progress → done) → time-in-status sums both `done` periods; cycle-time uses first-open-to-last-done.

**Integration:**
- POST a real-shape signed ClickUp webhook payload to `/webhooks/clickup` → row appears in `clickup_task_events`.
- `GET /reports/cycle-time?from=…&to=…&groupBy=week` → returns expected shape.

### 5.4 Frontend
- No new unit tests for `AuditLogPage` / `CycleTimeCard` — matches the existing pattern (no React tests in `apps/web/`).
- Manual verification list in this spec:
  1. Trigger a backfill via `POST /admin/backfill` with `X-Admin-User: rashedul`; load `/audit-log`; row visible with actor "rashedul".
  2. Click the row; drawer opens with the (redacted) request body.
  3. In ClickUp, move a task to a new status; within ~10s a row appears in `clickup_task_events`.
  4. Overview page shows the cycle-time card; both tabs render without error; empty-state copy correct when no done-events in the window.

### 5.5 Test data
- `clickup-status-update.fixture.json` colocated with the parser spec — real-shape sample, tokens redacted.

---

## Out-of-scope follow-ups for future specs

- Audit gap alerting (`POST /admin/audit-log/alerts` consumer, dashboard banner on unattributed runs).
- v2 status-event types (`taskMoved`, `taskAssigneeUpdated`, `taskPriorityUpdated`).
- Per-user API keys / proper login.
- Cycle-time widget on per-client and per-department drill-downs.
- A `clickup_task_events`-based "blocked task" detector keyed off `comment.replies.count` and time-in-status.

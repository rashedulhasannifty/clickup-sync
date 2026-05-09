# Production Readiness Sprint — Design Spec

Date: 2026-05-10

## Goal

Bring the NestJS ClickUp sync service from "starter" to "production ready" in one focused sprint. Three independent pieces that are all required before cutting over from n8n:

1. Webhook signature verification
2. Admin endpoints (manual triggers + webhook registration + dead-letter retry)
3. Supporting wiring (env, repository extensions, module registration)

---

## 1. Webhook Signature Verification

### Problem

`POST /webhooks/clickup` currently accepts any POST request. Before pointing ClickUp at the live endpoint, incoming requests must be verified against the HMAC-SHA256 signature ClickUp sends.

### How ClickUp signing works

ClickUp sends an `X-Signature` header on every webhook request. The value is `HMAC-SHA256(rawBody, webhookSecret)` where `webhookSecret` is the `secret` returned when the webhook was registered.

Known existing webhook secret (n8n): `UDA06C1Y67U8KD4C997CTC773GF6AH5YLU9MINA66UQCE5IL85IK0YVVA2FGEX9W`

### Changes

**`src/main.ts`**
Add `rawBody: true` to `NestFactory.create(AppModule, { bufferLogs: true, rawBody: true })`. NestJS exposes `req.rawBody` as a `Buffer` only when this flag is set. The JSON body parser still runs normally; `rawBody` is additive.

**`src/webhooks/webhook-signature.guard.ts`** (new file)
- Implements `CanActivate`
- Reads `x-signature` header from request
- Computes `HMAC-SHA256(req.rawBody, CLICKUP_WEBHOOK_SECRET)` using Node's `crypto.createHmac`
- Compares with `timingSafeEqual` to prevent timing attacks
- If `CLICKUP_WEBHOOK_SECRET` is empty: logs a warning and returns `true` (dev-mode pass-through)
- If header missing or mismatch: throws `UnauthorizedException`

**`src/webhooks/webhooks.module.ts`**
Register `WebhookSignatureGuard` as a provider. Apply it to `ClickupWebhookController` via `@UseGuards(WebhookSignatureGuard)`.

### Dev/staging behaviour

Set `CLICKUP_WEBHOOK_SECRET=` (empty) in `.env` to skip verification locally. Guard logs: `"CLICKUP_WEBHOOK_SECRET not set — skipping signature verification (dev mode)"`.

---

## 2. Admin Module

### New module: `src/admin/`

All endpoints under `/admin`. Protected by `AdminApiKeyGuard`.

### Security: `AdminApiKeyGuard`

- Reads `x-admin-key` header
- Compares with `ADMIN_API_KEY` env var using `timingSafeEqual`
- If `ADMIN_API_KEY` is empty: warns and passes (dev mode, same pattern as signature guard)
- If header missing or mismatch: throws `UnauthorizedException`

### Endpoints

#### `POST /admin/tasks/sync`

Manually trigger a task sync for a single ClickUp task.

Request body:
```json
{ "taskId": "86abc123" }
```

Response: `{ "queued": true, "taskId": "86abc123" }`

Behaviour: Validates `taskId` is a non-empty string, queues `SYNC_CLICKUP_TASK` job on `clickup-tasks` queue.

---

#### `POST /admin/backfill`

Trigger a space backfill for a configurable lookback window.

Request body:
```json
{ "spaceId": "3577824", "lookbackDays": 90 }
```

`lookbackDays` is optional — defaults to the value from `CLICKUP_SPACES` config for the given space.

Response: `{ "queued": true, "spaceId": "3577824", "lookbackDays": 90 }`

Validation: `spaceId` must match one of the configured spaces in `CLICKUP_SPACES`. Returns `400` with a clear message if the space is unknown.

---

#### `POST /admin/rates/sync`

Trigger an immediate Google Sheets rate sync.

Response: `{ "queued": true }`

---

#### `POST /admin/webhooks/register`

Register the NestJS webhook with ClickUp, avoiding duplicates.

**Flow:**
1. Call `GET /team/{teamId}/webhook` — returns `{ webhooks: [...] }`
2. Check if any existing webhook has `endpoint === CLICKUP_WEBHOOK_ENDPOINT` AND `health.status === 'active'`
3. If found: return `{ action: "existing", webhookId, endpoint }` — no creation, no secret exposed
4. If not found: call `POST /team/{teamId}/webhook` with `CLICKUP_WEBHOOK_ENDPOINT` and events from `CLICKUP_WEBHOOK_EVENTS` config
5. Log: `"New ClickUp webhook registered. Save the secret to CLICKUP_WEBHOOK_SECRET in your .env and restart."`
6. Return: `{ action: "created", webhookId, secret, endpoint }`

The `secret` is only returned on creation (the ClickUp API only gives it once at creation time). The operator saves it to `CLICKUP_WEBHOOK_SECRET` in `.env` and restarts the service.

**ClickUp API shape (from live data):**
```json
{
  "webhooks": [
    {
      "id": "7b57e43b-...",
      "endpoint": "https://...",
      "events": ["taskCreated", ...],
      "health": { "status": "active", "fail_count": 0 },
      "secret": "..."
    }
  ]
}
```

New service: `src/clickup/clickup-webhooks.service.ts` — contains `listWebhooks()` and `createWebhook()` methods. Keeps ClickUp API calls out of the controller.

---

#### `GET /admin/dead-letters`

List unresolved dead-letter jobs for inspection.

Query params: `limit` (default 50, max 200), `offset` (default 0)

Response:
```json
{
  "total": 12,
  "items": [
    {
      "id": "1",
      "queueName": "clickup-tasks",
      "jobName": "sync-clickup-task",
      "entityType": "task",
      "entityId": "86abc123",
      "errorMessage": "...",
      "failedAt": "2026-05-10T...",
      "retriedAt": null
    }
  ]
}
```

---

#### `POST /admin/dead-letters/:id/retry`

Re-queue a failed job from its dead-letter record.

Behaviour:
1. Find record by `id`
2. Return `404` if not found
3. Add job back to `queueName` queue with original `jobName` and `payload` using `QueueService`
4. Set `retried_at = now()` on the record
5. Return `{ "requeued": true, "id": "1", "queueName": "clickup-tasks", "jobName": "sync-clickup-task" }`

---

## 3. Supporting Changes

### `src/config/env.validation.ts`

Add:
```
ADMIN_API_KEY: z.string().optional().default('')
```

### `.env.example`

Add:
```env
ADMIN_API_KEY=your-secret-admin-key
```

### `src/jobs/dead-letter.repository.ts`

Extend with:
- `findPending(limit: number, offset: number)` — `where: { retriedAt: null, resolvedAt: null }`, ordered by `failedAt desc`, returns count + items
- `markRetried(id: bigint)` — sets `retriedAt = new Date()`

### `src/app.module.ts`

Import and register `AdminModule`.

---

## File map

| File | Status |
|---|---|
| `src/main.ts` | Modify — add `rawBody: true` |
| `src/webhooks/webhook-signature.guard.ts` | New |
| `src/webhooks/webhooks.module.ts` | Modify — register guard |
| `src/clickup/clickup-webhooks.service.ts` | New |
| `src/clickup/clickup.module.ts` | Modify — export new service |
| `src/admin/admin.module.ts` | New |
| `src/admin/admin-api-key.guard.ts` | New |
| `src/admin/admin.controller.ts` | New |
| `src/admin/dto/sync-task.dto.ts` | New |
| `src/admin/dto/backfill.dto.ts` | New |
| `src/jobs/dead-letter.repository.ts` | Modify — add findPending, markRetried |
| `src/config/env.validation.ts` | Modify — add ADMIN_API_KEY |
| `.env.example` | Modify — document ADMIN_API_KEY |
| `src/app.module.ts` | Modify — register AdminModule |

---

## What is NOT in scope

- Webhook deletion endpoint (operator deletes n8n webhook manually via ClickUp dashboard after cutover)
- Structured logging overhaul (separate sprint)
- Additional test coverage beyond what's needed for new code
- Any schema migrations (no new Prisma models)

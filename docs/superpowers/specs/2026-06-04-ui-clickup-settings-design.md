# UI-managed ClickUp settings — design

**Date:** 2026-06-04
**Branch:** `feat/ui-clickup-settings`
**Goal:** Let an admin edit ClickUp connection settings (API token, team ID, webhook endpoint/secret/events) from the dashboard **without editing `.env` or redeploying**. Single internal instance; admin auth stays in env.

## Decisions (locked)

- **Scope of UI-editable settings:** `clickupApiToken`, `clickupTeamId`, `webhookEndpoint`, `webhookSecret`, `webhookEvents`. **Not** `CLICKUP_AGENCY_USER_ID` (legacy/unused — only referenced in a comment).
- **Stays in env (required to boot / authenticate):** `DATABASE_URL`, `REDIS_URL`, `ADMIN_API_KEY`, and a new `APP_ENCRYPTION_KEY`.
- **Secrets at rest:** `clickupApiToken` + `webhookSecret` stored **encrypted (AES-256-GCM)**; other fields plaintext.
- **Resolution per field:** DB value → env fallback. No auto-seeding; existing deployments keep working via env until the admin saves in the UI (which then takes over per field).

## Architecture

### Data
New single-row Prisma model `AppSettings` (`app_settings`), enforced to one row via a fixed string PK (`id = "singleton"`). Columns: `clickupApiTokenEnc`, `webhookSecretEnc` (ciphertext text, nullable), `clickupTeamId`, `webhookEndpoint`, `webhookEvents` (nullable text), `updatedAt`, `updatedBy`. New raw-SQL migration `0005_app_settings`.

### CryptoService (`src/settings/crypto.service.ts`)
AES-256-GCM. Key from `APP_ENCRYPTION_KEY` (accepts 64-hex or base64 → 32 bytes; validated). `encrypt(plain) → base64(iv|tag|ciphertext)`, `decrypt(blob) → plain`. `isEnabled` false when no key (dev); `encrypt` throws when disabled so secret PATCH is rejected with a clear message.

### SettingsService (`src/settings/settings.service.ts`)
- Loads the row at `onModuleInit` into an in-memory cache (secrets decrypted in memory).
- **Synchronous getters** (`getApiToken/getTeamId/getWebhookSecret/getWebhookEndpoint/getWebhookEvents`) return `cacheValue ?? envFallback`, so the per-request `ClickupClient.headers()` and webhook guard stay sync.
- `getMasked()` returns effective values with secrets masked (`apiTokenSet`, last-4) for the GET endpoint.
- `update(patch, actor)` writes DB (encrypting supplied secrets), then refreshes cache. `setWebhookSecret(secret)` used by the register flow.
- Exposed via a `@Global` `SettingsModule` exporting `SettingsService` + `CryptoService`.

### Consumer refactor (8 sites)
Replace `process.env.CLICKUP_*` / `ConfigService.get('CLICKUP_*')` with `SettingsService` getters in: `clickup.client.ts`, `webhook-signature.guard.ts`, `clickup-webhooks.service.ts`, `admin.controller.ts` (workspace-members), `workspace-members.service.ts`, `backfill.service.ts`, `assignee-replacement.service.ts`, `time-entries.service.ts`.

### Admin API (`admin.controller.ts`)
- `GET /api/admin/settings` → masked effective settings.
- `PATCH /api/admin/settings` → `UpdateSettingsDto` (all optional); secrets updated only when supplied & non-empty.
- `POST /api/admin/settings/test` → validates token+team by calling ClickUp `GET /team/{id}` (reuses members fetch).
- `POST /api/admin/webhooks/register` → now **persists** the returned secret via `SettingsService.setWebhookSecret` (encrypted), so the UI flow needs no copy-paste.

### Boot gate (`env.validation.ts`)
- Drop the production hard-requirement on `CLICKUP_WEBHOOK_SECRET` (can now live in DB).
- Add `APP_ENCRYPTION_KEY` — **required in production** (≥ 32 bytes). `ADMIN_API_KEY` requirement unchanged. The runtime webhook guard still rejects unsigned webhooks in prod when no secret exists anywhere.

### UI (`apps/web`)
- `src/api/settings.ts` + `src/hooks/useSettings.ts` (query + patch mutation, invalidate on success).
- Settings → Connection tab: replace the hardcoded workspace card + read-only webhook fields with an editable "ClickUp connection" form (API token [write-only/masked], team ID, webhook endpoint, events, secret). Keep existing **Test connection** + **Register webhook** buttons; saving calls PATCH.

## Testing
Unit tests: `CryptoService` (round-trip, bad/short key, decrypt tampered → throws), `SettingsService` (env fallback, cache refresh, masking, secret-only-on-supply), new endpoints (masking, validation). Update affected consumer-site specs to provide `SettingsService` in their testing modules.

## Side effect
Kills the deploy chicken-and-egg: a fresh prod instance boots without a ClickUp secret, admin logs in (env key), enters token/team, clicks **Register webhook** (secret persisted encrypted) — live without editing `.env`.

## Out of scope (YAGNI)
Multi-tenant/multi-workspace, moving job-tuning vars to UI, agency-user-id UI, token-expiry tracking.

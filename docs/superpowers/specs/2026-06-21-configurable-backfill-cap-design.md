# Configurable backfill max-lookback

Date: 2026-06-21
Status: Approved

## Problem

The backfill `lookbackDays` ceiling is hardcoded in two places — `BackfillDto`
`@Max(1095)` and `SpacesPage.tsx` `MAX_LOOKBACK = 1095`. Raising it (e.g. to 4–5
years) currently means editing code in both places (and they already drifted once,
causing a silent-clamp bug). Admins should be able to set the cap from Settings, and
both backend and frontend should read that single value.

## Decision

- Store the cap in the existing `preferences` JSON blob: `sync.maxBackfillLookbackDays`.
- Default **1095** when absent (behavior unchanged until set).
- Hard backstop **3650** (10 years) — the user-configurable value is bounded to [1, 3650].

## Changes

### 1. Backend — `SettingsService` (`src/settings/settings.service.ts`)

- Add `maxBackfillLookbackDays: number` to the `SettingsPreferences.sync` type.
- Default it to 1095 wherever `sync` defaults are constructed.
- Add getter `getBackfillMaxLookbackDays(): number` returning the stored value
  **clamped to [1, 3650]** (authoritative source of truth; a bad stored value or
  missing field can never leak through — falls back to 1095 when absent).

### 2. Backend — validation moves decorator → controller

- `src/admin/dto/backfill.dto.ts`: change `@Max(1095)` → `@Max(3650)` (absolute hard
  backstop; a request can never exceed 10y regardless of the configured cap). Update
  the `@ApiPropertyOptional` `maximum`/description.
- `src/admin/admin.controller.ts` `POST /admin/backfill`: after DTO validation, read
  `const cap = this.settings.getBackfillMaxLookbackDays()`; if
  `dto.lookbackDays != null && dto.lookbackDays > cap`, throw `BadRequestException`
  with a clear message (e.g. `lookbackDays 2000 exceeds the configured maximum 1095 —
  raise it in Settings → Sync`). This is the dynamic, user-configurable policy layer.

Two layers of defense: the DTO enforces the 10y backstop; the controller enforces the
current configured policy.

### 3. Frontend

- `apps/web/src/api/settings.ts`: add `maxBackfillLookbackDays: number` to
  `SettingsPreferences.sync`.
- `apps/web/src/pages/SettingsPage.tsx`: in the Sync section, a numeric input next to
  the reconcile-lookback control, saved via the existing
  `patchPrefs({ sync: { maxBackfillLookbackDays } })`. Input bounded to [1, 3650].
- `apps/web/src/pages/SpacesPage.tsx`: replace the hardcoded `const MAX_LOOKBACK = 1095`
  with a value read from `useSettings()` → `prefs?.sync.maxBackfillLookbackDays ?? 1095`.
  `effectiveLookback()` clamps to that dynamic value. `MIN_LOOKBACK` stays 1.

## Tests

- `SettingsService.getBackfillMaxLookbackDays`: returns configured value; defaults to
  1095 when absent; clamps to [1, 3650].
- `BackfillDto`: accepts 3650, rejects 3651, still rejects 0.
- `admin.controller` backfill(): rejects `lookbackDays > cap` (mock settings cap=1095,
  request 2000 → 400); accepts `lookbackDays ≤ cap`.

## Backward-compat

Existing settings rows lack `sync.maxBackfillLookbackDays`; backend getter and frontend
both fall back to 1095. Because both sides now read the same settings value (frontend) /
shared backstop (backend), the previous two-cap drift bug cannot recur.

## Out of scope

- Per-space configurable caps (still one global cap).
- Changing per-space default `backfillLookbackDays` (still 30).
- The reconcile endpoint's lookback (separate, currently uncapped).

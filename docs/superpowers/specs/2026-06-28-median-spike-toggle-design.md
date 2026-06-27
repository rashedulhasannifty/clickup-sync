# Median spike toggle — design

Date: 2026-06-28

## Problem

The Time Spikes feature flags a user-day as a spike under two rules:

1. **Absolute cap** — logged hours exceed the configurable `spikeHoursCap`.
2. **Relative / median** — logged hours exceed `2×` the user's rolling median (and `>= 4h`).

The hour cap is already configurable from Settings. The team wants the **median
rule to be toggleable too** — an Owner switch in Settings that turns the median
behaviour on or off. When **off**, the Time Spikes page, the Overview Anomalies
panel, the in-app NotificationCenter, and spike notification emails must not
surface any median-derived numbers or wording.

## Decisions (confirmed with product owner)

- **Keep rows, hide median text.** Turning median off does **not** change which
  rows are detected/returned. Detection is unchanged; only the median-derived
  *display* (the median value, the multiplier, and any "× median" / "vs typical"
  wording) is removed. Relative-only rows still appear, relabelled neutrally.
- **Scope = both surfaces.** The toggle gates both the per-user **Time Spikes
  (hours)** page and the Overview **cost-anomaly** panel (daily + per-client).
  The Anomalies rows stay visible when median is off — they are just relabelled
  to neutral "unusually high" wording (no multiplier, no median-dollar compare).
- **Default = on.** `medianEnabled` defaults to `true` so existing behaviour is
  preserved until an Owner turns it off.

## Approach: strip server-side + carry a `medianEnabled` flag

The controller reads the setting once and passes it into both report queries.
When the flag is **off**, the service:

- leaves detection/row selection **unchanged**, and
- **nulls out** the median-derived numeric fields on every returned row
  (`median`, `multiplier` for hour spikes; `medianAud`, `baselineMedianAud`,
  `multiplier` for anomalies), and
- includes `medianEnabled: false` in the response payload.

Stripping the numbers in one place guarantees no median value can leak through
any consumer. The `medianEnabled` flag lets each UI surface choose neutral
wording. The email path needs no change: `NotifySpikeModal` sends `row.median`,
which is now null, and `SpikeNotificationService.reasonText()` already falls
back to median-free wording when `median` is falsy.

## Changes

### Settings storage & service

- `SettingsPreferences`: add `spike: { medianEnabled: boolean }`.
- `DEFAULT_PREFERENCES`: `spike: { medianEnabled: true }`.
- `SettingsService.isSpikeMedianEnabled(): boolean` — reads
  `preferences.spike.medianEnabled`, defaulting to `true`.
- `deepMergePrefs` already merges nested objects, so partial patches work.

### Reports controller

- `hourSpikes(...)` passes `this.settings.isSpikeMedianEnabled()` to the service.
- `anomalies()` passes the same flag.

### Reports service

- `hourSpikes(cap, from, to, limit, includeResolved, medianEnabled = true)`:
  - detection unchanged;
  - when `!medianEnabled`, map watchlist rows to `median: 0`, `multiplier: null`;
  - return `medianEnabled` in the payload.
- `anomalies(medianEnabled = true)`:
  - detection unchanged;
  - when `!medianEnabled`, set `medianAud`/`baselineMedianAud`/`multiplier` to
    `null` on each row;
  - return `medianEnabled` in the payload.

### Frontend types (`useReports.ts`)

- `HourSpikes` += `medianEnabled: boolean`.
- `Anomalies` += `medianEnabled: boolean`.
- `DailySpike.medianAud`, `DailySpike.multiplier`, `ClientSpike.baselineMedianAud`,
  `ClientSpike.multiplier` become `number | null`.

### Frontend rendering

- **HourSpikesPage** `watchSubtitle(s, cap, medianEnabled)`:
  - `medianEnabled` off (or `multiplier == null`): `absolute` → "over the {cap}h/day
    cap"; `relative`/`both` → neutral "unusually high for this person".
  - on: existing behaviour.
- **AnomaliesPanel**: when `medianEnabled` off, neutral titles/subtitles:
  - daily → "{date} had an unusually high cost day" / "{money} total".
  - client → "{client} had unusually high spend last week" / "{money} last 7d".
- **NotificationCenter**:
  - hour-spike fallback (when `multiplier == null`) → "Unusually high day".
  - anomaly lines → neutral wording when median figures are null.

### Settings UI (`SettingsPage.tsx`)

- Owner-only `SettingRow` + `Switch` directly under the "Daily-hour spike cap"
  row: label "Median spike rule", `checked={prefs?.spike?.medianEnabled ?? true}`,
  `onChange={(v) => patchPrefs({ spike: { medianEnabled: v } })}`.
- Reword the cap row description so it no longer states the median behaviour as
  always-on.

## Testing

- `settings.service.spec.ts`: `isSpikeMedianEnabled()` defaults true; reflects a
  stored `preferences.spike.medianEnabled = false`.
- `reports.service.spec.ts`: `hourSpikes(..., medianEnabled=false)` keeps the same
  rows but returns `multiplier: null` and `medianEnabled: false`; default call is
  unchanged. Anomalies analog if feasible with the existing test harness.
- Existing spike/notification specs continue to pass (median-free email wording
  already covered by `reasonText` fallback).

## Out of scope

- No change to detection thresholds or the `2×` / `>= 4h` constants.
- No DB migration (toggle lives in the existing `preferences` JSON).
- No rename of the AUD/USD currency fields (tracked separately).

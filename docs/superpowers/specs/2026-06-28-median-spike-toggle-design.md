# Median spike toggle — design

Date: 2026-06-28

> **Revision (2026-06-28, post-review).** The original design ("keep rows, hide
> median text" across both the Time Spikes page and the Overview Anomalies
> panel) was changed after the product owner saw it in action. Two corrections:
> (1) the toggle now **disables the median rule entirely** — median-only days
> are *removed* from detection rather than kept-with-neutral-wording; (2) the
> toggle's **scope is the Time Spikes page only** — the Overview Anomalies panel
> is no longer affected and always shows its median-based cost spikes. The
> sections below describe the corrected design.

## Problem

The Time Spikes feature flags a user-day as a spike under two rules:

1. **Absolute cap** — logged hours exceed the configurable `spikeHoursCap`.
2. **Relative / median** — logged hours exceed `2×` the user's rolling median (and `>= 4h`).

The hour cap is already configurable from Settings. The team wants the **median
rule to be toggleable too** — an Owner switch in Settings that turns the median
rule on or off. When **off**, the Time Spikes page (watchlist + chart) and its
spike notifications must behave as if the median rule does not exist: days
flagged *only* by the median rule disappear, and no median numbers/wording
appear anywhere on that surface.

## Decisions (confirmed with product owner)

- **Off = disable the median rule.** When off, a day flagged *only* by the
  relative rule (over `2×` median but under the cap) is no longer detected at
  all — it drops out of the watchlist, the chart, and the notifications. A day
  over the cap (with or without the median rule) still shows as a cap spike.
- **Scope = Time Spikes page only.** The toggle gates only the per-user **Time
  Spikes (hours)** surface and its NotificationCenter entries. The Overview
  **cost-anomaly** panel is a separate, always-on feature and is **not** gated
  by this toggle.
- **Default = on.** `medianEnabled` defaults to `true`, so existing behaviour is
  preserved until an Owner turns it off.

## Approach: gate detection server-side; strip residual median numbers

The reports controller reads the setting and passes it into `hourSpikes()` only
(the `anomalies()` query is untouched). When the flag is **off**, the service:

- gates the relative rule inside `classify()` so median-only days are never
  flagged (`rel = medianEnabled && med > 0 && hours > 2*med && hours >= 4`);
  this removes those rows from the watchlist *and* the chart's `isSpike` series;
- still strips the residual median numbers (`median: 0`, `multiplier: null`) on
  the cap spikes that remain, so a cap spike's incidental multiplier cannot leak
  into the notification wording.

The watchlist rows that survive when off are all cap spikes, which the existing
frontend already renders with cap-only wording ("over the Nh/day cap" /
"Above the daily cap") — so no frontend changes are needed for the off-state.
The email path needs no change: a removed median-only day generates no
notification, and a surviving cap spike sends `median: 0`, which
`SpikeNotificationService.reasonText()` treats as falsy → cap-only wording.

## Changes

### Settings storage & service

- `SettingsPreferences`: add `spike: { medianEnabled: boolean }`.
- `DEFAULT_PREFERENCES`: `spike: { medianEnabled: true }`.
- `SettingsService.isSpikeMedianEnabled(): boolean` — reads
  `preferences.spike.medianEnabled`, defaulting to `true`.
- `deepMergePrefs` already merges nested objects, so partial patches work.

### Reports controller

- `hourSpikes(...)` passes `this.settings.isSpikeMedianEnabled()` to the service.
- `anomalies()` takes **no** flag — it is not gated by the toggle.

### Reports service

- `hourSpikes(cap, from, to, limit, includeResolved, medianEnabled = true)`:
  - `classify()` gates the relative rule on `medianEnabled`, so median-only days
    are not flagged when off (removed from both the watchlist and the chart's
    `isSpike` series);
  - the surviving cap-spike rows still get `median: 0`, `multiplier: null` when
    off, so an incidental multiplier can't leak into notification wording;
  - the return shape is unchanged (no `medianEnabled` field in the payload).
- `anomalies()`: **unchanged** — no flag, no stripping; always returns its
  median-based cost spikes.

### Frontend types (`useReports.ts`)

- Unchanged from the pre-feature shape: `Anomalies` / `DailySpike` / `ClientSpike`
  keep non-null median fields; `HourSpikes` gains no flag. (Only the `spike`
  preference is added to `SettingsPreferences` in `apps/web/src/api/settings.ts`.)

### Frontend rendering

- **No changes.** When the toggle is off, the only surviving Time-Spikes rows are
  cap spikes, which the existing `watchSubtitle` ("over the {cap}h/day cap") and
  NotificationCenter fallback ("Above the daily cap") already render without any
  median wording. The AnomaliesPanel and the NotificationCenter anomaly lines are
  untouched (the panel is no longer gated by the toggle).

### Settings UI (`SettingsPage.tsx`)

- Owner-only `SettingRow` + `Switch` directly under the "Daily-hour spike cap"
  row: label "Median spike rule", `checked={prefs?.spike?.medianEnabled ?? true}`,
  `onChange={(v) => patchPrefs({ spike: { medianEnabled: v } })}`.
- Reword the cap row description so it no longer states the median behaviour as
  always-on.

## Testing

- `settings.service.spec.ts`: `isSpikeMedianEnabled()` defaults true; reflects a
  stored `preferences.spike.medianEnabled = false`.
- `reports.service.spec.ts`: `hourSpikes(..., medianEnabled=false)` **removes** a
  median-only day (empty watchlist + `isSpike: false`), **keeps** a cap spike with
  `median: 0`/`multiplier: null`, and the default call still flags the median-only
  day with its median fields. `anomalies()` is unchanged.
- `reports.controller.spec.ts`: `hourSpikes` forwards the flag (true + false);
  `anomalies()` is called with no argument.
- Existing spike/notification specs continue to pass (median-free email wording
  already covered by `reasonText` fallback).

## Out of scope

- No change to detection thresholds or the `2×` / `>= 4h` constants.
- No DB migration (toggle lives in the existing `preferences` JSON).
- No rename of the AUD/USD currency fields (tracked separately).

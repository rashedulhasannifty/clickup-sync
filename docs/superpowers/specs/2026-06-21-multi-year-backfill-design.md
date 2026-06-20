# Multi-year backfill (≥2 year support)

Date: 2026-06-21
Status: Approved

## Problem

Manual space backfills are capped at **365 days** by `BackfillDto` (`@Max(365)` + a
global `ValidationPipe`). A request for a 2–3 year backfill is rejected with HTTP 400
before any job is queued. The business needs backfills to reach **at least 2 years**.

Lifting the cap alone is not enough: at multi-year depth two latent risks surface.

1. **Time-entry fetch is a single un-chunked range.** `ClickupClient.getTimeEntries`
   sends one `start_date`/`end_date` pair, and ClickUp's `GET /team/{team}/time_entries`
   has **no pagination** (see `time-entries.service.ts:18-25`). A multi-year window on a
   high-volume task risks a truncated/incomplete response.
2. **Task pull has a ~100k ceiling.** `getAllTasksBySpace` loops to `MAX_PAGES = 1000`
   (100 tasks/page) and only `logger.warn`s on hitting the cap — a silently incomplete
   3-year pull would look complete to downstream reconciliation.

## Decision

Cap ceiling = **1095 days (3y headroom)**. Chunk granularity = **yearly**.

## Changes

### 1. Raise the cap — `src/admin/dto/backfill.dto.ts`

- `@Max(365)` → `@Max(1095)`.
- Update `@ApiPropertyOptional` `maximum`, `example`, and `description` to match.
- No downstream clamping is added: `BackfillService.backfillSpace` already honors the
  window verbatim, and `teLookbackDays` is a `Math.max(...)` floor so a longer task
  window correctly drives a longer time-entry window.

### 2. Chunk the time-entry fetch — `src/clickup/clickup.client.ts` (+ util)

- In `getTimeEntries`, resolve the `[startMs, endMs]` window once, split into
  **≤365-day slices**, fetch each slice sequentially via the existing
  `buildTimeEntriesQuery`, then concatenate and **dedupe by `time_entry_id`**.
- A window ≤365 days resolves to exactly one slice → **zero behavior change** for the
  existing hot paths (webhooks, hourly sweep).
- The prune logic in `TimeEntriesService.syncTaskTimeEntries` is unchanged: the
  concatenated union is still authoritative for the full window, and the
  `PRUNE_SAFETY_MAX_ENTRIES` guard still applies to the total.
- Slices are half-open by start_date so an entry lands in exactly one slice; dedupe by
  id is belt-and-suspenders against boundary overlap.

### 3. Pagination check — `src/clickup/clickup.client.ts`

- Raise `MAX_PAGES` to **5000** (~500k tasks) so a genuine 3-year space pull cannot hit
  the ceiling under normal volumes.
- Surface truncation as a visible signal: `getAllTasksBySpace` returns a `truncated`
  flag (cap hit without a short page) that `BackfillService.backfillSpace` includes in
  its result so an incomplete pull is observable, not buried in a log line.

## Tests

- `BackfillDto`: accepts `1095`, rejects `1096`, still rejects `0`.
- `getTimeEntries`: a 3-year window issues 3 slice requests and dedupes overlapping ids;
  a ≤365-day window issues exactly one request (no behavior change).
- `getAllTasksBySpace`: returns `truncated: false` on a normal short-page stop; existing
  pagination behavior preserved.

## Out of scope

- Per-chunk pruning (the service still prunes against the full concatenated set).
- Changing the per-space configured `backfillLookbackDays` defaults (still 30).
- Any UI surface for choosing the lookback (the admin API field already accepts it).

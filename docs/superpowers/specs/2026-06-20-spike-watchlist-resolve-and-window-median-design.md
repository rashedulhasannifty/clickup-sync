# Spike watchlist: resolve, selected-window median, and pagination

**Date:** 2026-06-20
**Status:** Approved (design)
**Area:** Time Spikes report (`HourSpikesPage` + `GET /reports/time-entries/hour-spikes`)

## Problem

The Time Spikes watchlist (`HourSpikesPage.tsx` → `ReportsService.hourSpikes()`) has three gaps:

1. **Capped at 20, silently.** The watchlist sorts flagged days by hours desc and does
   `slice(0, 20)`. If a range has more than 20 spike days the rest vanish with no
   indicator and no way to see them.
2. **Median ignores the selected window.** The "relative" spike rule compares a day's
   hours to the user's median, but that median is computed from a **fixed**
   `now() - interval '30 days'` baseline regardless of the date range the user picked.
   A range in the past is judged against the wrong baseline.
3. **No way to dismiss a known/expected spike.** Some days are legitimately high (a
   genuine crunch day, already-handled). They keep reappearing in the watchlist with no
   "resolved" control, so the list stays noisy.

## Decisions (from brainstorming)

- **Resolve = hide completely**, reversible, with a **"Show resolved"** toggle.
- **Admins only** may resolve/unresolve (same gate as the existing Notify button).
- **Pagination = "Load 20 more"** (progressive reveal), not expand-all.
- **Median from the selected window, floored to 14 days** so short ranges don't make
  every day look like a spike. The absolute-cap rule is unaffected.

## Scope

In scope: the `hourSpikes()` service, its controller route, a new `SpikeResolution`
model + migration, two admin endpoints, a `SpikeResolutionService`, and the
`HourSpikesPage` + `useReports`/api-client wiring. Out of scope: the "Daily hours by
user" chart (resolution does **not** change which bars are amber — resolution only
governs the watchlist list), and any change to the Notify feature.

## Architecture

### 1. Selected-window median with a 14-day floor

In `reports.service.ts` `hourSpikes()`, the baseline query currently filters
`start_time >= now() - interval '30 days'`. Replace the fixed window with a window
derived from the selected range, floored to 14 days:

```
const FLOOR_MS = 14 * 24 * 60 * 60 * 1000;
const baselineFrom = new Date(Math.min(from.getTime(), to.getTime() - FLOOR_MS));
// baselineTo = to
```

The baseline query then uses `e.start_time >= ${baselineFrom} AND e.start_time <= ${to}`.

- A 30-day pick → median over those 30 days.
- A 2-day pick → `baselineFrom = to - 14d`, so the median still spans 14 days.
- The `displayRows` query (which produces the candidate spike days and the chart series)
  keeps using the exact selected `[from, to]` — only the **baseline/median** widens.
- `classify()` and the absolute-cap rule (`hours > cap`) are unchanged.

The route's Swagger summary changes "2x the user's 30-day median" → "2x the user's
median over the selected window (min 14 days)".

### 2. Resolve / unresolve (hide)

**New Prisma model** `SpikeResolution` (mirrors `SpikeNotification`):

```prisma
model SpikeResolution {
  id            BigInt   @id @default(autoincrement())
  clickupUserId String   @map("clickup_user_id")
  spikeDate     DateTime @map("spike_date") @db.Date
  userName      String?  @map("user_name")
  note          String?
  resolvedBy    String?  @map("resolved_by")
  resolvedAt    DateTime @default(now()) @map("resolved_at")

  @@unique([clickupUserId, spikeDate])
  @@map("spike_resolutions")
}
```

**Hand-authored migration** `prisma/migrations/0011_spike_resolutions/migration.sql`
(create table + unique index, mirroring `0010_spike_notifications`). Apply with
`npm run prisma:deploy` — **not** `migrate dev` (schema/migration drift convention; see
the `prisma-migration-drift` memory).

**`SpikeResolutionService`** (`src/admin/spike-resolution.service.ts`) — single purpose,
depends on `PrismaService` only:
- `resolve({ userId, date, note?, resolvedBy? })` — idempotent upsert keyed by
  `(clickupUserId, spikeDate)`. Reuses the breakdown lookup only to capture `userName`
  (optional/best-effort; can be derived from the watchlist row instead to avoid an extra
  query — see Open question). Validates `date` is `YYYY-MM-DD`.
- `unresolve({ userId, date })` — delete by the unique key; no-op (200) if absent.

`spikeDate` is written as `new Date(\`${date}T00:00:00.000Z\`)` — the same `dayStart()`
convention `SpikeNotificationService` uses, so the read-side Set keys line up.

**Admin endpoints** (`admin.controller.ts`), mirroring the notify action POSTs (HTTP 200,
side-effecting, audited by the existing `AuditLogInterceptor`):
- `POST /admin/hour-spikes/resolve` `{ userId, date, note? }` → `resolve(...)`,
  `resolvedBy = actorLabel(user)`.
- `DELETE /admin/hour-spikes/resolve` `{ userId, date }` → `unresolve(...)`.

Wire `SpikeResolutionService` into `AdminModule.providers`.

DTOs: `ResolveSpikeDto { userId: string; date: string; note?: string; userName?: string }`
and `UnresolveSpikeDto { userId: string; date: string }` (class-validator, mirroring
`NotifySpikeDto`). `userName` is supplied by the client from the watchlist row it already
has (see Open question).

### 3. Resolution filter + pagination in `hourSpikes()`

New signature:
`hourSpikes(cap, fromParam?, toParam?, limit = 20, includeResolved = false)`.

After the full `watchlist` array is built and sorted by hours desc:

1. **Load resolutions for the range** in one query (not a big `OR`):
   ```
   spikeResolution.findMany({ where: { spikeDate: { gte: dayStart(from), lte: dayStart(to) } } })
   ```
   Build `resolvedSet` of `\`${userId}|${date}\`` keys (recover `YYYY-MM-DD` from the
   `@db.Date` via `.toISOString().slice(0,10)`, same as the notified-enrichment).
2. **Apply the toggle:**
   - `includeResolved = false` (default): drop rows whose key is in `resolvedSet`.
   - `includeResolved = true`: keep all; each row carries `resolved: resolvedSet.has(key)`.
3. **`watchlistTotal` = length of the post-filter array** (so the UI knows when to stop
   showing "Load 20 more").
4. **Slice to `limit`**: `const page = filtered.slice(0, limit)`.
5. **Notified-enrichment runs on `page` only** (unchanged pattern, keeps the empty-`OR`
   guard). Each row gets `notified` and `resolved`.

Return shape: `{ cap, watchlist: page, watchlistTotal, byUser: { buckets, users } }`.
`byUser` is computed as today (full chart, independent of pagination/resolution).

**Controller** gains query params:
```
hourSpikes(@Query('from') from?, @Query('to') to?, @Query('limit') limit?, @Query('includeResolved') includeResolved?)
  => this.reports.hourSpikes(cap, from, to, Number(limit) || 20, includeResolved === 'true')
```

### 4. Frontend

**API client** (`apps/web/src/api/reports.ts`):
`hourSpikes({ from, to, limit, includeResolved })` → passes all four as query params.

**Admin API** (`apps/web/src/api/admin.ts`): `resolveSpike({ userId, date, note? })` (POST)
and `unresolveSpike({ userId, date })` (DELETE).

**Hooks** (`apps/web/src/hooks/useReports.ts`):
- `HourSpikeWatchRow` gains `resolved: boolean`.
- `HourSpikes` gains `watchlistTotal: number`.
- `useHourSpikes(limit, includeResolved)` — `queryKey: ['hour-spikes', from, to, limit, includeResolved]`,
  `placeholderData: keepPreviousData`. (Progressive reveal via a growing `limit`: each
  "Load 20 more" click bumps `limit` by 20 and re-fetches the accumulated slice. Simpler
  than infinite-query page merging and invisible to the user.)
- `useResolveSpike()` / `useUnresolveSpike()` mutations — invalidate `['hour-spikes']`
  on success (same as `useNotifySpike`).

**Page** (`HourSpikesPage.tsx`):
- `const [limit, setLimit] = useState(20)` and `const [showResolved, setShowResolved] = useState(false)`;
  pass both to `useHourSpikes`. Reset `limit` to 20 when the date range or `showResolved`
  changes (so a stale large limit doesn't carry over).
- Card header gets a "Show resolved" toggle (admin-only; members never resolve).
- Each row (admin): a **Resolve** button beside **Notify**. When `showResolved` is on,
  resolved rows render muted with an **Unresolve** action and a small "Resolved" tag.
- Below the list: a **"Load 20 more"** button shown when `watchlist.length < watchlistTotal`;
  `onClick` → `setLimit((n) => n + 20)`. Optionally show "Showing X of N".

## Data flow

```
Topbar range ─► useHourSpikes(limit, showResolved)
             ─► GET /reports/time-entries/hour-spikes?from&to&limit&includeResolved
             ─► hourSpikes(): displayRows[from..to] + baselineRows[min(from,to-14d)..to]
                              → classify → sort desc → filter resolvedSet → total → slice(limit)
                              → enrich notified+resolved
Resolve btn  ─► POST /admin/hour-spikes/resolve {userId,date,note?} ─► invalidate ['hour-spikes']
Unresolve    ─► DELETE /admin/hour-spikes/resolve {userId,date}     ─► invalidate ['hour-spikes']
```

## Error handling / edge cases

- **Empty range / no spikes:** `watchlistTotal = 0`, existing empty-state copy stands; no
  "Load more" button.
- **Resolve idempotency:** upsert + `@@unique` means a double-click or concurrent resolve
  converges; unresolve of an already-absent row returns 200 (no-op).
- **Resolve then unresolve:** with `showResolved` off, resolving removes the row; turning
  the toggle on shows it (muted) so it can be unresolved.
- **Limit larger than total:** `slice` is safe; button hidden because
  `watchlist.length >= watchlistTotal`.
- **`includeResolved` flips while paginated:** `limit` resets to 20 on toggle change, so
  totals and the button stay consistent.
- **Resolution Set keys:** must match the watchlist's `userId|YYYY-MM-DD` exactly
  (`COALESCE(user_id,'unknown')` on the read side; `dayStart()` on the write side).

## Testing

- `reports.service.spec.ts` — extend the `hourSpikes` describe:
  - median now derives from the selected window; a short (<14d) window still floors to 14d
    (assert the baseline query bound, or behaviour: a day that would be relative-flagged
    only under a noisy short median is not flagged).
  - resolution filter: a resolved user-day is excluded by default and included (with
    `resolved: true`) when `includeResolved = true`.
  - pagination: `watchlistTotal` reflects the full post-filter count; `watchlist` length
    respects `limit`.
  - Stub order: the helper stubs the raw queries; add the `spikeResolution.findMany` stub.
- `reports.controller.spec.ts` — new params forwarded (`limit`, `includeResolved`).
- `spike-resolution.service.spec.ts` (new) — resolve upsert idempotency, unresolve no-op,
  bad date rejected. Mirror `spike-notification.service.spec.ts`.
- `admin.controller.spec.ts` — resolve/unresolve delegate to the service.
- Web: type-check/build (`HourSpikeWatchRow.resolved`, `watchlistTotal` now required).

## Open question (resolve inline, no blocker)

`SpikeResolution.userName` is nice-to-have for an audit-friendly row. Two ways to fill it:
(a) the client sends `userName` from the watchlist row it already has, or (b) the service
re-derives it. Plan picks **(a)** — the row already knows the name; avoids an extra query.
DTO therefore includes optional `userName`.

## Alternatives considered

- **Reuse `spike_notifications` with a `status` column** instead of a new table. Rejected:
  notify and resolve are independent (you can resolve a day you never emailed about);
  overloading one row couples them and complicates the unique-key semantics. A dedicated
  table keeps both features simple.
- **Expand-all instead of paginate.** Rejected by the user in favor of "Load 20 more".
- **Strict selected-window median (no floor).** Rejected: 1–3 day ranges produce a noisy
  median that flags nearly everything.

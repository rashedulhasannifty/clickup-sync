# Spike Notification Emails — Design

**Date:** 2026-06-14
**Status:** Approved (design); pending implementation plan

## Problem

The **Time Spikes** feature (`HourSpikesPage.tsx` + `GET /reports/time-entries/hour-spikes`)
already detects days where a user logged unusually high hours, using two rules
(absolute `> cap` h/day, default 12; relative `> 2× their 30-day median AND ≥ 4h`).
Its design doc explicitly lists *"Alerting/notifications on new spikes"* as **out of
scope**.

This feature fills exactly that gap: let an admin, from the watchlist, send the
flagged member an email with the day's task breakdown plus an optional note — so the
member can review and correct their tracked time.

## Scope

Build **only the email layer** on top of the existing watchlist. Detection is
unchanged — we reuse `hourSpikes()` and its watchlist rows as-is. Sending is **manual,
per watchlist row** (no automated/scheduled alerting).

## Detection (unchanged — context only)

A watchlist row is a `(user, local-day)` flagged by the existing rules. Each row
already carries `{ userId, userName, date, hours, median, multiplier, rule }`. We add a
`notified` flag (below) but do not change how rows are produced. "Day" bucketing is
`start_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka'`, matching the rest of the
reports service.

## Architecture

### 1. Data model — `SpikeNotification` (new table, migration `0009`)

One row per sent notice. The unique key is the watchlist row identity and enforces
"send once per person-day".

- **Prisma model `SpikeNotification`** → table `spike_notifications`:
  - `id BigInt @id @default(autoincrement())`
  - `clickupUserId String @map("clickup_user_id")` — ClickUp user id from the watchlist
  - `spikeDate DateTime @map("spike_date") @db.Date` — the flagged **local (Dhaka) day**
  - `recipientEmail String @map("recipient_email")` — snapshot of where it was sent
  - `userName String? @map("user_name")` — snapshot
  - `totalHours Decimal @map("total_hours") @db.Decimal(12, 4)` — snapshot of flagged hours
  - `rule String` — snapshot (`absolute` | `relative` | `both`)
  - `note String?` — admin's free-text message
  - `sentByUserId String? @map("sent_by_user_id")` — authenticated admin (session user id)
  - `sentAt DateTime @default(now()) @map("sent_at")`
  - `@@unique([clickupUserId, spikeDate])`
  - `@@map("spike_notifications")`
- **Migration `0009_spike_notifications`**: hand-authored SQL (`CREATE TABLE` +
  unique index), applied via `prisma:deploy` — consistent with the project's
  migration-drift handling.

### 2. Backend endpoints (on `AdminController`)

Both live on `AdminController` so they inherit the existing `AuditLogInterceptor`
(write actions auto-logged) and Admin/Owner role enforcement. The `SpikeNotification`
row is the primary record; the audit log is secondary.

- **`GET /admin/hour-spikes/:userId/:date/preview`** — powers the modal. Recomputes the
  breakdown server-side from `clickup_time_entries ⋈ clickup_tasks` for that user on
  that Dhaka-day (`is_deleted = false`), grouped by task. Returns:

  ```jsonc
  {
    "recipientEmail": "member@example.com",  // null if no entry has user_email
    "userName": "Rashedul",
    "date": "2026-06-10",
    "totalHours": 14.5,
    "rule": "absolute",                       // recomputed/snapshotted classification
    "tasks": [
      { "taskId": "86abc", "taskName": "Fix sync", "hours": 9.0 },
      { "taskId": "86def", "taskName": "Backfill", "hours": 5.5 }
    ],
    "alreadyNotified": false                   // a SpikeNotification row exists
  }
  ```

  - **Recipient email** is taken from `user_email` on that user's entries for the day
    (pick the first non-null; they should all match). If none has an email,
    `recipientEmail` is `null` and `alreadyNotified` still reflects history — the UI
    disables Send.
  - `Member` role can read the page but the **action endpoints are Admin/Owner only**;
    the preview/notify endpoints sit under `AdminController`'s role gate.

- **`POST /admin/hour-spikes/notify`** `{ userId, date, note? }`:
  1. **Recomputes** the breakdown itself (does **not** trust any client-supplied hours,
     email, or task list).
  2. `400` if the day has no entries or no resolvable `recipientEmail`.
  3. Sends via `MailerService.sendSpikeNotice(...)`.
  4. Inserts the `SpikeNotification`. A unique-constraint conflict on
     `(clickupUserId, spikeDate)` → `409 Already notified` (no second email).
  - `note` is validated by a small DTO (`NotifySpikeDto`): optional string, trimmed,
    sane max length (e.g. 2000 chars).

- **`MailerService.sendSpikeNotice(args)`** — new method beside `sendInvite`, same
  transport (real SMTP when `SMTP_HOST` set, else `jsonTransport` dev log). Builds the
  HTML from the breakdown + note. Never logs secrets.

### 3. Watchlist `notified` enrichment

`hourSpikes()` (reports service) builds the watchlist as today, then enriches it: query
`SpikeNotification` for `(clickupUserId, spikeDate)` pairs in the display window and set
`notified: true` on matching rows (default `false`). One extra indexed Prisma read;
keeps the page a single fetch. The reports service gains a `prisma` query for this table
only — no other coupling. The `notified` flag is informational and may be visible to
`Member` viewers; that is acceptable (internal tool).

### 4. Frontend — `HourSpikesPage.tsx`

Each watchlist row gets a right-side action, gated on the viewer's role
(Owner/Admin only — reuse the existing role/permission hook used elsewhere in the web
app):

- **`notified === false`** → a **"Notify"** button. Clicking opens a modal that calls
  the preview endpoint and shows: recipient email, date, total hours, the per-task
  breakdown, and a **note `<textarea>`**. A **Send** button POSTs to `notify`. Send is
  disabled when `recipientEmail` is null (no email on file), with a hint.
- **`notified === true`** → a disabled **"Notified ✓"** badge (amber, matching the
  page's styling) in place of the button.
- On successful send, the row flips to the "Notified ✓" state (invalidate the
  `useHourSpikes` query). A `409` is treated as already-notified (same UI result).
- `Member` (read-only) viewers see neither button nor badge action — just the existing
  watchlist.

New web pieces: `adminApi.previewSpikeNotice(userId, date)` and
`adminApi.notifySpike({ userId, date, note })`; a small `NotifySpikeModal` component;
a mutation hook that invalidates the spikes query on success.

### 5. Email content

- **Subject:** `Heads up: unusually high hours logged on Jun 10`
- **Body (HTML):**
  - Greeting: `Hi <userName>,`
  - Lead: `Our time-tracking review flagged <date> (Asia/Dhaka): you logged
    <totalHours>h, which is above the usual range` + reason from `rule`
    (`over the 12h/day cap` / `2.4× your typical 6h` / both).
  - **Admin note** (if provided) rendered in a highlighted block.
  - **Per-task table**: task name + hours per task for that day.
  - Closing: `Please review these entries in ClickUp and correct any mistakes.`
  - From `MAIL_FROM`; HTML-escape all interpolated values (task names, note, userName).

## Testing

- **`MailerService.sendSpikeNotice`** — renders subject/body and "sends" via
  `jsonTransport`; includes the note and task rows; escapes HTML.
- **Breakdown builder** — groups entries by task and sums hours; picks the first
  non-null `user_email`; returns `recipientEmail: null` when none present; excludes
  soft-deleted tasks; Dhaka-day bucketing.
- **`POST notify`** — happy path inserts a `SpikeNotification` and sends one email;
  `400` on no entries / no email; **`409` on duplicate** `(userId, date)` with no second
  send.
- **Watchlist enrichment** — a notified `(userId, date)` row comes back with
  `notified: true`; others `false`; a narrow display window still matches correctly.
- **Frontend** — Notify button hidden for `Member`; disabled "Notified ✓" when already
  sent; Send disabled when `recipientEmail` is null; row flips to notified after send.

## Decisions locked

- **Manual, per-row** sending only. No automated/scheduled alerting (the Notifications
  tab remains a placeholder).
- **Send-once per person-day**, enforced by `@@unique([clickupUserId, spikeDate])`;
  duplicate attempt → `409`. A recurring spike on a **different** day is a different row
  and independently notifiable.
- Endpoints live on **`AdminController`** → Admin/Owner only + auto audit-logged.
- Recipient email is resolved **server-side** from `clickup_time_entries.user_email`;
  the notify endpoint never trusts client-supplied recipient/hours/tasks.
- Reuses existing SMTP config (`SMTP_HOST` / `MAIL_FROM`); dev mode logs the email,
  consistent with `sendInvite`.

## Out of scope

- **Re-sending** the same person-day (would require a deliberate override + reset).
- Automated/scheduled spike alerting and member-self digests.
- Editing/deleting a `SpikeNotification` from the UI; per-ORG isolation of the table
  (single-tenant today; aligns with Spec 2 when multi-org lands).
- Cost-based spike notices (this is hours-only, mirroring the detection feature).

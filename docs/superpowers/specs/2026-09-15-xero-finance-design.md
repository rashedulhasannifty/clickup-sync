# Xero Finance: read-only sync of contacts and transactions

**Date:** 2026-09-15
**Status:** Draft (design). Screens approved 2026-09-15; architecture awaiting review.
**Mockup:** https://claude.ai/code/artifact/5b2bc945-5ba6-4e62-b007-bd57be6d1a45
(copy in `assets/2026-09-15-xero-finance-prototype.html`)

## Problem

The company keeps every client's books in one Xero organisation: sales
invoices, supplier bills, spend money and receive money. Today none of it is
visible in Clicksy. Answering "what does client X owe us?" or "what did we pay
AWS this year?" means logging in to Xero, and Grafana can't report on it.

## Goal

An Owner connects Xero once, from **Settings → Xero**. After that, a new
**Finance** page (Owner and Admin only) shows every Xero contact, with each
contact's:

- invoices (ACCREC) and bills (ACCPAY), including line items and tax
- spend money and receive money (bank transactions)
- credit notes and payments
- attachment names, each with an "Open in Xero" link

The data is copied into Postgres on a schedule, the same way ClickUp data is.
Pages load from our database, never live from Xero.

## Non-goals

- **Writing to Xero.** We request read scopes only.
- **Matching Xero contacts to the ClickUp `client` field**, and
  revenue-vs-cost views. This is the next phase, recorded in CLAUDE.md "Known
  limitations".
- **More than one Xero organisation.** One tenant, so there is no org switcher.
- **Downloading attachment files.** We store names and sizes only and link to
  Xero.
- **Other Xero data:** Xero webhooks, manual journals, bank transfers, quotes,
  purchase orders, payroll, and Xero's own reports (P&L, balance sheet).
- **Showing Finance to Members.**

## Decisions

| Question | Decision |
|---|---|
| Data mode | Sync into Postgres. No live reads. |
| Access | Read-only granular scopes. |
| Tenants | One organisation. |
| Who sees Finance | Owner and Admin. Members get neither the nav entry nor the API. |
| Who connects or disconnects | Owner only. |
| Extra data | Receive money, credit notes, payments, line items, attachment names. |
| Xero app | Already exists. Redirect URI `https://log.niftyitsolution.com/api/xero/callback`. |

## Screens

These are the screens approved in the mockup, which is the reference for
layout, copy and states.

1. **Settings → Xero tab.** The tab is added to `ALL_TAB_ITEMS`. Owners can
   act on it; Admins see it read-only.
   - **Not connected:** what we read, the scopes requested, and the **Connect
     to Xero** button.
   - **Connect failed:** a banner driven by `?xero=error&reason=…`.
   - **Connected:**
     - Organisation name, base currency, tenant ID, and who connected it and
       when.
     - Connection health: sign-in renewed, API calls used today.
     - A sync row for each data type, with record counts and status.
     - **Sync now**, and **Disconnect** behind a confirmation.
   - **Needs reconnect:** a red banner plus a **Reconnect** button. Synced
     data stays visible.
   - **First sync running:** progress for each data type.
2. **Finance page (`/finance`).** Sidebar label **Finance**, with a **Beta**
   tag, placed after Budgets. Also added to the command palette.
   - **Header:** "Synced N min ago", **Sync now**, **Export** (xlsx of the
     current tab and filters).
   - **KPI tiles:** Owed to you, Overdue, You owe, Money in (this month),
     Money out (this month). Each tile opens the matching filtered tab.
   - **Aged receivables:** buckets Current / 1–30 / 31–60 / 61–90 / 90+ days
     past due, plus a "Most overdue" list of the top 3 contacts.
   - **Money in vs out:** the last 6 months.
   - **Tabs:** Contacts, Invoices, Bills, Bank transactions, Credit notes,
     Payments. Each has search, filters, a sortable table, a totals row, and
     pagination.
3. **Contact drawer.**
   - Details: person, email, phone, address, tax number, default currency.
   - Four mini KPIs.
   - Sub-tabs for that contact: Invoices, Bills, Bank, Credit notes, Payments,
     Activity.
4. **Record drawer** (invoice, bill, bank transaction, credit note, payment).
   - Status, dates, and currency with its rate.
   - Line items and totals.
   - Payments applied, attachment names, and "Open in Xero".
   - Records stack: from a contact you can open an invoice, and from there a
     payment. **Back** returns to the previous record.
5. **Empty and error states.**
   - Not connected: an Owner sees a link to Settings; an Admin sees "Ask an
     Owner".
   - First sync: skeleton rows.
   - No matches: a **Clear filters** button.

### Status mapping (invoices and bills)

| Xero `Status` | Pill | Tone |
|---|---|---|
| `DRAFT` | Draft | gray |
| `SUBMITTED` | Awaiting approval | blue |
| `AUTHORISED`, not overdue, nothing paid | Awaiting payment | amber |
| `AUTHORISED`, `AmountPaid > 0` | Part paid | amber |
| `AUTHORISED`, `DueDate` before today (Dhaka) | Overdue · Nd | red |
| `PAID` | Paid | green |
| `VOIDED` | Voided (number struck through) | gray |
| `DELETED` | hidden by default | — |

The status filter uses **exclusive** buckets: "Awaiting payment" excludes
overdue, and "Overdue" is its own option. This is the same
exhaustive-by-construction rule as the `chargeable` filter.

### KPI definitions

All KPIs are in the organisation's **base currency**, using the stored
`base_*` columns (see "Money").

- **Owed to you:** sum of `amount_due_base` over `ACCREC` invoices with status
  `AUTHORISED`.
- **Overdue:** the subset of Owed to you where `due_date` is before today in
  Asia/Dhaka.
- **You owe:** the same sum over `ACCPAY` bills with status `AUTHORISED`.
- **Money in (month):**
  - payments applied to `ACCREC` invoices, plus
  - `RECEIVE*` bank transactions,
  - all with a date in the current Dhaka month, excluding status `DELETED`.
- **Money out (month):** payments on `ACCPAY` bills plus `SPEND*` bank
  transactions, with the same date and status rules.

Invoice payments are not bank transactions in Xero, so these two sources never
double count. `SPEND-TRANSFER` and `RECEIVE-TRANSFER` rows are transfers
between the company's own bank accounts, so they are **excluded** from both
KPIs and from the in/out chart. They are still listed on the Bank transactions
tab.

## Architecture

### Module layout (`src/xero/`)

| File | Job |
|---|---|
| `xero.module.ts` | Wires everything. Imports `SettingsModule` (CryptoService), `QueuesModule`, `JobsModule`, `HttpModule`. |
| `xero-auth.controller.ts` | `POST connect`, `GET callback`, `DELETE connection`, `GET status`, `POST sync`. |
| `xero-auth.service.ts` | OAuth: builds the consent URL, handles `state`, exchanges the code, revokes. |
| `xero-token.service.ts` | Stores tokens, single-flight refresh, `getAccessToken()`. |
| `xero.client.ts` | Thin `HttpService` client: tenant header, pacing, 429 handling, paging, `If-Modified-Since`. |
| `xero-normalize.ts` | Pure functions from Xero payloads to rows. Unit-tested per branch. |
| `xero.repository.ts` | All Prisma writes (upserts) and sync-state reads/writes. |
| `xero-sync.service.ts` | Runs the entity chain for one sync run. |
| `xero-reports.controller.ts` / `.service.ts` | Read API for the Finance page. |
| `src/workers/xero-sync.processor.ts` | The one processor for the `xero-sync` queue; switches on `job.name`. |
| `src/common/redis-lock.ts` | New helper. The codebase has no lock helper yet (see below). |

### OAuth connect flow

1. The Owner clicks **Connect to Xero**, which sends `POST /api/xero/connect`.
   - `@Roles(OWNER)`. Audited by `AuditLogInterceptor`, which only logs
     mutating methods; that's why this is a POST, not a GET.
   - Creates a 32-byte random `state` and stores
     `xero:oauth-state:<state> = {userId}` in Redis with a 10-minute TTL.
   - Returns `{ url }`, which the browser navigates to.
2. The consent URL is `https://login.xero.com/identity/connect/authorize` with:
   - `response_type=code`
   - `client_id`
   - `redirect_uri=${APP_BASE_URL}/api/xero/callback`
   - `scope` (below)
   - `state`
3. **`GET /api/xero/callback`** is `@Public()`. Authorization comes only from
   `state`, never from the session cookie.
   - `GETDEL` the state key. If it's missing, expired or already used, redirect
     with `reason=state`.
   - If Xero sent `error=access_denied`, redirect with `reason=cancelled`.
   - Exchange the code at `https://identity.xero.com/connect/token`, using
     Basic auth with the client ID and secret.
   - `GET https://api.xero.com/connections` and take the single `ORGANISATION`
     tenant. If there's more than one, redirect with `reason=multiple_tenants`.
     Only one org is supported; the Owner picks one on Xero's consent screen.
   - `GET /Organisation` for the name, base currency and **shortcode** (needed
     for deep links).
   - Upsert `XeroConnection` and write an explicit `AdminAuditLog` row
     `xero.connected`, with the actor taken from `state.userId`. The
     interceptor doesn't see this request.
   - Enqueue `XERO_SYNC {full: true}`.
   - Always **302** to `/settings?tab=xero&xero=connected`, or on failure to
     `…&xero=error&reason=<code>`. Never return JSON mid-redirect, and never
     put tokens or Xero error bodies in the URL.
4. **`DELETE /api/xero/connection`** (Owner, audited):
   - Calls `DELETE https://api.xero.com/connections/{id}`.
   - Revokes the refresh token at `/connect/revocation`.
   - Clears the token columns and sets `status = DISCONNECTED`.
   - Synced data is kept. A failed revoke is logged, and the local tokens are
     deleted anyway.

**Scopes (granular only):**

```
openid profile email offline_access
accounting.contacts.read accounting.invoices.read accounting.payments.read
accounting.banktransactions.read accounting.attachments.read accounting.settings.read
```

Apps created on or after 2 March 2026 can't use the broad
`accounting.transactions` scope, and older apps must move off it by 13
September 2027. Credit notes fall under `accounting.invoices`.

**Redirect URIs to register on the Xero app:**
- **Production:** `https://log.niftyitsolution.com/api/xero/callback` (already
  added).
- **Local:** `http://localhost:5173/api/xero/callback`. In dev,
  `APP_BASE_URL` is the Vite origin, and Vite proxies `/api` to the backend
  on :3002.

### Token storage and refresh

These are the rules that keep the connection alive.

- **Separate table, not `AppSettings`.** `SettingsService` keeps a decrypted
  cache per process. With blue, green and worker processes, one would hold a
  refresh token another has already rotated (see the
  `webhook-secret-cache-split-brain` memory). Tokens are read from the
  database on every use, with no in-process cache.
- **Encryption.** Tokens are encrypted with `CryptoService.encrypt`
  (AES-256-GCM, `APP_ENCRYPTION_KEY`). Connecting is refused (400) if
  `CryptoService.isEnabled` is false.
- **Single-flight refresh.** Xero **rotates the refresh token on every use** and
  invalidates the old one, so two concurrent refreshes break the connection
  until someone reconnects. `getAccessToken()` works like this:
  1. Read the row. If the access token is good for at least 120 more seconds,
     return it.
  2. Otherwise take the Redis lock `xero:token-refresh` (`SET NX PX 30000`
     with a random value; released by a compare-and-delete Lua script).
  3. **Re-read the row** after taking the lock. Another process may have just
     refreshed. If it's now fresh, return it.
  4. Refresh, write the new access token, refresh token, `accessExpiresAt` and
     `refreshedAt` in one update, then release the lock.
  5. A caller that doesn't get the lock polls the row every 250 ms for up to
     10 s, then gives up with a retryable error.
- **Keep-alive.** A daily cron at 04:00 Dhaka enqueues `XERO_TOKEN_KEEPALIVE`
  on the `maintenance` queue, which calls `getAccessToken({force: true})`.
  Refresh tokens expire after 60 days unused, so if syncing ever stops the
  connection still survives.
- **`invalid_grant`** means the refresh token was revoked, has expired, or the
  app was removed in Xero:
  - set `status = NEEDS_RECONNECT` and `lastError`
  - stop the sync chain (no retry storm)
  - the UI shows the Needs reconnect state

`src/common/redis-lock.ts` is a small `acquire(key, ttlMs)` →
`release()` helper built on `queues.redis()`. It's new; today the codebase
only has "busy" checks against queue job lists.

### Xero client

- **Shape.** Uses `HttpService` like `clickup.client.ts`: a single private
  `request()` with a 30 s timeout, headers
  `Authorization: Bearer <getAccessToken()>`, `xero-tenant-id` and
  `Accept: application/json`.
- **Pacing.**
  - Xero's limits: 60 calls a minute, 5,000 a day and 5 concurrent, all per
    tenant.
  - Data calls only happen in the **worker**, and the `xero-sync` processor
    runs with `concurrency: 1`. So the client paces itself in memory to at
    most 55 calls a minute (at least 1,100 ms between calls).
  - The web role only makes the connect, callback and revoke calls.
- **429 handling.** Honour `Retry-After` in seconds, retrying up to 3 times
  inside the client, capped at 60 s. This is the same approach as
  `ClickUpClient.retryAfterMs`.
- **Daily budget.** Log `X-DayLimit-Remaining` and `X-MinLimit-Remaining` for
  each run. If the day's remaining calls drop below 500, the run stops cleanly
  after the current entity, leaves its watermark where it was, and records
  `status = RATE_LIMITED` on the sync state. The next hourly run carries on.
- **Paging.** `page` **starts at 1**, unlike ClickUp's `page=0`, with 100 per
  page (paged responses include line items). Stop when a page returns fewer
  than 100 records, with a `MAX_PAGES` guard as in `clickup.client.ts`.
- **Incremental fetches.** Send
  `If-Modified-Since: <watermark, UTC, RFC 1123>`, add `order=UpdatedDateUTC`,
  and include archived contacts.
- **Dates.** Xero's legacy `/Date(1694736000000+0000)/` values are parsed by
  one pure helper, which gets its own tests.

### Data model (migration `0022_xero_finance`)

- **Conventions.** Existing ones apply: PascalCase models with snake_case
  `@@map` table names and `@map` column names, and `createdAt`/`updatedAt`
  timestamps.
- **Primary keys.** Each record's primary key is its **Xero GUID**
  (`String @id @db.Uuid`). That's the natural upsert conflict key, like
  `task_id`.

| Model / table | Key columns |
|---|---|
| `XeroConnection` / `xero_connections` | Singleton `id = "singleton"`, `tenantId`, `tenantName`, `shortCode`, `baseCurrency`, `accessTokenEnc`, `refreshTokenEnc`, `accessExpiresAt`, `refreshedAt`, `connectedByUserId`, `connectedAt`, `status` (`CONNECTED \| NEEDS_RECONNECT \| DISCONNECTED`), `lastError` |
| `XeroContact` / `xero_contacts` | `contactId`, `name`, `firstName`, `lastName`, `email`, `phones Json`, `addresses Json`, `taxNumber`, `defaultCurrency`, `isCustomer`, `isSupplier`, `status` (`ACTIVE \| ARCHIVED \| GDPRREQUEST`), `updatedDateUtc`, `raw Json` |
| `XeroInvoice` / `xero_invoices` | `invoiceId`, `type` (`ACCREC \| ACCPAY`), `number`, `reference`, `contactId`, `status`, `date @db.Date`, `dueDate @db.Date`, `currencyCode`, `currencyRate Decimal(18,6)`, `subTotal`, `totalTax`, `total`, `amountDue`, `amountPaid`, `amountCredited`, `totalBase`, `amountDueBase`, `lineItems Json`, `hasAttachments`, `updatedDateUtc`, `raw Json` |
| `XeroCreditNote` / `xero_credit_notes` | `creditNoteId`, `type` (`ACCRECCREDIT \| ACCPAYCREDIT`), `number`, `contactId`, `status`, `date`, `currencyCode`, `currencyRate`, `total`, `remainingCredit`, `totalBase`, `lineItems Json`, `hasAttachments`, `updatedDateUtc`, `raw` |
| `XeroBankTransaction` / `xero_bank_transactions` | `bankTransactionId`, `type` (`SPEND`, `RECEIVE`, and the `-OVERPAYMENT`, `-PREPAYMENT` and `-TRANSFER` variants), `contactId?`, `bankAccountCode`, `bankAccountName`, `reference`, `status`, `isReconciled`, `date`, `currencyCode`, `currencyRate`, `total`, `totalBase`, `lineItems Json`, `hasAttachments`, `updatedDateUtc`, `raw` |
| `XeroPayment` / `xero_payments` | `paymentId`, `invoiceId?`, `creditNoteId?`, `contactId`, `paymentType`, `status`, `date`, `amount`, `amountBase`, `currencyRate`, `accountCode`, `reference`, `updatedDateUtc`, `raw` |
| `XeroAttachment` / `xero_attachments` | `attachmentId`, `parentType` (`invoice \| creditNote \| bankTransaction`), `parentId`, `fileName`, `mimeType`, `contentLength`; unique on (`parentId`, `attachmentId`) |
| `XeroSyncState` / `xero_sync_state` | `entity` (primary key), `watermark` (max `UpdatedDateUTC` seen), `lastRunAt`, `lastSuccessAt`, `status`, `recordsUpserted`, `lastError` |

- **Money.** Amounts are `Decimal(14,2)` in the **document currency**, with
  `currency_code` beside them.
  - `*_base` columns hold the base-currency value, computed at write time as
    `amount / currencyRate`. Xero expresses the rate as foreign units per one
    base unit, and it is 1 for base-currency documents.
  - The division direction gets a fixture test against the Xero demo company.
  - No column is named after a currency it may not contain (see the
    `currency-aud-usd-debt` memory).
- **Indexes.** `contact_id`, `(type, status)`, `due_date`, `date` and
  `updated_date_utc` on each transaction table.
- **Deletes.** Voids, deletes and archives are **status changes** that arrive
  through the same incremental sync, because they change `UpdatedDateUTC`.
  Rows are never hard-deleted. `DELETED` rows are excluded by the report
  queries.
- **`raw`** keeps the full payload, so fields we skip now can be backfilled
  later without re-fetching.
- **Grafana.** The read-only database user needs `SELECT` on the new tables
  (ops step).

### Sync (worker only)

- **Queue.** New queue `xero-sync` in `QUEUES`, plus an `@InjectQueue` and a
  `get()` entry in `QueueService`. Processed only by `XeroSyncProcessor` in
  `WorkersModule`, with `concurrency: 1`.
- **Job types:**
  - `XERO_SYNC {full?: boolean}` is one run: contacts → invoices (both types)
    → credit notes → bank transactions → payments → attachment lists.
    - Each entity pages with `If-Modified-Since = watermark`. A full run
      ignores the watermark.
    - Rows are upserted in batches of 100.
    - The watermark moves forward only after an entity finishes.
  - `XERO_RECONCILE_OPEN` re-fetches, by ID, invoices whose status is still
    `AUTHORISED` or `SUBMITTED`, plus contacts. It uses `IDs=` batches of 50.
    - This covers a Xero gap: some edits don't change `UpdatedDateUTC`, for
      example a DueDate change on a part-paid invoice.
  - Attachment lists are fetched per record (`GET /{Entity}/{id}/Attachments`)
    only for records upserted in this run with `HasAttachments = true`, so the
    cost stays proportional to change.
- **Schedule.** Crons in `src/sync/sync.scheduler.ts` style: enqueue only,
  `timeZone: DHAKA`, skip if a job of the same name is already busy.
  - `XERO_SYNC`: hourly at minute 17.
  - `XERO_RECONCILE_OPEN`: nightly at 02:00. That's inside the 00:00–09:00
    heavy-work window (see the `office-hours-sync-schedule` memory).
  - `XERO_TOKEN_KEEPALIVE`: daily at 04:00, on `maintenance`.
  - All three are skipped when the connection isn't `CONNECTED`.
- **Manual.**
  - `POST /api/xero/sync` (Owner or Admin, audited) enqueues `XERO_SYNC`, or
    returns 409 if one is already busy.
  - The first successful connect enqueues `XERO_SYNC {full: true}`.
- **Failures.**
  - Default attempts and backoff from `QueueService.defaultJobOptions()`.
  - `NEEDS_RECONNECT` and `RATE_LIMITED` end the job cleanly, without throwing,
    so they don't use up retries.
  - Other failures go to `DeadLetterService.recordIfExhausted`. Its
    `entityId()` is extended to read `entity` from Xero payloads.
  - Sync progress for the Settings screen is written to `XeroSyncState` after
    each page.

### Read API

`src/xero/xero-reports.controller.ts`, with `@Roles(OWNER, ADMIN)`.

- **Pagination** follows the existing report conventions: `limit` and
  `offset`, `limit` capped at 200, response `{ items, total }`.
- **Filter parameters** are validated with class-validator DTOs. The global
  `ValidationPipe` already supports them, and they're safer than the ad-hoc
  parsing in `reports.controller.ts`.

| Endpoint | Returns |
|---|---|
| `GET /api/xero/status` | Connection state, org, scopes, per-entity sync state, calls used today. All roles that can see Settings. |
| `GET /api/finance/summary` | The 5 KPIs, aged-receivables buckets, top-3 overdue contacts, 6-month in/out series. |
| `GET /api/finance/contacts` | `q`, `role=customer\|supplier`, `archived`, `sort`, plus per-contact rollups (owed, overdue, owing, last activity). |
| `GET /api/finance/contacts/:id` | Contact, mini KPIs, and counts per sub-tab. |
| `GET /api/finance/invoices` | `type=ACCREC\|ACCPAY`, `status` (exclusive buckets), `from`, `to`, `currency`, `contactId`, `q`, `sort`, plus `totals`. |
| `GET /api/finance/invoices/:id` | Record, line items, payments, attachments, `xeroUrl`. |
| `GET /api/finance/bank-transactions` (`/:id`) | `type=SPEND\|RECEIVE`, `reconciled`, dates, `q`. |
| `GET /api/finance/credit-notes` (`/:id`) | Credit notes, same pattern. |
| `GET /api/finance/payments` | `direction=in\|out`, dates, `contactId`. |

**Deep links.** Built on the server as
`https://go.xero.com/organisationlogin/default.aspx?shortcode=<shortCode>&redirecturl=<path>`,
so they open the right organisation. Paths:
- Invoice: `/AccountsReceivable/View.aspx?InvoiceID=`
- Bill: `/AccountsPayable/View.aspx?InvoiceID=`
- Contact: `/Contacts/View/`
- Bank transaction: `/Bank/ViewTransaction.aspx?bankTransactionID=`

### Frontend

- **Navigation.** The three-file nav pattern from commit `f094dcd`:
  - `App.tsx`: a lazy `FinancePage`, wrapped in `RequireRole min="ADMIN"`.
  - `Sidebar.tsx`: in the admin-only branch, with `tag: "Beta"`.
  - `CommandPalette.tsx`: a `NAV_ITEMS` entry.
- **New files:**
  - `pages/FinancePage.tsx`, `components/finance/*` (the tables, the
    `ContactDrawer` and `RecordDrawer` with a record stack, and the
    `AgedReceivables` and `MoneyFlowChart` panels).
  - `api/finance.ts` and `hooks/useFinance.ts`, following the
    `hooks/useSettings.ts` pattern.
- **Reused components:** `PageHeader`, `MetricCard dense`, `DataTable`,
  `Drawer`, `Pill`, `Tabs`, `MultiSelect`, `Pagination`, `TableSkeleton`,
  `EmptyState`, `QueryError`, `Callout`, `Modal`, `fmt.money`, `lib/xlsx.ts`.
- **Settings page.** Add a `xero` tab to `SettingsPage.tsx`, and read
  `?tab=` and `?xero=` with `useSearchParams` (as `TasksPage.tsx:152` does).
  Check the tab against the role-filtered list, so a non-Owner can't open an
  Owner-only tab. After the success or error banner shows, clear `xero` from
  the URL.
- **Feature off.** If `XERO_CLIENT_ID` isn't set, `GET /api/xero/status` returns
  `{ configured: false }`. The Xero tab then says the server isn't configured,
  and the Finance nav entry is hidden.

### Config

Added to `src/config/env.validation.ts` (zod):

- `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`: `z.string().optional().default('')`.
- In `superRefine`, if either is set, both must be set, and in production
  `APP_ENCRYPTION_KEY` must also be valid.
- Both go in `.env.example` with a comment. The client secret is never logged
  and never stored in the database.

### Security

- **Callback.** Public, but authorised only by a single-use `state` bound to an
  Owner. The code is exchanged on the server; tokens never reach the browser.
- **Secrets.** Tokens are encrypted at rest and never logged. Axios error
  logging in `xero.client.ts` must strip the `Authorization` header.
- **Callback logs.** The request log must not record the callback's `code` and
  `state` query parameters. Audit-log body redaction doesn't cover them, but
  the callback is a GET, so the interceptor never sees it.
- **Finance data** (revenue, supplier spend) is limited to Owner and Admin, on
  both the API and the nav.
- **Least privilege.** Read-only scopes, so a leaked token can't change the
  books.

## Testing

- **Normaliser unit tests** for each payload type: contact roles, every
  invoice status, the bank-transaction type variants, payments against
  invoices and against credit notes, the multi-currency base conversion, the
  `/Date()/` parser, and missing optional fields.
- **Token service:**
  - Two concurrent `getAccessToken()` calls make exactly **one** refresh call,
    and the second caller gets the new token.
  - The re-read after taking the lock skips an unnecessary refresh.
  - `invalid_grant` → `NEEDS_RECONNECT`, and no retry.
- **OAuth callback:**
  - An unknown, expired or reused `state` is rejected.
  - `access_denied` → `reason=cancelled`.
  - A successful exchange upserts the connection, writes the audit row and
    enqueues a full sync.
  - The response is always a 302.
- **Client:**
  - Paging starts at 1 and stops on a short page.
  - `If-Modified-Since` is formatted correctly.
  - 429 honours `Retry-After`.
  - The run stops cleanly when the day's remaining calls fall below the
    threshold.
- **Reports service:**
  - KPI maths.
  - The exclusive status buckets cover every invoice.
  - Aged-bucket boundaries at 0/30/60/90 days.
  - `DELETED` rows are excluded.
- **Guardrail:** no code path calls a Xero write endpoint. A test asserts the
  client exposes only GET, plus the token, revoke and connection-delete calls.
- **Checks:** `npm run lint && npm run test && npm run build`.
- **Manual end-to-end** against the **Xero Demo Company**, through the
  localhost redirect:
  - connect, run the first sync, and check the table counts against Xero
  - edit an invoice in Xero and confirm the change arrives on the next run
  - void one and confirm the status updates
  - disconnect, then reconnect

## Docs to update on implementation

- **`CLAUDE.md`:**
  - the `xero-sync` queue in "Expected queues"
  - `src/xero/*` in "Main code areas"
  - the env block
  - "Known limitations": Xero ↔ ClickUp client matching is deferred
- **`docs/OPERATIONS.md`:**
  - registering the redirect URIs
  - the reconnect runbook
  - Grafana grants
  - the rate-limit and daily-budget behaviour

## Open questions

None blocking. Base-currency conversion direction and the deep-link paths get
confirmed against the Demo Company during the first implementation task.

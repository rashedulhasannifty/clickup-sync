# Xero Finance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Owner connects one Xero organisation from Settings. The worker then syncs its contacts, invoices, bills, credit notes, bank transactions, payments and attachment names into Postgres, and a new Owner/Admin-only **Finance** page shows them.

**Architecture:**
- **New module `src/xero/`:**
  - OAuth2 connect flow.
  - Encrypted token row with single-flight refresh (Redis lock).
  - Thin read-only Xero HTTP client.
  - Pure normalisers.
  - Repositories.
  - Sync service run by one BullMQ processor on a new `xero-sync` queue. Worker role only, scheduled with Dhaka-time crons.
- **Read API (`/api/finance/*`):** serves the React Finance page.
- **New Xero tab in Settings.**

**Tech Stack:**
- Backend: NestJS 11, Prisma 7 (Postgres), BullMQ + ioredis (Redis 8), `@nestjs/axios`, zod env validation, class-validator DTOs, Jest (`ts-jest`).
- Frontend: React 19 + Vite + TanStack Query + react-router v6.

**Spec:** `docs/superpowers/specs/2026-09-15-xero-finance-design.md`. Read it before starting.
**Approved UI:** `docs/superpowers/specs/assets/2026-09-15-xero-finance-prototype.html`. Open it in a browser; it is the visual reference for Tasks 11–12.

## Global Constraints

**Xero access**
- **Read-only:** no code may call a Xero endpoint that writes accounting data. Only data `GET`s plus the identity token/revoke calls and `DELETE /connections/{id}` (disconnect).
- **Scopes (exact):** `openid profile email offline_access accounting.contacts.read accounting.invoices.read accounting.payments.read accounting.banktransactions.read accounting.attachments.read accounting.settings.read`.
- **Tenants:** exactly one Xero organisation. More than one tenant → refuse with `reason=multiple_tenants`.
- **Redirect URI:** built as `${APP_BASE_URL}/api/xero/callback`.
  - Prod: `https://log.niftyitsolution.com/api/xero/callback`.
  - Local: `http://localhost:5173/api/xero/callback`.

**Tokens**
- Tokens live only in `xero_connections`, encrypted with `CryptoService`.
- Never cache them in-process. Never log them. Never put them in a URL.
- Never store them in `AppSettings`.
- Refresh is single-flight via the Redis lock `xero:token-refresh`. After acquiring the lock, re-read the row.

**Xero API behaviour**
- Paging starts at `page=1`, 100 per page. This differs from ClickUp's `page=0`.
- Rate limits are 60/min, 5,000/day and 5 concurrent. The client paces itself to ≥1,100 ms between calls.
- When `X-DayLimit-Remaining < 500`, the run stops cleanly with `RATE_LIMITED`.

**Money**
- Stored in document currency as `Decimal(14,2)` with `currency_code`.
- `*_base = amount / currencyRate` (rate 1 for base currency).
- No column is named after a currency.

**Dates and schedule**
- "Today" and "this month" are Asia/Dhaka.
- Crons use `timeZone: 'Asia/Dhaka'`, 6-field expressions, and only enqueue work.
- Crons are skipped when the connection isn't `CONNECTED`.

**Access**
- Finance pages and APIs: `Role.OWNER` and `Role.ADMIN`.
- Connect and disconnect: `Role.OWNER` only.
- Members see neither the nav entry nor the API.

**Business rules**
- Voids, deletes and archives are status changes, never hard deletes. `DELETED` rows are excluded from reports.
- `SPEND-TRANSFER` and `RECEIVE-TRANSFER` are excluded from money-in/out KPIs and the chart.
- The invoice/bill status filter uses exclusive buckets: `AUTHORISED` means "awaiting payment, not overdue"; `overdue` is its own bucket.

**Pagination and code style**
- List endpoints take `limit` (≤200) and `offset`, and return `{ items, total }`.
- Keep repo conventions:
  - Prisma PascalCase models with `@@map` snake_case, and `@map` on multi-word columns.
  - Repositories own writes.
  - Normalisers are pure.
  - Prettier formatting.
  - One `@Processor` per queue.

### Deliberate deviations from the spec (decided while planning)

1. **Keep-alive job queue.** `XERO_TOKEN_KEEPALIVE` runs on the `xero-sync` queue, not `maintenance`. `maintenance` is owned by `CostRecalcProcessor`; routing a Xero job through it would couple two unrelated features. A keep-alive delayed behind a running sync is harmless because the sync refreshes lazily.
2. **`If-Modified-Since` format.** Sent as ISO-8601 UTC without zone or milliseconds (`2026-09-15T10:00:00`), the form Xero documents and xero-node sends. The spec said RFC 1123.
3. **Controller name.** The read controller is `finance-reports.controller.ts` (it serves `/finance`), not `xero-reports.controller.ts`.
4. **Extra endpoint.** `GET /api/finance/contacts/:id/activity` is added for the contact drawer's Activity sub-tab. The spec listed the tab but not an endpoint.
5. **Extra columns.** `contact_name` is stored on every transaction row, so lists and search need no join. `xero_connections` also stores `connection_id`, needed by `DELETE /connections/{id}`, and `connected_by_email`, for display.
6. **Different-organisation guard.** A reconnect that picks a different Xero organisation from the one already synced is refused with `reason=different_org`, and the new grant is revoked. Otherwise two companies' books would mix in one set of tables. Switching organisations deliberately is an ops procedure; see the runbook in Task 13.
7. **First-sync progress.** Settings shows live per-entity record counts and a status pill during the first sync, instead of the prototype's percentage bars. Xero doesn't report totals up front, so any percentage would be made up.

Task 13 updates the spec to record these.

## File Map

| File | Responsibility | Task |
|---|---|---|
| `src/config/env.validation.ts` (+ `.spec.ts`) | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | 1 |
| `prisma/schema.prisma`, `prisma/migrations/0022_xero_finance/` | 8 tables + 1 enum | 1 |
| `src/common/redis-lock.ts` (+ spec) | `acquireLock()` / `release()` over `SET NX PX` + Lua compare-and-delete | 2 |
| `src/xero/xero.constants.ts` | URLs, scopes, Redis keys, thresholds, entity list | 3 |
| `src/xero/xero.types.ts` | Xero payload types (only the fields we read) | 3 |
| `src/xero/xero-errors.ts` | `XeroReconnectRequiredError`, `XeroInvalidGrantError`, `XeroRateBudgetExhaustedError` | 3 |
| `src/xero/xero-normalize.ts` (+ spec) | Pure payload → row functions, date parsing, base conversion, cash direction | 3 |
| `src/xero/xero-connection.repository.ts` | `xero_connections` singleton reads/writes | 4 |
| `src/xero/xero-identity.client.ts` (+ spec) | identity.xero.com token/refresh/revoke, `/connections` list/delete | 4 |
| `src/xero/xero-token.service.ts` (+ spec) | `getAccessToken()` with single-flight refresh | 4 |
| `src/xero/xero.client.ts` (+ spec) | Paced, paged, read-only data client | 5 |
| `src/xero/xero-auth.service.ts` (+ spec) | Consent URL + state, callback, disconnect, status | 6 |
| `src/xero/xero-auth.controller.ts` | `/api/xero/*` routes | 6 |
| `src/xero/xero.module.ts`, `src/app.module.ts` | Wiring | 6 |
| `src/xero/xero.repository.ts` (+ spec) | Upserts, attachment replace, sync state | 7 |
| `src/xero/xero-sync.service.ts` (+ spec) | Entity chain, watermark, attachments, reconcile-open | 7 |
| `src/queues/queue.constants.ts`, `queue.service.ts` | `xero-sync` queue + job names (registered early because the callback enqueues the first sync) | 6 |
| `src/workers/xero-sync.processor.ts` (+ spec), `workers.module.ts` | Processor | 8 |
| `src/xero/xero.scheduler.ts` (+ spec) | Hourly, nightly and keep-alive crons | 8 |
| `src/jobs/dead-letter.service.ts` (+ spec) | `entityId()` reads `entity` | 8 |
| `src/xero/finance-math.ts` (+ spec) | Dhaka dates, aging buckets, status-bucket `where`, deep links | 9 |
| `src/xero/dto/finance-query.dto.ts` | Validated list query DTOs | 10 |
| `src/xero/finance-reports.service.ts` (+ spec) | Summary, lists, details, activity | 10 |
| `src/xero/finance-reports.controller.ts` | `/api/finance/*` routes | 10 |
| `apps/web/src/api/finance.ts`, `hooks/useFinance.ts` | API types + react-query hooks | 11 |
| `apps/web/src/components/finance/XeroSettingsTab.tsx`, `pages/SettingsPage.tsx` | Settings → Xero | 11 |
| `apps/web/src/components/finance/*`, `pages/FinancePage.tsx`, `App.tsx`, `Sidebar.tsx`, `CommandPalette.tsx` | Finance page + nav | 12 |
| `CLAUDE.md`, `docs/OPERATIONS.md`, `.env.example`, spec | Docs | 13 |

Test commands:
- Backend: `npx jest <path> --runInBand` for one file; `npm run test` for everything.
- Frontend (no unit-test harness exists): `npm run build:web` and `npm run lint --workspace=apps/web`.

---

### Task 1: Config and database schema

**Files:**
- Modify: `src/config/env.validation.ts`
- Create: `src/config/env.validation.spec.ts`
- Modify: `prisma/schema.prisma` (append at the end of the file)
- Create: `prisma/migrations/0022_xero_finance/migration.sql` (generated, then reviewed)
- Modify: `.env.example`

**Interfaces:**
- Produces:
  - Env keys `XERO_CLIENT_ID: string` and `XERO_CLIENT_SECRET: string`, both defaulting to `''`.
  - Prisma models `XeroConnection`, `XeroContact`, `XeroInvoice`, `XeroCreditNote`, `XeroBankTransaction`, `XeroPayment`, `XeroAttachment`, `XeroSyncState`.
  - Enum `XeroConnectionStatus { CONNECTED NEEDS_RECONNECT DISCONNECTED }`.
  - Prisma client accessors `prisma.xeroConnection`, `prisma.xeroContact`, `prisma.xeroInvoice`, `prisma.xeroCreditNote`, `prisma.xeroBankTransaction`, `prisma.xeroPayment`, `prisma.xeroAttachment`, `prisma.xeroSyncState`.

- [ ] **Step 1: Write the failing env test**

Create `src/config/env.validation.spec.ts`:

```ts
import { validateEnv } from './env.validation';

const base = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };

describe('validateEnv — Xero', () => {
  it('defaults both Xero vars to empty (feature off)', () => {
    const env = validateEnv({ ...base });
    expect(env.XERO_CLIENT_ID).toBe('');
    expect(env.XERO_CLIENT_SECRET).toBe('');
  });

  it('accepts both set', () => {
    const env = validateEnv({ ...base, XERO_CLIENT_ID: 'id', XERO_CLIENT_SECRET: 'secret' });
    expect(env.XERO_CLIENT_ID).toBe('id');
  });

  it('rejects only one of the pair being set', () => {
    expect(() => validateEnv({ ...base, XERO_CLIENT_ID: 'id' })).toThrow(/XERO_CLIENT_SECRET/);
    expect(() => validateEnv({ ...base, XERO_CLIENT_SECRET: 's' })).toThrow(/XERO_CLIENT_ID/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/config/env.validation.spec.ts --runInBand`
Expected: FAIL. `XERO_CLIENT_ID` is `undefined`, and the pair rule doesn't throw.

- [ ] **Step 3: Add the vars and the pair rule**

In `src/config/env.validation.ts`, add after the `WEBHOOK_AUTOHEAL_ENABLED` line, inside `z.object({ ... })`:

```ts
  // Xero OAuth app credentials (Settings → Xero). Both empty = feature off.
  // The secret is only ever read by XeroIdentityClient; never log it.
  XERO_CLIENT_ID: z.string().optional().default(''),
  XERO_CLIENT_SECRET: z.string().optional().default(''),
```

At the **top** of the `.superRefine((env, ctx) => {` body, before the `if (env.NODE_ENV !== 'production') return;` line, add:

```ts
  // Half-configured Xero is always a mistake, in every environment.
  if (env.XERO_CLIENT_ID && !env.XERO_CLIENT_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['XERO_CLIENT_SECRET'], message: 'XERO_CLIENT_SECRET is required when XERO_CLIENT_ID is set' });
  }
  if (env.XERO_CLIENT_SECRET && !env.XERO_CLIENT_ID) {
    ctx.addIssue({ code: 'custom', path: ['XERO_CLIENT_ID'], message: 'XERO_CLIENT_ID is required when XERO_CLIENT_SECRET is set' });
  }
```

(In production `APP_ENCRYPTION_KEY` is already required unconditionally, so Xero needs no extra production check.)

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest src/config/env.validation.spec.ts --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 5: Append the Prisma models**

Append to the end of `prisma/schema.prisma`:

```prisma
// ─── Xero (read-only finance sync) ─────────────────────────────────────────
// See docs/superpowers/specs/2026-09-15-xero-finance-design.md. Primary keys are
// Xero GUIDs (natural upsert keys, like clickup_tasks.task_id). Money is in the
// DOCUMENT currency; *_base columns are base-currency (amount / currency_rate).

enum XeroConnectionStatus {
  CONNECTED
  NEEDS_RECONNECT
  DISCONNECTED
}

model XeroConnection {
  id                String               @id @default("singleton")
  tenantId          String?              @map("tenant_id")
  connectionId      String?              @map("connection_id")
  tenantName        String?              @map("tenant_name")
  shortCode         String?              @map("short_code")
  baseCurrency      String?              @map("base_currency")
  accessTokenEnc    String?              @map("access_token_enc")
  refreshTokenEnc   String?              @map("refresh_token_enc")
  accessExpiresAt   DateTime?            @map("access_expires_at")
  refreshedAt       DateTime?            @map("refreshed_at")
  connectedByUserId String?              @map("connected_by_user_id")
  connectedByEmail  String?              @map("connected_by_email")
  connectedAt       DateTime?            @map("connected_at")
  status            XeroConnectionStatus @default(DISCONNECTED)
  lastError         String?              @map("last_error")
  createdAt         DateTime             @default(now()) @map("created_at")
  updatedAt         DateTime             @default(now()) @updatedAt @map("updated_at")

  @@map("xero_connections")
}

model XeroContact {
  contactId       String   @id @map("contact_id") @db.Uuid
  name            String
  firstName       String?  @map("first_name")
  lastName        String?  @map("last_name")
  email           String?
  phones          Json?
  addresses       Json?
  taxNumber       String?  @map("tax_number")
  defaultCurrency String?  @map("default_currency")
  isCustomer      Boolean  @default(false) @map("is_customer")
  isSupplier      Boolean  @default(false) @map("is_supplier")
  status          String
  updatedDateUtc  DateTime @map("updated_date_utc")
  raw             Json
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at")

  @@index([name])
  @@map("xero_contacts")
}

model XeroInvoice {
  invoiceId      String    @id @map("invoice_id") @db.Uuid
  type           String
  number         String?
  reference      String?
  contactId      String?   @map("contact_id") @db.Uuid
  contactName    String?   @map("contact_name")
  status         String
  date           DateTime? @db.Date
  dueDate        DateTime? @map("due_date") @db.Date
  currencyCode   String    @map("currency_code")
  currencyRate   Decimal   @default(1) @map("currency_rate") @db.Decimal(18, 6)
  subTotal       Decimal   @default(0) @map("sub_total") @db.Decimal(14, 2)
  totalTax       Decimal   @default(0) @map("total_tax") @db.Decimal(14, 2)
  total          Decimal   @default(0) @db.Decimal(14, 2)
  amountDue      Decimal   @default(0) @map("amount_due") @db.Decimal(14, 2)
  amountPaid     Decimal   @default(0) @map("amount_paid") @db.Decimal(14, 2)
  amountCredited Decimal   @default(0) @map("amount_credited") @db.Decimal(14, 2)
  totalBase      Decimal   @default(0) @map("total_base") @db.Decimal(14, 2)
  amountDueBase  Decimal   @default(0) @map("amount_due_base") @db.Decimal(14, 2)
  lineItems      Json      @map("line_items")
  hasAttachments Boolean   @default(false) @map("has_attachments")
  updatedDateUtc DateTime  @map("updated_date_utc")
  raw            Json
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @default(now()) @updatedAt @map("updated_at")

  @@index([contactId])
  @@index([type, status])
  @@index([dueDate])
  @@index([date])
  @@index([updatedDateUtc])
  @@map("xero_invoices")
}

model XeroCreditNote {
  creditNoteId    String    @id @map("credit_note_id") @db.Uuid
  type            String
  number          String?
  reference       String?
  contactId       String?   @map("contact_id") @db.Uuid
  contactName     String?   @map("contact_name")
  status          String
  date            DateTime? @db.Date
  currencyCode    String    @map("currency_code")
  currencyRate    Decimal   @default(1) @map("currency_rate") @db.Decimal(18, 6)
  subTotal        Decimal   @default(0) @map("sub_total") @db.Decimal(14, 2)
  totalTax        Decimal   @default(0) @map("total_tax") @db.Decimal(14, 2)
  total           Decimal   @default(0) @db.Decimal(14, 2)
  remainingCredit Decimal   @default(0) @map("remaining_credit") @db.Decimal(14, 2)
  totalBase       Decimal   @default(0) @map("total_base") @db.Decimal(14, 2)
  lineItems       Json      @map("line_items")
  hasAttachments  Boolean   @default(false) @map("has_attachments")
  updatedDateUtc  DateTime  @map("updated_date_utc")
  raw             Json
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @default(now()) @updatedAt @map("updated_at")

  @@index([contactId])
  @@index([type, status])
  @@index([date])
  @@index([updatedDateUtc])
  @@map("xero_credit_notes")
}

model XeroBankTransaction {
  bankTransactionId String    @id @map("bank_transaction_id") @db.Uuid
  type              String
  contactId         String?   @map("contact_id") @db.Uuid
  contactName       String?   @map("contact_name")
  bankAccountCode   String?   @map("bank_account_code")
  bankAccountName   String?   @map("bank_account_name")
  reference         String?
  status            String
  isReconciled      Boolean   @default(false) @map("is_reconciled")
  date              DateTime? @db.Date
  currencyCode      String    @map("currency_code")
  currencyRate      Decimal   @default(1) @map("currency_rate") @db.Decimal(18, 6)
  subTotal          Decimal   @default(0) @map("sub_total") @db.Decimal(14, 2)
  totalTax          Decimal   @default(0) @map("total_tax") @db.Decimal(14, 2)
  total             Decimal   @default(0) @db.Decimal(14, 2)
  totalBase         Decimal   @default(0) @map("total_base") @db.Decimal(14, 2)
  lineItems         Json      @map("line_items")
  hasAttachments    Boolean   @default(false) @map("has_attachments")
  updatedDateUtc    DateTime  @map("updated_date_utc")
  raw               Json
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @default(now()) @updatedAt @map("updated_at")

  @@index([contactId])
  @@index([type, status])
  @@index([date])
  @@index([updatedDateUtc])
  @@map("xero_bank_transactions")
}

model XeroPayment {
  paymentId        String    @id @map("payment_id") @db.Uuid
  paymentType      String    @map("payment_type")
  // 'in' | 'out' | null — null = not a cash movement we count (see cashDirection()).
  cashDirection    String?   @map("cash_direction")
  status           String
  invoiceId        String?   @map("invoice_id") @db.Uuid
  invoiceNumber    String?   @map("invoice_number")
  creditNoteId     String?   @map("credit_note_id") @db.Uuid
  creditNoteNumber String?   @map("credit_note_number")
  contactId        String?   @map("contact_id") @db.Uuid
  contactName      String?   @map("contact_name")
  date             DateTime? @db.Date
  currencyCode     String?   @map("currency_code")
  amount           Decimal   @default(0) @db.Decimal(14, 2)
  currencyRate     Decimal   @default(1) @map("currency_rate") @db.Decimal(18, 6)
  amountBase       Decimal   @default(0) @map("amount_base") @db.Decimal(14, 2)
  bankAccountCode  String?   @map("bank_account_code")
  bankAccountName  String?   @map("bank_account_name")
  reference        String?
  updatedDateUtc   DateTime  @map("updated_date_utc")
  raw              Json
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @default(now()) @updatedAt @map("updated_at")

  @@index([invoiceId])
  @@index([creditNoteId])
  @@index([contactId])
  @@index([date])
  @@map("xero_payments")
}

model XeroAttachment {
  id            BigInt   @id @default(autoincrement())
  attachmentId  String   @map("attachment_id") @db.Uuid
  parentType    String   @map("parent_type")
  parentId      String   @map("parent_id") @db.Uuid
  fileName      String   @map("file_name")
  mimeType      String?  @map("mime_type")
  contentLength Int?     @map("content_length")
  createdAt     DateTime @default(now()) @map("created_at")

  @@unique([parentId, attachmentId])
  @@index([parentId])
  @@map("xero_attachments")
}

model XeroSyncState {
  entity          String    @id
  watermark       DateTime?
  lastRunAt       DateTime? @map("last_run_at")
  lastSuccessAt   DateTime? @map("last_success_at")
  status          String    @default("IDLE")
  recordsUpserted Int       @default(0) @map("records_upserted")
  lastError       String?   @map("last_error")
  updatedAt       DateTime  @default(now()) @updatedAt @map("updated_at")

  @@map("xero_sync_state")
}
```

- [ ] **Step 6: Generate the migration (create-only), rename it, and review the SQL**

Run (local DB up via `npm run dev:deps`):

```bash
npx prisma migrate dev --create-only --name xero_finance --config ./prisma.config.ts
mv prisma/migrations/*_xero_finance prisma/migrations/0022_xero_finance
cat prisma/migrations/0022_xero_finance/migration.sql
```

Expected SQL:
- `CREATE TYPE "XeroConnectionStatus"`, 8 × `CREATE TABLE` (all `xero_*`), and the indexes, including the unique index on `xero_attachments(parent_id, attachment_id)`.
- **No** `ALTER`/`DROP` on existing tables. If any appear, stop: the local DB has drifted, so run `npm run dev:reset` and repeat.

- [ ] **Step 7: Apply and generate the client**

Run: `npm run prisma:deploy && npm run prisma:generate`
Expected: `Applying migration 0022_xero_finance`, then `Generated Prisma Client`.

- [ ] **Step 8: Document the env vars**

Append to `.env.example`:

```env
# ── Xero (optional; Settings → Xero). Both empty = feature off. ──────────────
# From https://developer.xero.com/app/manage → your app → Configuration.
# Register redirect URIs on the Xero app:
#   prod:  https://log.niftyitsolution.com/api/xero/callback
#   local: http://localhost:5173/api/xero/callback   (Vite proxies /api)
# The redirect URI is built from APP_BASE_URL. Requires APP_ENCRYPTION_KEY.
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
```

- [ ] **Step 9: Build and commit**

Run: `npm run build`
Expected: exit 0.

```bash
git add src/config/env.validation.ts src/config/env.validation.spec.ts prisma/schema.prisma prisma/migrations/0022_xero_finance .env.example
git commit -m "feat(xero): env config and finance tables (migration 0022)"
```

---

### Task 2: Redis lock helper

The codebase has no lock primitive. Existing crons only check busy queues. Xero rotates the refresh token on every use, so two processes refreshing at once break the connection. This helper makes refresh single-flight.

**Files:**
- Create: `src/common/redis-lock.ts`
- Test: `src/common/redis-lock.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LockRedis {
    set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<unknown>;
    eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  }
  export interface LockHandle { readonly token: string; release(): Promise<boolean> }
  export function acquireLock(redis: LockRedis, key: string, ttlMs: number): Promise<LockHandle | null>;
  ```
  `QueueService.redis()` returns an ioredis client. Pass it as `(await queues.redis()) as unknown as LockRedis`.

- [ ] **Step 1: Write the failing test**

```ts
import { acquireLock, type LockRedis } from './redis-lock';

/** Minimal in-memory stand-in for the two Redis commands the lock uses. */
export class FakeLockRedis implements LockRedis {
  store = new Map<string, string>();
  async set(key: string, value: string, _px: 'PX', _ttl: number, _nx: 'NX') {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async eval(_script: string, _n: number, key: string, token: string) {
    if (this.store.get(key) === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

describe('acquireLock', () => {
  it('grants the lock once and refuses a second holder', async () => {
    const redis = new FakeLockRedis();
    const a = await acquireLock(redis, 'k', 1000);
    const b = await acquireLock(redis, 'k', 1000);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('release frees the key for the next caller', async () => {
    const redis = new FakeLockRedis();
    const a = await acquireLock(redis, 'k', 1000);
    expect(await a!.release()).toBe(true);
    expect(await acquireLock(redis, 'k', 1000)).not.toBeNull();
  });

  it("a stale holder cannot delete someone else's lock", async () => {
    const redis = new FakeLockRedis();
    const a = await acquireLock(redis, 'k', 1000);
    redis.store.set('k', 'someone-else'); // a's TTL expired and another process took it
    expect(await a!.release()).toBe(false);
    expect(redis.store.get('k')).toBe('someone-else');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/common/redis-lock.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './redis-lock'".

- [ ] **Step 3: Implement**

```ts
import { randomBytes } from 'crypto';

/**
 * The two ioredis commands this lock needs. `QueueService.redis()` returns a
 * full ioredis client; cast it to this at the call site.
 */
export interface LockRedis {
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface LockHandle {
  readonly token: string;
  /** True if we still held the lock and deleted it; false if it had expired or moved on. */
  release(): Promise<boolean>;
}

// Compare-and-delete. A plain DEL could remove a lock that expired and was
// re-acquired by another process while we were still working.
const RELEASE_LUA =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/**
 * Single-holder mutex over `SET key token PX ttl NX`. Returns null when another
 * holder has it. Callers decide whether to wait or give up. The TTL is the
 * safety net for a holder that crashes without releasing.
 */
export async function acquireLock(redis: LockRedis, key: string, ttlMs: number): Promise<LockHandle | null> {
  const token = randomBytes(16).toString('hex');
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  return {
    token,
    release: async () => Number(await redis.eval(RELEASE_LUA, 1, key, token)) === 1,
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest src/common/redis-lock.spec.ts --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/redis-lock.ts src/common/redis-lock.spec.ts
git commit -m "feat(common): redis single-holder lock helper"
```

---

### Task 3: Xero constants, types, errors and normalisers

Everything here is pure: no Nest, no I/O. Later tasks import these names exactly as written.

**Files:**
- Create: `src/xero/xero.constants.ts`
- Create: `src/xero/xero.types.ts`
- Create: `src/xero/xero-errors.ts`
- Create: `src/xero/xero-normalize.ts`
- Test: `src/xero/xero-normalize.spec.ts`

**Interfaces:**
- Produces:
  - All exports of `xero.constants.ts` below: `XERO_*` URLs, `XERO_SCOPES`, `XERO_SCOPE_STRING`, `XERO_REDIS`, the thresholds, `XERO_ENTITIES`, `XeroEntity`, `ENTITY_ENDPOINTS`, `ATTACHMENT_PARENTS`.
  - All payload interfaces in `xero.types.ts`.
  - Error classes `XeroReconnectRequiredError`, `XeroInvalidGrantError`, `XeroRateBudgetExhaustedError`.
  - From `xero-normalize.ts`: `parseXeroTimestamp`, `parseXeroDateOnly`, `round2`, `toBase`, `cashDirection`, `normalizeContact`, `normalizeInvoice`, `normalizeCreditNote`, `normalizeBankTransaction`, `normalizePayment`, `normalizeAttachment`, and `NormalizedRows`.

- [ ] **Step 1: Create the constants**

`src/xero/xero.constants.ts`:

```ts
export const XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
export const XERO_REVOKE_URL = 'https://identity.xero.com/connect/revocation';
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';

/**
 * Granular, read-only. Apps created on/after 2 Mar 2026 cannot use the broad
 * `accounting.transactions` scope. Credit notes are covered by accounting.invoices.
 */
export const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.contacts.read',
  'accounting.invoices.read',
  'accounting.payments.read',
  'accounting.banktransactions.read',
  'accounting.attachments.read',
  'accounting.settings.read',
] as const;
export const XERO_SCOPE_STRING = XERO_SCOPES.join(' ');

/** Raw ioredis commands are NOT auto-prefixed, so every key is namespaced here. */
export const XERO_REDIS = {
  oauthState: (state: string) => `xero:oauth-state:${state}`,
  tokenLock: 'xero:token-refresh',
  dayRemaining: 'xero:day-remaining',
} as const;

export const OAUTH_STATE_TTL_SECONDS = 600;
/** Treat an access token as stale this long before Xero's expiry (clock skew + in-flight calls). */
export const TOKEN_FRESH_MARGIN_MS = 120_000;
export const TOKEN_LOCK_TTL_MS = 30_000;
export const TOKEN_WAIT_TIMEOUT_MS = 10_000;
export const TOKEN_WAIT_POLL_MS = 250;

/** Xero allows 60/min per tenant; 1,100 ms spacing keeps us at ≤55/min. */
export const MIN_CALL_INTERVAL_MS = 1_100;
/** Stop a run when fewer than this many of the 5,000 daily calls remain. */
export const DAY_BUDGET_FLOOR = 500;
export const PAGE_SIZE = 100;
export const MAX_PAGES = 2_000;
export const MAX_429_RETRIES = 3;
export const MAX_BACKOFF_MS = 60_000;
export const RECONCILE_ID_BATCH = 50;
export const UPSERT_BATCH = 100;

export const XERO_ENTITIES = ['contacts', 'invoices', 'creditNotes', 'bankTransactions', 'payments'] as const;
export type XeroEntity = (typeof XERO_ENTITIES)[number];

/** Paged list endpoints. `key` is the array property in the JSON response. */
export const ENTITY_ENDPOINTS: Record<XeroEntity, { path: string; key: string; params: Record<string, string> }> = {
  contacts: { path: '/Contacts', key: 'Contacts', params: { includeArchived: 'true', order: 'UpdatedDateUTC ASC' } },
  invoices: { path: '/Invoices', key: 'Invoices', params: { order: 'UpdatedDateUTC ASC' } },
  creditNotes: { path: '/CreditNotes', key: 'CreditNotes', params: { order: 'UpdatedDateUTC ASC' } },
  bankTransactions: { path: '/BankTransactions', key: 'BankTransactions', params: { order: 'UpdatedDateUTC ASC' } },
  payments: { path: '/Payments', key: 'Payments', params: { order: 'UpdatedDateUTC ASC' } },
};

/** Records whose attachment list we fetch, keyed by our `parent_type` value. */
export const ATTACHMENT_PARENTS = {
  invoice: '/Invoices',
  creditNote: '/CreditNotes',
  bankTransaction: '/BankTransactions',
} as const;
export type AttachmentParentType = keyof typeof ATTACHMENT_PARENTS;
```

- [ ] **Step 2: Create the payload types**

`src/xero/xero.types.ts` (only the fields we read; everything else survives in `raw`):

```ts
export interface XeroTokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
}

export interface XeroTenantConnection {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName: string | null;
}

export interface XeroOrganisation {
  Name: string;
  BaseCurrency: string;
  ShortCode?: string;
}

export interface XeroContactRef {
  ContactID?: string;
  Name?: string;
}

export interface XeroLineItem {
  LineItemID?: string;
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  AccountCode?: string;
  TaxType?: string;
  TaxAmount?: number;
  LineAmount?: number;
  ItemCode?: string;
}

export interface XeroPhone {
  PhoneType?: string;
  PhoneNumber?: string;
  PhoneAreaCode?: string;
  PhoneCountryCode?: string;
}

export interface XeroAddress {
  AddressType?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  Region?: string;
  PostalCode?: string;
  Country?: string;
}

export interface XeroContact {
  ContactID: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  Phones?: XeroPhone[];
  Addresses?: XeroAddress[];
  TaxNumber?: string;
  DefaultCurrency?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  ContactStatus?: string;
  UpdatedDateUTC: string;
}

export interface XeroInvoice {
  InvoiceID: string;
  Type: string;
  InvoiceNumber?: string;
  Reference?: string;
  Contact?: XeroContactRef;
  Status: string;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
  AmountCredited?: number;
  LineItems?: XeroLineItem[];
  HasAttachments?: boolean;
  UpdatedDateUTC: string;
}

export interface XeroCreditNote {
  CreditNoteID: string;
  Type: string;
  CreditNoteNumber?: string;
  Reference?: string;
  Contact?: XeroContactRef;
  Status: string;
  Date?: string;
  DateString?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  RemainingCredit?: number;
  LineItems?: XeroLineItem[];
  HasAttachments?: boolean;
  UpdatedDateUTC: string;
}

export interface XeroBankTransaction {
  BankTransactionID: string;
  Type: string;
  Contact?: XeroContactRef;
  BankAccount?: { AccountID?: string; Code?: string; Name?: string };
  Reference?: string;
  Status: string;
  IsReconciled?: boolean;
  Date?: string;
  DateString?: string;
  CurrencyCode?: string;
  CurrencyRate?: number;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  LineItems?: XeroLineItem[];
  HasAttachments?: boolean;
  UpdatedDateUTC: string;
}

export interface XeroPayment {
  PaymentID: string;
  PaymentType?: string;
  Status: string;
  Date?: string;
  Amount?: number;
  CurrencyRate?: number;
  Reference?: string;
  Account?: { AccountID?: string; Code?: string; Name?: string };
  Invoice?: { InvoiceID?: string; InvoiceNumber?: string; Type?: string; Contact?: XeroContactRef; CurrencyCode?: string };
  CreditNote?: { CreditNoteID?: string; CreditNoteNumber?: string; Contact?: XeroContactRef; CurrencyCode?: string };
  UpdatedDateUTC: string;
}

export interface XeroAttachment {
  AttachmentID: string;
  FileName: string;
  MimeType?: string;
  ContentLength?: number;
}
```

- [ ] **Step 3: Create the error classes**

`src/xero/xero-errors.ts`:

```ts
/** The stored connection can't be used: never connected, disconnected, or refresh rejected. Don't retry. */
export class XeroReconnectRequiredError extends Error {
  constructor(message = 'Xero needs to be reconnected') {
    super(message);
    this.name = 'XeroReconnectRequiredError';
  }
}

/** identity.xero.com answered `invalid_grant`: the refresh token is revoked or expired. */
export class XeroInvalidGrantError extends Error {
  constructor(message = 'invalid_grant') {
    super(message);
    this.name = 'XeroInvalidGrantError';
  }
}

/** Fewer than DAY_BUDGET_FLOOR calls remain today. The run stops cleanly and the next one resumes. */
export class XeroRateBudgetExhaustedError extends Error {
  constructor(public readonly remaining: number) {
    super(`Xero daily call budget nearly exhausted (${remaining} left)`);
    this.name = 'XeroRateBudgetExhaustedError';
  }
}
```

- [ ] **Step 4: Write the failing normaliser tests**

`src/xero/xero-normalize.spec.ts`:

```ts
import {
  cashDirection, normalizeAttachment, normalizeBankTransaction, normalizeContact, normalizeCreditNote,
  normalizeInvoice, normalizePayment, parseXeroDateOnly, parseXeroTimestamp, toBase,
} from './xero-normalize';

const UPDATED = '/Date(1757930400000+0000)/'; // 2025-09-15T10:00:00Z

describe('parseXeroTimestamp', () => {
  it('parses the legacy /Date(ms+zone)/ form', () => {
    expect(parseXeroTimestamp(UPDATED)?.toISOString()).toBe('2025-09-15T10:00:00.000Z');
  });
  it('treats a zone-less ISO string as UTC', () => {
    expect(parseXeroTimestamp('2026-09-15T08:30:00')?.toISOString()).toBe('2026-09-15T08:30:00.000Z');
  });
  it('returns null for empty or garbage input', () => {
    expect(parseXeroTimestamp(undefined)).toBeNull();
    expect(parseXeroTimestamp('nope')).toBeNull();
  });
});

describe('parseXeroDateOnly', () => {
  it('prefers DateString and never shifts the calendar day', () => {
    expect(parseXeroDateOnly('2026-09-01T00:00:00', '/Date(1756684800000+0000)/')?.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });
  it('falls back to the legacy timestamp, truncated to its UTC date', () => {
    expect(parseXeroDateOnly(undefined, '/Date(1757930400000+0000)/')?.toISOString()).toBe('2025-09-15T00:00:00.000Z');
  });
});

describe('toBase', () => {
  it('returns the amount for base-currency documents (rate 1 or missing)', () => {
    expect(toBase(1234.5, 1)).toBe(1234.5);
    expect(toBase(1234.5, undefined)).toBe(1234.5);
    expect(toBase(1234.5, 0)).toBe(1234.5);
  });
  it('divides by the rate (Xero rate = foreign units per 1 base unit)', () => {
    // 1 USD = 1.515 AUD, so AUD 1,000 = USD 660.07
    expect(toBase(1000, 1.515)).toBe(660.07);
  });
});

describe('cashDirection', () => {
  it.each([
    ['ACCRECPAYMENT', 'in'],
    ['APCREDITPAYMENT', 'in'],
    ['ACCPAYPAYMENT', 'out'],
    ['ARCREDITPAYMENT', 'out'],
    ['AROVERPAYMENTPAYMENT', null],
    ['APPREPAYMENTPAYMENT', null],
    [undefined, null],
  ])('%s → %s', (type, expected) => {
    expect(cashDirection(type as string | undefined)).toBe(expected);
  });
});

describe('normalizeContact', () => {
  it('maps roles, email, status and keeps raw', () => {
    const c = {
      ContactID: '11111111-1111-4111-8111-111111111111', Name: 'Harbourline Dental', EmailAddress: 'a@b.c',
      IsCustomer: true, IsSupplier: false, DefaultCurrency: 'AUD', UpdatedDateUTC: UPDATED,
    };
    const row = normalizeContact(c);
    expect(row).toMatchObject({
      contactId: c.ContactID, name: 'Harbourline Dental', email: 'a@b.c', isCustomer: true, isSupplier: false,
      defaultCurrency: 'AUD', status: 'ACTIVE',
    });
    expect(row.updatedDateUtc.toISOString()).toBe('2025-09-15T10:00:00.000Z');
    expect(row.raw).toEqual(c);
  });
});

describe('normalizeInvoice', () => {
  const inv = {
    InvoiceID: '22222222-2222-4222-8222-222222222222', Type: 'ACCREC', InvoiceNumber: 'INV-0142', Reference: 'PO 4471',
    Contact: { ContactID: '11111111-1111-4111-8111-111111111111', Name: 'Harbourline Dental' },
    Status: 'AUTHORISED', DateString: '2026-08-20T00:00:00', DueDateString: '2026-09-03T00:00:00',
    CurrencyCode: 'AUD', CurrencyRate: 1.515, SubTotal: 1000, TotalTax: 100, Total: 1100, AmountDue: 660,
    AmountPaid: 440, AmountCredited: 0, HasAttachments: true, UpdatedDateUTC: UPDATED,
    LineItems: [{ Description: 'SEO — monthly', Quantity: 1, UnitAmount: 1000, AccountCode: '200', TaxType: 'OUTPUT', TaxAmount: 100, LineAmount: 1000 }],
  };

  it('maps header, contact, dates, money and base amounts', () => {
    const row = normalizeInvoice(inv);
    expect(row).toMatchObject({
      invoiceId: inv.InvoiceID, type: 'ACCREC', number: 'INV-0142', reference: 'PO 4471',
      contactId: inv.Contact.ContactID, contactName: 'Harbourline Dental', status: 'AUTHORISED',
      currencyCode: 'AUD', currencyRate: 1.515, subTotal: 1000, totalTax: 100, total: 1100,
      amountDue: 660, amountPaid: 440, amountCredited: 0, totalBase: 726.07, amountDueBase: 435.64,
      hasAttachments: true,
    });
    expect(row.date?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(row.dueDate?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    expect(row.lineItems).toEqual([
      { description: 'SEO — monthly', quantity: 1, unitAmount: 1000, accountCode: '200', taxType: 'OUTPUT', taxAmount: 100, lineAmount: 1000, itemCode: null },
    ]);
  });

  it('defaults missing optional fields', () => {
    const row = normalizeInvoice({ InvoiceID: inv.InvoiceID, Type: 'ACCPAY', Status: 'DRAFT', UpdatedDateUTC: UPDATED });
    expect(row).toMatchObject({
      number: null, contactId: null, contactName: null, currencyCode: 'XXX', currencyRate: 1, total: 0,
      amountDueBase: 0, hasAttachments: false, lineItems: [],
    });
    expect(row.date).toBeNull();
  });
});

describe('normalizeCreditNote', () => {
  it('maps remaining credit and base total', () => {
    const row = normalizeCreditNote({
      CreditNoteID: '33333333-3333-4333-8333-333333333333', Type: 'ACCRECCREDIT', CreditNoteNumber: 'CN-0031',
      Status: 'AUTHORISED', CurrencyCode: 'USD', Total: 450, RemainingCredit: 450, UpdatedDateUTC: UPDATED,
    });
    expect(row).toMatchObject({ number: 'CN-0031', type: 'ACCRECCREDIT', total: 450, remainingCredit: 450, totalBase: 450 });
  });
});

describe('normalizeBankTransaction', () => {
  it('keeps the transfer variant type and bank account', () => {
    const row = normalizeBankTransaction({
      BankTransactionID: '44444444-4444-4444-8444-444444444444', Type: 'SPEND-TRANSFER', Status: 'AUTHORISED',
      BankAccount: { Code: '090', Name: 'Business Bank Account' }, CurrencyCode: 'USD', Total: 500,
      UpdatedDateUTC: UPDATED,
    });
    expect(row).toMatchObject({
      type: 'SPEND-TRANSFER', bankAccountCode: '090', bankAccountName: 'Business Bank Account', isReconciled: false,
      total: 500, totalBase: 500, contactId: null,
    });
  });
});

describe('normalizePayment', () => {
  it('links an invoice payment and derives cash direction and base amount', () => {
    const row = normalizePayment({
      PaymentID: '55555555-5555-4555-8555-555555555555', PaymentType: 'ACCRECPAYMENT', Status: 'AUTHORISED',
      Date: '/Date(1757894400000+0000)/', Amount: 1515, CurrencyRate: 1.515, Reference: 'Stripe payout',
      Account: { Code: '090', Name: 'Business Bank Account' },
      Invoice: { InvoiceID: '22222222-2222-4222-8222-222222222222', InvoiceNumber: 'INV-0142', CurrencyCode: 'AUD', Contact: { ContactID: '11111111-1111-4111-8111-111111111111', Name: 'Harbourline Dental' } },
      UpdatedDateUTC: UPDATED,
    });
    expect(row).toMatchObject({
      cashDirection: 'in', invoiceId: '22222222-2222-4222-8222-222222222222', invoiceNumber: 'INV-0142',
      creditNoteId: null, contactName: 'Harbourline Dental', currencyCode: 'AUD', amount: 1515, amountBase: 1000,
      bankAccountCode: '090',
    });
    expect(row.date?.toISOString()).toBe('2025-09-15T00:00:00.000Z');
  });

  it('links a credit-note refund', () => {
    const row = normalizePayment({
      PaymentID: '66666666-6666-4666-8666-666666666666', PaymentType: 'ARCREDITPAYMENT', Status: 'AUTHORISED',
      Amount: 100, CreditNote: { CreditNoteID: '33333333-3333-4333-8333-333333333333', CreditNoteNumber: 'CN-0031' },
      UpdatedDateUTC: UPDATED,
    });
    expect(row).toMatchObject({ cashDirection: 'out', invoiceId: null, creditNoteId: '33333333-3333-4333-8333-333333333333' });
  });
});

describe('normalizeAttachment', () => {
  it('maps file metadata onto its parent', () => {
    expect(
      normalizeAttachment('invoice', 'p1', { AttachmentID: 'a1', FileName: 'SOW.pdf', MimeType: 'application/pdf', ContentLength: 2048 }),
    ).toEqual({ attachmentId: 'a1', parentType: 'invoice', parentId: 'p1', fileName: 'SOW.pdf', mimeType: 'application/pdf', contentLength: 2048 });
  });
});
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `npx jest src/xero/xero-normalize.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero-normalize'".

- [ ] **Step 6: Implement the normalisers**

`src/xero/xero-normalize.ts`:

```ts
import type { Prisma } from '@prisma/client';
import type { AttachmentParentType } from './xero.constants';
import type {
  XeroAttachment, XeroBankTransaction, XeroContact, XeroCreditNote, XeroInvoice, XeroLineItem, XeroPayment,
} from './xero.types';

const LEGACY_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/** Xero timestamps are either `/Date(ms+0000)/` or zone-less ISO strings, which Xero means as UTC. */
export function parseXeroTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  const legacy = LEGACY_DATE.exec(value);
  if (legacy) return new Date(Number(legacy[1]));
  const d = new Date(HAS_ZONE.test(value) ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Date-only fields (invoice Date/DueDate). Prefer the `*String` variant
 * (`2026-09-01T00:00:00`) and keep only its calendar day, so no timezone can move
 * a due date across midnight. Falls back to the legacy timestamp's UTC date.
 */
export function parseXeroDateOnly(dateString?: string | null, legacy?: string | null): Date | null {
  const m = dateString ? /^(\d{4}-\d{2}-\d{2})/.exec(dateString) : null;
  if (m) return new Date(`${m[1]}T00:00:00.000Z`);
  const ts = parseXeroTimestamp(legacy);
  return ts ? new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate())) : null;
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (v: unknown): number => round2(Number(v ?? 0) || 0);

/**
 * Document-currency amount → base currency. Xero's CurrencyRate is foreign units
 * per ONE base unit (1 for base-currency documents), so base = amount / rate.
 * Confirmed against the Demo Company in Task 13.
 */
export function toBase(amount: number | null | undefined, rate: number | null | undefined): number {
  const r = Number(rate);
  if (!r || !Number.isFinite(r) || r === 1) return money(amount);
  return round2(Number(amount ?? 0) / r);
}

/**
 * Which payments are real cash for the money-in/out KPIs. Overpayment and
 * prepayment allocations are excluded: their cash already appears as a
 * RECEIVE-/SPEND-OVERPAYMENT or -PREPAYMENT bank transaction, so counting the
 * allocation too would double count.
 */
export function cashDirection(paymentType?: string | null): 'in' | 'out' | null {
  switch (paymentType) {
    case 'ACCRECPAYMENT': // customer paid an invoice
    case 'APCREDITPAYMENT': // supplier refunded a credit note
      return 'in';
    case 'ACCPAYPAYMENT': // we paid a bill
    case 'ARCREDITPAYMENT': // we refunded a customer credit note
      return 'out';
    default:
      return null;
  }
}

function lineItems(items?: XeroLineItem[]): Prisma.InputJsonValue {
  return (items ?? []).map((l) => ({
    description: l.Description ?? null,
    quantity: l.Quantity ?? null,
    unitAmount: l.UnitAmount ?? null,
    accountCode: l.AccountCode ?? null,
    taxType: l.TaxType ?? null,
    taxAmount: l.TaxAmount ?? null,
    lineAmount: l.LineAmount ?? null,
    itemCode: l.ItemCode ?? null,
  }));
}

const raw = (v: unknown) => v as Prisma.InputJsonValue;
const updated = (v: string): Date => parseXeroTimestamp(v) ?? new Date(0);
const rate = (v?: number) => (v && Number.isFinite(v) ? v : 1);

export function normalizeContact(c: XeroContact) {
  return {
    contactId: c.ContactID,
    name: c.Name,
    firstName: c.FirstName ?? null,
    lastName: c.LastName ?? null,
    email: c.EmailAddress || null,
    phones: raw(c.Phones ?? []),
    addresses: raw(c.Addresses ?? []),
    taxNumber: c.TaxNumber || null,
    defaultCurrency: c.DefaultCurrency ?? null,
    isCustomer: c.IsCustomer ?? false,
    isSupplier: c.IsSupplier ?? false,
    status: c.ContactStatus ?? 'ACTIVE',
    updatedDateUtc: updated(c.UpdatedDateUTC),
    raw: raw(c),
  } satisfies Prisma.XeroContactCreateInput;
}

export function normalizeInvoice(i: XeroInvoice) {
  const r = rate(i.CurrencyRate);
  return {
    invoiceId: i.InvoiceID,
    type: i.Type,
    number: i.InvoiceNumber || null,
    reference: i.Reference || null,
    contactId: i.Contact?.ContactID ?? null,
    contactName: i.Contact?.Name ?? null,
    status: i.Status,
    date: parseXeroDateOnly(i.DateString, i.Date),
    dueDate: parseXeroDateOnly(i.DueDateString, i.DueDate),
    // 'XXX' is ISO 4217's "no currency" code. Xero always sends one; this only guards bad payloads.
    currencyCode: i.CurrencyCode ?? 'XXX',
    currencyRate: r,
    subTotal: money(i.SubTotal),
    totalTax: money(i.TotalTax),
    total: money(i.Total),
    amountDue: money(i.AmountDue),
    amountPaid: money(i.AmountPaid),
    amountCredited: money(i.AmountCredited),
    totalBase: toBase(i.Total, r),
    amountDueBase: toBase(i.AmountDue, r),
    lineItems: lineItems(i.LineItems),
    hasAttachments: i.HasAttachments ?? false,
    updatedDateUtc: updated(i.UpdatedDateUTC),
    raw: raw(i),
  } satisfies Prisma.XeroInvoiceCreateInput;
}

export function normalizeCreditNote(n: XeroCreditNote) {
  const r = rate(n.CurrencyRate);
  return {
    creditNoteId: n.CreditNoteID,
    type: n.Type,
    number: n.CreditNoteNumber || null,
    reference: n.Reference || null,
    contactId: n.Contact?.ContactID ?? null,
    contactName: n.Contact?.Name ?? null,
    status: n.Status,
    date: parseXeroDateOnly(n.DateString, n.Date),
    currencyCode: n.CurrencyCode ?? 'XXX',
    currencyRate: r,
    subTotal: money(n.SubTotal),
    totalTax: money(n.TotalTax),
    total: money(n.Total),
    remainingCredit: money(n.RemainingCredit),
    totalBase: toBase(n.Total, r),
    lineItems: lineItems(n.LineItems),
    hasAttachments: n.HasAttachments ?? false,
    updatedDateUtc: updated(n.UpdatedDateUTC),
    raw: raw(n),
  } satisfies Prisma.XeroCreditNoteCreateInput;
}

export function normalizeBankTransaction(t: XeroBankTransaction) {
  const r = rate(t.CurrencyRate);
  return {
    bankTransactionId: t.BankTransactionID,
    type: t.Type,
    contactId: t.Contact?.ContactID ?? null,
    contactName: t.Contact?.Name ?? null,
    bankAccountCode: t.BankAccount?.Code ?? null,
    bankAccountName: t.BankAccount?.Name ?? null,
    reference: t.Reference || null,
    status: t.Status,
    isReconciled: t.IsReconciled ?? false,
    date: parseXeroDateOnly(t.DateString, t.Date),
    currencyCode: t.CurrencyCode ?? 'XXX',
    currencyRate: r,
    subTotal: money(t.SubTotal),
    totalTax: money(t.TotalTax),
    total: money(t.Total),
    totalBase: toBase(t.Total, r),
    lineItems: lineItems(t.LineItems),
    hasAttachments: t.HasAttachments ?? false,
    updatedDateUtc: updated(t.UpdatedDateUTC),
    raw: raw(t),
  } satisfies Prisma.XeroBankTransactionCreateInput;
}

export function normalizePayment(p: XeroPayment) {
  const r = rate(p.CurrencyRate);
  const contact = p.Invoice?.Contact ?? p.CreditNote?.Contact;
  return {
    paymentId: p.PaymentID,
    paymentType: p.PaymentType ?? 'UNKNOWN',
    cashDirection: cashDirection(p.PaymentType),
    status: p.Status,
    invoiceId: p.Invoice?.InvoiceID ?? null,
    invoiceNumber: p.Invoice?.InvoiceNumber ?? null,
    creditNoteId: p.CreditNote?.CreditNoteID ?? null,
    creditNoteNumber: p.CreditNote?.CreditNoteNumber ?? null,
    contactId: contact?.ContactID ?? null,
    contactName: contact?.Name ?? null,
    date: parseXeroDateOnly(undefined, p.Date),
    currencyCode: p.Invoice?.CurrencyCode ?? p.CreditNote?.CurrencyCode ?? null,
    amount: money(p.Amount),
    currencyRate: r,
    amountBase: toBase(p.Amount, r),
    bankAccountCode: p.Account?.Code ?? null,
    bankAccountName: p.Account?.Name ?? null,
    reference: p.Reference || null,
    updatedDateUtc: updated(p.UpdatedDateUTC),
    raw: raw(p),
  } satisfies Prisma.XeroPaymentCreateInput;
}

export function normalizeAttachment(parentType: AttachmentParentType, parentId: string, a: XeroAttachment) {
  return {
    attachmentId: a.AttachmentID,
    parentType,
    parentId,
    fileName: a.FileName,
    mimeType: a.MimeType ?? null,
    contentLength: a.ContentLength ?? null,
  } satisfies Prisma.XeroAttachmentCreateManyInput;
}

export type NormalizedRows = {
  contacts: ReturnType<typeof normalizeContact>;
  invoices: ReturnType<typeof normalizeInvoice>;
  creditNotes: ReturnType<typeof normalizeCreditNote>;
  bankTransactions: ReturnType<typeof normalizeBankTransaction>;
  payments: ReturnType<typeof normalizePayment>;
};
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx jest src/xero/xero-normalize.spec.ts --runInBand`
Expected: PASS (all tests).
- If `totalBase: 726.07` is off by 0.01, check `round2` uses `Number.EPSILON` exactly as written.
- If TypeScript rejects `satisfies`, the model or field names differ from Task 1's schema. Fix the normaliser to match the schema, not the other way round.

- [ ] **Step 8: Commit**

```bash
git add src/xero/xero.constants.ts src/xero/xero.types.ts src/xero/xero-errors.ts src/xero/xero-normalize.ts src/xero/xero-normalize.spec.ts
git commit -m "feat(xero): payload types, constants and pure normalisers"
```

---

### Task 4: Connection storage, identity client, single-flight token service

**Files:**
- Create: `src/xero/xero-connection.repository.ts`
- Create: `src/xero/xero-identity.client.ts`
- Test: `src/xero/xero-identity.client.spec.ts`
- Create: `src/xero/xero-token.service.ts`
- Test: `src/xero/xero-token.service.spec.ts`

**Interfaces:**
- Consumes:
  - `acquireLock`, `LockRedis` (Task 2).
  - `XERO_*` constants, `XeroTokenSet`, `XeroTenantConnection`, `XeroOrganisation`, and the error classes (Task 3).
  - `CryptoService.encrypt/decrypt/isEnabled` (`src/settings/crypto.service.ts`).
  - `QueueService.redis()`.
- Produces:
  ```ts
  // xero-connection.repository.ts
  export const XERO_CONNECTION_ID = 'singleton';
  export interface SaveConnectedInput { tenantId: string; connectionId: string; tenantName: string | null; shortCode: string | null; baseCurrency: string | null; accessTokenEnc: string; refreshTokenEnc: string; accessExpiresAt: Date; connectedByUserId: string; connectedByEmail: string | null }
  class XeroConnectionRepository {
    get(): Promise<XeroConnection | null>;
    saveConnected(input: SaveConnectedInput): Promise<XeroConnection>;
    saveTokens(input: { accessTokenEnc: string; refreshTokenEnc: string; accessExpiresAt: Date; refreshedAt: Date }): Promise<void>;
    markNeedsReconnect(error: string): Promise<void>;
    markDisconnected(): Promise<void>;
  }
  // xero-identity.client.ts
  class XeroIdentityClient {
    isConfigured(): boolean;
    clientId(): string;
    exchangeCode(code: string, redirectUri: string): Promise<XeroTokenSet>;
    refresh(refreshToken: string): Promise<XeroTokenSet>;   // throws XeroInvalidGrantError
    revoke(refreshToken: string): Promise<void>;            // best effort, never throws
    listConnections(accessToken: string): Promise<XeroTenantConnection[]>;
    deleteConnection(accessToken: string, connectionId: string): Promise<void>; // best effort, never throws
    getOrganisation(accessToken: string, tenantId: string): Promise<XeroOrganisation>;
  }
  // xero-token.service.ts
  export interface XeroAccess { accessToken: string; tenantId: string }
  class XeroTokenService { getAccessToken(opts?: { force?: boolean }): Promise<XeroAccess> }
  ```

- [ ] **Step 1: Create the connection repository (no test; exercised through the token service spec)**

`src/xero/xero-connection.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { XeroConnectionStatus, type XeroConnection } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export const XERO_CONNECTION_ID = 'singleton';

export interface SaveConnectedInput {
  tenantId: string;
  connectionId: string;
  tenantName: string | null;
  shortCode: string | null;
  baseCurrency: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpiresAt: Date;
  connectedByUserId: string;
  connectedByEmail: string | null;
}

/**
 * The single Xero connection row. Deliberately NOT cached in memory: web
 * blue/green and the worker all read it, and Xero rotates the refresh token on
 * every use, so any per-process copy goes stale (the webhook-secret split-brain
 * bug class).
 */
@Injectable()
export class XeroConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  get(): Promise<XeroConnection | null> {
    return this.prisma.xeroConnection.findUnique({ where: { id: XERO_CONNECTION_ID } });
  }

  saveConnected(input: SaveConnectedInput): Promise<XeroConnection> {
    const now = new Date();
    const data = { ...input, status: XeroConnectionStatus.CONNECTED, refreshedAt: now, connectedAt: now, lastError: null };
    return this.prisma.xeroConnection.upsert({
      where: { id: XERO_CONNECTION_ID },
      create: { id: XERO_CONNECTION_ID, ...data },
      update: data,
    });
  }

  async saveTokens(input: { accessTokenEnc: string; refreshTokenEnc: string; accessExpiresAt: Date; refreshedAt: Date }) {
    await this.prisma.xeroConnection.update({ where: { id: XERO_CONNECTION_ID }, data: { ...input, lastError: null } });
  }

  async markNeedsReconnect(error: string) {
    await this.prisma.xeroConnection.updateMany({
      where: { id: XERO_CONNECTION_ID },
      data: { status: XeroConnectionStatus.NEEDS_RECONNECT, lastError: error },
    });
  }

  /** Clears the tokens only. Synced data and the tenant identity are kept for the next reconnect. */
  async markDisconnected() {
    await this.prisma.xeroConnection.updateMany({
      where: { id: XERO_CONNECTION_ID },
      data: {
        status: XeroConnectionStatus.DISCONNECTED,
        accessTokenEnc: null,
        refreshTokenEnc: null,
        accessExpiresAt: null,
        lastError: null,
      },
    });
  }
}
```

- [ ] **Step 2: Write the failing identity-client test**

`src/xero/xero-identity.client.spec.ts`:

```ts
import { of, throwError } from 'rxjs';
import { XeroIdentityClient } from './xero-identity.client';
import { XeroInvalidGrantError } from './xero-errors';

const config = { get: (k: string) => ({ XERO_CLIENT_ID: 'cid', XERO_CLIENT_SECRET: 'csecret' } as Record<string, string>)[k] };

function make(http: Record<string, jest.Mock>) {
  return new XeroIdentityClient(http as never, config as never);
}

describe('XeroIdentityClient', () => {
  it('posts a form-encoded refresh grant with Basic auth', async () => {
    const post = jest.fn().mockReturnValue(of({ data: { access_token: 'a', refresh_token: 'r', expires_in: 1800 } }));
    const tokens = await make({ post }).refresh('old-refresh');
    expect(tokens.access_token).toBe('a');
    const [url, body, opts] = post.mock.calls[0];
    expect(url).toBe('https://identity.xero.com/connect/token');
    expect(body).toBe('grant_type=refresh_token&refresh_token=old-refresh');
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('maps a 400 invalid_grant to XeroInvalidGrantError', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => ({ response: { status: 400, data: { error: 'invalid_grant' } } })));
    await expect(make({ post }).refresh('bad')).rejects.toBeInstanceOf(XeroInvalidGrantError);
  });

  it('other token failures throw a generic error that carries no secret', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => ({ response: { status: 500, data: { error: 'server_error' } } })));
    const err = await make({ post }).exchangeCode('c', 'http://x/cb').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain('csecret');
  });

  it('revoke and deleteConnection never throw', async () => {
    const post = jest.fn().mockReturnValue(throwError(() => new Error('down')));
    const del = jest.fn().mockReturnValue(throwError(() => new Error('down')));
    const client = make({ post, delete: del });
    await expect(client.revoke('r')).resolves.toBeUndefined();
    await expect(client.deleteConnection('a', 'conn')).resolves.toBeUndefined();
  });

  it('isConfigured reflects both env vars', () => {
    expect(make({}).isConfigured()).toBe(true);
    const off = new XeroIdentityClient({} as never, { get: () => '' } as never);
    expect(off.isConfigured()).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx jest src/xero/xero-identity.client.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero-identity.client'".

- [ ] **Step 4: Implement the identity client**

`src/xero/xero-identity.client.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { XERO_API_BASE, XERO_CONNECTIONS_URL, XERO_REVOKE_URL, XERO_TOKEN_URL } from './xero.constants';
import { XeroInvalidGrantError } from './xero-errors';
import type { XeroOrganisation, XeroTenantConnection, XeroTokenSet } from './xero.types';

const TIMEOUT_MS = 30_000;

/**
 * identity.xero.com (code exchange, refresh, revoke) plus the two non-accounting
 * endpoints the connect flow needs: /connections and /Organisation.
 * Never log request bodies or headers here: they carry the client secret and tokens.
 */
@Injectable()
export class XeroIdentityClient {
  private readonly logger = new Logger(XeroIdentityClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  clientId(): string {
    return this.config.get<string>('XERO_CLIENT_ID') ?? '';
  }

  isConfigured(): boolean {
    return !!this.clientId() && !!this.config.get<string>('XERO_CLIENT_SECRET');
  }

  exchangeCode(code: string, redirectUri: string): Promise<XeroTokenSet> {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  refresh(refreshToken: string): Promise<XeroTokenSet> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(refreshToken: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(XERO_REVOKE_URL, new URLSearchParams({ token: refreshToken }).toString(), {
          headers: this.formHeaders(),
          timeout: TIMEOUT_MS,
        }),
      );
    } catch (e: any) {
      this.logger.warn(`Xero token revoke failed (continuing): ${e?.response?.status ?? e?.message}`);
    }
  }

  async listConnections(accessToken: string): Promise<XeroTenantConnection[]> {
    const res = await firstValueFrom(
      this.http.get<XeroTenantConnection[]>(XERO_CONNECTIONS_URL, { headers: this.bearer(accessToken), timeout: TIMEOUT_MS }),
    );
    return res.data ?? [];
  }

  async deleteConnection(accessToken: string, connectionId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(`${XERO_CONNECTIONS_URL}/${encodeURIComponent(connectionId)}`, {
          headers: this.bearer(accessToken),
          timeout: TIMEOUT_MS,
        }),
      );
    } catch (e: any) {
      this.logger.warn(`Xero connection delete failed (continuing): ${e?.response?.status ?? e?.message}`);
    }
  }

  async getOrganisation(accessToken: string, tenantId: string): Promise<XeroOrganisation> {
    const res = await firstValueFrom(
      this.http.get<{ Organisations: XeroOrganisation[] }>(`${XERO_API_BASE}/Organisation`, {
        headers: { ...this.bearer(accessToken), 'xero-tenant-id': tenantId },
        timeout: TIMEOUT_MS,
      }),
    );
    const org = res.data?.Organisations?.[0];
    if (!org) throw new Error('Xero returned no organisation');
    return org;
  }

  private async tokenRequest(form: Record<string, string>): Promise<XeroTokenSet> {
    try {
      const res = await firstValueFrom(
        this.http.post<XeroTokenSet>(XERO_TOKEN_URL, new URLSearchParams(form).toString(), {
          headers: this.formHeaders(),
          timeout: TIMEOUT_MS,
        }),
      );
      return res.data;
    } catch (e: any) {
      const status = e?.response?.status;
      const code = e?.response?.data?.error;
      if (status === 400 && code === 'invalid_grant') throw new XeroInvalidGrantError();
      // Log only the status and Xero's error code, never the request.
      this.logger.error(`Xero token request (${form.grant_type}) failed: ${status ?? 'network'} ${code ?? e?.message ?? ''}`);
      throw new Error(`Xero token request failed (${status ?? 'network'}${code ? ` ${code}` : ''})`);
    }
  }

  private formHeaders() {
    const basic = Buffer.from(`${this.clientId()}:${this.config.get<string>('XERO_CLIENT_SECRET') ?? ''}`).toString('base64');
    return { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  }

  private bearer(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  }
}
```

- [ ] **Step 5: Run the identity test and confirm it passes**

Run: `npx jest src/xero/xero-identity.client.spec.ts --runInBand`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing token-service test**

`src/xero/xero-token.service.spec.ts`:

```ts
import { XeroTokenService } from './xero-token.service';
import { XeroInvalidGrantError, XeroReconnectRequiredError } from './xero-errors';

class FakeLockRedis {
  store = new Map<string, string>();
  async set(k: string, v: string) {
    if (this.store.has(k)) return null;
    this.store.set(k, v);
    return 'OK';
  }
  async eval(_s: string, _n: number, k: string, v: string) {
    if (this.store.get(k) === v) {
      this.store.delete(k);
      return 1;
    }
    return 0;
  }
}

const crypto = { encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1') };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'singleton', status: 'CONNECTED', tenantId: 'tenant-1',
    accessTokenEnc: 'enc(old-access)', refreshTokenEnc: 'enc(old-refresh)',
    accessExpiresAt: new Date(Date.now() + 20 * 60_000), refreshedAt: new Date(Date.now() - 10 * 60_000),
    ...over,
  };
}

function setup(rowOver: Record<string, unknown> = {}, refreshImpl?: () => Promise<unknown>) {
  const row: Record<string, any> = makeRow(rowOver);
  const repo = {
    get: jest.fn(async () => ({ ...row })),
    saveTokens: jest.fn(async (d: Record<string, unknown>) => { Object.assign(row, d); }),
    markNeedsReconnect: jest.fn(async (e: string) => { row.status = 'NEEDS_RECONNECT'; row.lastError = e; }),
  };
  const identity = {
    refresh: jest.fn(refreshImpl ?? (async () => { await sleep(30); return { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 1800 }; })),
  };
  const redis = new FakeLockRedis();
  const queues = { redis: async () => redis };
  const svc = new XeroTokenService(repo as never, identity as never, crypto as never, queues as never);
  svc.pollMs = 5;
  svc.waitTimeoutMs = 1_000;
  return { svc, repo, identity, redis, row };
}

describe('XeroTokenService.getAccessToken', () => {
  it('returns the stored token while it is fresh (no refresh)', async () => {
    const { svc, identity } = setup();
    await expect(svc.getAccessToken()).resolves.toEqual({ accessToken: 'old-access', tenantId: 'tenant-1' });
    expect(identity.refresh).not.toHaveBeenCalled();
  });

  it('refreshes a stale token and persists the rotated refresh token encrypted', async () => {
    const { svc, identity, row } = setup({ accessExpiresAt: new Date(Date.now() + 30_000) });
    await expect(svc.getAccessToken()).resolves.toEqual({ accessToken: 'new-access', tenantId: 'tenant-1' });
    expect(identity.refresh).toHaveBeenCalledWith('old-refresh');
    expect(row.refreshTokenEnc).toBe('enc(new-refresh)');
    expect(row.accessTokenEnc).toBe('enc(new-access)');
  });

  it('two concurrent callers cause exactly ONE refresh and both get the new token', async () => {
    const { svc, identity, redis } = setup({ accessExpiresAt: new Date(Date.now() - 1_000) });
    const [a, b] = await Promise.all([svc.getAccessToken(), svc.getAccessToken()]);
    expect(identity.refresh).toHaveBeenCalledTimes(1);
    expect(a.accessToken).toBe('new-access');
    expect(b.accessToken).toBe('new-access');
    expect(redis.store.size).toBe(0); // lock released
  });

  it('re-reads after taking the lock and skips a refresh another process just did', async () => {
    const { svc, repo, identity } = setup();
    const stale = makeRow({ accessExpiresAt: new Date(Date.now() - 1_000) });
    const fresh = makeRow({ accessTokenEnc: 'enc(other-process)', refreshedAt: new Date() });
    repo.get.mockResolvedValueOnce(stale as never).mockResolvedValue(fresh as never);
    await expect(svc.getAccessToken()).resolves.toEqual({ accessToken: 'other-process', tenantId: 'tenant-1' });
    expect(identity.refresh).not.toHaveBeenCalled();
  });

  it('invalid_grant marks NEEDS_RECONNECT, throws a no-retry error, and releases the lock', async () => {
    const { svc, repo, redis } = setup({ accessExpiresAt: new Date(Date.now() - 1_000) }, async () => {
      throw new XeroInvalidGrantError();
    });
    await expect(svc.getAccessToken()).rejects.toBeInstanceOf(XeroReconnectRequiredError);
    expect(repo.markNeedsReconnect).toHaveBeenCalled();
    expect(redis.store.size).toBe(0);
  });

  it('throws XeroReconnectRequiredError when not connected', async () => {
    const { svc } = setup({ status: 'DISCONNECTED', accessTokenEnc: null, refreshTokenEnc: null });
    await expect(svc.getAccessToken()).rejects.toBeInstanceOf(XeroReconnectRequiredError);
  });

  it('force refreshes even a fresh token (keep-alive)', async () => {
    const { svc, identity } = setup();
    await svc.getAccessToken({ force: true });
    expect(identity.refresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx jest src/xero/xero-token.service.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero-token.service'".

- [ ] **Step 8: Implement the token service**

`src/xero/xero-token.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { XeroConnection } from '@prisma/client';
import { CryptoService } from '../settings/crypto.service';
import { QueueService } from '../queues/queue.service';
import { acquireLock, type LockRedis } from '../common/redis-lock';
import { XeroConnectionRepository } from './xero-connection.repository';
import { XeroIdentityClient } from './xero-identity.client';
import { XeroInvalidGrantError, XeroReconnectRequiredError } from './xero-errors';
import {
  TOKEN_FRESH_MARGIN_MS, TOKEN_LOCK_TTL_MS, TOKEN_WAIT_POLL_MS, TOKEN_WAIT_TIMEOUT_MS, XERO_REDIS,
} from './xero.constants';

export interface XeroAccess {
  accessToken: string;
  tenantId: string;
}

type UsableConnection = XeroConnection & { accessTokenEnc: string; refreshTokenEnc: string; tenantId: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Hands out a valid Xero access token. Xero ROTATES the refresh token on every
 * refresh and invalidates the old one, so two processes refreshing at once leave
 * the loser holding a dead token until an Owner reconnects. Therefore:
 *   1. read the row; if the token is fresh, use it (the common path, no lock)
 *   2. otherwise take the Redis lock and RE-READ: another process may have just refreshed
 *   3. refresh once, persist both tokens, release
 *   4. a caller that loses the lock race polls the row instead of refreshing
 */
@Injectable()
export class XeroTokenService {
  private readonly logger = new Logger(XeroTokenService.name);
  /** Overridable in tests. */
  pollMs = TOKEN_WAIT_POLL_MS;
  waitTimeoutMs = TOKEN_WAIT_TIMEOUT_MS;

  constructor(
    private readonly repo: XeroConnectionRepository,
    private readonly identity: XeroIdentityClient,
    private readonly crypto: CryptoService,
    private readonly queues: QueueService,
  ) {}

  async getAccessToken(opts: { force?: boolean } = {}): Promise<XeroAccess> {
    const seen = this.usable(await this.repo.get());
    if (!opts.force && this.isFresh(seen)) return this.toAccess(seen);

    const redis = (await this.queues.redis()) as unknown as LockRedis;
    const lock = await acquireLock(redis, XERO_REDIS.tokenLock, TOKEN_LOCK_TTL_MS);
    if (!lock) return this.waitForRefresh(seen.refreshedAt);

    try {
      const current = this.usable(await this.repo.get());
      const someoneRefreshed = (current.refreshedAt?.getTime() ?? 0) > (seen.refreshedAt?.getTime() ?? 0);
      if (this.isFresh(current) && (!opts.force || someoneRefreshed)) return this.toAccess(current);
      return await this.refresh(current);
    } finally {
      await lock.release();
    }
  }

  private async refresh(row: UsableConnection): Promise<XeroAccess> {
    let tokens;
    try {
      tokens = await this.identity.refresh(this.crypto.decrypt(row.refreshTokenEnc));
    } catch (e) {
      if (e instanceof XeroInvalidGrantError) {
        await this.repo.markNeedsReconnect('Xero rejected the saved sign-in (invalid_grant). An Owner must reconnect Xero.');
        throw new XeroReconnectRequiredError();
      }
      throw e;
    }
    const now = Date.now();
    await this.repo.saveTokens({
      accessTokenEnc: this.crypto.encrypt(tokens.access_token),
      refreshTokenEnc: this.crypto.encrypt(tokens.refresh_token),
      accessExpiresAt: new Date(now + tokens.expires_in * 1000),
      refreshedAt: new Date(now),
    });
    this.logger.log('Xero access token refreshed');
    return { accessToken: tokens.access_token, tenantId: row.tenantId };
  }

  private async waitForRefresh(before: Date | null): Promise<XeroAccess> {
    const deadline = Date.now() + this.waitTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(this.pollMs);
      const row = this.usable(await this.repo.get()); // throws if the holder hit invalid_grant
      if (this.isFresh(row) && (row.refreshedAt?.getTime() ?? 0) > (before?.getTime() ?? 0)) return this.toAccess(row);
    }
    throw new Error('Timed out waiting for another process to refresh the Xero token');
  }

  private usable(row: XeroConnection | null): UsableConnection {
    if (!row || row.status !== 'CONNECTED' || !row.accessTokenEnc || !row.refreshTokenEnc || !row.tenantId) {
      throw new XeroReconnectRequiredError(
        row?.status === 'NEEDS_RECONNECT' ? 'Xero needs to be reconnected' : 'Xero is not connected',
      );
    }
    return row as UsableConnection;
  }

  private isFresh(row: XeroConnection): boolean {
    return !!row.accessExpiresAt && row.accessExpiresAt.getTime() - TOKEN_FRESH_MARGIN_MS > Date.now();
  }

  private toAccess(row: UsableConnection): XeroAccess {
    return { accessToken: this.crypto.decrypt(row.accessTokenEnc), tenantId: row.tenantId };
  }
}
```

- [ ] **Step 9: Run both specs and confirm they pass**

Run: `npx jest src/xero/xero-token.service.spec.ts src/xero/xero-identity.client.spec.ts --runInBand`
Expected: PASS (12 tests).
- If the concurrency test sees 2 refreshes, the second caller isn't hitting the lock. Check that `acquireLock` returned `null` and that `waitForRefresh` is taken.

- [ ] **Step 10: Commit**

```bash
git add src/xero/xero-connection.repository.ts src/xero/xero-identity.client.ts src/xero/xero-identity.client.spec.ts src/xero/xero-token.service.ts src/xero/xero-token.service.spec.ts
git commit -m "feat(xero): encrypted connection row and single-flight token refresh"
```

---

### Task 5: Read-only Xero data client

**Files:**
- Modify: `src/xero/xero-errors.ts` (append `XeroApiError`)
- Create: `src/xero/xero.client.ts`
- Test: `src/xero/xero.client.spec.ts`

**Interfaces:**
- Consumes:
  - `XeroTokenService.getAccessToken(opts?)` (Task 4).
  - Constants `XERO_API_BASE`, `PAGE_SIZE`, `MAX_PAGES`, `MAX_429_RETRIES`, `MAX_BACKOFF_MS`, `MIN_CALL_INTERVAL_MS`, `DAY_BUDGET_FLOOR`, `XERO_REDIS` (Task 3).
  - `QueueService.redis()`.
- Produces:
  ```ts
  export class XeroApiError extends Error { status: number | null; path: string }
  export interface XeroGetOptions { params?: Record<string, string>; modifiedSince?: Date | null }
  export function formatModifiedSince(d: Date): string;        // '2026-09-15T10:00:00'
  export function retryAfterMs(headers: Record<string, unknown> | undefined, attempt: number): number;
  class XeroClient {
    minIntervalMs: number;                    // test override
    sleep: (ms: number) => Promise<void>;     // test override
    beginRun(): void;                         // forget the last day-budget reading
    get<T>(path: string, opts?: XeroGetOptions): Promise<T>;
    pages<T>(path: string, key: string, opts?: XeroGetOptions): AsyncGenerator<T[]>;
  }
  ```

- [ ] **Step 1: Append the sanitised API error**

Append to `src/xero/xero-errors.ts`:

```ts
/**
 * A failed Xero data call, with the axios error stripped. Axios errors carry
 * `config.headers.Authorization`. Anything thrown out of a processor ends up in
 * job logs and dead-letter rows, so only status, path and message survive here.
 */
export class XeroApiError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly path: string,
    detail: string,
  ) {
    super(`Xero GET ${path} failed: ${status ?? 'network'} ${detail}`.trim());
    this.name = 'XeroApiError';
  }
}
```

- [ ] **Step 2: Write the failing client test**

`src/xero/xero.client.spec.ts`:

```ts
import { of, throwError } from 'rxjs';
import { formatModifiedSince, XeroClient } from './xero.client';
import { XeroApiError, XeroRateBudgetExhaustedError } from './xero-errors';

function setup(responses: Array<unknown>) {
  const request = jest.fn();
  for (const r of responses) {
    if (r instanceof Error || (r as { response?: unknown })?.response) request.mockReturnValueOnce(throwError(() => r));
    else request.mockReturnValueOnce(of(r));
  }
  const tokens = { getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'tok', tenantId: 'tenant-1' }) };
  const redisSet = jest.fn().mockResolvedValue('OK');
  const queues = { redis: async () => ({ set: redisSet }) };
  const client = new XeroClient({ request } as never, tokens as never, queues as never);
  client.minIntervalMs = 0;
  client.sleep = jest.fn().mockResolvedValue(undefined);
  return { client, request, tokens, redisSet };
}

const ok = (data: unknown, headers: Record<string, string> = {}) => ({ data, headers });
const page = (n: number) => ({ Invoices: Array.from({ length: n }, (_, i) => ({ InvoiceID: `i${i}` })) });

describe('formatModifiedSince', () => {
  it('is ISO-8601 UTC without zone or millis', () => {
    expect(formatModifiedSince(new Date('2026-09-15T10:00:00.123Z'))).toBe('2026-09-15T10:00:00');
  });
});

describe('XeroClient.get', () => {
  it('sends an authenticated GET with the tenant header', async () => {
    const { client, request } = setup([ok({ Contacts: [] })]);
    await client.get('/Contacts', { params: { includeArchived: 'true' } });
    const cfg = request.mock.calls[0][0];
    expect(cfg).toMatchObject({ method: 'GET', url: 'https://api.xero.com/api.xro/2.0/Contacts', params: { includeArchived: 'true' } });
    expect(cfg.headers).toMatchObject({ Authorization: 'Bearer tok', 'xero-tenant-id': 'tenant-1' });
    expect(cfg.headers['If-Modified-Since']).toBeUndefined();
  });

  it('adds If-Modified-Since when given a watermark', async () => {
    const { client, request } = setup([ok({})]);
    await client.get('/Invoices', { modifiedSince: new Date('2026-09-01T00:00:00Z') });
    expect(request.mock.calls[0][0].headers['If-Modified-Since']).toBe('2026-09-01T00:00:00');
  });

  it('honours Retry-After on 429, then succeeds', async () => {
    const { client, request } = setup([{ response: { status: 429, headers: { 'retry-after': '2' } } }, ok({ Contacts: [] })]);
    await client.get('/Contacts');
    expect(client.sleep).toHaveBeenCalledWith(2000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('on a 401 forces one token refresh and retries once', async () => {
    const { client, request, tokens } = setup([{ response: { status: 401, headers: {} } }, ok({})]);
    await client.get('/Contacts');
    expect(tokens.getAccessToken).toHaveBeenCalledWith({ force: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('throws a sanitised XeroApiError that never contains the bearer token', async () => {
    const axiosLike = { message: 'Request failed', response: { status: 500, headers: {} }, config: { headers: { Authorization: 'Bearer tok' } } };
    const { client } = setup([axiosLike]);
    const err = await client.get('/Contacts').catch((e: Error) => e);
    expect(err).toBeInstanceOf(XeroApiError);
    expect(JSON.stringify(err)).not.toContain('Bearer');
    expect((err as Error).message).not.toContain('Bearer');
  });

  it('stops before calling when the day budget is below the floor', async () => {
    const { client, request, redisSet } = setup([ok({}, { 'x-daylimit-remaining': '499' })]);
    await client.get('/Contacts');
    expect(redisSet).toHaveBeenCalledWith('xero:day-remaining', '499', 'EX', 86400);
    await expect(client.get('/Contacts')).rejects.toBeInstanceOf(XeroRateBudgetExhaustedError);
    expect(request).toHaveBeenCalledTimes(1);
    client.beginRun(); // a new run re-measures
    request.mockReturnValueOnce(of(ok({})));
    await expect(client.get('/Contacts')).resolves.toEqual({});
  });

  it('paces calls: the second call waits', async () => {
    const { client } = setup([ok({}), ok({})]);
    client.minIntervalMs = 1100;
    await client.get('/A');
    await client.get('/B');
    const waits = (client.sleep as jest.Mock).mock.calls.map((c) => c[0]);
    expect(waits.some((ms: number) => ms > 1000)).toBe(true);
  });
});

describe('XeroClient.pages', () => {
  it('starts at page=1 and stops after a short page', async () => {
    const { client, request } = setup([ok(page(100)), ok(page(37))]);
    const seen: number[] = [];
    for await (const items of client.pages('/Invoices', 'Invoices')) seen.push(items.length);
    expect(seen).toEqual([100, 37]);
    expect(request.mock.calls.map((c) => c[0].params.page)).toEqual(['1', '2']);
  });

  it('yields nothing for an empty first page', async () => {
    const { client, request } = setup([ok({ Invoices: [] })]);
    const seen: unknown[] = [];
    for await (const items of client.pages('/Invoices', 'Invoices')) seen.push(items);
    expect(seen).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('read-only guardrail', () => {
  it('only ever issues GET and exposes no write helpers', async () => {
    const proto = Object.getOwnPropertyNames(XeroClient.prototype);
    for (const name of ['post', 'put', 'patch', 'delete', 'create', 'update']) expect(proto).not.toContain(name);
    const { client, request } = setup([ok({}), ok({ Contacts: [] })]);
    await client.get('/X');
    for await (const _ of client.pages('/Contacts', 'Contacts')) void _;
    for (const call of request.mock.calls) expect(call[0].method).toBe('GET');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx jest src/xero/xero.client.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero.client'".

- [ ] **Step 4: Implement the client**

`src/xero/xero.client.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { QueueService } from '../queues/queue.service';
import { XeroTokenService } from './xero-token.service';
import { XeroApiError, XeroRateBudgetExhaustedError } from './xero-errors';
import {
  DAY_BUDGET_FLOOR, MAX_429_RETRIES, MAX_BACKOFF_MS, MAX_PAGES, MIN_CALL_INTERVAL_MS, PAGE_SIZE, XERO_API_BASE, XERO_REDIS,
} from './xero.constants';

export interface XeroGetOptions {
  params?: Record<string, string>;
  modifiedSince?: Date | null;
}

/** Xero documents If-Modified-Since as a zone-less UTC ISO timestamp. */
export function formatModifiedSince(d: Date): string {
  return d.toISOString().slice(0, 19);
}

export function retryAfterMs(headers: Record<string, unknown> | undefined, attempt: number): number {
  const secs = Number(headers?.['retry-after'] ?? headers?.['Retry-After']);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

/**
 * Read-only Xero Accounting API client. It exposes GET only; the read-only
 * guarantee is enforced by a guardrail test. Only the worker makes data calls
 * (the xero-sync processor runs at concurrency 1), so in-process pacing is
 * enough to stay under Xero's 60/min. 5,000/day is watched through
 * X-DayLimit-Remaining.
 */
@Injectable()
export class XeroClient {
  private readonly logger = new Logger(XeroClient.name);
  private nextCallAt = 0;
  private dayRemaining: number | null = null;
  /** Overridable in tests. */
  minIntervalMs = MIN_CALL_INTERVAL_MS;
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  constructor(
    private readonly http: HttpService,
    private readonly tokens: XeroTokenService,
    private readonly queues: QueueService,
  ) {}

  /** Call at the start of each sync run so a reading from an earlier run can't block it. */
  beginRun(): void {
    this.dayRemaining = null;
  }

  get<T>(path: string, opts: XeroGetOptions = {}): Promise<T> {
    return this.request<T>(path, opts, 0, false);
  }

  /** Xero paging is 1-based (ClickUp's is 0-based). Stops after the first short page. */
  async *pages<T>(path: string, key: string, opts: XeroGetOptions = {}): AsyncGenerator<T[]> {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.get<Record<string, T[] | undefined>>(path, { ...opts, params: { ...opts.params, page: String(page) } });
      const items = body?.[key] ?? [];
      if (items.length) yield items;
      if (items.length < PAGE_SIZE) return;
    }
    this.logger.warn(`Xero ${path} reached MAX_PAGES (${MAX_PAGES}); stopping this pass`);
  }

  private async request<T>(path: string, opts: XeroGetOptions, attempt: number, retriedAuth: boolean): Promise<T> {
    if (this.dayRemaining !== null && this.dayRemaining < DAY_BUDGET_FLOOR) {
      throw new XeroRateBudgetExhaustedError(this.dayRemaining);
    }
    await this.pace();
    const { accessToken, tenantId } = await this.tokens.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      Accept: 'application/json',
    };
    if (opts.modifiedSince) headers['If-Modified-Since'] = formatModifiedSince(opts.modifiedSince);

    try {
      const res = await firstValueFrom(
        this.http.request<T>({ method: 'GET', url: `${XERO_API_BASE}${path}`, params: opts.params, headers, timeout: 30_000 }),
      );
      await this.recordLimits(res.headers as Record<string, unknown>);
      return res.data;
    } catch (e: any) {
      const status: number | null = e?.response?.status ?? null;
      if (e?.response?.headers) await this.recordLimits(e.response.headers);
      if (status === 304) return {} as T;
      if (status === 429 && attempt < MAX_429_RETRIES) {
        const wait = retryAfterMs(e.response.headers, attempt);
        this.logger.warn(`Xero GET ${path} rate-limited; retrying in ${wait}ms (${attempt + 1}/${MAX_429_RETRIES})`);
        await this.sleep(wait);
        return this.request<T>(path, opts, attempt + 1, retriedAuth);
      }
      if (status === 401 && !retriedAuth) {
        await this.tokens.getAccessToken({ force: true });
        return this.request<T>(path, opts, attempt, true);
      }
      const detail = typeof e?.response?.data?.Message === 'string' ? e.response.data.Message : (e?.message ?? '');
      this.logger.error(`Xero GET ${path} failed: ${status ?? 'network'} ${detail}`);
      throw new XeroApiError(status, path, String(detail));
    }
  }

  private async pace(): Promise<void> {
    const now = Date.now();
    const wait = this.nextCallAt - now;
    this.nextCallAt = Math.max(now, this.nextCallAt) + this.minIntervalMs;
    if (wait > 0) await this.sleep(wait);
  }

  private async recordLimits(headers: Record<string, unknown> | undefined): Promise<void> {
    const raw = headers?.['x-daylimit-remaining'];
    if (raw === undefined) return;
    const remaining = Number(raw);
    if (!Number.isFinite(remaining)) return;
    this.dayRemaining = remaining;
    try {
      // Shared with the web role, so Settings can show "API calls today".
      const redis = (await this.queues.redis()) as unknown as { set: (...a: unknown[]) => Promise<unknown> };
      await redis.set(XERO_REDIS.dayRemaining, String(remaining), 'EX', 86_400);
    } catch {
      /* best effort: telemetry only */
    }
  }
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npx jest src/xero/xero.client.spec.ts --runInBand`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/xero/xero-errors.ts src/xero/xero.client.ts src/xero/xero.client.spec.ts
git commit -m "feat(xero): paced, paged, read-only Xero data client"
```

---

### Task 6: Connect, callback, disconnect, status and sync-now API, plus module wiring

**Files:**
- Modify: `src/queues/queue.constants.ts` (queue + 3 job names)
- Modify: `src/queues/queue.service.ts` (inject the queue and add it to `get()`)
- Modify: `src/xero/xero-connection.repository.ts` (add `listSyncStates()`)
- Create: `src/xero/xero-auth.service.ts`
- Test: `src/xero/xero-auth.service.spec.ts`
- Create: `src/xero/xero-auth.controller.ts`
- Create: `src/xero/xero.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes:
  - `XeroIdentityClient`, `XeroConnectionRepository`, `XeroTokenService` (Task 4).
  - Constants (Task 3).
  - `AuditLogRepository.create(AuditLogCreateInput)` (`src/admin/audit-log.repository.ts`).
  - `AuthPrincipal` (`src/auth/auth.types.ts`), and `Roles`, `Public`, `CurrentUser` (`src/auth/decorators.ts`).
- Produces:
  ```ts
  QUEUES.XERO_SYNC = 'xero-sync'
  JOBS.XERO_SYNC = 'xero-sync-run'; JOBS.XERO_RECONCILE_OPEN = 'xero-reconcile-open'; JOBS.XERO_TOKEN_KEEPALIVE = 'xero-token-keepalive'
  export type XeroSyncJobData = { entity: 'all'; full?: boolean }   // `entity` feeds DeadLetterService.entityId (Task 8)
  class XeroAuthService {
    redirectUri(): string;
    startConnect(user: AuthPrincipal): Promise<{ url: string }>;
    handleCallback(q: { code?: string; state?: string; error?: string }): Promise<string>;  // absolute redirect URL
    disconnect(): Promise<{ disconnected: true }>;
    status(): Promise<XeroStatusDto>;
    requestSync(): Promise<{ queued: true }>;
    isSyncBusy(): Promise<boolean>;
  }
  export interface XeroStatusDto { configured: boolean; encryptionEnabled: boolean; redirectUri: string; scopes: string[];
    status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'DISCONNECTED'; tenantName: string | null; tenantId: string | null;
    baseCurrency: string | null; connectedAt: string | null; connectedByEmail: string | null; refreshedAt: string | null;
    lastError: string | null; dayCallsRemaining: number | null; syncing: boolean;
    entities: { entity: string; status: string; recordsUpserted: number; lastRunAt: string | null; lastSuccessAt: string | null; watermark: string | null; lastError: string | null }[] }
  ```
  - Routes, all under the `/api` global prefix:
    - `POST /xero/connect` (OWNER)
    - `GET /xero/callback` (public)
    - `DELETE /xero/connection` (OWNER)
    - `GET /xero/status` (OWNER, ADMIN)
    - `POST /xero/sync` (OWNER, ADMIN)

- [ ] **Step 1: Register the queue and job names**

In `src/queues/queue.constants.ts`, add inside `QUEUES` after `CLICKUP_ASSIGNEE_REPLACEMENT`:

```ts
  /** All Xero work: sync runs, nightly reconcile, token keep-alive. Worker concurrency 1. */
  XERO_SYNC: 'xero-sync',
```

Add inside `JOBS` after `SYNC_LIST_CATALOG`:

```ts
  XERO_SYNC: 'xero-sync-run',
  XERO_RECONCILE_OPEN: 'xero-reconcile-open',
  XERO_TOKEN_KEEPALIVE: 'xero-token-keepalive',
```

In `src/queues/queue.service.ts`, add a constructor parameter after `assigneeReplacement`:

```ts
    @InjectQueue(QUEUES.XERO_SYNC) private readonly xeroSync: Queue,
```

and add to the `map` in `get()`:

```ts
      [QUEUES.XERO_SYNC]: this.xeroSync,
```

(`QueuesModule` registers every value in `QUEUES`, so nothing else is needed.)

No existing test builds `QueueService` with `new` (checked 2026-09-15: `grep -rn "new QueueService(" src` finds nothing), so the extra constructor argument needs no test changes. If that grep finds a hit by the time you run this, insert one extra `{} as never` argument before the settings argument.

- [ ] **Step 2: Add `listSyncStates()` to the connection repository**

Append this method to `XeroConnectionRepository`:

```ts
  listSyncStates() {
    return this.prisma.xeroSyncState.findMany({ orderBy: { entity: 'asc' } });
  }
```

- [ ] **Step 3: Write the failing auth-service test**

`src/xero/xero-auth.service.spec.ts`:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { XeroAuthService } from './xero-auth.service';

class FakeRedis {
  store = new Map<string, string>();
  ttl = new Map<string, number>();
  async set(k: string, v: string, _ex: 'EX', seconds: number) {
    this.store.set(k, v);
    this.ttl.set(k, seconds);
    return 'OK';
  }
  async getdel(k: string) {
    const v = this.store.get(k) ?? null;
    this.store.delete(k);
    return v;
  }
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
}

const owner = { userId: 'u1', orgId: 'o1', role: 'OWNER', email: 'owner@nifty.test', isMachine: false } as never;
const BASE = 'http://localhost:5173/';

function setup(over: { configured?: boolean; encryption?: boolean; connections?: unknown[]; existing?: unknown; busy?: boolean; exchange?: jest.Mock } = {}) {
  const redis = new FakeRedis();
  const queue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue(over.busy ? [{ name: 'xero-sync-run' }] : []) };
  const queues = { redis: async () => redis, get: () => queue, defaultJobOptions: () => ({ attempts: 5 }) };
  const identity = {
    isConfigured: () => over.configured ?? true,
    clientId: () => 'cid',
    exchangeCode: over.exchange ?? jest.fn().mockResolvedValue({ access_token: 'acc', refresh_token: 'ref', expires_in: 1800 }),
    listConnections: jest.fn().mockResolvedValue(over.connections ?? [{ id: 'conn-1', tenantId: 'tenant-1', tenantType: 'ORGANISATION', tenantName: 'Nifty IT Solution Ltd' }]),
    getOrganisation: jest.fn().mockResolvedValue({ Name: 'Nifty IT Solution Ltd', BaseCurrency: 'USD', ShortCode: '!abc12' }),
    revoke: jest.fn(),
    deleteConnection: jest.fn(),
  };
  const repo = {
    get: jest.fn().mockResolvedValue(over.existing ?? null),
    saveConnected: jest.fn(),
    markDisconnected: jest.fn(),
    listSyncStates: jest.fn().mockResolvedValue([]),
  };
  const tokens = { getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'acc', tenantId: 'tenant-1' }) };
  const crypto = { isEnabled: over.encryption ?? true, encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1') };
  const audit = { create: jest.fn() };
  const config = { get: (k: string) => (k === 'APP_BASE_URL' ? BASE : undefined) };
  const svc = new XeroAuthService(identity as never, repo as never, tokens as never, crypto as never, queues as never, audit as never, config as never);
  return { svc, redis, queue, identity, repo, audit, tokens };
}

async function connectAndGetState(svc: XeroAuthService) {
  const { url } = await svc.startConnect(owner);
  return new URL(url).searchParams.get('state')!;
}

describe('XeroAuthService.startConnect', () => {
  it('builds the consent URL with exact scopes and a redirect from APP_BASE_URL', async () => {
    const { svc, redis } = setup();
    const { url } = await svc.startConnect(owner);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://login.xero.com/identity/connect/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/xero/callback');
    expect(u.searchParams.get('scope')).toBe(
      'openid profile email offline_access accounting.contacts.read accounting.invoices.read accounting.payments.read accounting.banktransactions.read accounting.attachments.read accounting.settings.read',
    );
    const state = u.searchParams.get('state')!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(redis.store.get(`xero:oauth-state:${state}`)!)).toEqual({ userId: 'u1', email: 'owner@nifty.test' });
    expect(redis.ttl.get(`xero:oauth-state:${state}`)).toBe(600);
  });

  it('refuses when the server is not configured or encryption is off', async () => {
    await expect(setup({ configured: false }).svc.startConnect(owner)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ encryption: false }).svc.startConnect(owner)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('XeroAuthService.handleCallback', () => {
  it('connects: saves encrypted tokens, audits, queues a full sync, redirects to connected', async () => {
    const { svc, repo, audit, queue } = setup();
    const state = await connectAndGetState(svc);
    const url = await svc.handleCallback({ code: 'the-code', state });
    expect(url).toBe('http://localhost:5173/settings?tab=xero&xero=connected');
    expect(repo.saveConnected).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1', connectionId: 'conn-1', tenantName: 'Nifty IT Solution Ltd', shortCode: '!abc12',
        baseCurrency: 'USD', accessTokenEnc: 'enc(acc)', refreshTokenEnc: 'enc(ref)', connectedByUserId: 'u1',
        connectedByEmail: 'owner@nifty.test',
      }),
    );
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ actor: 'owner@nifty.test', routePattern: 'xero.connected', statusCode: 302 }));
    expect(queue.add).toHaveBeenCalledWith('xero-sync-run', { entity: 'all', full: true }, { attempts: 5 });
  });

  it('rejects an unknown state and a reused state', async () => {
    const { svc } = setup();
    expect(await svc.handleCallback({ code: 'c', state: 'nope' })).toContain('xero=error&reason=state');
    const state = await connectAndGetState(svc);
    await svc.handleCallback({ code: 'c', state });
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=state');
  });

  it('maps access_denied to cancelled and still consumes the state', async () => {
    const { svc, redis } = setup();
    const state = await connectAndGetState(svc);
    expect(await svc.handleCallback({ error: 'access_denied', state })).toContain('reason=cancelled');
    expect(redis.store.size).toBe(0);
  });

  it('refuses more than one organisation and revokes the grant', async () => {
    const conns = [
      { id: 'c1', tenantId: 't1', tenantType: 'ORGANISATION', tenantName: 'A' },
      { id: 'c2', tenantId: 't2', tenantType: 'ORGANISATION', tenantName: 'B' },
    ];
    const { svc, identity, repo } = setup({ connections: conns });
    const state = await connectAndGetState(svc);
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=multiple_tenants');
    expect(identity.revoke).toHaveBeenCalledWith('ref');
    expect(repo.saveConnected).not.toHaveBeenCalled();
  });

  it('refuses a different organisation from the one already synced', async () => {
    const { svc, identity, repo } = setup({ existing: { tenantId: 'other-tenant', status: 'DISCONNECTED' } });
    const state = await connectAndGetState(svc);
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=different_org');
    expect(identity.revoke).toHaveBeenCalled();
    expect(repo.saveConnected).not.toHaveBeenCalled();
  });

  it('maps an exchange failure to reason=exchange without throwing', async () => {
    const { svc } = setup({ exchange: jest.fn().mockRejectedValue(new Error('boom')) });
    const state = await connectAndGetState(svc);
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=exchange');
  });
});

describe('XeroAuthService.requestSync', () => {
  it('queues a run when idle and 409s when one is already busy', async () => {
    const idle = setup({ existing: { status: 'CONNECTED' } });
    await expect(idle.svc.requestSync()).resolves.toEqual({ queued: true });
    expect(idle.queue.add).toHaveBeenCalledWith('xero-sync-run', { entity: 'all' }, { attempts: 5 });
    const busy = setup({ existing: { status: 'CONNECTED' }, busy: true });
    await expect(busy.svc.requestSync()).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx jest src/xero/xero-auth.service.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero-auth.service'".

- [ ] **Step 5: Implement the auth service**

`src/xero/xero-auth.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from '../settings/crypto.service';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { AuditLogRepository } from '../admin/audit-log.repository';
import type { AuthPrincipal } from '../auth/auth.types';
import { XeroConnectionRepository } from './xero-connection.repository';
import { XeroIdentityClient } from './xero-identity.client';
import { XeroTokenService } from './xero-token.service';
import { OAUTH_STATE_TTL_SECONDS, XERO_AUTHORIZE_URL, XERO_REDIS, XERO_SCOPES, XERO_SCOPE_STRING } from './xero.constants';

export type XeroSyncJobData = { entity: 'all'; full?: boolean };

export interface XeroStatusDto {
  configured: boolean;
  encryptionEnabled: boolean;
  redirectUri: string;
  scopes: string[];
  status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'DISCONNECTED';
  tenantName: string | null;
  tenantId: string | null;
  baseCurrency: string | null;
  connectedAt: string | null;
  connectedByEmail: string | null;
  refreshedAt: string | null;
  lastError: string | null;
  dayCallsRemaining: number | null;
  syncing: boolean;
  entities: {
    entity: string; status: string; recordsUpserted: number; lastRunAt: string | null;
    lastSuccessAt: string | null; watermark: string | null; lastError: string | null;
  }[];
}

type StateOwner = { userId: string; email: string | null };
type RedisLike = {
  set(k: string, v: string, ex: 'EX', s: number): Promise<unknown>;
  getdel(k: string): Promise<string | null>;
  get(k: string): Promise<string | null>;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

@Injectable()
export class XeroAuthService {
  private readonly logger = new Logger(XeroAuthService.name);

  constructor(
    private readonly identity: XeroIdentityClient,
    private readonly repo: XeroConnectionRepository,
    private readonly tokens: XeroTokenService,
    private readonly crypto: CryptoService,
    private readonly queues: QueueService,
    private readonly audit: AuditLogRepository,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return (this.config.get<string>('APP_BASE_URL') ?? '').replace(/\/+$/, '');
  }

  /** Must match a redirect URI registered on the Xero app, character for character. */
  redirectUri(): string {
    return `${this.base()}/api/xero/callback`;
  }

  private settingsUrl(result: 'connected' | 'error', reason?: string): string {
    return `${this.base()}/settings?tab=xero&xero=${result}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
  }

  private async redis(): Promise<RedisLike> {
    return (await this.queues.redis()) as unknown as RedisLike;
  }

  async startConnect(user: AuthPrincipal): Promise<{ url: string }> {
    if (!this.identity.isConfigured()) {
      throw new BadRequestException('Xero is not configured on this server. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET.');
    }
    if (!this.crypto.isEnabled) {
      throw new BadRequestException('APP_ENCRYPTION_KEY must be set before connecting Xero, because the Xero sign-in is stored encrypted.');
    }
    const state = randomBytes(32).toString('hex');
    const owner: StateOwner = { userId: user.userId, email: user.email };
    await (await this.redis()).set(XERO_REDIS.oauthState(state), JSON.stringify(owner), 'EX', OAUTH_STATE_TTL_SECONDS);
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: this.identity.clientId(),
      redirect_uri: this.redirectUri(),
      scope: XERO_SCOPE_STRING,
      state,
    });
    return { url: `${XERO_AUTHORIZE_URL}?${q.toString()}` };
  }

  /** Always resolves to a redirect URL, never throws: the browser is mid-redirect. */
  async handleCallback(q: { code?: string; state?: string; error?: string }): Promise<string> {
    // Consume the state first, whatever happened, so it can never be replayed.
    const owner = q.state ? await this.consumeState(q.state) : null;
    if (q.error) return this.settingsUrl('error', q.error === 'access_denied' ? 'cancelled' : 'xero_error');
    if (!owner) return this.settingsUrl('error', 'state');
    if (!q.code) return this.settingsUrl('error', 'exchange');

    try {
      const tokens = await this.identity.exchangeCode(q.code, this.redirectUri());
      const orgs = (await this.identity.listConnections(tokens.access_token)).filter((c) => c.tenantType === 'ORGANISATION');
      if (orgs.length !== 1) {
        await this.identity.revoke(tokens.refresh_token);
        return this.settingsUrl('error', orgs.length === 0 ? 'no_tenant' : 'multiple_tenants');
      }
      const conn = orgs[0];
      const existing = await this.repo.get();
      if (existing?.tenantId && existing.tenantId !== conn.tenantId) {
        // Synced rows belong to the previous organisation; mixing two sets of books is never OK.
        await this.identity.revoke(tokens.refresh_token);
        return this.settingsUrl('error', 'different_org');
      }
      const org = await this.identity.getOrganisation(tokens.access_token, conn.tenantId);
      await this.repo.saveConnected({
        tenantId: conn.tenantId,
        connectionId: conn.id,
        tenantName: org.Name ?? conn.tenantName,
        shortCode: org.ShortCode ?? null,
        baseCurrency: org.BaseCurrency ?? null,
        accessTokenEnc: this.crypto.encrypt(tokens.access_token),
        refreshTokenEnc: this.crypto.encrypt(tokens.refresh_token),
        accessExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        connectedByUserId: owner.userId,
        connectedByEmail: owner.email,
      });
      // The AuditLogInterceptor skips GETs, so record the connect explicitly.
      await this.audit.create({
        actor: owner.email ?? owner.userId, method: 'GET', path: '/api/xero/callback', routePattern: 'xero.connected',
        statusCode: 302, durationMs: null, ip: null, userAgent: null, requestBody: { tenantName: org.Name }, errorMessage: null,
      });
      const data: XeroSyncJobData = { entity: 'all', full: true };
      await this.queues.get(QUEUES.XERO_SYNC).add(JOBS.XERO_SYNC, data, this.queues.defaultJobOptions());
      return this.settingsUrl('connected');
    } catch (e) {
      this.logger.error(`Xero callback failed: ${(e as Error).message}`);
      return this.settingsUrl('error', 'exchange');
    }
  }

  async disconnect(): Promise<{ disconnected: true }> {
    const row = await this.repo.get();
    if (row?.connectionId && row.status === 'CONNECTED') {
      try {
        const { accessToken } = await this.tokens.getAccessToken();
        await this.identity.deleteConnection(accessToken, row.connectionId);
      } catch (e) {
        this.logger.warn(`Xero disconnect: could not remove the connection at Xero (${(e as Error).message}); clearing locally`);
      }
    }
    const latest = await this.repo.get(); // the refresh token may have rotated above
    if (latest?.refreshTokenEnc) await this.identity.revoke(this.crypto.decrypt(latest.refreshTokenEnc));
    await this.repo.markDisconnected();
    return { disconnected: true };
  }

  async isSyncBusy(): Promise<boolean> {
    const live = await this.queues.get(QUEUES.XERO_SYNC).getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    return live.some((j) => j?.name === JOBS.XERO_SYNC);
  }

  async requestSync(): Promise<{ queued: true }> {
    const row = await this.repo.get();
    if (row?.status !== 'CONNECTED') throw new ConflictException('Xero is not connected');
    if (await this.isSyncBusy()) throw new ConflictException('A Xero sync is already running');
    const data: XeroSyncJobData = { entity: 'all' };
    await this.queues.get(QUEUES.XERO_SYNC).add(JOBS.XERO_SYNC, data, this.queues.defaultJobOptions());
    return { queued: true };
  }

  async status(): Promise<XeroStatusDto> {
    const [row, states, dayRaw, syncing] = await Promise.all([
      this.repo.get(),
      this.repo.listSyncStates(),
      this.redis().then((r) => r.get(XERO_REDIS.dayRemaining)).catch(() => null),
      this.isSyncBusy().catch(() => false),
    ]);
    return {
      configured: this.identity.isConfigured(),
      encryptionEnabled: this.crypto.isEnabled,
      redirectUri: this.redirectUri(),
      scopes: [...XERO_SCOPES],
      status: row?.status ?? 'DISCONNECTED',
      tenantName: row?.tenantName ?? null,
      tenantId: row?.tenantId ?? null,
      baseCurrency: row?.baseCurrency ?? null,
      connectedAt: iso(row?.connectedAt),
      connectedByEmail: row?.connectedByEmail ?? null,
      refreshedAt: iso(row?.refreshedAt),
      lastError: row?.lastError ?? null,
      dayCallsRemaining: dayRaw != null && Number.isFinite(Number(dayRaw)) ? Number(dayRaw) : null,
      syncing,
      entities: states.map((s) => ({
        entity: s.entity, status: s.status, recordsUpserted: s.recordsUpserted, lastRunAt: iso(s.lastRunAt),
        lastSuccessAt: iso(s.lastSuccessAt), watermark: iso(s.watermark), lastError: s.lastError,
      })),
    };
  }

  private async consumeState(state: string): Promise<StateOwner | null> {
    if (!/^[0-9a-f]{64}$/.test(state)) return null;
    const raw = await (await this.redis()).getdel(XERO_REDIS.oauthState(state));
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as StateOwner;
      return typeof v?.userId === 'string' ? v : null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `npx jest src/xero/xero-auth.service.spec.ts --runInBand`
Expected: PASS (10 tests).

- [ ] **Step 7: Create the controller**

`src/xero/xero-auth.controller.ts`:

```ts
import { Controller, Delete, Get, HttpCode, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import type { AuthPrincipal } from '../auth/auth.types';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { XeroAuthService } from './xero-auth.service';

/**
 * Roles are set per route, not on the class: the callback must stay @Public()
 * (Xero redirects the browser here; authorisation comes from the single-use `state`).
 * The interceptor audits the mutating routes (connect, disconnect, sync) and skips GETs.
 */
@ApiTags('xero')
@ApiSecurity('x-admin-key')
@UseInterceptors(AuditLogInterceptor)
@Controller('xero')
export class XeroAuthController {
  constructor(private readonly auth: XeroAuthService) {}

  @Post('connect')
  @HttpCode(200)
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Start the Xero OAuth flow; returns the consent URL to navigate to' })
  connect(@CurrentUser() user: AuthPrincipal) {
    return this.auth.startConnect(user);
  }

  @Get('callback')
  @Public()
  @ApiExcludeEndpoint()
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    res.redirect(302, await this.auth.handleCallback({ code, state, error }));
  }

  @Delete('connection')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Disconnect Xero (synced data is kept)' })
  disconnect() {
    return this.auth.disconnect();
  }

  @Get('status')
  @Roles(Role.OWNER, Role.ADMIN)
  @ApiOperation({ summary: 'Xero connection and per-entity sync status' })
  status() {
    return this.auth.status();
  }

  @Post('sync')
  @HttpCode(202)
  @Roles(Role.OWNER, Role.ADMIN)
  @ApiOperation({ summary: 'Queue an incremental Xero sync now' })
  sync() {
    return this.auth.requestSync();
  }
}
```

- [ ] **Step 8: Create the module and register it**

`src/xero/xero.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { QueuesModule } from '../queues/queues.module';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { XeroConnectionRepository } from './xero-connection.repository';
import { XeroIdentityClient } from './xero-identity.client';
import { XeroTokenService } from './xero-token.service';
import { XeroClient } from './xero.client';
import { XeroAuthService } from './xero-auth.service';
import { XeroAuthController } from './xero-auth.controller';

@Module({
  imports: [
    HttpModule.register({ httpAgent: new HttpAgent({ keepAlive: true }), httpsAgent: new HttpsAgent({ keepAlive: true }) }),
    QueuesModule,
  ],
  controllers: [XeroAuthController],
  providers: [
    XeroConnectionRepository, XeroIdentityClient, XeroTokenService, XeroClient, XeroAuthService,
    // Provided locally rather than importing AdminModule and its whole graph.
    AuditLogRepository, AuditLogInterceptor,
  ],
  exports: [XeroConnectionRepository, XeroTokenService, XeroClient, XeroAuthService],
})
export class XeroModule {}
```

In `src/app.module.ts`, add `import { XeroModule } from './xero/xero.module';` and add `XeroModule,` to `imports` directly after `BudgetsModule,`. It loads in both roles: the controllers are needed on web, and the services are needed by the worker's processor.

- [ ] **Step 9: Check that request logging never records the callback URL**

Run: `grep -n "morgan\|originalUrl\|req.url" src/main.ts src/**/*.middleware.ts 2>/dev/null`
Expected: no request logger that writes full URLs. If one exists, skip logging when `req.path === '/api/xero/callback'` (its `code` and `state` query params are credentials in flight).

- [ ] **Step 10: Run the whole suite and the build**

Run: `npm run test && npm run build`
Expected: all suites pass, including the `new QueueService(...)` call sites fixed in Step 1. Build exits 0.

- [ ] **Step 11: Commit**

```bash
git add src/queues src/xero src/app.module.ts
git commit -m "feat(xero): OAuth connect/callback/disconnect, status and sync-now API"
```

---

### Task 7: Repository and sync service

**Files:**
- Create: `src/xero/xero.repository.ts`
- Test: `src/xero/xero.repository.spec.ts`
- Create: `src/xero/xero-sync.service.ts`
- Test: `src/xero/xero-sync.service.spec.ts`
- Modify: `src/xero/xero.module.ts` (add both providers to `providers` and `exports`)

**Interfaces:**
- Consumes:
  - Normalisers and `NormalizedRows` (Task 3).
  - `XeroClient.pages/get/beginRun` (Task 5).
  - The error classes (Tasks 3 and 5).
  - Constants `XERO_ENTITIES`, `ENTITY_ENDPOINTS`, `ATTACHMENT_PARENTS`, `RECONCILE_ID_BATCH`.
- Produces:
  ```ts
  export type SyncStateStatus = 'IDLE' | 'RUNNING' | 'OK' | 'RATE_LIMITED' | 'NEEDS_RECONNECT' | 'FAILED';
  class XeroRepository {
    upsertContacts(rows): Promise<void>; upsertInvoices(rows): Promise<void>; upsertCreditNotes(rows): Promise<void>;
    upsertBankTransactions(rows): Promise<void>; upsertPayments(rows): Promise<void>;
    replaceAttachments(parentId: string, rows): Promise<void>;
    getSyncState(entity: string): Promise<XeroSyncState | null>;
    startEntity(entity: string): Promise<void>;
    recordProgress(entity: string, recordsUpserted: number): Promise<void>;
    finishEntity(entity: string, watermark: Date | null, recordsUpserted: number): Promise<void>;
    failEntity(entity: string, status: SyncStateStatus, error: string): Promise<void>;
    openInvoiceIds(): Promise<string[]>;
  }
  export interface XeroSyncResult { stopped: null | 'rate_limited' | 'reconnect'; entities: { entity: string; upserted: number; watermark: string | null }[]; attachmentsFetched: number }
  class XeroSyncService { runSync(opts?: { full?: boolean }): Promise<XeroSyncResult>; reconcileOpen(): Promise<XeroSyncResult> }
  ```

- [ ] **Step 1: Write the failing repository test**

`src/xero/xero.repository.spec.ts`:

```ts
import { XeroRepository } from './xero.repository';

function makePrisma() {
  const model = () => ({ upsert: jest.fn((a) => a), deleteMany: jest.fn((a) => a), createMany: jest.fn((a) => a), update: jest.fn(), upsert2: jest.fn() });
  const prisma = {
    xeroInvoice: model(), xeroContact: model(), xeroCreditNote: model(), xeroBankTransaction: model(), xeroPayment: model(),
    xeroAttachment: model(),
    xeroSyncState: { upsert: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  return prisma;
}

describe('XeroRepository', () => {
  it('upserts invoices keyed on invoiceId in one transaction', async () => {
    const prisma = makePrisma();
    const repo = new XeroRepository(prisma as never);
    await repo.upsertInvoices([{ invoiceId: 'a' }, { invoiceId: 'b' }] as never);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.xeroInvoice.upsert).toHaveBeenCalledWith({ where: { invoiceId: 'a' }, create: { invoiceId: 'a' }, update: { invoiceId: 'a' } });
    expect(prisma.xeroInvoice.upsert).toHaveBeenCalledTimes(2);
  });

  it('skips the transaction for an empty batch', async () => {
    const prisma = makePrisma();
    await new XeroRepository(prisma as never).upsertContacts([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaceAttachments deletes the parent set, then inserts the new one atomically', async () => {
    const prisma = makePrisma();
    const rows = [{ attachmentId: 'x', parentType: 'invoice', parentId: 'p', fileName: 'a.pdf', mimeType: null, contentLength: null }];
    await new XeroRepository(prisma as never).replaceAttachments('p', rows);
    expect(prisma.xeroAttachment.deleteMany).toHaveBeenCalledWith({ where: { parentId: 'p' } });
    expect(prisma.xeroAttachment.createMany).toHaveBeenCalledWith({ data: rows, skipDuplicates: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('finishEntity keeps the old watermark when the run saw no records', async () => {
    const prisma = makePrisma();
    await new XeroRepository(prisma as never).finishEntity('invoices', null, 0);
    const arg = prisma.xeroSyncState.upsert.mock.calls[0][0];
    expect(arg.update).not.toHaveProperty('watermark');
    expect(arg.update).toMatchObject({ status: 'OK', recordsUpserted: 0 });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/xero/xero.repository.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero.repository'".

- [ ] **Step 3: Implement the repository**

`src/xero/xero.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { NormalizedRows } from './xero-normalize';

export type SyncStateStatus = 'IDLE' | 'RUNNING' | 'OK' | 'RATE_LIMITED' | 'NEEDS_RECONNECT' | 'FAILED';

/**
 * All Xero writes. Upserts are idempotent (Xero GUID = conflict key), so a
 * retried page or an overlapping watermark rewrites the same rows harmlessly.
 */
@Injectable()
export class XeroRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertContacts(rows: NormalizedRows['contacts'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((r) => this.prisma.xeroContact.upsert({ where: { contactId: r.contactId }, create: r, update: r })));
  }

  async upsertInvoices(rows: NormalizedRows['invoices'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((r) => this.prisma.xeroInvoice.upsert({ where: { invoiceId: r.invoiceId }, create: r, update: r })));
  }

  async upsertCreditNotes(rows: NormalizedRows['creditNotes'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((r) => this.prisma.xeroCreditNote.upsert({ where: { creditNoteId: r.creditNoteId }, create: r, update: r })));
  }

  async upsertBankTransactions(rows: NormalizedRows['bankTransactions'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(
      rows.map((r) => this.prisma.xeroBankTransaction.upsert({ where: { bankTransactionId: r.bankTransactionId }, create: r, update: r })),
    );
  }

  async upsertPayments(rows: NormalizedRows['payments'][]) {
    if (!rows.length) return;
    await this.prisma.$transaction(rows.map((r) => this.prisma.xeroPayment.upsert({ where: { paymentId: r.paymentId }, create: r, update: r })));
  }

  /** The attachment list of a record is replaced wholesale, so removed files disappear too. */
  async replaceAttachments(parentId: string, rows: Prisma.XeroAttachmentCreateManyInput[]) {
    await this.prisma.$transaction([
      this.prisma.xeroAttachment.deleteMany({ where: { parentId } }),
      this.prisma.xeroAttachment.createMany({ data: rows, skipDuplicates: true }),
    ]);
  }

  getSyncState(entity: string) {
    return this.prisma.xeroSyncState.findUnique({ where: { entity } });
  }

  async startEntity(entity: string) {
    const data = { status: 'RUNNING' as SyncStateStatus, lastRunAt: new Date(), lastError: null, recordsUpserted: 0 };
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, ...data }, update: data });
  }

  async recordProgress(entity: string, recordsUpserted: number) {
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, recordsUpserted }, update: { recordsUpserted } });
  }

  /** The watermark only moves forward after an entity completes, so an interrupted entity is re-read next run. */
  async finishEntity(entity: string, watermark: Date | null, recordsUpserted: number) {
    const data = {
      status: 'OK' as SyncStateStatus, lastSuccessAt: new Date(), recordsUpserted, lastError: null,
      ...(watermark ? { watermark } : {}),
    };
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, ...data }, update: data });
  }

  async failEntity(entity: string, status: SyncStateStatus, error: string) {
    const data = { status, lastError: error.slice(0, 1000) };
    await this.prisma.xeroSyncState.upsert({ where: { entity }, create: { entity, ...data }, update: data });
  }

  async openInvoiceIds(): Promise<string[]> {
    const rows = await this.prisma.xeroInvoice.findMany({
      where: { status: { in: ['AUTHORISED', 'SUBMITTED'] } },
      select: { invoiceId: true },
    });
    return rows.map((r) => r.invoiceId);
  }
}
```

- [ ] **Step 4: Run the repository test and confirm it passes**

Run: `npx jest src/xero/xero.repository.spec.ts --runInBand`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing sync-service test**

`src/xero/xero-sync.service.spec.ts`:

```ts
import { XeroSyncService } from './xero-sync.service';
import { XeroApiError, XeroRateBudgetExhaustedError, XeroReconnectRequiredError } from './xero-errors';

const U = (iso: string) => `/Date(${Date.parse(iso)}+0000)/`;
const inv = (id: string, updated: string, extra: Record<string, unknown> = {}) => ({
  InvoiceID: id, Type: 'ACCREC', Status: 'AUTHORISED', UpdatedDateUTC: U(updated), ...extra,
});

async function* gen(pages: unknown[][]) {
  for (const p of pages) yield p;
}

function setup(pagesByPath: Record<string, unknown[][] | Error> = {}, watermark: Date | null = null) {
  const client = {
    beginRun: jest.fn(),
    pages: jest.fn((path: string) => {
      const v = pagesByPath[path];
      if (v instanceof Error) {
        return (async function* () {
          throw v;
        })();
      }
      return gen(v ?? []);
    }),
    get: jest.fn().mockResolvedValue({ Attachments: [{ AttachmentID: 'att-1', FileName: 'SOW.pdf' }] }),
  };
  const repo = {
    getSyncState: jest.fn().mockResolvedValue(watermark ? { watermark } : null),
    startEntity: jest.fn(), recordProgress: jest.fn(), finishEntity: jest.fn(), failEntity: jest.fn(),
    upsertContacts: jest.fn(), upsertInvoices: jest.fn(), upsertCreditNotes: jest.fn(), upsertBankTransactions: jest.fn(),
    upsertPayments: jest.fn(), replaceAttachments: jest.fn(), openInvoiceIds: jest.fn().mockResolvedValue([]),
  };
  return { svc: new XeroSyncService(client as never, repo as never), client, repo };
}

describe('XeroSyncService.runSync', () => {
  it('runs every entity in order with the stored watermark as If-Modified-Since', async () => {
    const wm = new Date('2026-09-01T00:00:00Z');
    const { svc, client } = setup({}, wm);
    await svc.runSync();
    expect(client.beginRun).toHaveBeenCalled();
    expect(client.pages.mock.calls.map((c) => c[0])).toEqual(['/Contacts', '/Invoices', '/CreditNotes', '/BankTransactions', '/Payments']);
    for (const call of client.pages.mock.calls) expect(call[2].modifiedSince).toEqual(wm);
  });

  it('a full run ignores the watermark', async () => {
    const { svc, client } = setup({}, new Date('2026-09-01T00:00:00Z'));
    await svc.runSync({ full: true });
    for (const call of client.pages.mock.calls) expect(call[2].modifiedSince).toBeNull();
  });

  it('advances the watermark to the newest UpdatedDateUTC seen across pages', async () => {
    const { svc, repo } = setup({
      '/Invoices': [
        [inv('11111111-1111-4111-8111-111111111111', '2026-09-10T00:00:00Z')],
        [inv('22222222-2222-4222-8222-222222222222', '2026-09-12T08:00:00Z')],
      ],
    });
    await svc.runSync();
    expect(repo.upsertInvoices).toHaveBeenCalledTimes(2);
    expect(repo.finishEntity).toHaveBeenCalledWith('invoices', new Date('2026-09-12T08:00:00Z'), 2);
  });

  it('fetches attachment lists only for records flagged HasAttachments', async () => {
    const { svc, client, repo } = setup({
      '/Invoices': [[
        inv('11111111-1111-4111-8111-111111111111', '2026-09-10T00:00:00Z', { HasAttachments: true }),
        inv('22222222-2222-4222-8222-222222222222', '2026-09-10T00:00:00Z'),
      ]],
    });
    const res = await svc.runSync();
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('/Invoices/11111111-1111-4111-8111-111111111111/Attachments');
    expect(repo.replaceAttachments).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', [
      expect.objectContaining({ attachmentId: 'att-1', parentType: 'invoice', fileName: 'SOW.pdf' }),
    ]);
    expect(res.attachmentsFetched).toBe(1);
    // The Settings "Attachment lists" row must exist on a healthy run, not only after a failure.
    expect(repo.startEntity).toHaveBeenCalledWith('attachments');
    expect(repo.finishEntity).toHaveBeenCalledWith('attachments', null, 1);
  });

  it('stops cleanly on the day budget: marks RATE_LIMITED, keeps the watermark, skips later entities', async () => {
    const { svc, client, repo } = setup({ '/Invoices': new XeroRateBudgetExhaustedError(420) });
    const res = await svc.runSync();
    expect(res.stopped).toBe('rate_limited');
    expect(repo.failEntity).toHaveBeenCalledWith('invoices', 'RATE_LIMITED', expect.any(String));
    expect(repo.finishEntity).not.toHaveBeenCalledWith('invoices', expect.anything(), expect.anything());
    expect(client.pages.mock.calls.map((c) => c[0])).toEqual(['/Contacts', '/Invoices']);
  });

  it('stops cleanly when Xero needs reconnecting', async () => {
    const { svc, repo } = setup({ '/Contacts': new XeroReconnectRequiredError() });
    await expect(svc.runSync()).resolves.toMatchObject({ stopped: 'reconnect' });
    expect(repo.failEntity).toHaveBeenCalledWith('contacts', 'NEEDS_RECONNECT', expect.any(String));
  });

  it('marks other failures FAILED and rethrows so BullMQ retries', async () => {
    const { svc, repo } = setup({ '/Payments': new XeroApiError(500, '/Payments', 'boom') });
    await expect(svc.runSync()).rejects.toBeInstanceOf(XeroApiError);
    expect(repo.failEntity).toHaveBeenCalledWith('payments', 'FAILED', expect.stringContaining('boom'));
  });
});

describe('XeroSyncService.reconcileOpen', () => {
  it('re-fetches open invoices by ID in batches of 50, after a full contacts pass', async () => {
    const { svc, client, repo } = setup();
    repo.openInvoiceIds.mockResolvedValue(Array.from({ length: 120 }, (_, i) => `id-${i}`));
    client.get.mockResolvedValue({ Invoices: [] });
    await svc.reconcileOpen();
    expect(client.pages.mock.calls[0][0]).toBe('/Contacts');
    expect(client.pages.mock.calls[0][2].modifiedSince).toBeNull();
    const idCalls = client.get.mock.calls.filter((c) => c[0] === '/Invoices');
    expect(idCalls).toHaveLength(3);
    expect(idCalls[0][1].params.IDs.split(',')).toHaveLength(50);
    expect(idCalls[2][1].params.IDs.split(',')).toHaveLength(20);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx jest src/xero/xero-sync.service.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero-sync.service'".

- [ ] **Step 7: Implement the sync service**

`src/xero/xero-sync.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { XeroClient } from './xero.client';
import { XeroRepository, type SyncStateStatus } from './xero.repository';
import { XeroRateBudgetExhaustedError, XeroReconnectRequiredError } from './xero-errors';
import {
  ATTACHMENT_PARENTS, ENTITY_ENDPOINTS, RECONCILE_ID_BATCH, XERO_ENTITIES, type AttachmentParentType, type XeroEntity,
} from './xero.constants';
import {
  normalizeAttachment, normalizeBankTransaction, normalizeContact, normalizeCreditNote, normalizeInvoice, normalizePayment,
} from './xero-normalize';
import type {
  XeroAttachment, XeroBankTransaction, XeroContact, XeroCreditNote, XeroInvoice, XeroPayment,
} from './xero.types';

export interface XeroSyncResult {
  stopped: null | 'rate_limited' | 'reconnect';
  entities: { entity: string; upserted: number; watermark: string | null }[];
  attachmentsFetched: number;
}

type Candidate = { parentType: AttachmentParentType; id: string };

const maxDate = (dates: Date[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (!m || d > m ? d : m), null);

/**
 * One sync run: contacts → invoices (both types) → credit notes → bank
 * transactions → payments → attachment lists. Each entity pages with
 * If-Modified-Since = its watermark, which only advances after the entity
 * completes. Voids and deletes are status changes that bump UpdatedDateUTC, so
 * they arrive through this same path; no deletion reconcile is needed.
 */
@Injectable()
export class XeroSyncService {
  private readonly logger = new Logger(XeroSyncService.name);

  constructor(
    private readonly client: XeroClient,
    private readonly repo: XeroRepository,
  ) {}

  async runSync(opts: { full?: boolean } = {}): Promise<XeroSyncResult> {
    this.client.beginRun();
    const result: XeroSyncResult = { stopped: null, entities: [], attachmentsFetched: 0 };
    const candidates: Candidate[] = [];
    for (const entity of XERO_ENTITIES) {
      try {
        result.entities.push(await this.syncEntity(entity, !!opts.full, candidates));
      } catch (e) {
        result.stopped = await this.stopReason(entity, e);
        return result;
      }
    }
    // Attachments get their own sync-state row, so Settings shows it on a healthy run too, not only on failure.
    await this.repo.startEntity('attachments');
    try {
      result.attachmentsFetched = await this.syncAttachments(candidates);
      await this.repo.finishEntity('attachments', null, result.attachmentsFetched);
    } catch (e) {
      result.stopped = await this.stopReason('attachments', e);
    }
    this.logger.log(`Xero sync finished: ${result.entities.map((r) => `${r.entity}=${r.upserted}`).join(' ')} attachments=${result.attachmentsFetched}`);
    return result;
  }

  /**
   * Nightly. Xero does not bump UpdatedDateUTC for some edits (e.g. a DueDate
   * change on a part-paid invoice), so unpaid invoices are re-read by ID. Contacts
   * get a full pass so balances and role flags stay right.
   */
  async reconcileOpen(): Promise<XeroSyncResult> {
    this.client.beginRun();
    const result: XeroSyncResult = { stopped: null, entities: [], attachmentsFetched: 0 };
    try {
      result.entities.push(await this.syncEntity('contacts', true, []));
      const ids = await this.repo.openInvoiceIds();
      let upserted = 0;
      for (let i = 0; i < ids.length; i += RECONCILE_ID_BATCH) {
        const batch = ids.slice(i, i + RECONCILE_ID_BATCH);
        const body = await this.client.get<{ Invoices?: XeroInvoice[] }>('/Invoices', { params: { IDs: batch.join(',') } });
        const rows = (body?.Invoices ?? []).map(normalizeInvoice);
        await this.repo.upsertInvoices(rows);
        upserted += rows.length;
      }
      result.entities.push({ entity: 'invoices', upserted, watermark: null });
    } catch (e) {
      result.stopped = await this.stopReason('invoices', e);
    }
    return result;
  }

  private async syncEntity(entity: XeroEntity, full: boolean, candidates: Candidate[]) {
    const state = await this.repo.getSyncState(entity);
    const since = full ? null : (state?.watermark ?? null);
    await this.repo.startEntity(entity);
    const { path, key, params } = ENTITY_ENDPOINTS[entity];
    let upserted = 0;
    let watermark: Date | null = null;
    for await (const page of this.client.pages<unknown>(path, key, { params, modifiedSince: since })) {
      const newest = await this.writePage(entity, page, candidates);
      upserted += page.length;
      if (newest && (!watermark || newest > watermark)) watermark = newest;
      await this.repo.recordProgress(entity, upserted);
    }
    await this.repo.finishEntity(entity, watermark, upserted);
    return { entity, upserted, watermark: watermark?.toISOString() ?? null };
  }

  /** Writes one page and returns its newest UpdatedDateUTC. */
  private async writePage(entity: XeroEntity, page: unknown[], candidates: Candidate[]): Promise<Date | null> {
    switch (entity) {
      case 'contacts': {
        const rows = (page as XeroContact[]).map(normalizeContact);
        await this.repo.upsertContacts(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'invoices': {
        const rows = (page as XeroInvoice[]).map(normalizeInvoice);
        await this.repo.upsertInvoices(rows);
        rows.filter((r) => r.hasAttachments).forEach((r) => candidates.push({ parentType: 'invoice', id: r.invoiceId }));
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'creditNotes': {
        const rows = (page as XeroCreditNote[]).map(normalizeCreditNote);
        await this.repo.upsertCreditNotes(rows);
        rows.filter((r) => r.hasAttachments).forEach((r) => candidates.push({ parentType: 'creditNote', id: r.creditNoteId }));
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'bankTransactions': {
        const rows = (page as XeroBankTransaction[]).map(normalizeBankTransaction);
        await this.repo.upsertBankTransactions(rows);
        rows.filter((r) => r.hasAttachments).forEach((r) => candidates.push({ parentType: 'bankTransaction', id: r.bankTransactionId }));
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
      case 'payments': {
        const rows = (page as XeroPayment[]).map(normalizePayment);
        await this.repo.upsertPayments(rows);
        return maxDate(rows.map((r) => r.updatedDateUtc));
      }
    }
  }

  /** One call per changed record that has attachments, so cost scales with change, not history. */
  private async syncAttachments(candidates: Candidate[]): Promise<number> {
    const seen = new Set<string>();
    let fetched = 0;
    for (const c of candidates) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const body = await this.client.get<{ Attachments?: XeroAttachment[] }>(`${ATTACHMENT_PARENTS[c.parentType]}/${c.id}/Attachments`);
      const rows = (body?.Attachments ?? []).map((a) => normalizeAttachment(c.parentType, c.id, a));
      await this.repo.replaceAttachments(c.id, rows);
      fetched += 1;
    }
    return fetched;
  }

  /**
   * Clean stops (budget, reconnect) are recorded and returned, so they don't burn
   * BullMQ retries. Anything else is recorded as FAILED and rethrown to retry.
   */
  private async stopReason(entity: string, e: unknown): Promise<'rate_limited' | 'reconnect'> {
    let status: SyncStateStatus = 'FAILED';
    if (e instanceof XeroRateBudgetExhaustedError) status = 'RATE_LIMITED';
    else if (e instanceof XeroReconnectRequiredError) status = 'NEEDS_RECONNECT';
    await this.repo.failEntity(entity, status, (e as Error)?.message ?? String(e));
    if (status === 'RATE_LIMITED') return 'rate_limited';
    if (status === 'NEEDS_RECONNECT') return 'reconnect';
    throw e;
  }
}
```

- [ ] **Step 8: Register the providers**

In `src/xero/xero.module.ts`, import `XeroRepository` and `XeroSyncService`, add both to `providers`, and add both to `exports`.

- [ ] **Step 9: Run both specs and the build, confirm they pass**

Run: `npx jest src/xero/xero.repository.spec.ts src/xero/xero-sync.service.spec.ts --runInBand && npm run build`
Expected: PASS (12 tests), and the build exits 0.

- [ ] **Step 10: Commit**

```bash
git add src/xero/xero.repository.ts src/xero/xero.repository.spec.ts src/xero/xero-sync.service.ts src/xero/xero-sync.service.spec.ts src/xero/xero.module.ts
git commit -m "feat(xero): idempotent upserts and incremental sync with watermarks"
```

---

### Task 8: Processor, crons, dead-letter hook, worker wiring

**Files:**
- Create: `src/workers/xero-sync.processor.ts`
- Test: `src/workers/xero-sync.processor.spec.ts`
- Modify: `src/workers/workers.module.ts`
- Create: `src/xero/xero.scheduler.ts`
- Test: `src/xero/xero.scheduler.spec.ts`
- Modify: `src/xero/xero.module.ts` (add `XeroScheduler` provider)
- Modify: `src/jobs/dead-letter.service.ts`
- Modify: `src/jobs/dead-letter.service.spec.ts` (append one test)

**Interfaces:**
- Consumes:
  - `XeroSyncService.runSync/reconcileOpen` (Task 7).
  - `XeroTokenService.getAccessToken` (Task 4).
  - `XeroConnectionRepository.get` (Task 4).
  - `QUEUES.XERO_SYNC`, `JOBS.XERO_*` and `XeroSyncJobData` (Task 6).
  - `JobLogsRepository.started/finished/failed` and `DeadLetterService.recordIfExhausted` (existing).
- Produces:
  - `XeroSyncProcessor`: the only consumer of the `xero-sync` queue, at concurrency 1.
  - `XeroScheduler.enqueue(name, data): Promise<boolean>`.
  - Three crons, all Asia/Dhaka:

    | Cron | Schedule | Job enqueued |
    |---|---|---|
    | `xero-sync-hourly` | minute 17 of every hour | `XERO_SYNC` |
    | `xero-reconcile-open` | 02:00 | `XERO_RECONCILE_OPEN` |
    | `xero-token-keepalive` | 04:00 | `XERO_TOKEN_KEEPALIVE` |

- [ ] **Step 1: Write the failing processor test**

`src/workers/xero-sync.processor.spec.ts`:

```ts
import { UnrecoverableError } from 'bullmq';
import { XeroSyncProcessor } from './xero-sync.processor';
import { XeroReconnectRequiredError } from '../xero/xero-errors';

function setup() {
  const sync = {
    runSync: jest.fn().mockResolvedValue({ stopped: null, entities: [], attachmentsFetched: 0 }),
    reconcileOpen: jest.fn().mockResolvedValue({ stopped: null, entities: [], attachmentsFetched: 0 }),
  };
  const tokens = { getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'a', tenantId: 't' }) };
  const jobLogs = { started: jest.fn().mockResolvedValue({ id: 7n }), finished: jest.fn(), failed: jest.fn() };
  const deadLetters = { recordIfExhausted: jest.fn() };
  const p = new XeroSyncProcessor(sync as never, tokens as never, jobLogs as never, deadLetters as never);
  return { p, sync, tokens, jobLogs, deadLetters };
}
const job = (name: string, data: Record<string, unknown> = { entity: 'all' }) => ({ id: '1', name, data }) as never;

describe('XeroSyncProcessor', () => {
  it('routes a sync run and passes the full flag', async () => {
    const { p, sync, jobLogs } = setup();
    await p.process(job('xero-sync-run', { entity: 'all', full: true }));
    expect(sync.runSync).toHaveBeenCalledWith({ full: true });
    expect(jobLogs.finished).toHaveBeenCalledWith(7n);
  });

  it('routes the nightly reconcile', async () => {
    const { p, sync } = setup();
    await p.process(job('xero-reconcile-open'));
    expect(sync.reconcileOpen).toHaveBeenCalled();
  });

  it('keep-alive forces a refresh, and a reconnect-required answer is not a failure', async () => {
    const { p, tokens, jobLogs } = setup();
    await p.process(job('xero-token-keepalive'));
    expect(tokens.getAccessToken).toHaveBeenCalledWith({ force: true });
    tokens.getAccessToken.mockRejectedValueOnce(new XeroReconnectRequiredError());
    await expect(p.process(job('xero-token-keepalive'))).resolves.toEqual({ keepalive: 'needs_reconnect' });
    expect(jobLogs.failed).not.toHaveBeenCalled();
  });

  it('logs a cleanly-stopped run as partial', async () => {
    const { p, sync, jobLogs } = setup();
    sync.runSync.mockResolvedValueOnce({ stopped: 'rate_limited', entities: [], attachmentsFetched: 0 });
    await p.process(job('xero-sync-run'));
    expect(jobLogs.finished).toHaveBeenCalledWith(7n, {}, 'partial', expect.stringContaining('rate_limited'));
  });

  it('rejects unknown job names as unrecoverable', async () => {
    const { p } = setup();
    await expect(p.process(job('nope'))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('logs failures, rethrows, and dead-letters when retries are exhausted', async () => {
    const { p, sync, jobLogs, deadLetters } = setup();
    sync.runSync.mockRejectedValueOnce(new Error('boom'));
    await expect(p.process(job('xero-sync-run'))).rejects.toThrow('boom');
    expect(jobLogs.failed).toHaveBeenCalled();
    const err = new Error('x');
    await p.onFailed(job('xero-sync-run'), err);
    expect(deadLetters.recordIfExhausted).toHaveBeenCalledWith(expect.anything(), err);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/workers/xero-sync.processor.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero-sync.processor'".

- [ ] **Step 3: Implement the processor**

`src/workers/xero-sync.processor.ts`:

```ts
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { JobLogsRepository } from '../jobs/job-logs.repository';
import { DeadLetterService } from '../jobs/dead-letter.service';
import { XeroSyncService, type XeroSyncResult } from '../xero/xero-sync.service';
import { XeroTokenService } from '../xero/xero-token.service';
import { XeroReconnectRequiredError } from '../xero/xero-errors';
import type { XeroSyncJobData } from '../xero/xero-auth.service';

/**
 * Sole consumer of the xero-sync queue (one @Processor per queue; route by job
 * name). Concurrency 1: Xero allows 5 concurrent calls and 60/min per tenant, and
 * XeroClient's pacing only works when a single run is calling at a time.
 */
@Injectable()
@Processor(QUEUES.XERO_SYNC, { concurrency: 1 })
export class XeroSyncProcessor extends WorkerHost {
  constructor(
    private readonly sync: XeroSyncService,
    private readonly tokens: XeroTokenService,
    private readonly jobLogs: JobLogsRepository,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<XeroSyncJobData>) {
    const log = await this.jobLogs.started({
      jobId: job.id?.toString(),
      queueName: QUEUES.XERO_SYNC,
      jobName: job.name,
      entityType: 'xero',
      entityId: 'all',
      payload: job.data?.full ? { full: true } : undefined,
    });
    try {
      const result = await this.route(job);
      const stopped = (result as XeroSyncResult | undefined)?.stopped;
      if (stopped) await this.jobLogs.finished(log.id, {}, 'partial', `Xero run stopped early: ${stopped}`);
      else await this.jobLogs.finished(log.id);
      return result;
    } catch (e) {
      await this.jobLogs.failed(log.id, e);
      throw e;
    }
  }

  private async route(job: Job<XeroSyncJobData>) {
    switch (job.name) {
      case JOBS.XERO_SYNC:
        return this.sync.runSync({ full: !!job.data?.full });
      case JOBS.XERO_RECONCILE_OPEN:
        return this.sync.reconcileOpen();
      case JOBS.XERO_TOKEN_KEEPALIVE:
        try {
          await this.tokens.getAccessToken({ force: true });
          return { keepalive: 'ok' };
        } catch (e) {
          // Already marked NEEDS_RECONNECT; retrying can't help.
          if (e instanceof XeroReconnectRequiredError) return { keepalive: 'needs_reconnect' };
          throw e;
        }
      default:
        throw new UnrecoverableError(`Unknown Xero job: ${job.name}`);
    }
  }
}
```

- [ ] **Step 4: Register the processor in the worker**

In `src/workers/workers.module.ts`:
- Add `import { XeroModule } from '../xero/xero.module';` and `import { XeroSyncProcessor } from './xero-sync.processor';`.
- Append `XeroModule` to the `imports` array.
- Append `XeroSyncProcessor` to the `providers` array.

- [ ] **Step 5: Run the processor test and confirm it passes**

Run: `npx jest src/workers/xero-sync.processor.spec.ts --runInBand`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the failing scheduler test**

`src/xero/xero.scheduler.spec.ts`:

```ts
import { XeroScheduler } from './xero.scheduler';

function setup(status: string | null, busy: string[] = []) {
  const queue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue(busy.map((name) => ({ name }))) };
  const queues = { get: jest.fn(() => queue), defaultJobOptions: () => ({ attempts: 5 }) };
  const repo = { get: jest.fn().mockResolvedValue(status ? { status } : null) };
  return { s: new XeroScheduler(queues as never, repo as never), queue, queues };
}

describe('XeroScheduler', () => {
  it('enqueues the hourly sync on the xero-sync queue when connected and idle', async () => {
    const { s, queue, queues } = setup('CONNECTED');
    await s.hourlySync();
    expect(queues.get).toHaveBeenCalledWith('xero-sync');
    expect(queue.add).toHaveBeenCalledWith('xero-sync-run', { entity: 'all' }, { attempts: 5 });
  });

  it('skips every cron when not connected', async () => {
    for (const status of [null, 'DISCONNECTED', 'NEEDS_RECONNECT']) {
      const { s, queue } = setup(status);
      await s.hourlySync();
      await s.nightlyReconcile();
      await s.keepalive();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it('skips a job whose previous run is still in flight, but not other job types', async () => {
    const { s, queue } = setup('CONNECTED', ['xero-sync-run']);
    await s.hourlySync();
    expect(queue.add).not.toHaveBeenCalled();
    await s.nightlyReconcile();
    expect(queue.add).toHaveBeenCalledWith('xero-reconcile-open', { entity: 'all' }, { attempts: 5 });
  });

  it('keep-alive enqueues the token keep-alive job', async () => {
    const { s, queue } = setup('CONNECTED');
    await s.keepalive();
    expect(queue.add).toHaveBeenCalledWith('xero-token-keepalive', { entity: 'all' }, { attempts: 5 });
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx jest src/xero/xero.scheduler.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './xero.scheduler'".

- [ ] **Step 8: Implement the scheduler**

`src/xero/xero.scheduler.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { XeroConnectionRepository } from './xero-connection.repository';
import type { XeroSyncJobData } from './xero-auth.service';

/** Team-local time, like src/sync/sync.scheduler.ts. Containers run UTC. */
const DHAKA = 'Asia/Dhaka';

/**
 * Crons only enqueue. They fire only in the worker role, because ScheduleModule
 * loads there alone, so blue/green web instances never double-fire.
 */
@Injectable()
export class XeroScheduler {
  private readonly logger = new Logger(XeroScheduler.name);

  constructor(
    private readonly queues: QueueService,
    private readonly repo: XeroConnectionRepository,
  ) {}

  /** Minute 17 keeps it clear of the top-of-hour ClickUp jobs. Incremental and cheap. */
  @Cron('0 17 * * * *', { name: 'xero-sync-hourly', timeZone: DHAKA })
  hourlySync() {
    return this.enqueue(JOBS.XERO_SYNC, { entity: 'all' });
  }

  /** Inside the 00:00–09:00 closed-office window (office-hours-sync-schedule). */
  @Cron('0 0 2 * * *', { name: 'xero-reconcile-open', timeZone: DHAKA })
  nightlyReconcile() {
    return this.enqueue(JOBS.XERO_RECONCILE_OPEN, { entity: 'all' });
  }

  /** A refresh token expires after 60 days unused; this keeps it alive even if syncing stops. */
  @Cron('0 0 4 * * *', { name: 'xero-token-keepalive', timeZone: DHAKA })
  keepalive() {
    return this.enqueue(JOBS.XERO_TOKEN_KEEPALIVE, { entity: 'all' });
  }

  async enqueue(name: string, data: XeroSyncJobData): Promise<boolean> {
    const row = await this.repo.get();
    if (row?.status !== 'CONNECTED') return false;
    const queue = this.queues.get(QUEUES.XERO_SYNC);
    // Name-filtered busy check (see sync.scheduler.ts): jobId dedup can't work for crons.
    const live = await queue.getJobs(['active', 'waiting', 'delayed', 'prioritized']);
    if (live.some((j) => j?.name === name)) {
      this.logger.warn(`Skipping ${name}: the previous one is still in flight`);
      return false;
    }
    await queue.add(name, data, this.queues.defaultJobOptions());
    return true;
  }
}
```

Add `XeroScheduler` to `providers` in `src/xero/xero.module.ts`.

- [ ] **Step 9: Let dead-letter rows name the Xero entity**

In `src/jobs/dead-letter.service.ts`, change the `candidate` line in `entityId()` to:

```ts
    const candidate = d.taskId ?? d.timeEntryId ?? d.spaceId ?? d.assigneeId ?? d.entity;
```

Append this test to `src/jobs/dead-letter.service.spec.ts`:

```ts
describe('DeadLetterService.entityId (Xero payloads)', () => {
  it('uses `entity` when no ClickUp id is present', async () => {
    const repo = { create: jest.fn().mockResolvedValue({}) };
    const svc = new DeadLetterService(repo as never);
    await svc.recordIfExhausted({ opts: { attempts: 1 }, attemptsMade: 1, queueName: 'xero-sync', name: 'xero-sync-run', data: { entity: 'all' }, id: '9' } as never, new Error('x'));
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'all' }));
  });
});
```

If `DeadLetterService` isn't already imported at the top of that spec file, add `import { DeadLetterService } from './dead-letter.service';`.

- [ ] **Step 10: Run the affected specs, the whole suite, and the build**

Run: `npx jest src/xero/xero.scheduler.spec.ts src/jobs/dead-letter.service.spec.ts --runInBand && npm run test && npm run build`
Expected: all pass, and the build exits 0.

- [ ] **Step 11: Smoke-test the worker boot**

Run: `ROLE=worker timeout 25 npm run start:dev 2>&1 | grep -iE "xero|error" | head -20`
Expected: no DI errors such as "Nest can't resolve dependencies of XeroSyncProcessor". Log lines mentioning Xero routes or crons are fine.

- [ ] **Step 12: Commit**

```bash
git add src/workers src/xero/xero.scheduler.ts src/xero/xero.scheduler.spec.ts src/xero/xero.module.ts src/jobs
git commit -m "feat(xero): xero-sync processor, Dhaka-time crons and dead-letter entity"
```

---

### Task 9: Finance maths (pure)

**Files:**
- Create: `src/xero/finance-math.ts`
- Test: `src/xero/finance-math.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DHAKA_TZ = 'Asia/Dhaka';
  export function todayDhaka(now?: Date): Date;            // UTC midnight of Dhaka's calendar date (matches @db.Date storage)
  export function monthStartDhaka(now?: Date): Date;
  export function addMonths(d: Date, n: number): Date;     // UTC-based
  export function dayString(d: Date | null | undefined): string | null; // 'YYYY-MM-DD'
  export function daysPastDue(dueDate: Date, today: Date): number;
  export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';
  export const AGING_BUCKETS: AgingBucket[];
  export function agingBucket(daysPast: number): AgingBucket;
  export function bucketAging(rows: { dueDate: Date | null; amountDueBase: number }[], today: Date): Record<AgingBucket, number>;
  export type StatusBucket = 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'overdue' | 'PAID' | 'VOIDED';
  export const STATUS_BUCKETS: StatusBucket[];
  export function invoiceStatusWhere(bucket: StatusBucket | undefined, today: Date): Prisma.XeroInvoiceWhereInput;
  export const IN_BANK_TYPES: string[];   // RECEIVE, RECEIVE-OVERPAYMENT, RECEIVE-PREPAYMENT
  export const OUT_BANK_TYPES: string[];  // SPEND, SPEND-OVERPAYMENT, SPEND-PREPAYMENT
  export type DeepLinkKind = 'invoice' | 'bill' | 'contact' | 'bankTransaction' | 'creditNote';
  export function xeroDeepLink(shortCode: string | null, kind: DeepLinkKind, id: string): string;
  ```

- [ ] **Step 1: Write the failing test**

`src/xero/finance-math.spec.ts`:

```ts
import {
  addMonths, agingBucket, bucketAging, dayString, IN_BANK_TYPES, invoiceStatusWhere, monthStartDhaka, OUT_BANK_TYPES,
  STATUS_BUCKETS, todayDhaka, xeroDeepLink,
} from './finance-math';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('Dhaka calendar', () => {
  it('uses the Dhaka date, not the UTC date (UTC+6)', () => {
    expect(dayString(todayDhaka(new Date('2026-09-14T19:00:00Z')))).toBe('2026-09-15');
    expect(dayString(todayDhaka(new Date('2026-09-14T17:59:00Z')))).toBe('2026-09-14');
  });
  it('month start and month arithmetic', () => {
    expect(dayString(monthStartDhaka(new Date('2026-09-30T20:00:00Z')))).toBe('2026-10-01');
    expect(dayString(addMonths(d('2026-09-01'), -5))).toBe('2026-04-01');
  });
});

describe('aging', () => {
  it.each([
    [-3, 'current'], [0, 'current'], [1, '1-30'], [30, '1-30'], [31, '31-60'], [60, '31-60'], [61, '61-90'], [90, '61-90'], [91, '90+'],
  ])('%d days past due → %s', (days, bucket) => {
    expect(agingBucket(days as number)).toBe(bucket);
  });

  it('sums base amounts per bucket; a missing due date counts as current', () => {
    const today = d('2026-09-15');
    const res = bucketAging(
      [
        { dueDate: d('2026-09-20'), amountDueBase: 100 },
        { dueDate: null, amountDueBase: 5 },
        { dueDate: d('2026-09-01'), amountDueBase: 200 },
        { dueDate: d('2026-05-01'), amountDueBase: 300 },
      ],
      today,
    );
    expect(res).toEqual({ current: 105, '1-30': 200, '31-60': 0, '61-90': 0, '90+': 300 });
  });
});

/** Tiny evaluator for exactly the where-shapes invoiceStatusWhere emits. */
function matches(inv: { status: string; dueDate: Date | null }, w: Record<string, any>): boolean {
  if (w.OR && !w.OR.some((o: Record<string, any>) => matches(inv, o))) return false;
  if (typeof w.status === 'string' && inv.status !== w.status) return false;
  if (w.status?.not && inv.status === w.status.not) return false;
  if (w.dueDate === null && inv.dueDate !== null) return false;
  if (w.dueDate?.lt && !(inv.dueDate && inv.dueDate < w.dueDate.lt)) return false;
  if (w.dueDate?.gte && !(inv.dueDate && inv.dueDate >= w.dueDate.gte)) return false;
  return true;
}

describe('invoiceStatusWhere', () => {
  const today = d('2026-09-15');
  const invoices = ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED', 'DELETED'].flatMap((status) =>
    [d('2026-09-01'), d('2026-09-15'), d('2026-10-01'), null].map((dueDate) => ({ status, dueDate })),
  );

  it('the buckets are exclusive and exhaustive over non-deleted invoices', () => {
    for (const inv of invoices) {
      const hits = STATUS_BUCKETS.filter((b) => matches(inv, invoiceStatusWhere(b, today)));
      expect(hits).toHaveLength(inv.status === 'DELETED' ? 0 : 1);
    }
  });

  it('"overdue" is AUTHORISED with a due date before today; due today is not overdue', () => {
    const w = invoiceStatusWhere('overdue', today);
    expect(matches({ status: 'AUTHORISED', dueDate: d('2026-09-14') }, w)).toBe(true);
    expect(matches({ status: 'AUTHORISED', dueDate: today }, w)).toBe(false);
  });

  it('no bucket = everything except DELETED', () => {
    const w = invoiceStatusWhere(undefined, today);
    expect(matches({ status: 'DELETED', dueDate: null }, w)).toBe(false);
    expect(matches({ status: 'PAID', dueDate: null }, w)).toBe(true);
  });
});

describe('bank cash types', () => {
  it('exclude transfers between own accounts', () => {
    expect([...IN_BANK_TYPES, ...OUT_BANK_TYPES].some((t) => t.includes('TRANSFER'))).toBe(false);
    expect(IN_BANK_TYPES).toContain('RECEIVE');
    expect(OUT_BANK_TYPES).toContain('SPEND');
  });
});

describe('xeroDeepLink', () => {
  it('routes through organisationlogin with the shortcode so the right org opens', () => {
    const url = new URL(xeroDeepLink('!abc12', 'invoice', 'inv-1'));
    expect(url.origin + url.pathname).toBe('https://go.xero.com/organisationlogin/default.aspx');
    expect(url.searchParams.get('shortcode')).toBe('!abc12');
    expect(url.searchParams.get('redirecturl')).toBe('/AccountsReceivable/View.aspx?InvoiceID=inv-1');
  });
  it('uses the payable path for bills and falls back without a shortcode', () => {
    expect(xeroDeepLink(null, 'bill', 'b-1')).toBe('https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=b-1');
    expect(xeroDeepLink(null, 'contact', 'c-1')).toBe('https://go.xero.com/Contacts/View/c-1');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/xero/finance-math.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './finance-math'".

- [ ] **Step 3: Implement**

`src/xero/finance-math.ts`:

```ts
import type { Prisma } from '@prisma/client';

export const DHAKA_TZ = 'Asia/Dhaka';
const DAY_MS = 86_400_000;

const dhakaYmd = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: DHAKA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Dhaka's calendar date as UTC midnight, the same representation Prisma uses for @db.Date columns. */
export function todayDhaka(now: Date = new Date()): Date {
  return new Date(`${dhakaYmd(now)}T00:00:00.000Z`);
}

export function monthStartDhaka(now: Date = new Date()): Date {
  return new Date(`${dhakaYmd(now).slice(0, 7)}-01T00:00:00.000Z`);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

export function dayString(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function daysPastDue(dueDate: Date, today: Date): number {
  return Math.round((today.getTime() - dueDate.getTime()) / DAY_MS);
}

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';
export const AGING_BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+'];

export function agingBucket(daysPast: number): AgingBucket {
  if (daysPast <= 0) return 'current';
  if (daysPast <= 30) return '1-30';
  if (daysPast <= 60) return '31-60';
  if (daysPast <= 90) return '61-90';
  return '90+';
}

export function bucketAging(rows: { dueDate: Date | null; amountDueBase: number }[], today: Date): Record<AgingBucket, number> {
  const out: Record<AgingBucket, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const r of rows) {
    const b = r.dueDate ? agingBucket(daysPastDue(r.dueDate, today)) : 'current';
    out[b] = Math.round((out[b] + r.amountDueBase) * 100) / 100;
  }
  return out;
}

export type StatusBucket = 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'overdue' | 'PAID' | 'VOIDED';
export const STATUS_BUCKETS: StatusBucket[] = ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'overdue', 'PAID', 'VOIDED'];

/**
 * Exclusive status buckets for invoices and bills. "AUTHORISED" means awaiting
 * payment and NOT overdue; "overdue" is its own bucket. Together they cover every
 * non-DELETED invoice exactly once, a property enforced by finance-math.spec.ts.
 * If you add a way for an invoice to be split, change both buckets together.
 */
export function invoiceStatusWhere(bucket: StatusBucket | undefined, today: Date): Prisma.XeroInvoiceWhereInput {
  if (!bucket) return { status: { not: 'DELETED' } };
  if (bucket === 'overdue') return { status: 'AUTHORISED', dueDate: { lt: today } };
  if (bucket === 'AUTHORISED') return { status: 'AUTHORISED', OR: [{ dueDate: { gte: today } }, { dueDate: null }] };
  return { status: bucket };
}

/** Real cash movements. *-TRANSFER is money moving between the company's own accounts. */
export const IN_BANK_TYPES = ['RECEIVE', 'RECEIVE-OVERPAYMENT', 'RECEIVE-PREPAYMENT'];
export const OUT_BANK_TYPES = ['SPEND', 'SPEND-OVERPAYMENT', 'SPEND-PREPAYMENT'];

export type DeepLinkKind = 'invoice' | 'bill' | 'contact' | 'bankTransaction' | 'creditNote';

/** Paths confirmed against the Demo Company in Task 13. */
export function xeroDeepLink(shortCode: string | null, kind: DeepLinkKind, id: string): string {
  const path = {
    invoice: `/AccountsReceivable/View.aspx?InvoiceID=${id}`,
    bill: `/AccountsPayable/View.aspx?InvoiceID=${id}`,
    contact: `/Contacts/View/${id}`,
    bankTransaction: `/Bank/ViewTransaction.aspx?bankTransactionID=${id}`,
    creditNote: `/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=${id}`,
  }[kind];
  if (!shortCode) return `https://go.xero.com${path}`;
  const q = new URLSearchParams({ shortcode: shortCode, redirecturl: path });
  return `https://go.xero.com/organisationlogin/default.aspx?${q.toString()}`;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest src/xero/finance-math.spec.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/xero/finance-math.ts src/xero/finance-math.spec.ts
git commit -m "feat(xero): Dhaka dates, aging buckets, exclusive status buckets, deep links"
```

---

### Task 10: Finance read API

**Files:**
- Create: `src/xero/dto/finance-query.dto.ts`
- Create: `src/xero/finance-reports.service.ts`
- Test: `src/xero/finance-reports.service.spec.ts`
- Create: `src/xero/finance-reports.controller.ts`
- Modify: `src/xero/xero.module.ts` (add the controller and service)

**Interfaces:**
- Consumes:
  - Everything in `finance-math.ts` (Task 9).
  - `XeroConnectionRepository.get()` (Task 4), for `shortCode` and `baseCurrency`.
  - Prisma models (Task 1).
- Produces the routes (all `@Roles(OWNER, ADMIN)`, under `/api`), each listed with its response shape. Task 11 mirrors these types in the frontend.
  - `GET /finance/summary` → `FinanceSummary`:
    ```ts
    { baseCurrency: string | null; owedToYou: { amount: number; count: number };
      overdue: { amount: number; count: number; oldestDays: number | null };
      youOwe: { amount: number; count: number; nextDueDate: string | null };
      moneyInMonth: number; moneyOutMonth: number;
      aging: { bucket: AgingBucket; amount: number }[];
      topOverdue: { contactId: string; contactName: string; amount: number; invoices: number; oldestDays: number }[];
      series: { month: string; in: number; out: number }[] }
    ```
  - `GET /finance/contacts` → `{ items: ContactListItem[]; total }`, where `ContactListItem = { id, name, email, person, isCustomer, isSupplier, archived, defaultCurrency, owed, overdue, owing, lastActivity }`.
  - `GET /finance/contacts/:id` → `ContactDetail = ContactListItem & { firstName, lastName, taxNumber, phones: unknown[], addresses: unknown[], kpis: { billed, owed, overdue, spend }, counts: { invoices, bills, bank, creditNotes, payments }, xeroUrl }`.
  - `GET /finance/contacts/:id/activity` → `{ items: ActivityItem[] }`, where `ActivityItem = { kind: 'invoice' | 'bill' | 'payment' | 'bank' | 'creditNote'; id; date; title; amount; currencyCode; status }`.
  - `GET /finance/invoices?type=ACCREC|ACCPAY&status&from&to&currency&contactId&q&sort&dir&limit&offset` → `{ items: InvoiceListItem[]; total; totals: { totalBase, amountDueBase } }`.
    - `InvoiceListItem = { id, type, number, reference, contactId, contactName, status, overdue, overdueDays, partPaid, date, dueDate, currencyCode, total, amountDue, amountPaid, totalBase, amountDueBase, hasAttachments }`.
  - `GET /finance/invoices/:id` → `InvoiceDetail = InvoiceListItem & { currencyRate, subTotal, totalTax, amountCredited, lineItems: LineItem[], payments: PaymentListItem[], attachments: AttachmentItem[], updatedDateUtc, xeroUrl }`.
  - `GET /finance/bank-transactions?type=SPEND|RECEIVE&reconciled&from&to&contactId&q&sort&dir&limit&offset` → `{ items: BankTxListItem[]; total; totals: { spentBase, receivedBase } }`.
    - `BankTxListItem = { id, type, direction: 'in' | 'out' | 'transfer', contactId, contactName, reference, description, accountCode, bankAccountName, status, isReconciled, date, currencyCode, total, totalBase, hasAttachments }`.
  - `GET /finance/bank-transactions/:id` → `BankTxListItem & { lineItems, attachments, xeroUrl }`.
  - `GET /finance/credit-notes?from&to&contactId&q&sort&dir&limit&offset` → `{ items: CreditNoteListItem[]; total; totals: { totalBase } }`.
    - `CreditNoteListItem = { id, type, number, reference, contactId, contactName, status, date, currencyCode, total, remainingCredit, totalBase }`.
  - `GET /finance/credit-notes/:id` → `CreditNoteListItem & { lineItems, payments, attachments, xeroUrl }`.
  - `GET /finance/payments?direction=in|out&from&to&contactId&q&sort&dir&limit&offset` → `{ items: PaymentListItem[]; total; totals: { inBase, outBase } }`.
    - `PaymentListItem = { id, paymentType, direction, status, invoiceId, invoiceNumber, creditNoteId, creditNoteNumber, contactId, contactName, date, currencyCode, amount, amountBase, bankAccountName, reference }`.
  - Common types:
    - `LineItem = { description, quantity, unitAmount, accountCode, taxType, taxAmount, lineAmount }`
    - `AttachmentItem = { id, fileName, mimeType, contentLength }`
  - **Dates** are `'YYYY-MM-DD'` strings. **Money** is a `number`: document currency unless the name ends in `Base`.

- [ ] **Step 1: Create the query DTOs**

`src/xero/dto/finance-query.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { STATUS_BUCKETS, type StatusBucket } from '../finance-math';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

export class FinancePageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
}

export class FinanceRangeDto extends FinancePageDto {
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsUUID() contactId?: string;
}

export class ContactListQueryDto extends FinancePageDto {
  @IsOptional() @IsIn(['customer', 'supplier']) role?: 'customer' | 'supplier';
  @IsOptional() @Transform(toBool) @IsBoolean() archived?: boolean;
  @IsOptional() @IsIn(['name', 'owed', 'overdue', 'owing', 'lastActivity']) sort?: 'name' | 'owed' | 'overdue' | 'owing' | 'lastActivity';
}

export class InvoiceListQueryDto extends FinanceRangeDto {
  @IsIn(['ACCREC', 'ACCPAY']) type!: 'ACCREC' | 'ACCPAY';
  @IsOptional() @IsIn(STATUS_BUCKETS) status?: StatusBucket;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsIn(['date', 'dueDate', 'number', 'contactName', 'total', 'amountDue']) sort?: string;
}

export class BankTxListQueryDto extends FinanceRangeDto {
  @IsOptional() @IsIn(['SPEND', 'RECEIVE']) type?: 'SPEND' | 'RECEIVE';
  @IsOptional() @Transform(toBool) @IsBoolean() reconciled?: boolean;
  @IsOptional() @IsIn(['date', 'total', 'contactName']) sort?: string;
}

export class CreditNoteListQueryDto extends FinanceRangeDto {
  @IsOptional() @IsIn(['date', 'number', 'total']) sort?: string;
}

export class PaymentListQueryDto extends FinanceRangeDto {
  @IsOptional() @IsIn(['in', 'out']) direction?: 'in' | 'out';
  @IsOptional() @IsIn(['date', 'amount']) sort?: string;
}
```

- [ ] **Step 2: Write the failing service test**

`src/xero/finance-reports.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { FinanceReportsService } from './finance-reports.service';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const NOW = new Date('2026-09-15T06:00:00Z'); // 12:00 Dhaka, 15 Sep

function makePrisma() {
  const m = () => ({
    aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
  });
  return { xeroInvoice: m(), xeroContact: m(), xeroCreditNote: m(), xeroBankTransaction: m(), xeroPayment: m(), xeroAttachment: m() };
}

function setup() {
  const prisma = makePrisma();
  const connection = { get: jest.fn().mockResolvedValue({ shortCode: '!abc12', baseCurrency: 'USD' }) };
  const svc = new FinanceReportsService(prisma as never, connection as never);
  svc.now = () => NOW;
  return { svc, prisma };
}

describe('FinanceReportsService.summary', () => {
  it('computes KPIs, aging, top overdue and the 6-month series, excluding transfers', async () => {
    const { svc, prisma } = setup();
    prisma.xeroInvoice.aggregate
      .mockResolvedValueOnce({ _sum: { amountDueBase: 1500 }, _count: { _all: 3 } }) // owed to you
      .mockResolvedValueOnce({ _sum: { amountDueBase: 900 }, _count: { _all: 2 } }) // overdue
      .mockResolvedValueOnce({ _sum: { amountDueBase: 400 }, _count: { _all: 1 } }); // you owe
    prisma.xeroInvoice.findFirst
      .mockResolvedValueOnce({ dueDate: d('2026-06-01') }) // oldest overdue
      .mockResolvedValueOnce({ dueDate: d('2026-09-18') }); // next bill due
    prisma.xeroInvoice.findMany.mockResolvedValueOnce([
      { contactId: 'c1', contactName: 'Oakridge', dueDate: d('2026-06-01'), amountDueBase: 700 },
      { contactId: 'c2', contactName: 'Meridian', dueDate: d('2026-09-10'), amountDueBase: 200 },
      { contactId: 'c1', contactName: 'Oakridge', dueDate: d('2026-10-01'), amountDueBase: 600 },
    ]);
    prisma.xeroPayment.findMany.mockResolvedValueOnce([
      { date: d('2026-09-03'), amountBase: 1000, cashDirection: 'in' },
      { date: d('2026-08-20'), amountBase: 300, cashDirection: 'out' },
    ]);
    prisma.xeroBankTransaction.findMany.mockResolvedValueOnce([
      { date: d('2026-09-05'), totalBase: 50, type: 'SPEND' },
      { date: d('2026-09-06'), totalBase: 20, type: 'RECEIVE' },
    ]);

    const s = await svc.summary();

    expect(s.owedToYou).toEqual({ amount: 1500, count: 3 });
    expect(s.overdue).toEqual({ amount: 900, count: 2, oldestDays: 106 });
    expect(s.youOwe).toEqual({ amount: 400, count: 1, nextDueDate: '2026-09-18' });
    expect(s.moneyInMonth).toBe(1020);
    expect(s.moneyOutMonth).toBe(50);
    expect(s.aging).toEqual([
      { bucket: 'current', amount: 600 }, { bucket: '1-30', amount: 200 }, { bucket: '31-60', amount: 0 },
      { bucket: '61-90', amount: 0 }, { bucket: '90+', amount: 700 },
    ]);
    expect(s.topOverdue[0]).toEqual({ contactId: 'c1', contactName: 'Oakridge', amount: 700, invoices: 1, oldestDays: 106 });
    expect(s.series.map((p) => p.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(s.series[4]).toEqual({ month: '2026-08', in: 0, out: 300 });
    const bankWhere = prisma.xeroBankTransaction.findMany.mock.calls[0][0].where;
    expect(bankWhere.type.in).not.toContain('SPEND-TRANSFER');
    expect(bankWhere.type.in).not.toContain('RECEIVE-TRANSFER');
  });
});

describe('FinanceReportsService.listInvoices', () => {
  it('ANDs the status bucket with search, maps decimals to numbers and flags overdue', async () => {
    const { svc, prisma } = setup();
    prisma.xeroInvoice.findMany.mockResolvedValueOnce([
      {
        invoiceId: 'i1', type: 'ACCREC', number: 'INV-0142', reference: null, contactId: 'c1', contactName: 'Oakridge',
        status: 'AUTHORISED', date: d('2026-08-01'), dueDate: d('2026-09-01'), currencyCode: 'GBP', total: '1100.00',
        amountDue: '660.00', amountPaid: '440.00', totalBase: '1397.00', amountDueBase: '838.20', hasAttachments: false,
      },
    ]);
    prisma.xeroInvoice.count.mockResolvedValueOnce(1);
    prisma.xeroInvoice.aggregate.mockResolvedValueOnce({ _sum: { totalBase: '1397.00', amountDueBase: '838.20' } });

    const res = await svc.listInvoices({ type: 'ACCREC', status: 'overdue', q: 'oak', limit: 25, offset: 0 });

    const where = prisma.xeroInvoice.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { type: 'ACCREC' },
        { status: 'AUTHORISED', dueDate: { lt: d('2026-09-15') } },
        { OR: [
          { number: { contains: 'oak', mode: 'insensitive' } },
          { reference: { contains: 'oak', mode: 'insensitive' } },
          { contactName: { contains: 'oak', mode: 'insensitive' } },
        ] },
      ]),
    );
    expect(res.total).toBe(1);
    expect(res.totals).toEqual({ totalBase: 1397, amountDueBase: 838.2 });
    expect(res.items[0]).toMatchObject({ id: 'i1', overdue: true, overdueDays: 14, partPaid: true, total: 1100, date: '2026-08-01', dueDate: '2026-09-01' });
  });

  it('caps limit at 200', async () => {
    const { svc, prisma } = setup();
    await svc.listInvoices({ type: 'ACCPAY', limit: 5000 } as never);
    expect(prisma.xeroInvoice.findMany.mock.calls[0][0].take).toBe(200);
  });
});

describe('FinanceReportsService.listContacts', () => {
  it('joins rollups, hides archived by default, sorts by owed desc and pages', async () => {
    const { svc, prisma } = setup();
    prisma.xeroContact.findMany.mockResolvedValueOnce([
      { contactId: 'c1', name: 'A', email: null, firstName: null, lastName: null, isCustomer: true, isSupplier: false, status: 'ACTIVE', defaultCurrency: 'USD' },
      { contactId: 'c2', name: 'B', email: null, firstName: 'Bo', lastName: 'Li', isCustomer: true, isSupplier: true, status: 'ACTIVE', defaultCurrency: 'USD' },
    ]);
    prisma.xeroInvoice.groupBy
      .mockResolvedValueOnce([{ contactId: 'c1', _sum: { amountDueBase: 100 } }, { contactId: 'c2', _sum: { amountDueBase: 900 } }]) // owed
      .mockResolvedValueOnce([{ contactId: 'c2', _sum: { amountDueBase: 300 } }]) // overdue
      .mockResolvedValueOnce([{ contactId: 'c2', _sum: { amountDueBase: 50 } }]) // owing
      .mockResolvedValueOnce([{ contactId: 'c1', _max: { date: d('2026-09-01') } }]); // last invoice/bill
    const res = await svc.listContacts({ limit: 1, offset: 0 });
    expect(prisma.xeroContact.findMany.mock.calls[0][0].where.AND).toContainEqual({ status: { not: 'ARCHIVED' } });
    expect(res.total).toBe(2);
    expect(res.items).toEqual([expect.objectContaining({ id: 'c2', owed: 900, overdue: 300, owing: 50, person: 'Bo Li' })]);
  });
});

describe('FinanceReportsService.invoiceDetail', () => {
  it('404s an unknown invoice', async () => {
    const { svc } = setup();
    await expect(svc.invoiceDetail('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('includes payments, attachments and a shortcode deep link (bill path for ACCPAY)', async () => {
    const { svc, prisma } = setup();
    prisma.xeroInvoice.findUnique.mockResolvedValueOnce({
      invoiceId: 'b1', type: 'ACCPAY', number: 'AWS-1', status: 'PAID', date: d('2026-08-01'), dueDate: d('2026-08-15'),
      currencyCode: 'USD', currencyRate: 1, total: 100, amountDue: 0, amountPaid: 100, amountCredited: 0, subTotal: 100,
      totalTax: 0, totalBase: 100, amountDueBase: 0, lineItems: [], hasAttachments: true, updatedDateUtc: new Date(), contactId: 'c9', contactName: 'AWS', reference: null,
    });
    prisma.xeroPayment.findMany.mockResolvedValueOnce([{ paymentId: 'p1', paymentType: 'ACCPAYPAYMENT', cashDirection: 'out', status: 'AUTHORISED', invoiceId: 'b1', amount: 100, amountBase: 100, date: d('2026-08-10') }]);
    prisma.xeroAttachment.findMany.mockResolvedValueOnce([{ attachmentId: 'a1', fileName: 'inv.pdf', mimeType: 'application/pdf', contentLength: 900 }]);
    const res = await svc.invoiceDetail('b1');
    expect(res.payments).toHaveLength(1);
    expect(res.attachments).toEqual([{ id: 'a1', fileName: 'inv.pdf', mimeType: 'application/pdf', contentLength: 900 }]);
    expect(decodeURIComponent(res.xeroUrl)).toContain('/AccountsPayable/View.aspx?InvoiceID=b1');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx jest src/xero/finance-reports.service.spec.ts --runInBand`
Expected: FAIL with "Cannot find module './finance-reports.service'".

- [ ] **Step 4: Implement the service**

`src/xero/finance-reports.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { XeroConnectionRepository } from './xero-connection.repository';
import {
  AGING_BUCKETS, addMonths, bucketAging, dayString, daysPastDue, IN_BANK_TYPES, invoiceStatusWhere, monthStartDhaka,
  OUT_BANK_TYPES, todayDhaka, xeroDeepLink,
} from './finance-math';
import type {
  BankTxListQueryDto, ContactListQueryDto, CreditNoteListQueryDto, InvoiceListQueryDto, PaymentListQueryDto,
} from './dto/finance-query.dto';

const num = (v: unknown): number => (v == null ? 0 : Math.round(Number(v) * 100) / 100);
const lim = (v?: number) => Math.min(Math.max(Number(v) || 50, 1), 200);
const off = (v?: number) => Math.max(Number(v) || 0, 0);
const ins = (q: string) => ({ contains: q, mode: 'insensitive' as const });
const dir = (d?: 'asc' | 'desc') => d ?? 'desc';

function rangeWhere(field: string, from?: string, to?: string) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: new Date(`${from.slice(0, 10)}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to.slice(0, 10)}T00:00:00.000Z`) } : {}) } };
}

const lineItemsOut = (v: unknown) =>
  (Array.isArray(v) ? v : []).map((l: any) => ({
    description: l.description ?? null, quantity: l.quantity ?? null, unitAmount: l.unitAmount ?? null,
    accountCode: l.accountCode ?? null, taxType: l.taxType ?? null, taxAmount: l.taxAmount ?? null, lineAmount: l.lineAmount ?? null,
  }));

/**
 * Read-only queries behind /api/finance/*. Every money figure in a KPI is in the
 * organisation's base currency (*_base columns). List rows carry both the
 * document amount and its base equivalent.
 */
@Injectable()
export class FinanceReportsService {
  /** Overridable in tests. */
  now = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: XeroConnectionRepository,
  ) {}

  async summary() {
    const today = todayDhaka(this.now());
    const monthStart = monthStartDhaka(this.now());
    const seriesStart = addMonths(monthStart, -5);
    const recOpen = { type: 'ACCREC', status: 'AUTHORISED' };
    const [owed, overdue, owe, oldest, nextDue, open, payments, bank, conn] = await Promise.all([
      this.prisma.xeroInvoice.aggregate({ where: recOpen, _sum: { amountDueBase: true }, _count: { _all: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { ...recOpen, dueDate: { lt: today } }, _sum: { amountDueBase: true }, _count: { _all: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { type: 'ACCPAY', status: 'AUTHORISED' }, _sum: { amountDueBase: true }, _count: { _all: true } }),
      this.prisma.xeroInvoice.findFirst({ where: { ...recOpen, dueDate: { lt: today } }, orderBy: { dueDate: 'asc' }, select: { dueDate: true } }),
      this.prisma.xeroInvoice.findFirst({ where: { type: 'ACCPAY', status: 'AUTHORISED', dueDate: { gte: today } }, orderBy: { dueDate: 'asc' }, select: { dueDate: true } }),
      this.prisma.xeroInvoice.findMany({ where: recOpen, select: { contactId: true, contactName: true, dueDate: true, amountDueBase: true } }),
      this.prisma.xeroPayment.findMany({
        where: { status: { not: 'DELETED' }, cashDirection: { not: null }, date: { gte: seriesStart } },
        select: { date: true, amountBase: true, cashDirection: true },
      }),
      this.prisma.xeroBankTransaction.findMany({
        where: { status: 'AUTHORISED', type: { in: [...IN_BANK_TYPES, ...OUT_BANK_TYPES] }, date: { gte: seriesStart } },
        select: { date: true, totalBase: true, type: true },
      }),
      this.connection.get(),
    ]);

    const months = Array.from({ length: 6 }, (_, i) => dayString(addMonths(seriesStart, i))!.slice(0, 7));
    const series = new Map(months.map((m) => [m, { month: m, in: 0, out: 0 }]));
    const add = (date: Date | null, amount: number, way: 'in' | 'out') => {
      const p = date && series.get(dayString(date)!.slice(0, 7));
      if (p) p[way] = Math.round((p[way] + amount) * 100) / 100;
    };
    for (const p of payments) add(p.date, num(p.amountBase), p.cashDirection as 'in' | 'out');
    for (const t of bank) add(t.date, num(t.totalBase), IN_BANK_TYPES.includes(t.type) ? 'in' : 'out');

    const openRows = open.map((r) => ({ ...r, amountDueBase: num(r.amountDueBase) }));
    const aging = bucketAging(openRows, today);
    const byContact = new Map<string, { contactId: string; contactName: string; amount: number; invoices: number; oldestDays: number }>();
    for (const r of openRows) {
      if (!r.contactId || !r.dueDate || r.dueDate >= today) continue;
      const days = daysPastDue(r.dueDate, today);
      const cur = byContact.get(r.contactId) ?? { contactId: r.contactId, contactName: r.contactName ?? '', amount: 0, invoices: 0, oldestDays: 0 };
      cur.amount = Math.round((cur.amount + r.amountDueBase) * 100) / 100;
      cur.invoices += 1;
      cur.oldestDays = Math.max(cur.oldestDays, days);
      byContact.set(r.contactId, cur);
    }
    const last = series.get(months[5])!;
    return {
      baseCurrency: conn?.baseCurrency ?? null,
      owedToYou: { amount: num(owed._sum.amountDueBase), count: owed._count._all },
      overdue: { amount: num(overdue._sum.amountDueBase), count: overdue._count._all, oldestDays: oldest?.dueDate ? daysPastDue(oldest.dueDate, today) : null },
      youOwe: { amount: num(owe._sum.amountDueBase), count: owe._count._all, nextDueDate: dayString(nextDue?.dueDate) },
      moneyInMonth: last.in,
      moneyOutMonth: last.out,
      aging: AGING_BUCKETS.map((bucket) => ({ bucket, amount: aging[bucket] })),
      topOverdue: [...byContact.values()].sort((a, b) => b.amount - a.amount).slice(0, 3),
      series: [...series.values()],
    };
  }

  /**
   * Rollups are joined and sorted in memory. That's fine up to a few thousand
   * contacts. If the book grows past ~5k, move this to one SQL query with
   * LEFT JOINed aggregates.
   */
  async listContacts(q: ContactListQueryDto) {
    const today = todayDhaka(this.now());
    const and: Prisma.XeroContactWhereInput[] = [];
    if (!q.archived) and.push({ status: { not: 'ARCHIVED' } });
    if (q.role === 'customer') and.push({ isCustomer: true });
    if (q.role === 'supplier') and.push({ isSupplier: true });
    if (q.q) and.push({ OR: [{ name: ins(q.q) }, { email: ins(q.q) }, { firstName: ins(q.q) }, { lastName: ins(q.q) }] });
    const [contacts, owed, overdue, owing, lastInv, lastBank] = await Promise.all([
      this.prisma.xeroContact.findMany({
        where: { AND: and },
        select: { contactId: true, name: true, email: true, firstName: true, lastName: true, isCustomer: true, isSupplier: true, status: true, defaultCurrency: true },
      }),
      this.prisma.xeroInvoice.groupBy({ by: ['contactId'], where: { type: 'ACCREC', status: 'AUTHORISED' }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.groupBy({ by: ['contactId'], where: { type: 'ACCREC', status: 'AUTHORISED', dueDate: { lt: today } }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.groupBy({ by: ['contactId'], where: { type: 'ACCPAY', status: 'AUTHORISED' }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.groupBy({ by: ['contactId'], where: { status: { not: 'DELETED' } }, _max: { date: true } }),
      this.prisma.xeroBankTransaction.groupBy({ by: ['contactId'], where: { status: { not: 'DELETED' } }, _max: { date: true } }),
    ]);
    const sumMap = (rows: { contactId: string | null; _sum: { amountDueBase: unknown } }[]) =>
      new Map(rows.map((r) => [r.contactId, num(r._sum.amountDueBase)]));
    const [owedM, overdueM, owingM] = [sumMap(owed as never), sumMap(overdue as never), sumMap(owing as never)];
    const lastM = new Map<string | null, Date>();
    for (const r of [...(lastInv as any[]), ...(lastBank as any[])]) {
      const dt: Date | null = r._max?.date ?? null;
      if (dt && (!lastM.get(r.contactId) || dt > lastM.get(r.contactId)!)) lastM.set(r.contactId, dt);
    }
    const items = contacts.map((c) => ({
      id: c.contactId, name: c.name, email: c.email,
      person: [c.firstName, c.lastName].filter(Boolean).join(' ') || null,
      isCustomer: c.isCustomer, isSupplier: c.isSupplier, archived: c.status === 'ARCHIVED', defaultCurrency: c.defaultCurrency,
      owed: owedM.get(c.contactId) ?? 0, overdue: overdueM.get(c.contactId) ?? 0, owing: owingM.get(c.contactId) ?? 0,
      lastActivity: dayString(lastM.get(c.contactId)),
    }));
    const key = q.sort ?? 'owed';
    const sign = dir(q.dir) === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      const x = key === 'lastActivity' ? (a.lastActivity ?? '') : (a as any)[key];
      const y = key === 'lastActivity' ? (b.lastActivity ?? '') : (b as any)[key];
      if (key === 'name') return String(x).localeCompare(String(y)) * (q.dir === 'desc' ? -1 : 1);
      return (x > y ? 1 : x < y ? -1 : a.name.localeCompare(b.name) * -sign) * sign;
    });
    const start = off(q.offset);
    return { items: items.slice(start, start + lim(q.limit)), total: items.length };
  }

  async contactDetail(id: string) {
    const c = await this.prisma.xeroContact.findUnique({ where: { contactId: id } });
    if (!c) throw new NotFoundException('Contact not found');
    const today = todayDhaka(this.now());
    const [billed, owed, overdue, owing, spendBills, spendBank, invoices, bills, bank, creditNotes, payments, lastInv, conn] = await Promise.all([
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCREC', status: { in: ['AUTHORISED', 'PAID'] } }, _sum: { totalBase: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCREC', status: 'AUTHORISED' }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCREC', status: 'AUTHORISED', dueDate: { lt: today } }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCPAY', status: 'AUTHORISED' }, _sum: { amountDueBase: true } }),
      this.prisma.xeroInvoice.aggregate({ where: { contactId: id, type: 'ACCPAY', status: { in: ['AUTHORISED', 'PAID'] } }, _sum: { totalBase: true } }),
      this.prisma.xeroBankTransaction.aggregate({ where: { contactId: id, status: 'AUTHORISED', type: { in: OUT_BANK_TYPES } }, _sum: { totalBase: true } }),
      this.prisma.xeroInvoice.count({ where: { contactId: id, type: 'ACCREC', status: { not: 'DELETED' } } }),
      this.prisma.xeroInvoice.count({ where: { contactId: id, type: 'ACCPAY', status: { not: 'DELETED' } } }),
      this.prisma.xeroBankTransaction.count({ where: { contactId: id, status: { not: 'DELETED' } } }),
      this.prisma.xeroCreditNote.count({ where: { contactId: id, status: { not: 'DELETED' } } }),
      this.prisma.xeroPayment.count({ where: { contactId: id, status: { not: 'DELETED' } } }),
      this.prisma.xeroInvoice.findFirst({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { date: 'desc' }, select: { date: true } }),
      this.connection.get(),
    ]);
    return {
      id: c.contactId, name: c.name, email: c.email, firstName: c.firstName, lastName: c.lastName,
      person: [c.firstName, c.lastName].filter(Boolean).join(' ') || null,
      isCustomer: c.isCustomer, isSupplier: c.isSupplier, archived: c.status === 'ARCHIVED', defaultCurrency: c.defaultCurrency,
      taxNumber: c.taxNumber, phones: (c.phones as unknown[]) ?? [], addresses: (c.addresses as unknown[]) ?? [],
      owed: num(owed._sum.amountDueBase), overdue: num(overdue._sum.amountDueBase), owing: num(owing._sum.amountDueBase), lastActivity: dayString(lastInv?.date),
      kpis: {
        billed: num(billed._sum.totalBase), owed: num(owed._sum.amountDueBase), overdue: num(overdue._sum.amountDueBase),
        spend: Math.round((num(spendBills._sum.totalBase) + num(spendBank._sum.totalBase)) * 100) / 100,
      },
      counts: { invoices, bills, bank, creditNotes, payments },
      xeroUrl: xeroDeepLink(conn?.shortCode ?? null, 'contact', c.contactId),
    };
  }

  async contactActivity(id: string) {
    const [inv, pay, bank, cn] = await Promise.all([
      this.prisma.xeroInvoice.findMany({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { updatedDateUtc: 'desc' }, take: 20 }),
      this.prisma.xeroPayment.findMany({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { date: 'desc' }, take: 20 }),
      this.prisma.xeroBankTransaction.findMany({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { date: 'desc' }, take: 20 }),
      this.prisma.xeroCreditNote.findMany({ where: { contactId: id, status: { not: 'DELETED' } }, orderBy: { date: 'desc' }, take: 20 }),
    ]);
    const items = [
      ...inv.map((i) => ({
        kind: (i.type === 'ACCREC' ? 'invoice' : 'bill') as 'invoice' | 'bill', id: i.invoiceId, date: dayString(i.date),
        title: `${i.type === 'ACCREC' ? 'Invoice' : 'Bill'} ${i.number ?? ''}`.trim(), amount: num(i.total), currencyCode: i.currencyCode, status: i.status,
      })),
      ...pay.map((p) => ({
        kind: 'payment' as const, id: p.paymentId, date: dayString(p.date),
        title: `Payment ${p.cashDirection === 'in' ? 'received' : 'made'}${p.invoiceNumber ? ` for ${p.invoiceNumber}` : ''}`,
        amount: num(p.amount), currencyCode: p.currencyCode, status: p.status,
      })),
      ...bank.map((t) => ({
        kind: 'bank' as const, id: t.bankTransactionId, date: dayString(t.date),
        title: `${t.type.startsWith('SPEND') ? 'Spend money' : 'Receive money'}${t.reference ? ` · ${t.reference}` : ''}`,
        amount: num(t.total), currencyCode: t.currencyCode, status: t.status,
      })),
      ...cn.map((n) => ({
        kind: 'creditNote' as const, id: n.creditNoteId, date: dayString(n.date), title: `Credit note ${n.number ?? ''}`.trim(),
        amount: num(n.total), currencyCode: n.currencyCode, status: n.status,
      })),
    ];
    items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return { items: items.slice(0, 30) };
  }

  private invoiceItem(i: any, today: Date) {
    const overdue = i.status === 'AUTHORISED' && !!i.dueDate && i.dueDate < today;
    return {
      id: i.invoiceId, type: i.type, number: i.number, reference: i.reference, contactId: i.contactId, contactName: i.contactName,
      status: i.status, overdue, overdueDays: overdue ? daysPastDue(i.dueDate, today) : 0, partPaid: i.status === 'AUTHORISED' && num(i.amountPaid) > 0,
      date: dayString(i.date), dueDate: dayString(i.dueDate), currencyCode: i.currencyCode,
      total: num(i.total), amountDue: num(i.amountDue), amountPaid: num(i.amountPaid), totalBase: num(i.totalBase), amountDueBase: num(i.amountDueBase),
      hasAttachments: !!i.hasAttachments,
    };
  }

  async listInvoices(q: InvoiceListQueryDto) {
    const today = todayDhaka(this.now());
    const and: Prisma.XeroInvoiceWhereInput[] = [{ type: q.type }, invoiceStatusWhere(q.status, today)];
    if (q.currency) and.push({ currencyCode: q.currency });
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.from || q.to) and.push(rangeWhere('date', q.from, q.to));
    if (q.q) and.push({ OR: [{ number: ins(q.q) }, { reference: ins(q.q) }, { contactName: ins(q.q) }] });
    const where = { AND: and };
    const sortField = ({ date: 'date', dueDate: 'dueDate', number: 'number', contactName: 'contactName', total: 'totalBase', amountDue: 'amountDueBase' } as const)[
      (q.sort ?? 'date') as 'date'
    ] ?? 'date';
    const [rows, total, sums] = await Promise.all([
      this.prisma.xeroInvoice.findMany({ where, orderBy: [{ [sortField]: dir(q.dir) }, { invoiceId: 'asc' }], take: lim(q.limit), skip: off(q.offset) }),
      this.prisma.xeroInvoice.count({ where }),
      this.prisma.xeroInvoice.aggregate({ where, _sum: { totalBase: true, amountDueBase: true } }),
    ]);
    return {
      items: rows.map((r) => this.invoiceItem(r, today)),
      total,
      totals: { totalBase: num(sums._sum.totalBase), amountDueBase: num(sums._sum.amountDueBase) },
    };
  }

  async invoiceDetail(id: string) {
    const i = await this.prisma.xeroInvoice.findUnique({ where: { invoiceId: id } });
    if (!i) throw new NotFoundException('Invoice not found');
    const [payments, attachments, conn] = await Promise.all([
      this.prisma.xeroPayment.findMany({ where: { invoiceId: id, status: { not: 'DELETED' } }, orderBy: { date: 'asc' } }),
      this.prisma.xeroAttachment.findMany({ where: { parentId: id }, orderBy: { fileName: 'asc' } }),
      this.connection.get(),
    ]);
    return {
      ...this.invoiceItem(i, todayDhaka(this.now())),
      currencyRate: Number(i.currencyRate), subTotal: num(i.subTotal), totalTax: num(i.totalTax), amountCredited: num(i.amountCredited),
      lineItems: lineItemsOut(i.lineItems),
      payments: payments.map((p) => this.paymentItem(p)),
      attachments: attachments.map((a) => this.attachmentItem(a)),
      updatedDateUtc: i.updatedDateUtc?.toISOString?.() ?? null,
      xeroUrl: xeroDeepLink(conn?.shortCode ?? null, i.type === 'ACCREC' ? 'invoice' : 'bill', i.invoiceId),
    };
  }

  private bankItem(t: any) {
    const direction = t.type.endsWith('TRANSFER') ? 'transfer' : t.type.startsWith('RECEIVE') ? 'in' : 'out';
    const first = Array.isArray(t.lineItems) ? t.lineItems[0] : undefined;
    return {
      id: t.bankTransactionId, type: t.type, direction, contactId: t.contactId, contactName: t.contactName, reference: t.reference,
      description: first?.description ?? null, accountCode: first?.accountCode ?? null, bankAccountName: t.bankAccountName,
      status: t.status, isReconciled: t.isReconciled, date: dayString(t.date), currencyCode: t.currencyCode,
      total: num(t.total), totalBase: num(t.totalBase), hasAttachments: !!t.hasAttachments,
    };
  }

  async listBankTransactions(q: BankTxListQueryDto) {
    const and: Prisma.XeroBankTransactionWhereInput[] = [{ status: { not: 'DELETED' } }];
    if (q.type) and.push({ type: { startsWith: q.type } });
    if (q.reconciled !== undefined) and.push({ isReconciled: q.reconciled });
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.from || q.to) and.push(rangeWhere('date', q.from, q.to));
    if (q.q) and.push({ OR: [{ contactName: ins(q.q) }, { reference: ins(q.q) }, { bankAccountName: ins(q.q) }] });
    const where = { AND: and };
    const sortField = ({ date: 'date', total: 'totalBase', contactName: 'contactName' } as const)[(q.sort ?? 'date') as 'date'] ?? 'date';
    const [rows, total, spent, received] = await Promise.all([
      this.prisma.xeroBankTransaction.findMany({ where, orderBy: [{ [sortField]: dir(q.dir) }, { bankTransactionId: 'asc' }], take: lim(q.limit), skip: off(q.offset) }),
      this.prisma.xeroBankTransaction.count({ where }),
      this.prisma.xeroBankTransaction.aggregate({ where: { AND: [...and, { type: { in: OUT_BANK_TYPES } }] }, _sum: { totalBase: true } }),
      this.prisma.xeroBankTransaction.aggregate({ where: { AND: [...and, { type: { in: IN_BANK_TYPES } }] }, _sum: { totalBase: true } }),
    ]);
    return { items: rows.map((r) => this.bankItem(r)), total, totals: { spentBase: num(spent._sum.totalBase), receivedBase: num(received._sum.totalBase) } };
  }

  async bankTransactionDetail(id: string) {
    const t = await this.prisma.xeroBankTransaction.findUnique({ where: { bankTransactionId: id } });
    if (!t) throw new NotFoundException('Bank transaction not found');
    const [attachments, conn] = await Promise.all([
      this.prisma.xeroAttachment.findMany({ where: { parentId: id }, orderBy: { fileName: 'asc' } }),
      this.connection.get(),
    ]);
    return {
      ...this.bankItem(t), lineItems: lineItemsOut(t.lineItems), attachments: attachments.map((a) => this.attachmentItem(a)),
      xeroUrl: xeroDeepLink(conn?.shortCode ?? null, 'bankTransaction', t.bankTransactionId),
    };
  }

  private creditNoteItem(n: any) {
    return {
      id: n.creditNoteId, type: n.type, number: n.number, reference: n.reference, contactId: n.contactId, contactName: n.contactName,
      status: n.status, date: dayString(n.date), currencyCode: n.currencyCode, total: num(n.total), remainingCredit: num(n.remainingCredit),
      totalBase: num(n.totalBase),
    };
  }

  async listCreditNotes(q: CreditNoteListQueryDto) {
    const and: Prisma.XeroCreditNoteWhereInput[] = [{ status: { not: 'DELETED' } }];
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.from || q.to) and.push(rangeWhere('date', q.from, q.to));
    if (q.q) and.push({ OR: [{ number: ins(q.q) }, { reference: ins(q.q) }, { contactName: ins(q.q) }] });
    const where = { AND: and };
    const sortField = ({ date: 'date', number: 'number', total: 'totalBase' } as const)[(q.sort ?? 'date') as 'date'] ?? 'date';
    const [rows, total, sums] = await Promise.all([
      this.prisma.xeroCreditNote.findMany({ where, orderBy: [{ [sortField]: dir(q.dir) }, { creditNoteId: 'asc' }], take: lim(q.limit), skip: off(q.offset) }),
      this.prisma.xeroCreditNote.count({ where }),
      this.prisma.xeroCreditNote.aggregate({ where, _sum: { totalBase: true } }),
    ]);
    return { items: rows.map((r) => this.creditNoteItem(r)), total, totals: { totalBase: num(sums._sum.totalBase) } };
  }

  async creditNoteDetail(id: string) {
    const n = await this.prisma.xeroCreditNote.findUnique({ where: { creditNoteId: id } });
    if (!n) throw new NotFoundException('Credit note not found');
    const [payments, attachments, conn] = await Promise.all([
      this.prisma.xeroPayment.findMany({ where: { creditNoteId: id, status: { not: 'DELETED' } }, orderBy: { date: 'asc' } }),
      this.prisma.xeroAttachment.findMany({ where: { parentId: id }, orderBy: { fileName: 'asc' } }),
      this.connection.get(),
    ]);
    return {
      ...this.creditNoteItem(n), lineItems: lineItemsOut(n.lineItems), payments: payments.map((p) => this.paymentItem(p)),
      attachments: attachments.map((a) => this.attachmentItem(a)), xeroUrl: xeroDeepLink(conn?.shortCode ?? null, 'creditNote', n.creditNoteId),
    };
  }

  private paymentItem(p: any) {
    return {
      id: p.paymentId, paymentType: p.paymentType, direction: p.cashDirection, status: p.status, invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber,
      creditNoteId: p.creditNoteId, creditNoteNumber: p.creditNoteNumber, contactId: p.contactId, contactName: p.contactName,
      date: dayString(p.date), currencyCode: p.currencyCode, amount: num(p.amount), amountBase: num(p.amountBase),
      bankAccountName: p.bankAccountName, reference: p.reference,
    };
  }

  private attachmentItem(a: any) {
    return { id: a.attachmentId, fileName: a.fileName, mimeType: a.mimeType, contentLength: a.contentLength };
  }

  async listPayments(q: PaymentListQueryDto) {
    const and: Prisma.XeroPaymentWhereInput[] = [{ status: { not: 'DELETED' } }];
    if (q.direction) and.push({ cashDirection: q.direction });
    if (q.contactId) and.push({ contactId: q.contactId });
    if (q.from || q.to) and.push(rangeWhere('date', q.from, q.to));
    if (q.q) and.push({ OR: [{ contactName: ins(q.q) }, { invoiceNumber: ins(q.q) }, { reference: ins(q.q) }] });
    const where = { AND: and };
    const sortField = ({ date: 'date', amount: 'amountBase' } as const)[(q.sort ?? 'date') as 'date'] ?? 'date';
    const [rows, total, ins_, outs] = await Promise.all([
      this.prisma.xeroPayment.findMany({ where, orderBy: [{ [sortField]: dir(q.dir) }, { paymentId: 'asc' }], take: lim(q.limit), skip: off(q.offset) }),
      this.prisma.xeroPayment.count({ where }),
      this.prisma.xeroPayment.aggregate({ where: { AND: [...and, { cashDirection: 'in' }] }, _sum: { amountBase: true } }),
      this.prisma.xeroPayment.aggregate({ where: { AND: [...and, { cashDirection: 'out' }] }, _sum: { amountBase: true } }),
    ]);
    return { items: rows.map((r) => this.paymentItem(r)), total, totals: { inBase: num(ins_._sum.amountBase), outBase: num(outs._sum.amountBase) } };
  }
}
```

- [ ] **Step 5: Run the service test and confirm it passes**

Run: `npx jest src/xero/finance-reports.service.spec.ts --runInBand`
Expected: PASS (6 tests). If an `AND` assertion fails on ordering, `arrayContaining` is order-insensitive, so check the shape instead (e.g. the `mode: 'insensitive'` key).

- [ ] **Step 6: Create the controller**

`src/xero/finance-reports.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { FinanceReportsService } from './finance-reports.service';
import {
  BankTxListQueryDto, ContactListQueryDto, CreditNoteListQueryDto, InvoiceListQueryDto, PaymentListQueryDto,
} from './dto/finance-query.dto';

/** Finance data is revenue and supplier spend, so Owners and Admins only. Members get 403. */
@ApiTags('finance')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@Controller('finance')
export class FinanceReportsController {
  constructor(private readonly finance: FinanceReportsService) {}

  @Get('summary') @ApiOperation({ summary: 'KPIs, aged receivables, top overdue, 6-month money in/out' })
  summary() { return this.finance.summary(); }

  @Get('contacts') listContacts(@Query() q: ContactListQueryDto) { return this.finance.listContacts(q); }
  @Get('contacts/:id') contact(@Param('id', ParseUUIDPipe) id: string) { return this.finance.contactDetail(id); }
  @Get('contacts/:id/activity') activity(@Param('id', ParseUUIDPipe) id: string) { return this.finance.contactActivity(id); }

  @Get('invoices') listInvoices(@Query() q: InvoiceListQueryDto) { return this.finance.listInvoices(q); }
  @Get('invoices/:id') invoice(@Param('id', ParseUUIDPipe) id: string) { return this.finance.invoiceDetail(id); }

  @Get('bank-transactions') listBank(@Query() q: BankTxListQueryDto) { return this.finance.listBankTransactions(q); }
  @Get('bank-transactions/:id') bankTx(@Param('id', ParseUUIDPipe) id: string) { return this.finance.bankTransactionDetail(id); }

  @Get('credit-notes') listCreditNotes(@Query() q: CreditNoteListQueryDto) { return this.finance.listCreditNotes(q); }
  @Get('credit-notes/:id') creditNote(@Param('id', ParseUUIDPipe) id: string) { return this.finance.creditNoteDetail(id); }

  @Get('payments') listPayments(@Query() q: PaymentListQueryDto) { return this.finance.listPayments(q); }
}
```

In `src/xero/xero.module.ts`, add `FinanceReportsController` to `controllers` and `FinanceReportsService` to `providers`.

- [ ] **Step 7: Run the full suite, the build, and a role check against the running app**

Run: `npm run test && npm run build`
Expected: all pass, and the build exits 0.

Then start the backend with `npm run start:dev` and check the role gate:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/api/finance/summary
curl -s -H "x-admin-key: $ADMIN_API_KEY" http://127.0.0.1:3002/api/finance/summary | head -c 400
curl -s -o /dev/null -w "%{http_code}\n" -H "x-admin-key: $ADMIN_API_KEY" "http://127.0.0.1:3002/api/finance/invoices?type=NOPE"
```

Expected:
- `401` without credentials.
- Summary JSON with zeros while the tables are empty.
- `400` for the invalid `type`.

- [ ] **Step 8: Commit**

```bash
git add src/xero/dto src/xero/finance-reports.service.ts src/xero/finance-reports.service.spec.ts src/xero/finance-reports.controller.ts src/xero/xero.module.ts
git commit -m "feat(xero): /api/finance read API (summary, lists, details, activity)"
```

---

### Task 11: Frontend API, hooks and the Settings → Xero tab

The web app has no unit-test harness. For frontend tasks, the gates are `npm run build:web` (the type check plus the Vite build), `npm run lint --workspace=apps/web`, and the manual checks listed.

**Files:**
- Create: `apps/web/src/api/finance.ts`
- Create: `apps/web/src/hooks/useFinance.ts`
- Create: `apps/web/src/components/finance/XeroSettingsTab.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes the backend routes from Tasks 6 and 10.
- Produces:
  - Types: `XeroStatus`, `FinanceSummary`, `ContactListItem`, `ContactDetail`, `ActivityItem`, `InvoiceListItem`, `InvoiceDetail`, `BankTxListItem`, `BankTxDetail`, `CreditNoteListItem`, `CreditNoteDetail`, `PaymentListItem`, `LineItem`, `AttachmentItem`, `Page<T, Totals>`.
  - `xeroApi` and `financeApi`.
  - Hooks: `useXeroStatus`, `useConnectXero`, `useDisconnectXero`, `useXeroSyncNow`, `useFinanceSummary`, `useFinanceContacts`, `useFinanceInvoices`, `useFinanceBankTx`, `useFinanceCreditNotes`, `useFinancePayments`, `useFinanceContact`, `useContactActivity`, `useFinanceInvoice`, `useFinanceBankTxDetail`, `useFinanceCreditNote`.
  - Component `<XeroSettingsTab flash onFlashShown />`.
- **Note:** `DataTable<T>` requires `T extends { [key: string]: unknown }`. TypeScript `interface`s don't satisfy an index signature, so every row shape here is a `type` alias.

- [ ] **Step 1: API types and client**

`apps/web/src/api/finance.ts`:

```ts
import { apiClient } from './client';

export type XeroConnStatus = 'CONNECTED' | 'NEEDS_RECONNECT' | 'DISCONNECTED';

export type XeroEntityState = {
  entity: string; status: string; recordsUpserted: number; lastRunAt: string | null;
  lastSuccessAt: string | null; watermark: string | null; lastError: string | null;
};

export type XeroStatus = {
  configured: boolean; encryptionEnabled: boolean; redirectUri: string; scopes: string[]; status: XeroConnStatus;
  tenantName: string | null; tenantId: string | null; baseCurrency: string | null; connectedAt: string | null;
  connectedByEmail: string | null; refreshedAt: string | null; lastError: string | null; dayCallsRemaining: number | null;
  syncing: boolean; entities: XeroEntityState[];
};

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export type FinanceSummary = {
  baseCurrency: string | null;
  owedToYou: { amount: number; count: number };
  overdue: { amount: number; count: number; oldestDays: number | null };
  youOwe: { amount: number; count: number; nextDueDate: string | null };
  moneyInMonth: number;
  moneyOutMonth: number;
  aging: { bucket: AgingBucket; amount: number }[];
  topOverdue: { contactId: string; contactName: string; amount: number; invoices: number; oldestDays: number }[];
  series: { month: string; in: number; out: number }[];
};

export type Page<T, Totals = undefined> = { items: T[]; total: number; totals?: Totals };

export type ContactListItem = {
  id: string; name: string; email: string | null; person: string | null; isCustomer: boolean; isSupplier: boolean;
  archived: boolean; defaultCurrency: string | null; owed: number; overdue: number; owing: number; lastActivity: string | null;
};

export type ContactDetail = ContactListItem & {
  firstName: string | null; lastName: string | null; taxNumber: string | null;
  phones: { PhoneType?: string; PhoneNumber?: string; PhoneAreaCode?: string; PhoneCountryCode?: string }[];
  addresses: { AddressType?: string; AddressLine1?: string; City?: string; Region?: string; PostalCode?: string; Country?: string }[];
  kpis: { billed: number; owed: number; overdue: number; spend: number };
  counts: { invoices: number; bills: number; bank: number; creditNotes: number; payments: number };
  xeroUrl: string;
};

export type ActivityItem = {
  kind: 'invoice' | 'bill' | 'payment' | 'bank' | 'creditNote'; id: string; date: string | null; title: string;
  amount: number; currencyCode: string | null; status: string;
};

export type LineItem = {
  description: string | null; quantity: number | null; unitAmount: number | null; accountCode: string | null;
  taxType: string | null; taxAmount: number | null; lineAmount: number | null;
};
export type AttachmentItem = { id: string; fileName: string; mimeType: string | null; contentLength: number | null };

export type InvoiceListItem = {
  id: string; type: 'ACCREC' | 'ACCPAY'; number: string | null; reference: string | null; contactId: string | null;
  contactName: string | null; status: string; overdue: boolean; overdueDays: number; partPaid: boolean;
  date: string | null; dueDate: string | null; currencyCode: string; total: number; amountDue: number; amountPaid: number;
  totalBase: number; amountDueBase: number; hasAttachments: boolean;
};

export type PaymentListItem = {
  id: string; paymentType: string; direction: 'in' | 'out' | null; status: string; invoiceId: string | null;
  invoiceNumber: string | null; creditNoteId: string | null; creditNoteNumber: string | null; contactId: string | null;
  contactName: string | null; date: string | null; currencyCode: string | null; amount: number; amountBase: number;
  bankAccountName: string | null; reference: string | null;
};

export type InvoiceDetail = InvoiceListItem & {
  currencyRate: number; subTotal: number; totalTax: number; amountCredited: number; lineItems: LineItem[];
  payments: PaymentListItem[]; attachments: AttachmentItem[]; updatedDateUtc: string | null; xeroUrl: string;
};

export type BankTxListItem = {
  id: string; type: string; direction: 'in' | 'out' | 'transfer'; contactId: string | null; contactName: string | null;
  reference: string | null; description: string | null; accountCode: string | null; bankAccountName: string | null;
  status: string; isReconciled: boolean; date: string | null; currencyCode: string; total: number; totalBase: number;
  hasAttachments: boolean;
};
export type BankTxDetail = BankTxListItem & { lineItems: LineItem[]; attachments: AttachmentItem[]; xeroUrl: string };

export type CreditNoteListItem = {
  id: string; type: 'ACCRECCREDIT' | 'ACCPAYCREDIT' | string; number: string | null; reference: string | null;
  contactId: string | null; contactName: string | null; status: string; date: string | null; currencyCode: string;
  total: number; remainingCredit: number; totalBase: number;
};
export type CreditNoteDetail = CreditNoteListItem & {
  lineItems: LineItem[]; payments: PaymentListItem[]; attachments: AttachmentItem[]; xeroUrl: string;
};

type Paging = { limit?: number; offset?: number; q?: string; dir?: 'asc' | 'desc'; sort?: string };
type Range = Paging & { from?: string; to?: string; contactId?: string };
export type ContactListParams = Paging & { role?: 'customer' | 'supplier'; archived?: boolean };
export type InvoiceListParams = Range & { type: 'ACCREC' | 'ACCPAY'; status?: string; currency?: string };
export type BankTxListParams = Range & { type?: 'SPEND' | 'RECEIVE'; reconciled?: boolean };
export type CreditNoteListParams = Range;
export type PaymentListParams = Range & { direction?: 'in' | 'out' };

const get = <T,>(url: string, params?: object): Promise<T> => apiClient.get(url, { params }).then((r) => r.data);

export const xeroApi = {
  status: () => get<XeroStatus>('/xero/status'),
  connect: (): Promise<{ url: string }> => apiClient.post('/xero/connect').then((r) => r.data),
  disconnect: (): Promise<{ disconnected: true }> => apiClient.delete('/xero/connection').then((r) => r.data),
  sync: (): Promise<{ queued: true }> => apiClient.post('/xero/sync').then((r) => r.data),
};

export const financeApi = {
  summary: () => get<FinanceSummary>('/finance/summary'),
  contacts: (p: ContactListParams) => get<Page<ContactListItem>>('/finance/contacts', p),
  contact: (id: string) => get<ContactDetail>(`/finance/contacts/${id}`),
  contactActivity: (id: string) => get<{ items: ActivityItem[] }>(`/finance/contacts/${id}/activity`),
  invoices: (p: InvoiceListParams) => get<Page<InvoiceListItem, { totalBase: number; amountDueBase: number }>>('/finance/invoices', p),
  invoice: (id: string) => get<InvoiceDetail>(`/finance/invoices/${id}`),
  bankTransactions: (p: BankTxListParams) => get<Page<BankTxListItem, { spentBase: number; receivedBase: number }>>('/finance/bank-transactions', p),
  bankTransaction: (id: string) => get<BankTxDetail>(`/finance/bank-transactions/${id}`),
  creditNotes: (p: CreditNoteListParams) => get<Page<CreditNoteListItem, { totalBase: number }>>('/finance/credit-notes', p),
  creditNote: (id: string) => get<CreditNoteDetail>(`/finance/credit-notes/${id}`),
  payments: (p: PaymentListParams) => get<Page<PaymentListItem, { inBase: number; outBase: number }>>('/finance/payments', p),
};
```

- [ ] **Step 2: Hooks**

`apps/web/src/hooks/useFinance.ts`:

```ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  financeApi, xeroApi, type BankTxListParams, type ContactListParams, type CreditNoteListParams, type InvoiceListParams,
  type PaymentListParams,
} from '../api/finance';

export function useXeroStatus(enabled = true) {
  return useQuery({
    queryKey: ['xero', 'status'],
    queryFn: xeroApi.status,
    enabled,
    // Poll while a sync runs so the Settings progress rows and the "Synced N min ago" label stay live.
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : false),
  });
}

export function useConnectXero() {
  return useMutation({
    mutationFn: xeroApi.connect,
    // Full-page navigation to Xero's consent screen; Xero redirects back to /api/xero/callback.
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useDisconnectXero() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: xeroApi.disconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['xero'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
    },
  });
}

export function useXeroSyncNow() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: xeroApi.sync, onSuccess: () => qc.invalidateQueries({ queryKey: ['xero', 'status'] }) });
}

export const useFinanceSummary = (enabled = true) =>
  useQuery({ queryKey: ['finance', 'summary'], queryFn: financeApi.summary, enabled });

export const useFinanceContacts = (p: ContactListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'contacts', p], queryFn: () => financeApi.contacts(p), enabled, placeholderData: keepPreviousData });

export const useFinanceInvoices = (p: InvoiceListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'invoices', p], queryFn: () => financeApi.invoices(p), enabled, placeholderData: keepPreviousData });

export const useFinanceBankTx = (p: BankTxListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'bank', p], queryFn: () => financeApi.bankTransactions(p), enabled, placeholderData: keepPreviousData });

export const useFinanceCreditNotes = (p: CreditNoteListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'credits', p], queryFn: () => financeApi.creditNotes(p), enabled, placeholderData: keepPreviousData });

export const useFinancePayments = (p: PaymentListParams, enabled = true) =>
  useQuery({ queryKey: ['finance', 'payments', p], queryFn: () => financeApi.payments(p), enabled, placeholderData: keepPreviousData });

export const useFinanceContact = (id: string | null) =>
  useQuery({ queryKey: ['finance', 'contact', id], queryFn: () => financeApi.contact(id!), enabled: !!id });

export const useContactActivity = (id: string | null, enabled = true) =>
  useQuery({ queryKey: ['finance', 'contact-activity', id], queryFn: () => financeApi.contactActivity(id!), enabled: !!id && enabled });

export const useFinanceInvoice = (id: string | null) =>
  useQuery({ queryKey: ['finance', 'invoice', id], queryFn: () => financeApi.invoice(id!), enabled: !!id });

export const useFinanceBankTxDetail = (id: string | null) =>
  useQuery({ queryKey: ['finance', 'bank-tx', id], queryFn: () => financeApi.bankTransaction(id!), enabled: !!id });

export const useFinanceCreditNote = (id: string | null) =>
  useQuery({ queryKey: ['finance', 'credit-note', id], queryFn: () => financeApi.creditNote(id!), enabled: !!id });
```

- [ ] **Step 3: The Settings → Xero tab**

`apps/web/src/components/finance/XeroSettingsTab.tsx`. Its layout, copy and states match the approved prototype's Settings screen.

```tsx
import { useEffect, useState } from 'react';
import { AlertTriangle, CircleCheck, Link2, Lock, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { Callout } from '../ui/Callout';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useConnectXero, useDisconnectXero, useXeroStatus, useXeroSyncNow } from '../../hooks/useFinance';
import { fmt } from '../../lib/formatters';
import type { XeroEntityState } from '../../api/finance';

export type XeroFlash = { result: 'connected' | 'error'; reason?: string } | null;

/** Copy for the ?xero=error&reason= codes produced by XeroAuthService.handleCallback. */
const REASONS: Record<string, string> = {
  cancelled: "The Xero consent screen was cancelled, so nothing was saved. Select Connect to Xero to try again.",
  state: 'That connect link expired or was already used. Start again from this page.',
  exchange: "Xero didn't finish the sign-in. Try again. If it keeps failing, check that the redirect URI on the Xero app matches exactly.",
  no_tenant: 'No Xero organisation was chosen. On the Xero screen, pick your organisation.',
  multiple_tenants: 'More than one organisation was chosen. Clicksy supports one. Reconnect and pick just one.',
  different_org: "That's a different Xero organisation from the one already synced. Mixing two sets of books isn't allowed. See the OPERATIONS runbook to switch organisations.",
  xero_error: 'Xero returned an error. Try again in a minute.',
};

const ENTITY_LABELS: Record<string, string> = {
  contacts: 'Contacts', invoices: 'Invoices & bills', creditNotes: 'Credit notes', bankTransactions: 'Bank transactions',
  payments: 'Payments', attachments: 'Attachment lists',
};

function XeroMark({ size = 44 }: { size?: number }) {
  return (
    <div aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: '#13B5EA', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: size * 0.48, flexShrink: 0 }}>
      x
    </div>
  );
}

function entityPill(s: XeroEntityState) {
  if (s.status === 'RUNNING') return <Pill tone="blue">Syncing</Pill>;
  if (s.status === 'OK') return <Pill tone="green">Up to date</Pill>;
  if (s.status === 'RATE_LIMITED') return <Pill tone="amber">Paused · daily limit</Pill>;
  if (s.status === 'NEEDS_RECONNECT') return <Pill tone="red">Paused</Pill>;
  if (s.status === 'FAILED') return <Pill tone="red">Failed · retrying</Pill>;
  return <Pill tone="gray">Queued</Pill>;
}

export function XeroSettingsTab({ flash, onFlashShown }: { flash: XeroFlash; onFlashShown: () => void }) {
  const { hasRole } = useAuth();
  const isOwner = hasRole('OWNER');
  const toast = useToast();
  const status = useXeroStatus();
  const connect = useConnectXero();
  const disconnect = useDisconnectXero();
  const syncNow = useXeroSyncNow();
  const [banner] = useState<XeroFlash>(flash); // keep the banner after the URL param is cleared
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!flash) return;
    if (flash.result === 'connected') toast.show('Connected to Xero. The first sync has started.', 'green');
    onFlashShown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = status.data;
  if (status.isLoading || !s) return <Card><div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading Xero status…</div></Card>;

  if (!s.configured) {
    return (
      <Callout tone="neutral" icon={<Lock size={13} />}>
        Xero isn't configured on this server. Set <code>XERO_CLIENT_ID</code> and <code>XERO_CLIENT_SECRET</code>, register the redirect URI{' '}
        <code>{s.redirectUri}</code> on the Xero app, then restart the backend.
      </Callout>
    );
  }

  const errorBanner = banner?.result === 'error' && (
    <Callout tone="red" icon={<AlertTriangle size={13} />}>
      <b>Xero didn't finish connecting.</b> {REASONS[banner.reason ?? ''] ?? REASONS.xero_error}
    </Callout>
  );
  const viewOnly = !isOwner && (
    <Callout tone="amber" icon={<Lock size={13} />}>
      <b>View only.</b> Only an Owner can connect or disconnect Xero. You can still see sync status and use the Finance page.
    </Callout>
  );
  const connectBtn = (label: string) => (
    <Button variant="accent" size="lg" icon={<Link2 size={15} />} loading={connect.isPending} disabled={!isOwner || !s.encryptionEnabled}
      onClick={() => connect.mutate(undefined, { onError: (e: any) => toast.show(e?.response?.data?.message ?? "Couldn't start the Xero connection.", 'red') })}>
      {label}
    </Button>
  );

  if (s.status === 'DISCONNECTED') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {viewOnly}
        {errorBanner}
        {!s.encryptionEnabled && (
          <Callout tone="amber" icon={<AlertTriangle size={13} />}>
            <code>APP_ENCRYPTION_KEY</code> isn't set, so the Xero sign-in can't be stored securely. Set it and restart the backend before connecting.
          </Callout>
        )}
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 18 }}>
            <XeroMark size={52} />
            <div>
              <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em' }}>Connect your Xero organisation</h2>
              <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', maxWidth: '60ch' }}>
                Bring every client's invoices, supplier bills and bank spending into Clicksy. The data is copied on a schedule, so the Finance
                page loads instantly and Grafana can report on it.
              </p>
              <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 18px' }}>
                {[
                  ['Contacts', 'Customers and suppliers, with balances'],
                  ['Invoices, bills & credit notes', 'Including line items and tax'],
                  ['Spend & receive money', 'Bank transactions and reconciliation state'],
                  ['Payments & attachment names', 'Files stay in Xero; we only link to them'],
                ].map(([t, sub]) => (
                  <li key={t} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-alt)', border: '1px solid var(--border-soft)', fontSize: 13 }}>
                    {t}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {connectBtn('Connect to Xero')}
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>You'll sign in on Xero and choose the organisation.</span>
              </div>
              <p style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 0' }}>
                <ShieldCheck size={14} /> <span><b style={{ color: 'var(--text)' }}>Read-only.</b> Clicksy can't create, edit or delete anything in Xero. The Xero sign-in is stored encrypted.</span>
              </p>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '18px 0 8px' }}>Permissions requested</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {s.scopes.map((sc) => (
                  <code key={sc} style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, background: 'var(--muted-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-soft)' }}>{sc}</code>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const needsReconnect = s.status === 'NEEDS_RECONNECT';
  const firstSync = s.syncing && s.entities.every((e) => !e.lastSuccessAt);
  const pill = needsReconnect ? <Pill tone="red">Needs reconnect</Pill> : firstSync ? <Pill tone="blue">First sync running</Pill> : <Pill tone="green">Connected</Pill>;
  const used = s.dayCallsRemaining == null ? null : 5000 - s.dayCallsRemaining;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {viewOnly}
      {errorBanner}
      {needsReconnect && (
        <Callout tone="red" icon={<AlertTriangle size={13} />}>
          <b>Xero stopped accepting our connection.</b> This happens if someone removed the app in Xero, or the sign-in went unused for 60 days.
          Synced data is kept. Reconnect with the same organisation to carry on. {isOwner && <span style={{ marginLeft: 8 }}>{connectBtn('Reconnect')}</span>}
        </Callout>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title={s.tenantName ?? 'Xero organisation'} subtitle={`Connected ${s.connectedAt ? fmt.relative(s.connectedAt) : ''}${s.connectedByEmail ? ` by ${s.connectedByEmail}` : ''}`} action={pill}>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '8px 16px', fontSize: 13, margin: 0 }}>
              <dt style={{ color: 'var(--text-muted)' }}>Base currency</dt><dd style={{ margin: 0 }}>{s.baseCurrency ?? '—'}</dd>
              <dt style={{ color: 'var(--text-muted)' }}>Tenant ID</dt><dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, overflowWrap: 'anywhere' }}>{s.tenantId}</dd>
              <dt style={{ color: 'var(--text-muted)' }}>Access</dt><dd style={{ margin: 0 }}>Read-only · {s.scopes.length} permissions</dd>
              <dt style={{ color: 'var(--text-muted)' }}>Callback URL</dt><dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, overflowWrap: 'anywhere' }}>{s.redirectUri}</dd>
            </dl>
          </Card>
          <Card
            title="Data sync"
            subtitle={firstSync ? 'Copying everything from Xero for the first time.' : 'Changes are pulled every hour. Unpaid invoices and balances are re-checked nightly at 02:00 (Dhaka).'}
            action={
              <Button size="sm" icon={<RefreshCw size={14} />} loading={syncNow.isPending} disabled={needsReconnect || s.syncing}
                onClick={() => syncNow.mutate(undefined, {
                  onSuccess: () => toast.show('Sync queued.', 'green'),
                  onError: (e: any) => toast.show(e?.response?.data?.message ?? "Couldn't start a sync.", 'red'),
                })}>
                {s.syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            }
          >
            {s.entities.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Waiting for the first sync to start…</div>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ textAlign: 'left', padding: '0 0 8px' }}>Data</th><th style={{ textAlign: 'right' }}>Records</th>
                    <th style={{ textAlign: 'left', paddingLeft: 16 }}>Last success</th><th style={{ textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {s.entities.map((e) => (
                    <tr key={e.entity} style={{ borderTop: '1px solid var(--border-soft)' }} title={e.lastError ?? undefined}>
                      <td style={{ padding: '9px 0', fontWeight: 500 }}>{ENTITY_LABELS[e.entity] ?? e.entity}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt.number(e.recordsUpserted)}</td>
                      <td style={{ paddingLeft: 16, color: 'var(--text-muted)' }}>{e.lastSuccessAt ? fmt.relative(e.lastSuccessAt) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{entityPill(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Connection health">
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '8px 16px', fontSize: 13, margin: 0 }}>
              <dt style={{ color: 'var(--text-muted)' }}>Sign-in renewed</dt>
              <dd style={{ margin: 0, textAlign: 'right', color: needsReconnect ? 'var(--red)' : undefined }}>
                {needsReconnect ? 'Rejected by Xero' : s.refreshedAt ? fmt.relative(s.refreshedAt) : '—'}
              </dd>
              <dt style={{ color: 'var(--text-muted)' }}>API calls today</dt>
              <dd style={{ margin: 0, textAlign: 'right' }}>{used == null ? '—' : `${fmt.number(used)} of 5,000`}</dd>
            </dl>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
              Xero allows 60 calls a minute and 5,000 a day. Syncs pace themselves and pause when fewer than 500 calls remain.
            </p>
          </Card>
          <Card title="Disconnect" subtitle="Stops syncing and deletes the stored Xero sign-in. Data already copied stays in Finance.">
            <Button variant="danger" icon={<Unplug size={14} />} disabled={!isOwner} onClick={() => setConfirmOpen(true)}>Disconnect Xero</Button>
          </Card>
        </div>
      </div>
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Disconnect Xero?"
        subtitle="Syncing stops and the stored Xero sign-in is deleted. Contacts and transactions already copied stay in Finance and reports. You can reconnect any time."
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => setConfirmOpen(false)}>Keep connected</Button>
            <Button variant="danger" icon={<Unplug size={14} />} loading={disconnect.isPending}
              onClick={() => disconnect.mutate(undefined, { onSuccess: () => { setConfirmOpen(false); toast.show('Xero disconnected.', 'green'); } })}>
              Disconnect
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}><CircleCheck size={14} /> Nothing in Xero is changed.</div>
      </Modal>
    </div>
  );
}
```


- [ ] **Step 4: Wire the tab into Settings with URL deep-linking**

In `apps/web/src/pages/SettingsPage.tsx`:

1. Add the imports:
   ```tsx
   import { useSearchParams } from 'react-router-dom';
   import { XeroSettingsTab, type XeroFlash } from '../components/finance/XeroSettingsTab';
   ```
2. Add to `ALL_TAB_ITEMS`, after `notifications`:
   ```tsx
     { value: 'xero', label: 'Xero', ownerOnly: false },
   ```
3. Replace `const [activeTab, setActiveTab] = useState(() => (hasRole('OWNER') ? 'connection' : 'sync'));` with:
   ```tsx
   const [searchParams, setSearchParams] = useSearchParams();
   // ?tab= is honoured only if this role may see that tab (no opening owner-only tabs by URL).
   const allowedTabs = ALL_TAB_ITEMS.filter((t) => !t.ownerOnly || hasRole('OWNER')).map((t) => t.value);
   const [activeTab, setActiveTab] = useState(() => {
     const fromUrl = searchParams.get('tab');
     if (fromUrl && allowedTabs.includes(fromUrl)) return fromUrl;
     return hasRole('OWNER') ? 'connection' : 'sync';
   });
   const xeroParam = searchParams.get('xero');
   const xeroFlash: XeroFlash =
     xeroParam === 'connected' || xeroParam === 'error' ? { result: xeroParam, reason: searchParams.get('reason') ?? undefined } : null;
   const clearXeroFlash = () => {
     const next = new URLSearchParams(searchParams);
     next.delete('xero');
     next.delete('reason');
     setSearchParams(next, { replace: true });
   };
   ```
4. Find the `{activeTab === 'notifications' && (` block (`grep -n "activeTab === 'notifications'" apps/web/src/pages/SettingsPage.tsx`). Directly after that block's closing `)}`, add:
   ```tsx
         {activeTab === 'xero' && <XeroSettingsTab flash={xeroFlash} onFlashShown={clearXeroFlash} />}
   ```

- [ ] **Step 5: Build and lint**

Run: `npm run build:web && npm run lint --workspace=apps/web`
Expected: both exit 0.

- [ ] **Step 6: Manual check (local)**

Run `npm run dev:all`, sign in as an Owner, and open `http://localhost:5173/settings?tab=xero`. Check each state:

| Setup | Expected |
|---|---|
| `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` unset | The "isn't configured" callout, showing the redirect URI. |
| Both vars set, not connected | The Connect hero. The scope chips list 10 scopes. |
| Visit `/settings?tab=xero&xero=error&reason=cancelled` | The red "cancelled" banner. The URL drops `xero` and `reason` but the banner stays. |
| Signed in as an Admin | The "View only" callout. Connect and Disconnect are disabled. |

(The real connect flow is exercised in Task 13.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/finance.ts apps/web/src/hooks/useFinance.ts apps/web/src/components/finance/XeroSettingsTab.tsx apps/web/src/pages/SettingsPage.tsx
git commit -m "feat(web): Xero settings tab with connect, status, sync-now and disconnect"
```

---

### Task 12: Finance page, drawers and navigation

**Files:**
- Create: `apps/web/src/components/finance/format.tsx`
- Create: `apps/web/src/components/finance/FinanceInsights.tsx`
- Create: `apps/web/src/components/finance/financeColumns.tsx`
- Create: `apps/web/src/components/finance/RecordDrawer.tsx`
- Create: `apps/web/src/pages/FinancePage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/components/layout/CommandPalette.tsx`

**Interfaces:**
- Consumes:
  - Every type and hook from Task 11.
  - UI kit: `PageHeader`, `MetricCard`, `DataTable`/`Column`, `Drawer`, `Pill`, `Tabs`, `Button`, `Card`, `Callout`, `EmptyState`, `QueryError`, `TableSkeleton`.
  - `exportXlsx` and `XlsxColumn` from `lib/xlsx.ts`.
- Produces:
  - Route `/finance`, restricted to Admin and above.
  - `RecordRef = { kind: 'contact' | 'invoice' | 'bank' | 'creditNote' | 'payment'; id: string; payment?: PaymentListItem }`.
  - `<RecordDrawer stack onPush onBack onClose />`.

- [ ] **Step 1: Formatting helpers and status pills**

`apps/web/src/components/finance/format.tsx`:

```tsx
import { Pill } from '../ui/Pill';
import type { InvoiceListItem } from '../../api/finance';

/**
 * Document-currency money. Unlike fmt.money (cents, narrowSymbol), finance rows mix
 * currencies, so the code must stay unambiguous: A$ / £ / $, plus a code suffix
 * for anything that isn't the base currency.
 */
export function money(n: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** Whole-unit base-currency figure for KPIs and totals. */
export function baseMoney(n: number, currency: string | null | undefined) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n);
}

export function Amount({ value, currency, base }: { value: number; currency: string | null; base: string | null }) {
  const cur = currency || base || 'USD';
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {money(value, cur)}
      {base && cur !== base && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', marginLeft: 4, fontFamily: 'var(--font-mono)' }}>{cur}</span>}
    </span>
  );
}

export function day(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Exclusive buckets, mirroring the backend filter (finance-math.invoiceStatusWhere). */
export function InvoiceStatus({ i }: { i: Pick<InvoiceListItem, 'status' | 'overdue' | 'overdueDays' | 'partPaid'> }) {
  if (i.status === 'DRAFT') return <Pill tone="gray">Draft</Pill>;
  if (i.status === 'SUBMITTED') return <Pill tone="blue">Awaiting approval</Pill>;
  if (i.status === 'PAID') return <Pill tone="green">Paid</Pill>;
  if (i.status === 'VOIDED') return <Pill tone="gray">Voided</Pill>;
  if (i.status === 'DELETED') return <Pill tone="gray">Deleted</Pill>;
  if (i.overdue) return <Pill tone="red">{`Overdue · ${i.overdueDays}d`}</Pill>;
  if (i.partPaid) return <Pill tone="amber">Part paid</Pill>;
  return <Pill tone="amber">Awaiting payment</Pill>;
}

const HUES = ['#7B68EE', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#6366f1', '#84cc16'];
export function ContactAvatar({ name, size = 30 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name.replace(/[^A-Za-z& ]/g, '').split(' ').filter((w) => w && w !== '&').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: size * 0.27, background: HUES[h % HUES.length], color: '#fff', fontSize: size * 0.36, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials || '?'}
    </span>
  );
}

export const STATUS_OPTIONS = [
  ['', 'All statuses'], ['DRAFT', 'Draft'], ['SUBMITTED', 'Awaiting approval'], ['AUTHORISED', 'Awaiting payment'],
  ['overdue', 'Overdue'], ['PAID', 'Paid'], ['VOIDED', 'Voided'],
] as const;
```

- [ ] **Step 2: KPI tiles, aged receivables and the money-flow chart**

`apps/web/src/components/finance/FinanceInsights.tsx`:

```tsx
import { MetricCard } from '../ui/MetricCard';
import { Card } from '../ui/Card';
import type { FinanceSummary } from '../../api/finance';
import { baseMoney, ContactAvatar, day } from './format';

export type KpiTarget = 'recv' | 'overdue' | 'pay' | 'in' | 'out';

export function FinanceKpis({ s, loading, onOpen }: { s?: FinanceSummary; loading: boolean; onOpen: (t: KpiTarget) => void }) {
  const cur = s?.baseCurrency ?? 'USD';
  const month = new Date().toLocaleString('en-GB', { month: 'short' });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
      <MetricCard dense loading={loading} label="Owed to you" value={baseMoney(s?.owedToYou.amount ?? 0, cur)} caption={`${s?.owedToYou.count ?? 0} unpaid invoices`} onClick={() => onOpen('recv')} />
      <MetricCard dense loading={loading} label="Overdue" value={baseMoney(s?.overdue.amount ?? 0, cur)}
        caption={`${s?.overdue.count ?? 0} invoices${s?.overdue.oldestDays ? ` · oldest ${s.overdue.oldestDays}d` : ''}`} onClick={() => onOpen('overdue')} />
      <MetricCard dense loading={loading} label="You owe" value={baseMoney(s?.youOwe.amount ?? 0, cur)}
        caption={`${s?.youOwe.count ?? 0} bills${s?.youOwe.nextDueDate ? ` · next due ${day(s.youOwe.nextDueDate)}` : ''}`} onClick={() => onOpen('pay')} />
      <MetricCard dense loading={loading} label={`Money in · ${month}`} value={baseMoney(s?.moneyInMonth ?? 0, cur)} caption="Payments + receive money" onClick={() => onOpen('in')} />
      <MetricCard dense loading={loading} label={`Money out · ${month}`} value={baseMoney(s?.moneyOutMonth ?? 0, cur)} caption="Bills paid + spend money" onClick={() => onOpen('out')} />
    </div>
  );
}

const AGING_COLORS: Record<string, string> = { current: '#10b981', '1-30': '#f59e0b', '31-60': '#f97316', '61-90': '#ef4444', '90+': '#b91c1c' };
const AGING_LABELS: Record<string, string> = { current: 'Current', '1-30': '1–30 days', '31-60': '31–60 days', '61-90': '61–90 days', '90+': '90+ days' };

export function AgedReceivables({ s, onOpenContact, onViewOverdue }: { s: FinanceSummary; onOpenContact: (id: string) => void; onViewOverdue: () => void }) {
  const cur = s.baseCurrency ?? 'USD';
  const total = s.aging.reduce((a, b) => a + b.amount, 0) || 1;
  return (
    <Card title="Aged receivables" subtitle={`Unpaid customer invoices by days past due, in ${cur}`} action={<button type="button" onClick={onViewOverdue} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>View overdue →</button>}>
      <div role="img" aria-label="Aged receivables distribution" style={{ display: 'flex', height: 14, borderRadius: 5, overflow: 'hidden', gap: 2, margin: '6px 0 12px' }}>
        {s.aging.filter((b) => b.amount > 0).map((b) => (
          <span key={b.bucket} title={`${AGING_LABELS[b.bucket]}: ${baseMoney(b.amount, cur)}`} style={{ width: `${(b.amount / total) * 100}%`, background: AGING_COLORS[b.bucket] }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 10 }}>
        {s.aging.map((b) => (
          <div key={b.bucket} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: AGING_COLORS[b.bucket], marginRight: 5 }} />
            {AGING_LABELS[b.bucket]}
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{baseMoney(b.amount, cur)}</div>
          </div>
        ))}
      </div>
      {s.topOverdue.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '16px 0 6px' }}>Most overdue</div>
          {s.topOverdue.map((c) => (
            <button key={c.contactId} type="button" onClick={() => onOpenContact(c.contactId)}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 2, width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border-soft)', padding: '8px 4px', cursor: 'pointer', color: 'var(--text)' }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><ContactAvatar name={c.contactName} size={20} />{c.contactName}</span>
              <span style={{ color: 'var(--red)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{baseMoney(c.amount, cur)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.invoices} overdue {c.invoices === 1 ? 'invoice' : 'invoices'} · oldest {c.oldestDays} days late</span>
            </button>
          ))}
        </>
      )}
    </Card>
  );
}

export function MoneyFlowChart({ s }: { s: FinanceSummary }) {
  const W = 340, H = 160, L = 34, B = 20;
  const max = Math.max(1, ...s.series.flatMap((p) => [p.in, p.out]));
  const step = max > 50000 ? 20000 : max > 20000 ? 10000 : max > 5000 ? 2500 : 1000;
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => H - B - (v / top) * (H - B - 8);
  const cw = (W - L) / s.series.length;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const cur = s.baseCurrency ?? 'USD';
  return (
    <Card title="Money in vs out" subtitle={`Last 6 months, ${cur}`}
      action={<span style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--green)', marginRight: 4 }} />In</span>
        <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', marginRight: 4 }} />Out</span>
      </span>}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Money in versus money out by month" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--border-soft)" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)">{v === 0 ? '0' : `${v / 1000}k`}</text>
          </g>
        ))}
        {s.series.map((p, i) => {
          const cx = L + cw * i + cw / 2;
          return (
            <g key={p.month}>
              <rect x={cx - 13} y={y(p.in)} width={12} height={H - B - y(p.in)} rx={2} fill="var(--green)"><title>{`${label(p.month)} in: ${baseMoney(p.in, cur)}`}</title></rect>
              <rect x={cx + 1} y={y(p.out)} width={12} height={H - B - y(p.out)} rx={2} fill="var(--accent)"><title>{`${label(p.month)} out: ${baseMoney(p.out, cur)}`}</title></rect>
              <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--text-muted)">{label(p.month)}</text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
```

- [ ] **Step 3: Table columns per tab**

`apps/web/src/components/finance/financeColumns.tsx`:

```tsx
import type { Column } from '../ui/DataTable';
import { Pill } from '../ui/Pill';
import type { BankTxListItem, ContactListItem, CreditNoteListItem, InvoiceListItem, PaymentListItem } from '../../api/finance';
import { Amount, baseMoney, ContactAvatar, day, InvoiceStatus } from './format';

const faint = <span style={{ color: 'var(--text-faint)' }}>—</span>;
const mono = (s: string | null) => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{s ?? '—'}</span>;
const who = (name: string | null) =>
  name ? <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}><ContactAvatar name={name} size={22} />{name}</span> : faint;

export function contactColumns(base: string | null): Column<ContactListItem>[] {
  return [
    { key: 'name', header: 'Contact', sortable: true, render: (c) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
        <ContactAvatar name={c.name} />
        <span><b style={{ fontWeight: 600 }}>{c.name}</b><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.person ?? c.email ?? ''}</div></span>
      </span>
    ) },
    { key: 'type', header: 'Type', render: (c) => (
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {c.isCustomer && <Pill tone="purple" size="xs">Customer</Pill>}
        {c.isSupplier && <Pill tone="blue" size="xs">Supplier</Pill>}
        {c.archived && <Pill tone="gray" size="xs">Archived</Pill>}
      </span>
    ) },
    { key: 'email', header: 'Email', render: (c) => (c.email ? <span style={{ color: 'var(--text-muted)' }}>{c.email}</span> : faint) },
    { key: 'owed', header: 'Owed to you', align: 'right', sortable: true, render: (c) => (c.owed ? baseMoney(c.owed, base) : faint) },
    { key: 'overdue', header: 'Overdue', align: 'right', sortable: true, render: (c) => (c.overdue ? <b style={{ color: 'var(--red)' }}>{baseMoney(c.overdue, base)}</b> : faint) },
    { key: 'owing', header: 'You owe', align: 'right', sortable: true, render: (c) => (c.owing ? baseMoney(c.owing, base) : faint) },
    { key: 'lastActivity', header: 'Last activity', sortable: true, render: (c) => <span style={{ color: 'var(--text-muted)' }}>{day(c.lastActivity)}</span> },
  ];
}

export function invoiceColumns(base: string | null, noun: 'Invoice' | 'Bill'): Column<InvoiceListItem>[] {
  return [
    { key: 'number', header: noun, sortable: true, render: (i) => (
      <span><span style={i.status === 'VOIDED' ? { textDecoration: 'line-through', color: 'var(--text-faint)' } : undefined}>{mono(i.number)}</span>
        {i.reference && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{i.reference}</div>}</span>
    ) },
    { key: 'contactName', header: 'Contact', sortable: true, render: (i) => who(i.contactName) },
    { key: 'date', header: 'Date', sortable: true, render: (i) => day(i.date) },
    { key: 'dueDate', header: 'Due', sortable: true, render: (i) => <span style={i.overdue ? { color: 'var(--red)' } : undefined}>{day(i.dueDate)}</span> },
    { key: 'status', header: 'Status', render: (i) => <InvoiceStatus i={i} /> },
    { key: 'total', header: 'Total', align: 'right', sortable: true, render: (i) => <Amount value={i.total} currency={i.currencyCode} base={base} /> },
    { key: 'amountDue', header: 'Amount due', align: 'right', sortable: true, render: (i) => (i.amountDue ? <Amount value={i.amountDue} currency={i.currencyCode} base={base} /> : faint) },
  ];
}

export function bankColumns(base: string | null): Column<BankTxListItem>[] {
  return [
    { key: 'date', header: 'Date', sortable: true, render: (t) => day(t.date) },
    { key: 'contactName', header: 'Payee', sortable: true, render: (t) => who(t.contactName) },
    { key: 'description', header: 'Description', render: (t) => (
      <span>{t.description ?? t.reference ?? '—'}{t.accountCode && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{t.accountCode}</div>}</span>
    ) },
    { key: 'type', header: 'Type', render: (t) =>
      t.direction === 'transfer' ? <Pill tone="gray" size="xs">Transfer</Pill>
        : t.direction === 'out' ? <Pill tone="purple" size="xs">Spend money</Pill> : <Pill tone="green" size="xs">Receive money</Pill> },
    { key: 'rec', header: 'Bank rec', render: (t) => (t.isReconciled ? <Pill tone="gray" size="xs">Reconciled</Pill> : <Pill tone="amber" size="xs">Unreconciled</Pill>) },
    { key: 'total', header: 'Amount', align: 'right', sortable: true, render: (t) => (
      <span style={{ color: t.direction === 'in' ? 'var(--green)' : undefined, fontWeight: 500 }}>
        {t.direction === 'out' ? '−' : t.direction === 'in' ? '+' : ''}<Amount value={t.total} currency={t.currencyCode} base={base} />
      </span>
    ) },
  ];
}

export function creditColumns(base: string | null): Column<CreditNoteListItem>[] {
  return [
    { key: 'number', header: 'Credit note', sortable: true, render: (n) => mono(n.number) },
    { key: 'contact', header: 'Contact', render: (n) => who(n.contactName) },
    { key: 'date', header: 'Date', sortable: true, render: (n) => day(n.date) },
    { key: 'type', header: 'Type', render: (n) => (n.type === 'ACCRECCREDIT' ? <Pill tone="purple" size="xs">Customer credit</Pill> : <Pill tone="blue" size="xs">Supplier credit</Pill>) },
    { key: 'total', header: 'Total', align: 'right', sortable: true, render: (n) => <Amount value={n.total} currency={n.currencyCode} base={base} /> },
    { key: 'remaining', header: 'Unallocated', align: 'right', render: (n) => (n.remainingCredit ? <Amount value={n.remainingCredit} currency={n.currencyCode} base={base} /> : <Pill tone="green" size="xs">Fully applied</Pill>) },
  ];
}

export function paymentColumns(base: string | null): Column<PaymentListItem>[] {
  return [
    { key: 'date', header: 'Date', sortable: true, render: (p) => day(p.date) },
    { key: 'contact', header: 'Contact', render: (p) => who(p.contactName) },
    { key: 'doc', header: 'Applied to', render: (p) => mono(p.invoiceNumber ?? p.creditNoteNumber) },
    { key: 'direction', header: 'Direction', render: (p) =>
      p.direction === 'in' ? <Pill tone="green" size="xs">Received</Pill> : p.direction === 'out' ? <Pill tone="purple" size="xs">Paid out</Pill> : <Pill tone="gray" size="xs">Allocation</Pill> },
    { key: 'account', header: 'Bank account', render: (p) => <span style={{ color: 'var(--text-muted)' }}>{p.bankAccountName ?? '—'}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (p) => <Amount value={p.amount} currency={p.currencyCode} base={base} /> },
  ];
}
```

- [ ] **Step 4: The record drawer (contact, invoice/bill, bank transaction, credit note, payment)**

`apps/web/src/components/finance/RecordDrawer.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { ArrowLeft, ExternalLink, FileText, Paperclip } from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { Tabs } from '../ui/Tabs';
import {
  useContactActivity, useFinanceBankTx, useFinanceBankTxDetail, useFinanceContact, useFinanceCreditNote, useFinanceCreditNotes,
  useFinanceInvoice, useFinanceInvoices, useFinancePayments,
} from '../../hooks/useFinance';
import type { AttachmentItem, LineItem, PaymentListItem } from '../../api/finance';
import { Amount, baseMoney, ContactAvatar, day, InvoiceStatus, money } from './format';

export type RecordRef = { kind: 'contact' | 'invoice' | 'bank' | 'creditNote' | 'payment'; id: string; payment?: PaymentListItem };

const label = (t: string) => <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '18px 0 8px' }}>{t}</div>;
const Facts = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px 18px', padding: '14px 0', borderBlock: '1px solid var(--border-soft)', margin: '0 0 12px' }}>
    {rows.map(([k, v]) => (
      <div key={k} style={{ minWidth: 0 }}>
        <dt style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</dt>
        <dd style={{ margin: 0, fontSize: 13, overflowWrap: 'anywhere' }}>{v ?? '—'}</dd>
      </div>
    ))}
  </dl>
);
const Row = ({ onClick, top, right, sub }: { onClick: () => void; top: ReactNode; right: ReactNode; sub: ReactNode }) => (
  <button type="button" onClick={onClick} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '4px 12px', width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--border-soft)', padding: '10px 6px', cursor: 'pointer', color: 'var(--text)', borderRadius: 6 }}>
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, minWidth: 0 }}>{top}</span>
    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{right}</span>
    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</span>
  </button>
);

function LinesTable({ lines, currency }: { lines: LineItem[]; currency: string }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
        <thead><tr style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          <th style={{ textAlign: 'left', padding: 6 }}>Description</th><th style={{ textAlign: 'left', padding: 6 }}>Account</th>
          <th style={{ textAlign: 'left', padding: 6 }}>Tax</th><th style={{ textAlign: 'right', padding: 6 }}>Qty</th>
          <th style={{ textAlign: 'right', padding: 6 }}>Unit</th><th style={{ textAlign: 'right', padding: 6 }}>Amount</th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
              <td style={{ padding: 8 }}>{l.description ?? '—'}</td>
              <td style={{ padding: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{l.accountCode ?? '—'}</td>
              <td style={{ padding: 8, color: 'var(--text-muted)' }}>{l.taxType ?? '—'}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{l.quantity ?? '—'}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{l.unitAmount != null ? money(l.unitAmount, currency) : '—'}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{l.lineAmount != null ? money(l.lineAmount, currency) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Attachments({ items, xeroUrl }: { items: AttachmentItem[]; xeroUrl: string }) {
  if (!items.length) return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No attachments.</p>;
  return (
    <>
      {items.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border-soft)', borderRadius: 8, fontSize: 13, marginBottom: 6 }}>
          <Paperclip size={14} /><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fileName}</span>
          {a.contentLength != null && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{Math.max(1, Math.round(a.contentLength / 1024))} KB</span>}
          <a href={xeroUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Open in Xero</a>
        </div>
      ))}
    </>
  );
}

function PaymentsList({ items, onPush }: { items: PaymentListItem[]; onPush: (r: RecordRef) => void }) {
  if (!items.length) return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No payments recorded yet.</p>;
  return <>{items.map((p) => (
    <Row key={p.id} onClick={() => onPush({ kind: 'payment', id: p.id, payment: p })}
      top={`${p.direction === 'out' ? 'Paid' : 'Received'} · ${p.invoiceNumber ?? p.creditNoteNumber ?? ''}`}
      right={money(p.amount, p.currencyCode ?? 'USD')} sub={`${day(p.date)}${p.reference ? ` · ${p.reference}` : ''}`} />
  ))}</>;
}

type SubTab = 'invoices' | 'bills' | 'bank' | 'credits' | 'payments' | 'activity';

function ContactView({ id, onPush, base }: { id: string; onPush: (r: RecordRef) => void; base: string | null }) {
  const c = useFinanceContact(id);
  const [tab, setTab] = useState<SubTab>('invoices');
  const lp = { contactId: id, limit: 50 };
  const inv = useFinanceInvoices({ ...lp, type: 'ACCREC' }, tab === 'invoices');
  const bills = useFinanceInvoices({ ...lp, type: 'ACCPAY' }, tab === 'bills');
  const bank = useFinanceBankTx(lp, tab === 'bank');
  const credits = useFinanceCreditNotes(lp, tab === 'credits');
  const pays = useFinancePayments(lp, tab === 'payments');
  const act = useContactActivity(id, tab === 'activity');
  if (!c.data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  const d = c.data;
  const phone = d.phones.find((p) => p.PhoneNumber);
  const addr = d.addresses.find((a) => a.AddressLine1 || a.City);
  const tabs: { value: SubTab; label: string; count?: number }[] = [
    { value: 'invoices', label: 'Invoices', count: d.counts.invoices }, { value: 'bills', label: 'Bills', count: d.counts.bills },
    { value: 'bank', label: 'Bank', count: d.counts.bank }, { value: 'credits', label: 'Credit notes', count: d.counts.creditNotes },
    { value: 'payments', label: 'Payments', count: d.counts.payments }, { value: 'activity', label: 'Activity' },
  ];
  const docRows = (rows?: { id: string; number: string | null; date: string | null; dueDate: string | null; reference: string | null; total: number; currencyCode: string; status: string; overdue: boolean; overdueDays: number; partPaid: boolean }[]) =>
    rows?.length ? rows.map((r) => (
      <Row key={r.id} onClick={() => onPush({ kind: 'invoice', id: r.id })} top={<><span style={{ fontFamily: 'var(--font-mono)' }}>{r.number ?? '—'}</span><InvoiceStatus i={r} /></>}
        right={money(r.total, r.currencyCode)} sub={`${day(r.date)} · due ${day(r.dueDate)}${r.reference ? ` · ${r.reference}` : ''}`} />
    )) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing here yet.</p>;
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
        <ContactAvatar name={d.name} size={44} />
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 6px', letterSpacing: '-0.02em' }}>{d.name}</h2>
          <span style={{ display: 'flex', gap: 4 }}>
            {d.isCustomer && <Pill tone="purple">Customer</Pill>}{d.isSupplier && <Pill tone="blue">Supplier</Pill>}{d.archived && <Pill tone="gray">Archived</Pill>}
          </span>
        </div>
      </div>
      <Facts rows={[
        ['Contact person', d.person], ['Email', d.email ? <a href={`mailto:${d.email}`}>{d.email}</a> : null],
        ['Phone', phone ? [phone.PhoneCountryCode, phone.PhoneAreaCode, phone.PhoneNumber].filter(Boolean).join(' ') : null],
        ['Address', addr ? [addr.AddressLine1, addr.City, addr.Region, addr.Country].filter(Boolean).join(', ') : null],
        ['Tax number', d.taxNumber], ['Default currency', d.defaultCurrency],
      ]} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 16 }}>
        {([['Lifetime billed', d.kpis.billed], ['Owed to you', d.kpis.owed], ['Overdue', d.kpis.overdue], ['Lifetime spend', d.kpis.spend]] as const).map(([k, v]) => (
          <div key={k} style={{ background: 'var(--surface-alt)', border: '1px solid var(--border-soft)', borderRadius: 8, padding: '9px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
            <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums', color: k === 'Overdue' && v > 0 ? 'var(--red)' : undefined }}>{baseMoney(v, base)}</b>
          </div>
        ))}
      </div>
      <Tabs variant="segmented" items={tabs} value={tab} onChange={(v) => setTab(v as SubTab)} ariaLabel="Contact records" />
      <div style={{ marginTop: 10 }}>
        {tab === 'invoices' && docRows(inv.data?.items)}
        {tab === 'bills' && docRows(bills.data?.items)}
        {tab === 'bank' && (bank.data?.items.length ? bank.data.items.map((t) => (
          <Row key={t.id} onClick={() => onPush({ kind: 'bank', id: t.id })} top={t.description ?? t.reference ?? 'Bank transaction'}
            right={`${t.direction === 'out' ? '−' : '+'}${money(t.total, t.currencyCode)}`} sub={day(t.date)} />
        )) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing here yet.</p>)}
        {tab === 'credits' && (credits.data?.items.length ? credits.data.items.map((n) => (
          <Row key={n.id} onClick={() => onPush({ kind: 'creditNote', id: n.id })} top={<span style={{ fontFamily: 'var(--font-mono)' }}>{n.number}</span>}
            right={money(n.total, n.currencyCode)} sub={day(n.date)} />
        )) : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nothing here yet.</p>)}
        {tab === 'payments' && <PaymentsList items={pays.data?.items ?? []} onPush={onPush} />}
        {tab === 'activity' && (
          <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 0 14px', borderLeft: '2px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {(act.data?.items ?? []).map((a) => (
              <li key={`${a.kind}-${a.id}`} style={{ fontSize: 13 }}>{a.title}
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{day(a.date)} · {money(a.amount, a.currencyCode ?? 'USD')} · {a.status.toLowerCase()}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function InvoiceView({ id, onPush }: { id: string; onPush: (r: RecordRef) => void }) {
  const q = useFinanceInvoice(id);
  if (!q.data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  const d = q.data;
  const cur = d.currencyCode;
  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
        <FileText size={28} color="var(--text-muted)" />
        <div><h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 17, margin: '0 0 6px' }}>{d.number ?? '—'}</h2>
          <span style={{ display: 'flex', gap: 4 }}><InvoiceStatus i={d} /><Pill tone="gray">{d.type === 'ACCREC' ? 'Sales invoice' : 'Purchase bill'}</Pill></span></div>
      </div>
      <Facts rows={[
        [d.type === 'ACCREC' ? 'To' : 'From', d.contactId ? <a href="#" onClick={(e) => { e.preventDefault(); onPush({ kind: 'contact', id: d.contactId! }); }}>{d.contactName}</a> : d.contactName],
        ['Reference', d.reference], ['Date', day(d.date)],
        ['Due date', <span style={d.overdue ? { color: 'var(--red)' } : undefined}>{day(d.dueDate)}{d.overdue ? ` · ${d.overdueDays} days late` : ''}</span>],
        ['Currency', `${cur}${d.currencyRate !== 1 ? ` · rate ${d.currencyRate}` : ''}`],
        ['Last changed in Xero', d.updatedDateUtc ? new Date(d.updatedDateUtc).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null],
      ]} />
      {label('Line items')}
      <LinesTable lines={d.lineItems} currency={cur} />
      <div style={{ marginLeft: 'auto', width: 'min(280px, 100%)', display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 16px', fontSize: 13, margin: '12px 0 0 auto' }}>
        <span style={{ color: 'var(--text-muted)' }}>Subtotal</span><span>{money(d.subTotal, cur)}</span>
        <span style={{ color: 'var(--text-muted)' }}>Tax</span><span>{money(d.totalTax, cur)}</span>
        <b style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>Total {cur}</b><b style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>{money(d.total, cur)}</b>
        {d.amountPaid > 0 && <><span style={{ color: 'var(--text-muted)' }}>Less payments</span><span>−{money(d.amountPaid, cur)}</span></>}
        {d.amountCredited > 0 && <><span style={{ color: 'var(--text-muted)' }}>Less credits</span><span>−{money(d.amountCredited, cur)}</span></>}
        <b>Amount due</b><b>{money(d.amountDue, cur)}</b>
      </div>
      {label('Payments')}<PaymentsList items={d.payments} onPush={onPush} />
      {label('Attachments')}<Attachments items={d.attachments} xeroUrl={d.xeroUrl} />
    </>
  );
}

function BankView({ id, onPush }: { id: string; onPush: (r: RecordRef) => void }) {
  const q = useFinanceBankTxDetail(id);
  if (!q.data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  const t = q.data;
  return (
    <>
      <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 6px' }}>{t.description ?? t.reference ?? 'Bank transaction'}</h2>
      <span style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <Pill tone={t.direction === 'in' ? 'green' : t.direction === 'out' ? 'purple' : 'gray'}>{t.direction === 'in' ? 'Receive money' : t.direction === 'out' ? 'Spend money' : 'Transfer'}</Pill>
        {t.isReconciled ? <Pill tone="gray">Reconciled</Pill> : <Pill tone="amber">Unreconciled</Pill>}
      </span>
      <Facts rows={[
        [t.direction === 'in' ? 'Received from' : 'Paid to', t.contactId ? <a href="#" onClick={(e) => { e.preventDefault(); onPush({ kind: 'contact', id: t.contactId! }); }}>{t.contactName}</a> : t.contactName],
        ['Date', day(t.date)], ['Bank account', t.bankAccountName], ['Reference', t.reference],
      ]} />
      {label('Line items')}<LinesTable lines={t.lineItems} currency={t.currencyCode} />
      {label('Attachments')}<Attachments items={t.attachments} xeroUrl={t.xeroUrl} />
    </>
  );
}

function CreditNoteView({ id, onPush }: { id: string; onPush: (r: RecordRef) => void }) {
  const q = useFinanceCreditNote(id);
  if (!q.data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  const n = q.data;
  return (
    <>
      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 17, margin: '0 0 6px' }}>{n.number ?? '—'}</h2>
      <span style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <Pill tone={n.type === 'ACCRECCREDIT' ? 'purple' : 'blue'}>{n.type === 'ACCRECCREDIT' ? 'Customer credit' : 'Supplier credit'}</Pill>
        {n.remainingCredit ? <Pill tone="amber">{`Unallocated ${money(n.remainingCredit, n.currencyCode)}`}</Pill> : <Pill tone="green">Fully applied</Pill>}
      </span>
      <Facts rows={[['Contact', n.contactName], ['Date', day(n.date)], ['Reference', n.reference], ['Total', money(n.total, n.currencyCode)]]} />
      {label('Line items')}<LinesTable lines={n.lineItems} currency={n.currencyCode} />
      {label('Payments')}<PaymentsList items={n.payments} onPush={onPush} />
      {label('Attachments')}<Attachments items={n.attachments} xeroUrl={n.xeroUrl} />
    </>
  );
}

function PaymentView({ p, onPush }: { p: PaymentListItem; onPush: (r: RecordRef) => void }) {
  return (
    <>
      <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 12px' }}>{money(p.amount, p.currencyCode ?? 'USD')} {p.direction === 'out' ? 'paid' : 'received'}</h2>
      <Facts rows={[
        ['Applied to', p.invoiceId ? <a href="#" onClick={(e) => { e.preventDefault(); onPush({ kind: 'invoice', id: p.invoiceId! }); }}>{p.invoiceNumber}</a>
          : p.creditNoteId ? <a href="#" onClick={(e) => { e.preventDefault(); onPush({ kind: 'creditNote', id: p.creditNoteId! }); }}>{p.creditNoteNumber}</a> : null],
        ['Contact', p.contactName], ['Date', day(p.date)], ['Bank account', p.bankAccountName], ['Reference', p.reference],
      ]} />
    </>
  );
}

const TITLE: Record<RecordRef['kind'], string> = { contact: 'Contact', invoice: 'Invoice', bank: 'Bank transaction', creditNote: 'Credit note', payment: 'Payment' };

export function RecordDrawer({ stack, onPush, onBack, onClose, xeroUrlFor, base }: {
  stack: RecordRef[]; onPush: (r: RecordRef) => void; onBack: () => void; onClose: () => void; base: string | null;
  xeroUrlFor?: (r: RecordRef) => string | undefined;
}) {
  const top = stack[stack.length - 1];
  const contact = useFinanceContact(top?.kind === 'contact' ? top.id : null);
  const invoice = useFinanceInvoice(top?.kind === 'invoice' ? top.id : null);
  const bank = useFinanceBankTxDetail(top?.kind === 'bank' ? top.id : null);
  const credit = useFinanceCreditNote(top?.kind === 'creditNote' ? top.id : null);
  const xeroUrl = contact.data?.xeroUrl ?? invoice.data?.xeroUrl ?? bank.data?.xeroUrl ?? credit.data?.xeroUrl ?? (top && xeroUrlFor?.(top));
  return (
    <Drawer open={!!top} onClose={onClose} width={600} title={top ? TITLE[top.kind] : ''}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
          {stack.length > 1 ? <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>Back</Button> : <span />}
          {xeroUrl && <a href={xeroUrl} target="_blank" rel="noreferrer"><Button icon={<ExternalLink size={14} />}>Open in Xero</Button></a>}
        </div>
      }>
      {top?.kind === 'contact' && <ContactView key={top.id} id={top.id} onPush={onPush} base={base} />}
      {top?.kind === 'invoice' && <InvoiceView key={top.id} id={top.id} onPush={onPush} />}
      {top?.kind === 'bank' && <BankView key={top.id} id={top.id} onPush={onPush} />}
      {top?.kind === 'creditNote' && <CreditNoteView key={top.id} id={top.id} onPush={onPush} />}
      {top?.kind === 'payment' && top.payment && <PaymentView p={top.payment} onPush={onPush} />}
    </Drawer>
  );
}

// Re-exported for the page's export columns.
export { Amount };
```

- [ ] **Step 5: The page**

`apps/web/src/pages/FinancePage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Download, Landmark, Lock, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Callout } from '../components/ui/Callout';
import { Pill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';
import { QueryError } from '../components/ui/QueryError';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { DataTable } from '../components/ui/DataTable';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../hooks/useAuth';
import {
  useFinanceBankTx, useFinanceContacts, useFinanceCreditNotes, useFinanceInvoices, useFinancePayments, useFinanceSummary,
  useXeroStatus, useXeroSyncNow,
} from '../hooks/useFinance';
import { financeApi } from '../api/finance';
import { exportXlsx, type XlsxColumn } from '../lib/xlsx';
import { fmt } from '../lib/formatters';
import { AgedReceivables, FinanceKpis, MoneyFlowChart, type KpiTarget } from '../components/finance/FinanceInsights';
import { bankColumns, contactColumns, creditColumns, invoiceColumns, paymentColumns } from '../components/finance/financeColumns';
import { RecordDrawer, type RecordRef } from '../components/finance/RecordDrawer';
import { baseMoney, STATUS_OPTIONS } from '../components/finance/format';

type Tab = 'contacts' | 'invoices' | 'bills' | 'bank' | 'credits' | 'payments';
type Filters = { q: string; role: '' | 'customer' | 'supplier'; archived: boolean; status: string; from: string; currency: string; bankType: '' | 'SPEND' | 'RECEIVE'; reconciled: '' | 'true' | 'false'; direction: '' | 'in' | 'out' };
const EMPTY: Filters = { q: '', role: '', archived: false, status: '', from: '', currency: '', bankType: '', reconciled: '', direction: '' };
const DEFAULT_SORT: Record<Tab, { key: string; dir: 'asc' | 'desc' }> = {
  contacts: { key: 'owed', dir: 'desc' }, invoices: { key: 'date', dir: 'desc' }, bills: { key: 'date', dir: 'desc' },
  bank: { key: 'date', dir: 'desc' }, credits: { key: 'date', dir: 'desc' }, payments: { key: 'date', dir: 'desc' },
};

function rangeFrom(v: string): string | undefined {
  if (!v) return undefined;
  const now = new Date();
  if (v === 'ytd') return `${now.getFullYear()}-01-01`;
  return new Date(now.getTime() - Number(v) * 86_400_000).toISOString().slice(0, 10);
}

const selectStyle = { height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '0 8px', fontSize: 13 } as const;

export function FinancePage() {
  const { hasRole } = useAuth();
  const toast = useToast();
  const status = useXeroStatus();
  const syncNow = useXeroSyncNow();
  const connected = status.data?.status === 'CONNECTED' || status.data?.status === 'NEEDS_RECONNECT';
  const hasData = connected || (status.data?.entities.some((e) => e.lastSuccessAt) ?? false);
  const summary = useFinanceSummary(hasData);
  const base = summary.data?.baseCurrency ?? status.data?.baseCurrency ?? 'USD';

  const [tab, setTab] = useState<Tab>('contacts');
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState(DEFAULT_SORT.contacts);
  const [stack, setStack] = useState<RecordRef[]>([]);
  const set = (patch: Partial<Filters>) => { setF((x) => ({ ...x, ...patch })); setPage(1); };
  const switchTab = (t: Tab, patch: Partial<Filters> = {}) => { setTab(t); setF({ ...EMPTY, ...patch }); setPage(1); setSort(DEFAULT_SORT[t]); };

  const paging = { limit: pageSize, offset: (page - 1) * pageSize, q: f.q || undefined, sort: sort.key, dir: sort.dir };
  const range = { ...paging, from: rangeFrom(f.from) };
  const contactsP = { ...paging, role: f.role || undefined, archived: f.archived || undefined };
  const invP = { ...range, type: 'ACCREC' as const, status: f.status || undefined, currency: f.currency || undefined };
  const billP = { ...range, type: 'ACCPAY' as const, status: f.status || undefined };
  const bankP = { ...range, type: f.bankType || undefined, reconciled: f.reconciled === '' ? undefined : f.reconciled === 'true' };
  const payP = { ...range, direction: f.direction || undefined };

  const contacts = useFinanceContacts(contactsP, hasData && tab === 'contacts');
  const invoices = useFinanceInvoices(invP, hasData && tab === 'invoices');
  const bills = useFinanceInvoices(billP, hasData && tab === 'bills');
  const bank = useFinanceBankTx(bankP, hasData && tab === 'bank');
  const credits = useFinanceCreditNotes(range, hasData && tab === 'credits');
  const payments = useFinancePayments(payP, hasData && tab === 'payments');
  const active = { contacts, invoices, bills, bank, credits, payments }[tab];

  const openKpi = (t: KpiTarget) => {
    if (t === 'recv') switchTab('invoices', { status: 'AUTHORISED' });
    if (t === 'overdue') switchTab('invoices', { status: 'overdue' });
    if (t === 'pay') switchTab('bills', { status: 'AUTHORISED' });
    if (t === 'in') switchTab('payments', { direction: 'in' });
    if (t === 'out') switchTab('bank', { bankType: 'SPEND' });
    document.getElementById('finance-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const table = useMemo(() => {
    const open = (r: RecordRef) => setStack([r]);
    switch (tab) {
      case 'contacts': return <DataTable layout="design" columns={contactColumns(base)} data={contacts.data?.items ?? []} total={contacts.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={contacts.isFetching && !contacts.data} onRowClick={(r) => open({ kind: 'contact', id: r.id })} emptyTitle="No contacts match" />;
      case 'invoices': return <DataTable layout="design" columns={invoiceColumns(base, 'Invoice')} data={invoices.data?.items ?? []} total={invoices.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={invoices.isFetching && !invoices.data} onRowClick={(r) => open({ kind: 'invoice', id: r.id })} emptyTitle="No invoices match" />;
      case 'bills': return <DataTable layout="design" columns={invoiceColumns(base, 'Bill')} data={bills.data?.items ?? []} total={bills.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={bills.isFetching && !bills.data} onRowClick={(r) => open({ kind: 'invoice', id: r.id })} emptyTitle="No bills match" />;
      case 'bank': return <DataTable layout="design" columns={bankColumns(base)} data={bank.data?.items ?? []} total={bank.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={bank.isFetching && !bank.data} onRowClick={(r) => open({ kind: 'bank', id: r.id })} emptyTitle="No bank transactions match" />;
      case 'credits': return <DataTable layout="design" columns={creditColumns(base)} data={credits.data?.items ?? []} total={credits.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={credits.isFetching && !credits.data} onRowClick={(r) => open({ kind: 'creditNote', id: r.id })} emptyTitle="No credit notes match" />;
      case 'payments': return <DataTable layout="design" columns={paymentColumns(base)} data={payments.data?.items ?? []} total={payments.data?.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSortChange={setSort} loading={payments.isFetching && !payments.data} onRowClick={(r) => open({ kind: 'payment', id: r.id, payment: r })} emptyTitle="No payments match" />;
    }
  }, [tab, base, page, pageSize, sort, contacts, invoices, bills, bank, credits, payments]);

  const totalsLine = (() => {
    if (tab === 'invoices' && invoices.data?.totals) return `Total ${baseMoney(invoices.data.totals.totalBase, base)} · due ${baseMoney(invoices.data.totals.amountDueBase, base)}`;
    if (tab === 'bills' && bills.data?.totals) return `Total ${baseMoney(bills.data.totals.totalBase, base)} · due ${baseMoney(bills.data.totals.amountDueBase, base)}`;
    if (tab === 'bank' && bank.data?.totals) return `Spent ${baseMoney(bank.data.totals.spentBase, base)} · received ${baseMoney(bank.data.totals.receivedBase, base)}`;
    if (tab === 'payments' && payments.data?.totals) return `In ${baseMoney(payments.data.totals.inBase, base)} · out ${baseMoney(payments.data.totals.outBase, base)}`;
    if (tab === 'credits' && credits.data?.totals) return `Total ${baseMoney(credits.data.totals.totalBase, base)}`;
    return null;
  })();

  async function exportTab() {
    // Pages through the API with the same filters (≤ 5,000 rows) so the file matches what's on screen.
    const all: any[] = [];
    const fetchPage = (offset: number) => {
      const p = { limit: 200, offset };
      switch (tab) {
        case 'contacts': return financeApi.contacts({ ...contactsP, ...p });
        case 'invoices': return financeApi.invoices({ ...invP, ...p });
        case 'bills': return financeApi.invoices({ ...billP, ...p });
        case 'bank': return financeApi.bankTransactions({ ...bankP, ...p });
        case 'credits': return financeApi.creditNotes({ ...range, ...p });
        case 'payments': return financeApi.payments({ ...payP, ...p });
      }
    };
    try {
      for (let offset = 0; offset < 5000; offset += 200) {
        const res = await fetchPage(offset);
        all.push(...res.items);
        if (res.items.length < 200) break;
      }
      const cols: Record<Tab, XlsxColumn<any>[]> = {
        contacts: [{ header: 'Contact', value: 'name' }, { header: 'Email', value: 'email' }, { header: 'Customer', value: (r) => (r.isCustomer ? 'Yes' : '') }, { header: 'Supplier', value: (r) => (r.isSupplier ? 'Yes' : '') }, { header: `Owed to you (${base})`, value: 'owed', type: 'number' }, { header: `Overdue (${base})`, value: 'overdue', type: 'number' }, { header: `You owe (${base})`, value: 'owing', type: 'number' }, { header: 'Last activity', value: 'lastActivity' }],
        invoices: [{ header: 'Invoice', value: 'number' }, { header: 'Reference', value: 'reference' }, { header: 'Contact', value: 'contactName' }, { header: 'Date', value: 'date' }, { header: 'Due', value: 'dueDate' }, { header: 'Status', value: (r) => (r.overdue ? 'OVERDUE' : r.status) }, { header: 'Currency', value: 'currencyCode' }, { header: 'Total', value: 'total', type: 'number' }, { header: 'Amount due', value: 'amountDue', type: 'number' }, { header: `Total (${base})`, value: 'totalBase', type: 'number' }],
        bills: [{ header: 'Bill', value: 'number' }, { header: 'Reference', value: 'reference' }, { header: 'Supplier', value: 'contactName' }, { header: 'Date', value: 'date' }, { header: 'Due', value: 'dueDate' }, { header: 'Status', value: (r) => (r.overdue ? 'OVERDUE' : r.status) }, { header: 'Currency', value: 'currencyCode' }, { header: 'Total', value: 'total', type: 'number' }, { header: 'Amount due', value: 'amountDue', type: 'number' }, { header: `Total (${base})`, value: 'totalBase', type: 'number' }],
        bank: [{ header: 'Date', value: 'date' }, { header: 'Type', value: 'type' }, { header: 'Payee', value: 'contactName' }, { header: 'Description', value: 'description' }, { header: 'Account', value: 'accountCode' }, { header: 'Reconciled', value: (r) => (r.isReconciled ? 'Yes' : 'No') }, { header: 'Currency', value: 'currencyCode' }, { header: 'Amount', value: 'total', type: 'number' }, { header: `Amount (${base})`, value: 'totalBase', type: 'number' }],
        credits: [{ header: 'Credit note', value: 'number' }, { header: 'Contact', value: 'contactName' }, { header: 'Date', value: 'date' }, { header: 'Type', value: 'type' }, { header: 'Currency', value: 'currencyCode' }, { header: 'Total', value: 'total', type: 'number' }, { header: 'Unallocated', value: 'remainingCredit', type: 'number' }],
        payments: [{ header: 'Date', value: 'date' }, { header: 'Contact', value: 'contactName' }, { header: 'Applied to', value: (r) => r.invoiceNumber ?? r.creditNoteNumber }, { header: 'Direction', value: 'direction' }, { header: 'Bank account', value: 'bankAccountName' }, { header: 'Currency', value: 'currencyCode' }, { header: 'Amount', value: 'amount', type: 'number' }, { header: `Amount (${base})`, value: 'amountBase', type: 'number' }],
      };
      await exportXlsx({ filename: `finance-${tab}`, sheetName: tab, rows: all, columns: cols[tab] });
      toast.show(`Exported ${all.length} rows.`, 'green');
    } catch {
      toast.show("Export failed. Try again, or narrow the filters.", 'red');
    }
  }

  const s = status.data;
  const lastSync = s?.entities.map((e) => e.lastSuccessAt).filter(Boolean).sort().at(-1);
  const header = (
    <PageHeader
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>Finance <Pill tone="purple" size="xs">Beta</Pill></span>}
      badge={s?.tenantName ? <Pill tone="gray">{s.tenantName}</Pill> : undefined}
      description="Contacts, invoices, bills and bank transactions from Xero. Read-only: edit anything in Xero and it shows up here on the next sync."
      actions={connected ? (
        <>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {s?.syncing ? 'Syncing…' : s?.status === 'NEEDS_RECONNECT' ? 'Sync paused' : lastSync ? `Synced ${fmt.relative(lastSync)}` : 'Not synced yet'}
          </span>
          <Button icon={<RefreshCw size={14} />} loading={syncNow.isPending} disabled={s?.syncing || s?.status !== 'CONNECTED'}
            onClick={() => syncNow.mutate(undefined, { onSuccess: () => toast.show('Sync queued.', 'green'), onError: (e: any) => toast.show(e?.response?.data?.message ?? "Couldn't start a sync.", 'red') })}>
            Sync now
          </Button>
          <Button icon={<Download size={14} />} onClick={exportTab}>Export</Button>
        </>
      ) : undefined}
    />
  );

  if (status.isLoading) return <div>{header}<TableSkeleton rows={8} /></div>;
  if (!s?.configured || (!connected && !hasData)) {
    return (
      <div>{header}
        <Card>
          <EmptyState icon={<Landmark size={22} />} title="Connect Xero to see your finances here"
            body="Once connected, every Xero contact appears here with its invoices, bills, spend money, credit notes and payments."
            action={hasRole('OWNER')
              ? <Link to="/settings?tab=xero"><Button variant="accent">Go to Xero settings</Button></Link>
              : <Pill tone="gray" icon={<Lock size={12} />}>Only an Owner can connect Xero. Ask an Owner in your organisation.</Pill>} />
        </Card>
      </div>
    );
  }
  const firstSync = s.syncing && !s.entities.some((e) => e.lastSuccessAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {header}
      {s.status === 'NEEDS_RECONNECT' && (
        <Callout tone="red">
          <b>Xero is disconnected.</b> Figures below may be out of date. {hasRole('OWNER') ? <Link to="/settings?tab=xero">Reconnect in Settings</Link> : 'Ask an Owner to reconnect Xero.'}
        </Callout>
      )}
      {!s.syncing && !s.entities.some((e) => e.lastSuccessAt) && s.entities.some((e) => e.status === 'FAILED' || e.status === 'RATE_LIMITED') && (
        // A first sync that failed or hit the daily limit would otherwise show a page of unexplained zeros.
        <Callout tone="amber">
          <b>The first sync hasn't finished.</b> {s.entities.find((e) => e.lastError)?.lastError ?? 'It retries automatically.'}{' '}
          {hasRole('OWNER') && <Link to="/settings?tab=xero">See sync status</Link>}
        </Callout>
      )}
      {firstSync ? (
        <>
          <Callout tone="blue"><b>First sync in progress.</b> We're copying your Xero data. You can leave this page; it keeps running in the background.</Callout>
          <TableSkeleton rows={8} />
        </>
      ) : (
        <>
          <QueryError query={summary} what="finance summary" />
          <FinanceKpis s={summary.data} loading={summary.isLoading} onOpen={openKpi} />
          {summary.data && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              <AgedReceivables s={summary.data} onOpenContact={(id) => setStack([{ kind: 'contact', id }])} onViewOverdue={() => openKpi('overdue')} />
              <MoneyFlowChart s={summary.data} />
            </div>
          )}
          <div id="finance-tabs">
            <Tabs variant="underline" ariaLabel="Finance records" value={tab} onChange={(v) => switchTab(v as Tab)}
              items={[
                { value: 'contacts', label: 'Contacts' }, { value: 'invoices', label: 'Invoices' }, { value: 'bills', label: 'Bills' },
                { value: 'bank', label: 'Bank transactions' }, { value: 'credits', label: 'Credit notes' }, { value: 'payments', label: 'Payments' },
              ]} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <label style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-faint)' }} />
              <input id="finance-search" className="input-3d" type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search…" aria-label="Search"
                style={{ ...selectStyle, width: '100%', paddingLeft: 30 }} />
            </label>
            {tab === 'contacts' && (
              <>
                <Tabs variant="segmented" value={f.role || 'all'} onChange={(v) => set({ role: v === 'all' ? '' : (v as Filters['role']) })}
                  items={[{ value: 'all', label: 'All' }, { value: 'customer', label: 'Customers' }, { value: 'supplier', label: 'Suppliers' }]} />
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input id="finance-archived" type="checkbox" checked={f.archived} onChange={(e) => set({ archived: e.target.checked })} /> Show archived
                </label>
              </>
            )}
            {(tab === 'invoices' || tab === 'bills') && (
              <select id="finance-status" aria-label="Status" style={selectStyle} value={f.status} onChange={(e) => set({ status: e.target.value })}>
                {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
            {tab === 'invoices' && (
              <select id="finance-currency" aria-label="Currency" style={selectStyle} value={f.currency} onChange={(e) => set({ currency: e.target.value })}>
                <option value="">All currencies</option>{['USD', 'AUD', 'GBP', 'EUR', 'NZD', 'BDT'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {tab === 'bank' && (
              <>
                <Tabs variant="segmented" value={f.bankType || 'all'} onChange={(v) => set({ bankType: v === 'all' ? '' : (v as Filters['bankType']) })}
                  items={[{ value: 'all', label: 'All' }, { value: 'SPEND', label: 'Spend money' }, { value: 'RECEIVE', label: 'Receive money' }]} />
                <select id="finance-reconciled" aria-label="Reconciliation" style={selectStyle} value={f.reconciled} onChange={(e) => set({ reconciled: e.target.value as Filters['reconciled'] })}>
                  <option value="">Any reconciliation</option><option value="true">Reconciled</option><option value="false">Unreconciled</option>
                </select>
              </>
            )}
            {tab === 'payments' && (
              <select id="finance-direction" aria-label="Direction" style={selectStyle} value={f.direction} onChange={(e) => set({ direction: e.target.value as Filters['direction'] })}>
                <option value="">In and out</option><option value="in">Received</option><option value="out">Paid out</option>
              </select>
            )}
            {tab !== 'contacts' && (
              <select id="finance-range" aria-label="Date range" style={selectStyle} value={f.from} onChange={(e) => set({ from: e.target.value })}>
                <option value="">Any date</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="ytd">This year</option>
              </select>
            )}
            <span style={{ flex: 1 }} />
            {totalsLine && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{totalsLine}</span>}
          </div>
          <QueryError query={active} what="finance records" />
          {table}
        </>
      )}
      <RecordDrawer base={base} stack={stack} onPush={(r) => setStack((x) => [...x, r])} onBack={() => setStack((x) => x.slice(0, -1))} onClose={() => setStack([])} />
    </div>
  );
}
```

- [ ] **Step 6: Route and navigation**

In `apps/web/src/App.tsx`, next to the other lazy imports:

```tsx
const FinancePage = React.lazy(() =>
	import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })),
);
```

and after the `/budgets` route:

```tsx
										<Route
											path="/finance"
											element={
												<RequireRole min="ADMIN" redirect="/overview">
													<SuspenseRoute><FinancePage /></SuspenseRoute>
												</RequireRole>
											}
										/>
```

In `apps/web/src/components/layout/Sidebar.tsx`:
1. Add `Landmark` to the `lucide-react` import.
2. Add `import { useXeroStatus } from "../../hooks/useFinance";`.
3. After `const isAdmin = hasRole("ADMIN");`, add:

   ```tsx
     // Finance is admin-only and appears only once the server has Xero credentials.
     const xeroStatus = useXeroStatus(isAdmin);
     const showFinance = isAdmin && !!xeroStatus.data?.configured;
   ```

4. In `navItems`, directly after the Budgets entry, add:

   ```tsx
       ...(showFinance ? [{ to: "/finance", label: "Finance", icon: Landmark, tag: "Beta" }] : []),
   ```

In `apps/web/src/components/layout/CommandPalette.tsx`:
1. Add `Landmark` to the `lucide-react` import.
2. Add after the Budgets entry in `NAV_ITEMS`:

   ```tsx
     { label: 'Finance (beta)', to: '/finance', sub: '/finance', icon: Landmark, adminOnly: true },
   ```

- [ ] **Step 7: Build and lint**

Run: `npm run build:web && npm run lint --workspace=apps/web`
Expected: both exit 0.
- If `DataTable` rejects a row type, that type was declared with `interface`; change it to `type` (see Task 11's note).
- If `Tabs` rejects a `count`-less item, its `count` is optional, so check the `items` shape.

- [ ] **Step 8: Manual check against the prototype**

Open `http://localhost:5173/finance` as an Owner with an empty database and with Xero configured. Expect the "Connect Xero…" empty state with a Settings button; as an Admin, the "Only an Owner…" pill instead. Check that Members have no Finance nav entry, and that visiting `/finance` as a Member redirects to `/overview`.

Then, with data present (after Task 13's Demo Company sync, or seeded rows), compare side by side with `docs/superpowers/specs/assets/2026-09-15-xero-finance-prototype.html`:

1. **KPI tiles:** five tiles, and clicking one opens the right filtered tab.
2. **Aged receivables:** the bar, the legend, and "Most overdue", which opens the contact drawer.
3. **Money in vs out:** six months, readable in both themes.
4. **Tabs:** every tab loads, sorts server-side, pages, and shows its totals line.
5. **Contact drawer:**
   - Sub-tabs load lazily.
   - Invoice → payment → "Applied to" → back works through the stack.
   - "Open in Xero" is present.
6. **Phone width (~400px):** no horizontal page scroll. Tables scroll inside their card.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/finance apps/web/src/pages/FinancePage.tsx apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/CommandPalette.tsx
git commit -m "feat(web): Finance page with KPIs, aged receivables, record tables and drawers"
```

---

### Task 13: End-to-end against the Xero Demo Company, then docs

**Files:**
- Modify (only if Step 3 shows it's needed): `src/xero/xero-normalize.ts`, `src/xero/finance-math.ts` and their specs
- Modify: `CLAUDE.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/superpowers/specs/2026-09-15-xero-finance-design.md`

**Interfaces:**
- Consumes everything above. Produces no new code interfaces.

- [ ] **Step 1: Prepare the Xero app and local env**

1. At https://developer.xero.com/app/manage, open the existing app. Under **Configuration → Redirect URIs**, make sure both are present:
   - `https://log.niftyitsolution.com/api/xero/callback`
   - `http://localhost:5173/api/xero/callback`
2. Copy the client ID and generate or copy the client secret into your local `.env`:
   ```env
   XERO_CLIENT_ID=...
   XERO_CLIENT_SECRET=...
   APP_ENCRYPTION_KEY=<64 hex chars; `openssl rand -hex 32`>
   APP_BASE_URL=http://localhost:5173
   ```
3. In Xero, open the **Demo Company** (My Xero → Try the demo company). It has multi-currency invoices, bills, spend money and credit notes.

- [ ] **Step 2: Connect and run the first sync**

Run in two terminals: `npm run dev:all`, and `ROLE=worker PORT=3003 npm run start:dev` (the worker runs the processor and crons).

1. Sign in as an Owner and go to `/settings?tab=xero`. Click **Connect to Xero**, pick **Demo Company** only, and allow access.
2. Expected:
   - You land on `/settings?tab=xero`, the "Connected" toast appears, and the URL loses `xero=connected`.
   - "First sync running" shows progress, then every entity turns "Up to date".
   - The Audit Log shows `xero.connected` plus the `POST /api/xero/connect` row.
3. Compare counts. Run:
   ```bash
   psql "$DATABASE_URL" -c "select 'contacts',count(*) from xero_contacts union all select 'invoices',count(*) from xero_invoices where type='ACCREC' union all select 'bills',count(*) from xero_invoices where type='ACCPAY' union all select 'bank',count(*) from xero_bank_transactions union all select 'credits',count(*) from xero_credit_notes union all select 'payments',count(*) from xero_payments;"
   ```
   Check them against the Demo Company's own lists: Contacts → All, Business → Invoices/Bills → All, and Accounting → Bank accounts → account transactions. They should match, apart from items Xero hides by default, such as archived contacts.

- [ ] **Step 3: Verify the two assumptions the spec flagged**

1. **Currency-rate direction.** Find a foreign-currency invoice:
   ```bash
   psql "$DATABASE_URL" -c "select number,currency_code,currency_rate,total,total_base from xero_invoices where currency_code <> (select base_currency from xero_connections) limit 3;"
   ```
   Open the same invoice in Xero. Xero shows the base-currency equivalent on the invoice (or in the currency-gain report).
   - If `total_base` matches it, the assumption holds and nothing changes.
   - If it matches `total * currency_rate` instead, change `toBase()` in `src/xero/xero-normalize.ts` to multiply, and flip the `toBase(1000, 1.515)` expectation in its spec to `1515`.
   - Then run `npx jest src/xero --runInBand`, then force a full re-sync so every stored row is rewritten: `psql "$DATABASE_URL" -c "delete from xero_sync_state"` (no watermarks means a full pass), then click **Sync now**.
2. **Deep links.** In the Finance drawer, click **Open in Xero** on an invoice, a bill, a contact, a spend-money transaction and a credit note. Each must open that record in the Demo Company. Fix any wrong path in `xeroDeepLink()` (`src/xero/finance-math.ts`) and its spec. Supplier credit notes may need `/AccountsPayable/ViewCreditNote.aspx`; if so, branch on `type === 'ACCPAYCREDIT'` in `creditNoteDetail`.

- [ ] **Step 4: Change, void, reconnect**

1. In the Demo Company, edit an invoice's reference, then click **Sync now** on `/finance`. The new reference appears in one run.
2. Void a draft or awaiting-payment invoice and sync. It shows **Voided**, with the number struck through, and drops out of "Owed to you".
3. **Disconnect** from Settings. Expected:
   - The Xero connection disappears from https://go.xero.com/Settings/ConnectedApps.
   - `/finance` still shows the data, with no Sync button.
   - The cron skips, with nothing in the worker logs.
4. **Reconnect** to the Demo Company. It works, and syncing resumes from the stored watermarks.
5. Reconnect choosing a *different* organisation (e.g. a trial org). You're refused with the "different organisation" banner, and nothing is overwritten.

- [ ] **Step 5: Update CLAUDE.md**

1. Under **Expected queues**, add `- \`xero-sync\``.
2. In the **Main code areas** table, add:
   ```markdown
   | Xero finance sync (read-only) | `src/xero/*`, `src/workers/xero-sync.processor.ts`, `apps/web/src/pages/FinancePage.tsx` |
   ```
3. In the env block under **Environment variables**, add an "Optional (Xero finance)" subsection listing `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`, and note that the redirect URI is `${APP_BASE_URL}/api/xero/callback`.
4. Add a `### Xero finance` subsection to **Data model rules**:
   ```markdown
   ### Xero finance

   Read-only mirror of one Xero organisation (spec: `docs/superpowers/specs/2026-09-15-xero-finance-design.md`).

   - Never call a Xero write endpoint; a guardrail test enforces GET-only on `XeroClient`.
   - Tokens live only in `xero_connections`, encrypted, never cached in-process
     (Xero rotates the refresh token on every use). Refresh only via
     `XeroTokenService.getAccessToken()`, which is single-flight under the Redis lock `xero:token-refresh`.
   - Xero paging is 1-based (`page=1`); ClickUp's is 0-based.
   - Money is stored in document currency plus `*_base = amount / currency_rate`. KPIs use `*_base`.
   - Voids/deletes are status changes; `DELETED` rows are excluded from every report.
   - The invoice/bill status filter is exclusive: `AUTHORISED` = awaiting payment and not overdue,
     `overdue` is its own bucket (`finance-math.invoiceStatusWhere`). Keep them exhaustive.
   - `*-TRANSFER` bank transactions are not money in/out.
   - One organisation only; a reconnect to a different org is refused (`different_org`).
   ```
5. Under **Known starter limitations**, add: "Xero ↔ ClickUp client matching (revenue vs tracked-time cost per client) is deferred; Xero contacts aren't linked to the ClickUp `client` field yet."
6. Under **Already in place**, add a bullet summarising the Xero Finance feature with its routes (`/api/xero/*`, `/api/finance/*`, `/finance`, Settings → Xero).

- [ ] **Step 6: Update docs/OPERATIONS.md**

Append:

````markdown
## Xero finance sync

**Setup**
1. Xero app (developer.xero.com → My Apps): register the redirect URIs `https://log.niftyitsolution.com/api/xero/callback`
   and, for local dev, `http://localhost:5173/api/xero/callback`.
2. Set `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` in the server `.env` (both or neither). `APP_ENCRYPTION_KEY` must be set.
   Recreate the web and worker containers.
3. An Owner connects from Settings → Xero and picks exactly one organisation.

**Schedule** (worker only, Asia/Dhaka)

| Job | When | What |
|---|---|---|
| `xero-sync-run` | hourly at :17 | incremental, `If-Modified-Since` = per-entity watermark |
| `xero-reconcile-open` | 02:00 | full contacts pass + re-read unpaid/submitted invoices by ID |
| `xero-token-keepalive` | 04:00 | force a token refresh (refresh tokens die after 60 days unused) |

**Rate limits.** Xero allows 60 calls/min, 5,000/day and 5 concurrent. The client paces itself to ≤55/min, and a run stops
cleanly (`RATE_LIMITED` in `xero_sync_state`) when fewer than 500 daily calls remain. The next hourly run resumes from the watermark.

**Runbook: "Needs reconnect"**
- Cause: Xero answered `invalid_grant`. Someone removed the app under Xero → Settings → Connected apps, the refresh
  token went unused for 60 days, or the client secret was rotated.
- Fix: an Owner opens Settings → Xero → **Reconnect** and picks the **same** organisation. Watermarks are kept, so the
  first run only fetches what changed.

**Runbook: switching to a different Xero organisation** (destructive; take a DB backup first)
The app refuses to connect a second organisation (`reason=different_org`), so books never mix. To switch deliberately:
```sql
BEGIN;
TRUNCATE xero_attachments, xero_payments, xero_bank_transactions, xero_credit_notes, xero_invoices, xero_contacts, xero_sync_state;
DELETE FROM xero_connections;
COMMIT;
```
Then connect the new organisation from Settings.

**Grafana.** Grant the read-only Grafana role `SELECT` on the eight `xero_*` tables. Use the role Grafana's Postgres data source connects as
(find it with `\du` on the prod database):
`GRANT SELECT ON xero_connections, xero_contacts, xero_invoices, xero_credit_notes, xero_bank_transactions, xero_payments, xero_attachments, xero_sync_state TO <grafana read-only role>;`
Leave out `xero_connections` if you'd rather not expose the (encrypted) token columns.
````

The repo doesn't record the Grafana role's name. OPERATIONS.md only says "Keep Grafana read-only credentials separate from app credentials." So write the GRANT with the literal token `<grafana read-only role>` as shown, then add one line under it: "Find the role with `\du` on the prod database, or from the Grafana Postgres data source's user." The operator fills it in on the server; the name is prod config, not repo content.

- [ ] **Step 7: Record the planning deviations in the spec**

In `docs/superpowers/specs/2026-09-15-xero-finance-design.md`:
- Change `**Status:**` to `Approved; implemented per docs/superpowers/plans/2026-09-15-xero-finance.md`.
- Add a `## Changes made during planning` section at the end. Copy in the seven numbered items from this plan's "Deliberate deviations from the spec" list, plus any deep-link or currency-rate correction from Step 3.

- [ ] **Step 8: Full verification**

Run: `npm run lint && npm run test && npm run build && npm run build:web`
Expected: all exit 0. Record the test counts in the PR description.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md docs/OPERATIONS.md docs/superpowers/specs/2026-09-15-xero-finance-design.md src/xero
git commit -m "docs(xero): operations runbook, CLAUDE.md rules, spec deviations"
```

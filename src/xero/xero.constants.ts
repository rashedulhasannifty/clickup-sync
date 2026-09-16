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
// Ordering invariant: TOKEN_LOCK_TTL_MS > identity-client HTTP timeout (15s) + DB read/write, and TOKEN_WAIT_TIMEOUT_MS >= that HTTP timeout — a lock must outlive the refresh it guards, and a waiter must not give up on a healthy in-flight one.
export const TOKEN_LOCK_TTL_MS = 45_000;
export const TOKEN_WAIT_TIMEOUT_MS = 30_000;
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

/**
 * How far back the nightly pass re-reads parents to refresh `has_attachments`.
 *
 * Attaching a file in Xero does NOT bump the parent's UpdatedDateUTC, so an attachment is
 * invisible to us until the parent is re-read — and incremental sync never re-reads it.
 * This window is deliberately bounded rather than "everything": a nightly full re-read grows
 * with the whole ledger forever, and Xero allows 5,000 calls a day shared with the hourly
 * incrementals, which would start reporting "Paused · daily limit" once the nightly pass ate
 * the budget. An attachment added to a document older than this window is picked up by
 * Settings -> Xero -> "Re-read everything" instead.
 */
export const ATTACHMENT_RECONCILE_DAYS = 90;

/** Largest attachment we will fetch and serve. Larger files are opened in Xero instead. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
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
/** Parents read from the DB per page in the attachment phase (each costs one Xero call). */
export const ATTACHMENT_BATCH = 100;

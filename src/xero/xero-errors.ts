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

/** How much of an error body survives into logs and dead-letter rows. */
export const DETAIL_MAX_LEN = 200;

/** Below this share of printable characters, treat the body as binary and ignore it. */
const MIN_PRINTABLE_RATIO = 0.8;

/** Error-body fields Xero uses, most specific first. */
const DETAIL_KEYS = ['Message', 'Detail', 'Title', 'error_description', 'error', 'ErrorDescription'] as const;

function isBinary(v: unknown): v is ArrayBufferLike | ArrayBufferView {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(v) ? true : v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}

/**
 * Empty unless the text is overwhelmingly printable. An attachment request sets
 * `responseType: 'arraybuffer'`, so a failed one hands us a Buffer of raw bytes
 * — decoding that blindly would spray control characters through the logs and
 * into a dead-letter row.
 */
function printable(text: string): string {
  if (!text) return '';
  // A replacement character means the bytes were not valid UTF-8 at all, which
  // no Xero error body ever is - decisive on its own.
  if (text.includes('\uFFFD')) return '';
  let printableChars = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const isWhitespace = code === 9 || code === 10 || code === 13;
    if (isWhitespace || (code >= 32 && code !== 127)) printableChars += 1;
  }
  return printableChars / text.length >= MIN_PRINTABLE_RATIO ? text : '';
}

function fromBody(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return printable(data);
  if (isBinary(data)) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    return printable(buf.subarray(0, DETAIL_MAX_LEN * 4).toString('utf8'));
  }
  if (typeof data === 'object') {
    const row = data as Record<string, unknown>;
    for (const key of DETAIL_KEYS) {
      const value = row[key];
      if (typeof value === 'string' && value.trim()) return printable(value);
    }
  }
  return '';
}

/**
 * The most useful one-line explanation of a failed Xero call.
 *
 * Xero does not answer in one shape: `{ Message }` for most accounting errors,
 * `{ Title, Detail }` for problem-style ones, and for a rejected *tenant* — the
 * case that matters most — a bare string such as `AuthenticationUnsuccessful`
 * with no JSON at all. Reading only `data.Message` fell back to axios's own
 * "Request failed with status code 403", which is the one sentence that says
 * nothing: a Xero connection revoked on 2026-09-18 then retried hourly for
 * three days with no clue in the logs as to why. HTML (a gateway error page) is
 * stripped to its text so a 502 doesn't push a page of markup into a log line.
 *
 * Never reads headers or `e.config` — those carry the bearer token.
 */
export function xeroErrorDetail(data: unknown, fallback: string, maxLen: number = DETAIL_MAX_LEN): string {
  const raw = fromBody(data) || fallback || '';
  const text = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLen);
}

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

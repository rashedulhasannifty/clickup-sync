import { ProviderRateLimitedError } from '../attendance-provider';
import { addDays, diffDays } from '../people-dates';
import { parseStellarLog, type StellarLogParse } from './stellar-log';

/**
 * Stellar HRM's API (Rumy Technologies RAMS): `POST` a JSON body with
 * `operation`, `auth_user` and `auth_code` to one endpoint.
 *
 * - Read only. The API can also delete users and remove them from the door
 *   readers; this client sends nothing but the operations in `READ_OPERATIONS`
 *   (a guardrail test pins that).
 * - At most one call every five minutes per IP, or the server blocks the IP.
 *   Every call first claims a slot in Redis (`SET NX PX`), shared by every
 *   process and surviving restarts; with no slot free it throws
 *   `StellarRateLimitedError` and makes no request.
 * - One `fetch_log` call answers at most `MAX_DAYS_PER_CALL` days (the last
 *   days of a longer range are returned and the rest silently dropped), so
 *   callers fetch in windows of that size.
 * - `auth_code` is a password: it is never logged, and neither is a request body.
 */

export const STELLAR_API_URL = 'https://rumytechnologies.com/rams/json_api';
export const READ_OPERATIONS = ['fetch_log', 'fetch_user_list', 'fetch_device_detail'] as const;
export type StellarReadOperation = (typeof READ_OPERATIONS)[number];

/** Five minutes is the documented minimum; 30 s on top absorbs clock skew. */
export const STELLAR_CALL_INTERVAL_MS = 330_000;
/** Days one `fetch_log` call actually returns (measured: a 12-day range came back as its last 3). */
export const MAX_DAYS_PER_CALL = 3;
export const STELLAR_RATE_KEY = 'stellar:api:slot';
const TIMEOUT_MS = 60_000;

export interface StellarCredentials {
  authUser: string;
  authCode: string;
}

/** The two Redis commands the slot needs (ioredis-compatible). */
export interface SlotRedis {
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<unknown>;
  pttl(key: string): Promise<number>;
}

export class StellarRateLimitedError extends ProviderRateLimitedError {
  constructor(retryAt: Date) {
    super(`Stellar HRM allows one call every 5 minutes; next slot at ${retryAt.toISOString()}`, retryAt);
  }
}

export class StellarApiError extends Error {}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class StellarApiClient {
  constructor(
    private readonly credentials: StellarCredentials | null,
    private readonly redis: () => Promise<SlotRedis>,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly url = STELLAR_API_URL,
  ) {}

  get configured(): boolean {
    return !!this.credentials;
  }

  /** Every punch on `from`..`to` (Dhaka dates, at most `MAX_DAYS_PER_CALL` days): one API call. */
  async fetchLog(from: string, to: string): Promise<StellarLogParse> {
    const days = diffDays(from, to) + 1;
    if (days < 1 || days > MAX_DAYS_PER_CALL)
      throw new RangeError(`fetchLog takes 1..${MAX_DAYS_PER_CALL} days, got ${from}..${to}`);
    const body = await this.call('fetch_log', {
      start_date: from,
      end_date: to,
      start_time: '00:00:00',
      end_time: '23:59:59',
    });
    return parseStellarLog(body);
  }

  /** The oldest-first `MAX_DAYS_PER_CALL`-day windows covering `from`..`to`. */
  static windows(from: string, to: string): { from: string; to: string }[] {
    const out: { from: string; to: string }[] = [];
    for (let start = from; start <= to; start = addDays(start, MAX_DAYS_PER_CALL)) {
      const end = addDays(start, MAX_DAYS_PER_CALL - 1);
      out.push({ from: start, to: end < to ? end : to });
    }
    return out;
  }

  private async call(operation: StellarReadOperation, params: Record<string, string>): Promise<unknown> {
    if (!(READ_OPERATIONS as readonly string[]).includes(operation))
      throw new Error(`Stellar HRM operation ${operation} is not allowed`);
    if (!this.credentials) throw new StellarApiError('Stellar HRM API credentials are not configured');
    await this.claimSlot();
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation,
          auth_user: this.credentials.authUser,
          auth_code: this.credentials.authCode,
          ...params,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new StellarApiError(`Stellar HRM ${operation} failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new StellarApiError(`Stellar HRM ${operation} answered HTTP ${res.status}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new StellarApiError(`Stellar HRM ${operation} answered with something that is not JSON`);
    }
  }

  /** Take the one call slot of the next five minutes, or throw when another call holds it. */
  private async claimSlot(): Promise<void> {
    const redis = await this.redis();
    const ok = await redis.set(STELLAR_RATE_KEY, String(Date.now()), 'PX', STELLAR_CALL_INTERVAL_MS, 'NX');
    if (ok === 'OK') return;
    const ttl = await redis.pttl(STELLAR_RATE_KEY);
    throw new StellarRateLimitedError(new Date(Date.now() + Math.max(ttl, 1_000)));
  }
}

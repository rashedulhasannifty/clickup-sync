import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { QueueService } from '../queues/queue.service';
import { XeroTokenService } from './xero-token.service';
import { XeroApiError, XeroRateBudgetExhaustedError } from './xero-errors';
import {
  DAY_BUDGET_FLOOR, MAX_429_RETRIES, MAX_ATTACHMENT_BYTES, MAX_BACKOFF_MS, MAX_PAGES, MIN_CALL_INTERVAL_MS, PAGE_SIZE, XERO_API_BASE,
  XERO_REDIS,
} from './xero.constants';

export interface XeroGetOptions {
  params?: Record<string, string>;
  modifiedSince?: Date | null;
}

/** Raw bytes of a file Xero serves, plus the Content-Type Xero sent with them. */
export interface XeroFile {
  data: Buffer;
  contentType: string | null;
}

/** Internal: what `request` needs beyond the public GET options. */
type RequestOptions = XeroGetOptions & {
  accept?: string;
  binary?: boolean;
  /**
   * Skip the in-process DAY_BUDGET_FLOOR pre-check. For single interactive calls made from the
   * web role: that process never calls beginRun(), so a low reading from one open would
   * otherwise block every later open until a restart. One call can't starve the sync; Xero's
   * own 429 still applies.
   */
  ignoreBudgetFloor?: boolean;
};

type RawResponse<T> = { data: T; headers: Record<string, unknown> };

/** How long a single Xero data GET is allowed to hang before we give up on it. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Upper bound on how much of a third-party error message we let into logs/dead-letter rows. */
const DETAIL_MAX_LEN = 200;

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
 * guarantee is enforced by a guardrail test. Sync calls come only from the worker
 * (the xero-sync processor runs at concurrency 1), so in-process pacing is enough
 * to stay under Xero's 60/min. The web role adds only single, user-initiated
 * attachment opens (`getFile`); a rare overlap with a sync is absorbed by the 429
 * retry. 5,000/day is watched through X-DayLimit-Remaining.
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
    return this.request<T>(path, opts, 0, false).then((r) => r.data);
  }

  /**
   * GET a file's bytes (an attachment's content). Still a read: `accept` is the file's MIME type,
   * which is how Xero's attachment endpoints select the raw-content representation. Bounded by
   * MAX_ATTACHMENT_BYTES so a huge file can't exhaust memory in the web process.
   */
  async getFile(path: string, accept: string): Promise<XeroFile> {
    const res = await this.request<ArrayBuffer>(path, { accept, binary: true, ignoreBudgetFloor: true }, 0, false);
    const type = res.headers['content-type'];
    return { data: Buffer.from(res.data), contentType: typeof type === 'string' ? type : null };
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

  private async request<T>(path: string, opts: RequestOptions, attempt: number, retriedAuth: boolean): Promise<RawResponse<T>> {
    if (!opts.ignoreBudgetFloor && this.dayRemaining !== null && this.dayRemaining < DAY_BUDGET_FLOOR) {
      throw new XeroRateBudgetExhaustedError(this.dayRemaining);
    }
    await this.pace();
    const { accessToken, tenantId } = await this.tokens.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      Accept: opts.accept ?? 'application/json',
    };
    if (opts.modifiedSince) headers['If-Modified-Since'] = formatModifiedSince(opts.modifiedSince);

    try {
      const res = await firstValueFrom(
        this.http.request<T>({
          method: 'GET', url: `${XERO_API_BASE}${path}`, params: opts.params, headers, timeout: REQUEST_TIMEOUT_MS,
          ...(opts.binary ? { responseType: 'arraybuffer' as const, maxContentLength: MAX_ATTACHMENT_BYTES } : {}),
        }),
      );
      await this.recordLimits(res.headers as Record<string, unknown>);
      return { data: res.data, headers: (res.headers ?? {}) as Record<string, unknown> };
    } catch (e: any) {
      const status: number | null = e?.response?.status ?? null;
      if (e?.response?.headers) await this.recordLimits(e.response.headers);
      if (status === 304) return { data: {} as T, headers: {} };
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
      // Never surface e.config (carries the bearer token) or e itself (as cause or
      // otherwise) — only status/path/a truncated message end up in XeroApiError,
      // matching the sanitizedError() rule in xero-identity.client.ts.
      const rawDetail = typeof e?.response?.data?.Message === 'string' ? e.response.data.Message : (e?.message ?? '');
      const detail = String(rawDetail).slice(0, DETAIL_MAX_LEN);
      this.logger.error(`Xero GET ${path} failed: ${status ?? 'network'} ${detail}`);
      throw new XeroApiError(status, path, detail);
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

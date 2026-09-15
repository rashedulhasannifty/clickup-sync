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

/**
 * The `authentication_event_id` claim of a Xero access token (a JWT), or null when
 * the token isn't a JWT or has no such claim. No signature check: the token came
 * straight from Xero's token endpoint over TLS. Never logs the token or payload.
 */
export function authEventIdOf(accessToken: string): string | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const id = (payload as { authentication_event_id?: unknown } | null)?.authentication_event_id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/** Fixed text plus the error's class name or Prisma code. Never `message`: a Prisma validation message can quote token ciphertext. */
function errorKind(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code) return code;
  return (e as Error | null)?.name ?? 'unknown';
}

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
      // Scope to THIS consent: the unfiltered list also holds every organisation this
      // user connected earlier (e.g. the Demo Company), which would refuse a valid pick.
      const authEventId = authEventIdOf(tokens.access_token) ?? undefined;
      const orgs = (await this.identity.listConnections(tokens.access_token, authEventId)).filter((c) => c.tenantType === 'ORGANISATION');
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
      // The connection is saved: from here on the redirect must say `connected`, so the
      // side effects below are best-effort. The hourly cron picks up a missed first sync.
      // The AuditLogInterceptor skips GETs, so record the connect explicitly.
      await this.audit
        .create({
          actor: owner.email ?? owner.userId, method: 'GET', path: '/api/xero/callback', routePattern: 'xero.connected',
          statusCode: 302, durationMs: null, ip: null, userAgent: null, requestBody: { tenantName: org.Name }, errorMessage: null,
        })
        .catch((e: unknown) => this.logger.error(`Xero connected, but the audit entry could not be written: ${errorKind(e)}`));
      // Only a first-ever connect is full. Reconnecting the same organisation resumes from the watermarks.
      const data: XeroSyncJobData = { entity: 'all', full: !existing?.tenantId };
      await this.queues
        .get(QUEUES.XERO_SYNC)
        .add(JOBS.XERO_SYNC, data, this.queues.defaultJobOptions())
        .catch((e: unknown) => this.logger.error(`Xero connected, but the first sync could not be queued: ${errorKind(e)}`));
      return this.settingsUrl('connected');
    } catch (e) {
      this.logger.error(`Xero callback failed: ${errorKind(e)}`);
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
    let raw: string | null;
    try {
      raw = await (await this.redis()).getdel(XERO_REDIS.oauthState(state));
    } catch (e) {
      // Redis unreachable: an unverifiable state must be rejected, not thrown —
      // this method backs the @Public() callback, which must always redirect.
      this.logger.error(`Xero callback could not verify state: ${(e as Error).message}`);
      return null;
    }
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as StateOwner;
      return typeof v?.userId === 'string' ? v : null;
    } catch {
      return null;
    }
  }
}

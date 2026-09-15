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
      const released = await lock.release();
      if (!released) {
        // The TTL expired (or another process's lock now occupies the key) before we
        // released — the refresh took longer than TOKEN_LOCK_TTL_MS. A concurrent
        // refresh may now be racing this one; carries no tokens.
        this.logger.warn('Xero token refresh outlived its lock: TTL expired before release');
      }
    }
  }

  private async refresh(row: UsableConnection): Promise<XeroAccess> {
    let tokens;
    try {
      tokens = await this.identity.refresh(this.crypto.decrypt(row.refreshTokenEnc));
    } catch (e) {
      if (e instanceof XeroInvalidGrantError) {
        // Compare-and-set: if the row was reconnected or disconnected meanwhile, the dead
        // grant was the OLD one, so nothing is marked. This caller's grant is dead either way.
        await this.repo.markNeedsReconnect(row.refreshTokenEnc, 'Xero rejected the saved sign-in (invalid_grant). An Owner must reconnect Xero.');
        throw new XeroReconnectRequiredError();
      }
      throw e;
    }
    const now = Date.now();
    const saved = await this.repo.saveTokens(row.refreshTokenEnc, {
      accessTokenEnc: this.crypto.encrypt(tokens.access_token),
      refreshTokenEnc: this.crypto.encrypt(tokens.refresh_token),
      accessExpiresAt: new Date(now + tokens.expires_in * 1000),
      refreshedAt: new Date(now),
    });
    if (!saved) {
      // The row was replaced (reconnect) or disconnected while we refreshed: discard the
      // old-grant tokens and read once more. `usable` throws if it's no longer CONNECTED. No loop.
      this.logger.warn('Xero token refresh discarded: the connection was replaced or disconnected mid-refresh');
      return this.toAccess(this.usable(await this.repo.get()));
    }
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

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

  /**
   * Compare-and-set on the refresh token the caller read. A refresh that finishes
   * after a disconnect or reconnect must not write the old grant back. A status-only
   * guard isn't enough, because after a reconnect the row is CONNECTED again.
   * Returns whether a row changed.
   */
  async saveTokens(
    readRefreshTokenEnc: string,
    input: { accessTokenEnc: string; refreshTokenEnc: string; accessExpiresAt: Date; refreshedAt: Date },
  ): Promise<boolean> {
    const { count } = await this.prisma.xeroConnection.updateMany({
      where: this.sameGrant(readRefreshTokenEnc),
      data: { ...input, lastError: null },
    });
    return count > 0;
  }

  /** Same compare-and-set as saveTokens: only the grant that was read can be marked dead. */
  async markNeedsReconnect(readRefreshTokenEnc: string, error: string): Promise<boolean> {
    const { count } = await this.prisma.xeroConnection.updateMany({
      where: this.sameGrant(readRefreshTokenEnc),
      data: { status: XeroConnectionStatus.NEEDS_RECONNECT, lastError: error },
    });
    return count > 0;
  }

  private sameGrant(refreshTokenEnc: string) {
    return { id: XERO_CONNECTION_ID, status: XeroConnectionStatus.CONNECTED, refreshTokenEnc };
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

  listSyncStates() {
    return this.prisma.xeroSyncState.findMany({ orderBy: { entity: 'asc' } });
  }
}

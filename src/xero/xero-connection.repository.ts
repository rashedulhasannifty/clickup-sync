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

  listSyncStates() {
    return this.prisma.xeroSyncState.findMany({ orderBy: { entity: 'asc' } });
  }
}

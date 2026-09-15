import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { XERO_API_BASE, XERO_CONNECTIONS_URL, XERO_REVOKE_URL, XERO_TOKEN_URL } from './xero.constants';
import { XeroInvalidGrantError } from './xero-errors';
import type { XeroOrganisation, XeroTenantConnection, XeroTokenSet } from './xero.types';

// Kept well under TOKEN_LOCK_TTL_MS (xero.constants.ts) so the token-refresh lock
// always outlives an in-flight request plus the DB work around it.
const TIMEOUT_MS = 15_000;

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

  /**
   * Without `authEventId` Xero returns EVERY organisation this user ever connected to
   * the app. With it, only the ones picked on that consent (the id is a claim in the
   * new access token; it is not a secret, so it may go in the query string).
   */
  async listConnections(accessToken: string, authEventId?: string): Promise<XeroTenantConnection[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<XeroTenantConnection[]>(XERO_CONNECTIONS_URL, {
          headers: this.bearer(accessToken),
          timeout: TIMEOUT_MS,
          ...(authEventId ? { params: { authEventId } } : {}),
        }),
      );
      return res.data ?? [];
    } catch (e: any) {
      throw this.sanitizedError('listConnections', e);
    }
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
    let res;
    try {
      res = await firstValueFrom(
        this.http.get<{ Organisations: XeroOrganisation[] }>(`${XERO_API_BASE}/Organisation`, {
          headers: { ...this.bearer(accessToken), 'xero-tenant-id': tenantId },
          timeout: TIMEOUT_MS,
        }),
      );
    } catch (e: any) {
      throw this.sanitizedError('getOrganisation', e);
    }
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
      throw this.sanitizedError(`token request (${form.grant_type})`, e);
    }
  }

  /**
   * Logs the status + Xero's error code (never the request) and returns a plain
   * `Error` carrying only those two facts. Deliberately does NOT attach `e` as
   * `cause` and does not return the raw axios error at all: `e.config.headers`
   * carries either the Basic-auth client secret (token endpoints) or a bearer
   * access token (`bearer()`, used by `listConnections`/`getOrganisation`/`deleteConnection`).
   * Returning it — even as `cause` — risks a later `console.error`/util.inspect
   * or `JSON.stringify` on the thrown error printing that header.
   */
  private sanitizedError(op: string, e: any): Error {
    const status = e?.response?.status;
    const code = e?.response?.data?.error;
    this.logger.error(`Xero ${op} failed: ${status ?? 'network'} ${code ?? e?.message ?? ''}`);
    return new Error(`Xero ${op} failed (${status ?? 'network'}${code ? ` ${code}` : ''})`);
  }

  private formHeaders() {
    const basic = Buffer.from(`${this.clientId()}:${this.config.get<string>('XERO_CLIENT_SECRET') ?? ''}`).toString('base64');
    return { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  }

  private bearer(accessToken: string) {
    return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  }
}

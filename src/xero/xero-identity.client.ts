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
      // Deliberately NOT attaching `e` as `cause`: it's the raw axios error and
      // `e.config.headers` carries the Basic-auth client secret (and, for
      // refresh/exchange, a bearer token). Attaching it risks a later
      // `console.error`/util.inspect on this error printing that header. Status
      // and Xero's error code above are the full diagnostic surface we want kept.
      // eslint-disable-next-line preserve-caught-error
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

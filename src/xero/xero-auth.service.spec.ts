import { BadRequestException, ConflictException } from '@nestjs/common';
import { XeroAuthService } from './xero-auth.service';

class FakeRedis {
  store = new Map<string, string>();
  ttl = new Map<string, number>();
  async set(k: string, v: string, _ex: 'EX', seconds: number) {
    this.store.set(k, v);
    this.ttl.set(k, seconds);
    return 'OK';
  }
  async getdel(k: string) {
    const v = this.store.get(k) ?? null;
    this.store.delete(k);
    return v;
  }
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
}

const owner = { userId: 'u1', orgId: 'o1', role: 'OWNER', email: 'owner@nifty.test', isMachine: false } as never;
const BASE = 'http://localhost:5173/';

function setup(over: { configured?: boolean; encryption?: boolean; connections?: unknown[]; existing?: unknown; busy?: boolean; exchange?: jest.Mock } = {}) {
  const redis = new FakeRedis();
  const queue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue(over.busy ? [{ name: 'xero-sync-run' }] : []) };
  const queues = { redis: async () => redis, get: () => queue, defaultJobOptions: () => ({ attempts: 5 }) };
  const identity = {
    isConfigured: () => over.configured ?? true,
    clientId: () => 'cid',
    exchangeCode: over.exchange ?? jest.fn().mockResolvedValue({ access_token: 'acc', refresh_token: 'ref', expires_in: 1800 }),
    listConnections: jest.fn().mockResolvedValue(over.connections ?? [{ id: 'conn-1', tenantId: 'tenant-1', tenantType: 'ORGANISATION', tenantName: 'Nifty IT Solution Ltd' }]),
    getOrganisation: jest.fn().mockResolvedValue({ Name: 'Nifty IT Solution Ltd', BaseCurrency: 'USD', ShortCode: '!abc12' }),
    revoke: jest.fn(),
    deleteConnection: jest.fn(),
  };
  const repo = {
    get: jest.fn().mockResolvedValue(over.existing ?? null),
    saveConnected: jest.fn(),
    markDisconnected: jest.fn(),
    listSyncStates: jest.fn().mockResolvedValue([]),
  };
  const tokens = { getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'acc', tenantId: 'tenant-1' }) };
  const crypto = { isEnabled: over.encryption ?? true, encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1') };
  const audit = { create: jest.fn() };
  const config = { get: (k: string) => (k === 'APP_BASE_URL' ? BASE : undefined) };
  const svc = new XeroAuthService(identity as never, repo as never, tokens as never, crypto as never, queues as never, audit as never, config as never);
  return { svc, redis, queue, identity, repo, audit, tokens };
}

async function connectAndGetState(svc: XeroAuthService) {
  const { url } = await svc.startConnect(owner);
  return new URL(url).searchParams.get('state')!;
}

describe('XeroAuthService.startConnect', () => {
  it('builds the consent URL with exact scopes and a redirect from APP_BASE_URL', async () => {
    const { svc, redis } = setup();
    const { url } = await svc.startConnect(owner);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://login.xero.com/identity/connect/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/xero/callback');
    expect(u.searchParams.get('scope')).toBe(
      'openid profile email offline_access accounting.contacts.read accounting.invoices.read accounting.payments.read accounting.banktransactions.read accounting.attachments.read accounting.settings.read',
    );
    const state = u.searchParams.get('state')!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(redis.store.get(`xero:oauth-state:${state}`)!)).toEqual({ userId: 'u1', email: 'owner@nifty.test' });
    expect(redis.ttl.get(`xero:oauth-state:${state}`)).toBe(600);
  });

  it('refuses when the server is not configured or encryption is off', async () => {
    await expect(setup({ configured: false }).svc.startConnect(owner)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ encryption: false }).svc.startConnect(owner)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('XeroAuthService.handleCallback', () => {
  it('connects: saves encrypted tokens, audits, queues a full sync, redirects to connected', async () => {
    const { svc, repo, audit, queue } = setup();
    const state = await connectAndGetState(svc);
    const url = await svc.handleCallback({ code: 'the-code', state });
    expect(url).toBe('http://localhost:5173/settings?tab=xero&xero=connected');
    expect(repo.saveConnected).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1', connectionId: 'conn-1', tenantName: 'Nifty IT Solution Ltd', shortCode: '!abc12',
        baseCurrency: 'USD', accessTokenEnc: 'enc(acc)', refreshTokenEnc: 'enc(ref)', connectedByUserId: 'u1',
        connectedByEmail: 'owner@nifty.test',
      }),
    );
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ actor: 'owner@nifty.test', routePattern: 'xero.connected', statusCode: 302 }));
    expect(queue.add).toHaveBeenCalledWith('xero-sync-run', { entity: 'all', full: true }, { attempts: 5 });
  });

  it('rejects an unknown state and a reused state', async () => {
    const { svc } = setup();
    expect(await svc.handleCallback({ code: 'c', state: 'nope' })).toContain('xero=error&reason=state');
    const state = await connectAndGetState(svc);
    await svc.handleCallback({ code: 'c', state });
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=state');
  });

  it('maps access_denied to cancelled and still consumes the state', async () => {
    const { svc, redis } = setup();
    const state = await connectAndGetState(svc);
    expect(await svc.handleCallback({ error: 'access_denied', state })).toContain('reason=cancelled');
    expect(redis.store.size).toBe(0);
  });

  it('refuses more than one organisation and revokes the grant', async () => {
    const conns = [
      { id: 'c1', tenantId: 't1', tenantType: 'ORGANISATION', tenantName: 'A' },
      { id: 'c2', tenantId: 't2', tenantType: 'ORGANISATION', tenantName: 'B' },
    ];
    const { svc, identity, repo } = setup({ connections: conns });
    const state = await connectAndGetState(svc);
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=multiple_tenants');
    expect(identity.revoke).toHaveBeenCalledWith('ref');
    expect(repo.saveConnected).not.toHaveBeenCalled();
  });

  it('refuses a different organisation from the one already synced', async () => {
    const { svc, identity, repo } = setup({ existing: { tenantId: 'other-tenant', status: 'DISCONNECTED' } });
    const state = await connectAndGetState(svc);
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=different_org');
    expect(identity.revoke).toHaveBeenCalled();
    expect(repo.saveConnected).not.toHaveBeenCalled();
  });

  it('maps an exchange failure to reason=exchange without throwing', async () => {
    const { svc } = setup({ exchange: jest.fn().mockRejectedValue(new Error('boom')) });
    const state = await connectAndGetState(svc);
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=exchange');
  });

  it('redirects with reason=state when Redis is unavailable, without throwing', async () => {
    const { svc, redis } = setup();
    const state = await connectAndGetState(svc);
    redis.getdel = async () => {
      throw new Error('redis down');
    };
    expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=state');
  });
});

describe('XeroAuthService.requestSync', () => {
  it('queues a run when idle and 409s when one is already busy', async () => {
    const idle = setup({ existing: { status: 'CONNECTED' } });
    await expect(idle.svc.requestSync()).resolves.toEqual({ queued: true });
    expect(idle.queue.add).toHaveBeenCalledWith('xero-sync-run', { entity: 'all' }, { attempts: 5 });
    const busy = setup({ existing: { status: 'CONNECTED' }, busy: true });
    await expect(busy.svc.requestSync()).rejects.toBeInstanceOf(ConflictException);
  });
});

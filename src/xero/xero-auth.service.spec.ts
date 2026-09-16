import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { XeroAuthService } from './xero-auth.service';

/** A Xero-style access token: a 3-segment JWT whose payload carries the given claims. */
const jwt = (claims: Record<string, unknown>) => `hdr.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const STALE = { id: 'conn-old', tenantId: 'tenant-demo', tenantType: 'ORGANISATION', tenantName: 'Demo Company' };
const PICKED = { id: 'conn-1', tenantId: 'tenant-1', tenantType: 'ORGANISATION', tenantName: 'Nifty IT Solution Ltd' };

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

type ConnMap = { all?: unknown[]; byEvent?: Record<string, unknown[]> };

function setup(over: { configured?: boolean; encryption?: boolean; connections?: unknown[] | ConnMap; existing?: unknown; busy?: boolean; exchange?: jest.Mock } = {}) {
  const redis = new FakeRedis();
  // Argument-aware: the filtered call (authEventId) and the unfiltered call return different sets,
  // so a test cannot pass unless the service passes the right filter.
  const conns: ConnMap = Array.isArray(over.connections) ? { all: over.connections } : (over.connections ?? {});
  const listConnections = jest.fn(async (_token: string, authEventId?: string) =>
    authEventId ? (conns.byEvent?.[authEventId] ?? []) : (conns.all ?? [PICKED]),
  );
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
    getJobs: jest.fn().mockResolvedValue(over.busy ? [{ name: 'xero-sync-run' }] : []),
    drain: jest.fn().mockResolvedValue(undefined),
  };
  const queues = { redis: async () => redis, get: () => queue, defaultJobOptions: () => ({ attempts: 5 }) };
  const identity = {
    isConfigured: () => over.configured ?? true,
    clientId: () => 'cid',
    exchangeCode: over.exchange ?? jest.fn().mockResolvedValue({ access_token: 'acc', refresh_token: 'ref', expires_in: 1800 }),
    listConnections,
    getOrganisation: jest.fn().mockResolvedValue({ Name: 'Nifty IT Solution Ltd', BaseCurrency: 'USD', ShortCode: '!abc12' }),
    revoke: jest.fn(),
    deleteConnection: jest.fn(),
  };
  const repo = {
    get: jest.fn().mockResolvedValue(over.existing ?? null),
    saveConnected: jest.fn().mockResolvedValue(undefined),
    markDisconnected: jest.fn().mockResolvedValue(undefined),
    listSyncStates: jest.fn().mockResolvedValue([]),
  };
  const tokens = { getAccessToken: jest.fn().mockResolvedValue({ accessToken: 'acc', tenantId: 'tenant-1' }) };
  const crypto = { isEnabled: over.encryption ?? true, encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1') };
  const audit = { create: jest.fn().mockResolvedValue(undefined) };
  const config = { get: (k: string) => (k === 'APP_BASE_URL' ? BASE : undefined) };
  const data = { eraseAll: jest.fn().mockResolvedValue(undefined) };
  const svc = new XeroAuthService(
    identity as never, repo as never, tokens as never, crypto as never, queues as never, audit as never, config as never, data as never,
  );
  return { svc, redis, queue, identity, repo, audit, tokens, data };
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

describe('XeroAuthService.eraseData', () => {
  const CONNECTED = { tenantId: 'tenant-1', status: 'CONNECTED', connectionId: 'conn-1', refreshTokenEnc: 'enc(ref)' };
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('refuses while a sync is running, erasing and draining nothing', async () => {
    const { svc, data, queue, identity } = setup({ busy: true, existing: CONNECTED });
    await expect(svc.eraseData()).rejects.toBeInstanceOf(ConflictException);
    expect(data.eraseAll).not.toHaveBeenCalled();
    expect(queue.drain).not.toHaveBeenCalled();
    expect(identity.deleteConnection).not.toHaveBeenCalled();
  });

  it('revokes at Xero, erases every row, then drains delayed retries too', async () => {
    const { svc, data, queue, identity, repo } = setup({ existing: CONNECTED });
    const order: string[] = [];
    identity.deleteConnection.mockImplementation(async () => void order.push('deleteConnection'));
    identity.revoke.mockImplementation(async () => void order.push('revoke'));
    repo.markDisconnected.mockImplementation(async () => void order.push('markDisconnected'));
    data.eraseAll.mockImplementation(async () => void order.push('eraseAll'));
    queue.drain.mockImplementation(async () => void order.push('drain'));

    await expect(svc.eraseData()).resolves.toEqual({ erased: true });

    // Revoking is HTTP and must happen before the rows go; the drain comes last so a job
    // queued earlier can't run, fail on the dead connection, and re-create a sync-state row.
    expect(order).toEqual(['deleteConnection', 'revoke', 'markDisconnected', 'eraseAll', 'drain']);
    // `true` also drops delayed/backoff retries that a bare drain() would leave queued.
    expect(queue.drain).toHaveBeenCalledWith(true);
  });

  it('still erases when Xero was never connected', async () => {
    const { svc, data, queue, identity } = setup({ existing: null });
    await expect(svc.eraseData()).resolves.toEqual({ erased: true });
    expect(identity.deleteConnection).not.toHaveBeenCalled();
    expect(data.eraseAll).toHaveBeenCalled();
    expect(queue.drain).toHaveBeenCalledWith(true);
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
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { svc } = setup({ exchange: jest.fn().mockRejectedValue(new Error('boom')) });
      const state = await connectAndGetState(svc);
      expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=exchange');
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Xero callback failed'));
    } finally {
      errSpy.mockRestore();
    }
  });

  it('the catch-all log carries the error name or Prisma code, never the message (it can hold token ciphertext)', async () => {
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const validation = Object.assign(new Error('Invalid value for accessTokenEnc: "enc(acc)"'), { name: 'PrismaClientValidationError' });
      const known = Object.assign(new Error('Unique constraint failed on refreshTokenEnc enc(ref)'), { code: 'P2002' });
      for (const e of [validation, known]) {
        const { svc, repo } = setup();
        repo.saveConnected.mockRejectedValueOnce(e);
        const state = await connectAndGetState(svc);
        expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=exchange');
      }
      const logged = errSpy.mock.calls.map((c) => String(c[0]));
      expect(logged).toEqual([
        expect.stringContaining('PrismaClientValidationError'),
        expect.stringContaining('P2002'),
      ]);
      expect(logged.join(' ')).not.toContain('enc(');
      expect(logged.join(' ')).not.toContain('Invalid value');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('redirects with reason=state when Redis is unavailable, without throwing', async () => {
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const { svc, redis } = setup();
      const state = await connectAndGetState(svc);
      redis.getdel = async () => {
        throw new Error('redis down');
      };
      expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=state');
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('could not verify state'));
    } finally {
      errSpy.mockRestore();
    }
  });

  describe('tenant selection is scoped to this authorisation event', () => {
    const token = jwt({ authentication_event_id: 'evt-1', sub: 'user-1' });
    const exchange = () => jest.fn().mockResolvedValue({ access_token: token, refresh_token: 'ref', expires_in: 1800 });

    it('a stale earlier connection plus one new pick connects (the filtered call passes authEventId)', async () => {
      const { svc, identity, repo } = setup({ exchange: exchange(), connections: { all: [STALE, PICKED], byEvent: { 'evt-1': [PICKED] } } });
      const state = await connectAndGetState(svc);
      expect(await svc.handleCallback({ code: 'c', state })).toBe('http://localhost:5173/settings?tab=xero&xero=connected');
      expect(identity.listConnections).toHaveBeenCalledWith(token, 'evt-1');
      expect(repo.saveConnected).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', connectionId: 'conn-1' }));
      expect(identity.revoke).not.toHaveBeenCalled();
    });

    it('two organisations picked on THIS consent are still refused as multiple_tenants', async () => {
      const { svc, identity, repo } = setup({ exchange: exchange(), connections: { all: [PICKED], byEvent: { 'evt-1': [STALE, PICKED] } } });
      const state = await connectAndGetState(svc);
      expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=multiple_tenants');
      expect(identity.revoke).toHaveBeenCalledWith('ref');
      expect(repo.saveConnected).not.toHaveBeenCalled();
    });

    it('an empty filtered set is no_tenant (no second fallback to the unfiltered list)', async () => {
      const { svc } = setup({ exchange: exchange(), connections: { all: [PICKED], byEvent: {} } });
      const state = await connectAndGetState(svc);
      expect(await svc.handleCallback({ code: 'c', state })).toContain('reason=no_tenant');
    });

    it.each([
      ['not a JWT', 'acc'],
      ['a JWT without the claim', jwt({ sub: 'user-1' })],
      ['a JWT with an unparseable payload', 'hdr.%%%not-base64-json.sig'],
    ])('falls back to the unfiltered list for %s', async (_label, accessToken) => {
      const { svc, identity } = setup({
        exchange: jest.fn().mockResolvedValue({ access_token: accessToken, refresh_token: 'ref', expires_in: 1800 }),
        connections: { all: [PICKED], byEvent: {} },
      });
      const state = await connectAndGetState(svc);
      expect(await svc.handleCallback({ code: 'c', state })).toContain('xero=connected');
      expect(identity.listConnections).toHaveBeenCalledWith(accessToken, undefined);
    });
  });

  it('a first-ever connect queues a FULL sync; reconnecting the same org queues an incremental one', async () => {
    const first = setup();
    await first.svc.handleCallback({ code: 'c', state: await connectAndGetState(first.svc) });
    expect(first.queue.add).toHaveBeenCalledWith('xero-sync-run', { entity: 'all', full: true }, { attempts: 5 });

    const again = setup({ existing: { tenantId: 'tenant-1', status: 'DISCONNECTED' } });
    expect(await again.svc.handleCallback({ code: 'c', state: await connectAndGetState(again.svc) })).toContain('xero=connected');
    expect(again.queue.add).toHaveBeenCalledWith('xero-sync-run', { entity: 'all', full: false }, { attempts: 5 });
  });

  it('post-save side effects are best-effort: an audit or enqueue failure after save still redirects to connected', async () => {
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const a = setup();
      a.audit.create.mockRejectedValueOnce(new Error('audit db down'));
      expect(await a.svc.handleCallback({ code: 'c', state: await connectAndGetState(a.svc) })).toBe('http://localhost:5173/settings?tab=xero&xero=connected');
      expect(a.repo.saveConnected).toHaveBeenCalled();
      expect(a.queue.add).toHaveBeenCalled(); // the first sync still queued

      const b = setup();
      b.queue.add.mockRejectedValueOnce(new Error('redis down'));
      expect(await b.svc.handleCallback({ code: 'c', state: await connectAndGetState(b.svc) })).toBe('http://localhost:5173/settings?tab=xero&xero=connected');

      const logged = errSpy.mock.calls.map((c) => String(c[0]));
      expect(logged).toHaveLength(2);
      expect(logged.join(' ')).not.toContain('audit db down');
      expect(logged.join(' ')).not.toContain('redis down');
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('XeroAuthService.disconnect', () => {
  it('removes the connection at Xero, revokes the latest refresh token, then clears locally', async () => {
    const { svc, identity, repo, tokens } = setup({ existing: { status: 'CONNECTED', connectionId: 'conn-1', refreshTokenEnc: 'enc(ref-latest)' } });
    await expect(svc.disconnect()).resolves.toEqual({ disconnected: true });
    expect(tokens.getAccessToken).toHaveBeenCalled();
    expect(identity.deleteConnection).toHaveBeenCalledWith('acc', 'conn-1');
    expect(identity.revoke).toHaveBeenCalledWith('ref-latest');
    expect(repo.markDisconnected).toHaveBeenCalledTimes(1);
    // Revoking first would kill the grant the DELETE /connections call needs; clearing locally comes last.
    expect(identity.deleteConnection.mock.invocationCallOrder[0]).toBeLessThan(identity.revoke.mock.invocationCallOrder[0]);
    expect(identity.revoke.mock.invocationCallOrder[0]).toBeLessThan(repo.markDisconnected.mock.invocationCallOrder[0]);
  });

  it('the Xero-side delete is best-effort: a token failure still revokes and clears locally', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { svc, identity, repo, tokens } = setup({ existing: { status: 'CONNECTED', connectionId: 'conn-1', refreshTokenEnc: 'enc(ref)' } });
      tokens.getAccessToken.mockRejectedValueOnce(new Error('Xero needs to be reconnected'));
      await expect(svc.disconnect()).resolves.toEqual({ disconnected: true });
      expect(identity.deleteConnection).not.toHaveBeenCalled();
      expect(identity.revoke).toHaveBeenCalledWith('ref');
      expect(repo.markDisconnected).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('clearing locally'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a row that is not CONNECTED skips the Xero-side delete but still clears locally', async () => {
    const { svc, identity, repo, tokens } = setup({ existing: { status: 'NEEDS_RECONNECT', connectionId: 'conn-1', refreshTokenEnc: null } });
    await svc.disconnect();
    expect(tokens.getAccessToken).not.toHaveBeenCalled();
    expect(identity.deleteConnection).not.toHaveBeenCalled();
    expect(identity.revoke).not.toHaveBeenCalled();
    expect(repo.markDisconnected).toHaveBeenCalledTimes(1);
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

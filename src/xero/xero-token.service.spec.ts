import { Logger } from '@nestjs/common';
import { XeroTokenService } from './xero-token.service';
import { XeroInvalidGrantError, XeroReconnectRequiredError } from './xero-errors';

class FakeLockRedis {
  store = new Map<string, string>();
  async set(k: string, v: string) {
    if (this.store.has(k)) return null;
    this.store.set(k, v);
    return 'OK';
  }
  async eval(_s: string, _n: number, k: string, v: string) {
    if (this.store.get(k) === v) {
      this.store.delete(k);
      return 1;
    }
    return 0;
  }
}

/** Simulates a lock whose TTL already expired (or was stolen) by the time release() runs. */
class FakeLockRedisLostRelease extends FakeLockRedis {
  async eval(_s: string, _n: number, k: string, _v: string) {
    this.store.delete(k);
    return 0 as const;
  }
}

const crypto = { encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1') };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'singleton', status: 'CONNECTED', tenantId: 'tenant-1',
    accessTokenEnc: 'enc(old-access)', refreshTokenEnc: 'enc(old-refresh)',
    accessExpiresAt: new Date(Date.now() + 20 * 60_000), refreshedAt: new Date(Date.now() - 10 * 60_000),
    ...over,
  };
}

function setup(rowOver: Record<string, unknown> = {}, refreshImpl?: () => Promise<unknown>) {
  const row: Record<string, any> = makeRow(rowOver);
  // Compare-and-set, like the real repository: writes only while the row is still
  // CONNECTED with the refresh token the caller read, and reports whether it wrote.
  const stillOurs = (readEnc: string) => row.status === 'CONNECTED' && row.refreshTokenEnc === readEnc;
  const repo = {
    get: jest.fn(async () => ({ ...row })),
    saveTokens: jest.fn(async (readEnc: string, d: Record<string, unknown>) => {
      if (!stillOurs(readEnc)) return false;
      Object.assign(row, d);
      return true;
    }),
    markNeedsReconnect: jest.fn(async (readEnc: string, e: string) => {
      if (!stillOurs(readEnc)) return false;
      row.status = 'NEEDS_RECONNECT';
      row.lastError = e;
      return true;
    }),
  };
  const identity = {
    refresh: jest.fn(refreshImpl ?? (async () => { await sleep(30); return { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 1800 }; })),
  };
  const redis = new FakeLockRedis();
  const queues = { redis: async () => redis };
  const svc = new XeroTokenService(repo as never, identity as never, crypto as never, queues as never);
  svc.pollMs = 5;
  svc.waitTimeoutMs = 1_000;
  return { svc, repo, identity, redis, row };
}

describe('XeroTokenService.getAccessToken', () => {
  // A successful refresh logs one fixed line by design; silence it and assert on it where it matters.
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('returns the stored token while it is fresh (no refresh)', async () => {
    const { svc, identity } = setup();
    await expect(svc.getAccessToken()).resolves.toEqual({ accessToken: 'old-access', tenantId: 'tenant-1' });
    expect(identity.refresh).not.toHaveBeenCalled();
  });

  it('refreshes a stale token and persists the rotated refresh token encrypted', async () => {
    const { svc, identity, repo, row } = setup({ accessExpiresAt: new Date(Date.now() + 30_000) });
    await expect(svc.getAccessToken()).resolves.toEqual({ accessToken: 'new-access', tenantId: 'tenant-1' });
    expect(identity.refresh).toHaveBeenCalledWith('old-refresh');
    expect(repo.saveTokens).toHaveBeenCalledWith('enc(old-refresh)', expect.objectContaining({ refreshTokenEnc: 'enc(new-refresh)' }));
    expect(row.refreshTokenEnc).toBe('enc(new-refresh)');
    expect(row.accessTokenEnc).toBe('enc(new-access)');
  });

  it('two concurrent callers cause exactly ONE refresh and both get the new token', async () => {
    const { svc, identity, redis } = setup({ accessExpiresAt: new Date(Date.now() - 1_000) });
    const [a, b] = await Promise.all([svc.getAccessToken(), svc.getAccessToken()]);
    expect(identity.refresh).toHaveBeenCalledTimes(1);
    expect(a.accessToken).toBe('new-access');
    expect(b.accessToken).toBe('new-access');
    expect(redis.store.size).toBe(0); // lock released
  });

  it('re-reads after taking the lock and skips a refresh another process just did', async () => {
    const { svc, repo, identity } = setup();
    const stale = makeRow({ accessExpiresAt: new Date(Date.now() - 1_000) });
    const fresh = makeRow({ accessTokenEnc: 'enc(other-process)', refreshedAt: new Date() });
    repo.get.mockResolvedValueOnce(stale as never).mockResolvedValue(fresh as never);
    await expect(svc.getAccessToken()).resolves.toEqual({ accessToken: 'other-process', tenantId: 'tenant-1' });
    expect(identity.refresh).not.toHaveBeenCalled();
  });

  it('invalid_grant marks NEEDS_RECONNECT, throws a no-retry error, and releases the lock', async () => {
    const { svc, repo, redis } = setup({ accessExpiresAt: new Date(Date.now() - 1_000) }, async () => {
      throw new XeroInvalidGrantError();
    });
    await expect(svc.getAccessToken()).rejects.toBeInstanceOf(XeroReconnectRequiredError);
    expect(repo.markNeedsReconnect).toHaveBeenCalledWith('enc(old-refresh)', expect.stringContaining('invalid_grant'));
    expect(redis.store.size).toBe(0);
  });

  it('throws XeroReconnectRequiredError when not connected', async () => {
    const { svc } = setup({ status: 'DISCONNECTED', accessTokenEnc: null, refreshTokenEnc: null });
    await expect(svc.getAccessToken()).rejects.toBeInstanceOf(XeroReconnectRequiredError);
  });

  it('force refreshes even a fresh token (keep-alive)', async () => {
    const { svc, identity } = setup();
    await svc.getAccessToken({ force: true });
    expect(identity.refresh).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when the lock TTL expired before release, but still returns the refreshed token', async () => {
    const row: Record<string, any> = makeRow({ accessExpiresAt: new Date(Date.now() - 1_000) });
    const repo = {
      get: jest.fn(async () => ({ ...row })),
      saveTokens: jest.fn(async (_readEnc: string, d: Record<string, unknown>) => {
        Object.assign(row, d);
        return true;
      }),
      markNeedsReconnect: jest.fn(),
    };
    const identity = {
      refresh: jest.fn(async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 1800 })),
    };
    const redis = new FakeLockRedisLostRelease();
    const queues = { redis: async () => redis };
    const svc = new XeroTokenService(repo as never, identity as never, crypto as never, queues as never);
    svc.pollMs = 5;
    svc.waitTimeoutMs = 1_000;

    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(svc.getAccessToken()).resolves.toEqual({ accessToken: 'new-access', tenantId: 'tenant-1' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('lock'));
    const loggedText = warnSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(loggedText).not.toContain('new-access');
    expect(loggedText).not.toContain('new-refresh');
    warnSpy.mockRestore();
  });
});

describe('XeroTokenService: a refresh racing a reconnect or disconnect', () => {
  const stale = { accessExpiresAt: new Date(Date.now() + 30_000) };
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  const logged = () => [...warnSpy.mock.calls, ...logSpy.mock.calls].map((c) => String(c[0])).join(' ');

  it('a row replaced mid-refresh (reconnect) is not overwritten, and the CURRENT token is returned', async () => {
    let row: Record<string, any> = {};
    const t = setup(stale, async () => {
      // An Owner reconnects while our refresh is in flight: a brand-new grant lands in the row.
      Object.assign(row, { accessTokenEnc: 'enc(reconnect-access)', refreshTokenEnc: 'enc(reconnect-refresh)', accessExpiresAt: new Date(Date.now() + 30 * 60_000), refreshedAt: new Date() });
      return { access_token: 'old-grant-access', refresh_token: 'old-grant-refresh', expires_in: 1800 };
    });
    row = t.row;
    await expect(t.svc.getAccessToken()).resolves.toEqual({ accessToken: 'reconnect-access', tenantId: 'tenant-1' });
    expect(t.repo.saveTokens).toHaveBeenCalledWith('enc(old-refresh)', expect.anything());
    expect(t.row.refreshTokenEnc).toBe('enc(reconnect-refresh)');
    expect(t.row.accessTokenEnc).toBe('enc(reconnect-access)');
    expect(t.identity.refresh).toHaveBeenCalledTimes(1); // no loop, no second refresh
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(logged()).not.toContain('old-grant');
  });

  it('a row disconnected mid-refresh gives reconnect-required and nothing is written', async () => {
    let row: Record<string, any> = {};
    const t = setup(stale, async () => {
      Object.assign(row, { status: 'DISCONNECTED', accessTokenEnc: null, refreshTokenEnc: null, accessExpiresAt: null });
      return { access_token: 'old-grant-access', refresh_token: 'old-grant-refresh', expires_in: 1800 };
    });
    row = t.row;
    await expect(t.svc.getAccessToken()).rejects.toBeInstanceOf(XeroReconnectRequiredError);
    expect(t.row).toMatchObject({ status: 'DISCONNECTED', accessTokenEnc: null, refreshTokenEnc: null });
    expect(t.redis.store.size).toBe(0);
    expect(logged()).not.toContain('old-grant');
  });

  it('invalid_grant on the OLD grant after a reconnect does not mark the new grant NEEDS_RECONNECT', async () => {
    let row: Record<string, any> = {};
    const t = setup(stale, async () => {
      Object.assign(row, { accessTokenEnc: 'enc(reconnect-access)', refreshTokenEnc: 'enc(reconnect-refresh)' });
      throw new XeroInvalidGrantError();
    });
    row = t.row;
    await expect(t.svc.getAccessToken()).rejects.toBeInstanceOf(XeroReconnectRequiredError);
    expect(t.repo.markNeedsReconnect).toHaveBeenCalledWith('enc(old-refresh)', expect.any(String));
    expect(t.row.status).toBe('CONNECTED');
    expect(t.row.lastError).toBeUndefined();
  });
});

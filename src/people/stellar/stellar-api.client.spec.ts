import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MAX_DAYS_PER_CALL,
  READ_OPERATIONS,
  STELLAR_CALL_INTERVAL_MS,
  StellarApiClient,
  StellarApiError,
  StellarRateLimitedError,
} from './stellar-api.client';

const CODE = 'secret-auth-code-123';

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    set: jest.fn(async (key: string, _v: string, _px: 'PX', ttl: number, _nx: 'NX') => {
      if (store.has(key)) return null;
      store.set(key, ttl);
      return 'OK';
    }),
    pttl: jest.fn(async (key: string) => store.get(key) ?? -2),
  };
}

function make(response: { status?: number; body: unknown } = { body: { log: [] } }) {
  const redis = fakeRedis();
  const fetchFn = jest.fn(async () => ({
    ok: (response.status ?? 200) < 400,
    status: response.status ?? 200,
    text: async () => (typeof response.body === 'string' ? response.body : JSON.stringify(response.body)),
  })) as unknown as jest.Mock;
  const client = new StellarApiClient({ authUser: 'test-user', authCode: CODE }, async () => redis, fetchFn as never, 'https://example.test/api');
  return { client, redis, fetchFn };
}

describe('StellarApiClient', () => {
  it('sends one read-only fetch_log POST with the credentials in the body', async () => {
    const { client, fetchFn } = make();
    await client.fetchLog('2026-10-10', '2026-10-12');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/api');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      operation: 'fetch_log',
      auth_user: 'test-user',
      auth_code: CODE,
      start_date: '2026-10-10',
      end_date: '2026-10-12',
      start_time: '00:00:00',
      end_time: '23:59:59',
    });
  });

  it('a second call inside five minutes is refused before any request', async () => {
    const { client, fetchFn, redis } = make();
    await client.fetchLog('2026-10-12', '2026-10-12');
    expect(redis.set).toHaveBeenCalledWith('stellar:api:slot', expect.any(String), 'PX', STELLAR_CALL_INTERVAL_MS, 'NX');
    const err = await client.fetchLog('2026-10-12', '2026-10-12').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StellarRateLimitedError);
    expect((err as StellarRateLimitedError).retryAt.getTime()).toBeGreaterThan(Date.now() + STELLAR_CALL_INTERVAL_MS - 5_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a range the API would silently cut short', async () => {
    const { client, fetchFn } = make();
    await expect(client.fetchLog('2026-10-01', '2026-10-12')).rejects.toBeInstanceOf(RangeError);
    await expect(client.fetchLog('2026-10-12', '2026-10-11')).rejects.toBeInstanceOf(RangeError);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(StellarApiClient.windows('2026-10-01', '2026-10-07')).toEqual([
      { from: '2026-10-01', to: '2026-10-03' },
      { from: '2026-10-04', to: '2026-10-06' },
      { from: '2026-10-07', to: '2026-10-07' },
    ]);
    expect(MAX_DAYS_PER_CALL).toBe(3);
  });

  it('errors never carry the auth code', async () => {
    for (const response of [{ status: 500, body: 'oops' }, { body: 'not json' }, { body: { error: 'bad auth' } }]) {
      const err = await make(response).client.fetchLog('2026-10-12', '2026-10-12').catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(String((err as Error).message)).not.toContain(CODE);
    }
    const http = await make({ status: 500, body: 'x' }).client.fetchLog('2026-10-12', '2026-10-12').catch((e) => e);
    expect(http).toBeInstanceOf(StellarApiError);
  });

  it('without credentials it is not configured and calls nothing', async () => {
    const redis = fakeRedis();
    const fetchFn = jest.fn();
    const client = new StellarApiClient(null, async () => redis, fetchFn as never);
    expect(client.configured).toBe(false);
    await expect(client.fetchLog('2026-10-12', '2026-10-12')).rejects.toBeInstanceOf(StellarApiError);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('guardrail: the client can only name read operations', () => {
    expect([...READ_OPERATIONS].sort()).toEqual(['fetch_device_detail', 'fetch_log', 'fetch_user_list']);
    const src = readFileSync(join(__dirname, 'stellar-api.client.ts'), 'utf8');
    for (const op of ['delete_permanently', 'remove_user_from_device', 'add_user', 'update_user'])
      expect(src).not.toContain(op);
    // Every operation string sent is one of READ_OPERATIONS (the `call` signature takes only those).
    expect(src).toMatch(/private async call\(operation: StellarReadOperation/);
  });
});

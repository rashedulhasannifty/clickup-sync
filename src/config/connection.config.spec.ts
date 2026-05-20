import { buildBullConnection, buildPgPoolConfig } from './connection.config';

describe('buildBullConnection', () => {
  it('passes the redis url through', () => {
    expect(buildBullConnection('redis://127.0.0.1:6379').url).toBe('redis://127.0.0.1:6379');
  });

  it('sets maxRetriesPerRequest to null (BullMQ requires this for blocking commands)', () => {
    expect(buildBullConnection('redis://127.0.0.1:6379').maxRetriesPerRequest).toBeNull();
  });

  it('retries forever with increasing, capped backoff so a proxy blip self-heals', () => {
    const { retryStrategy } = buildBullConnection('redis://127.0.0.1:6379');
    expect(typeof retryStrategy).toBe('function');
    expect(retryStrategy(1)).toBeGreaterThan(0);
    expect(retryStrategy(5)).toBeGreaterThan(retryStrategy(1));
    expect(retryStrategy(1_000_000)).toBe(10_000); // capped, not unbounded
    expect(retryStrategy(1_000_000)).not.toBeNull(); // a number means "keep trying"
  });
});

describe('buildPgPoolConfig', () => {
  it('passes the database url through as connectionString', () => {
    expect(buildPgPoolConfig('postgresql://u:p@127.0.0.1:5433/db').connectionString).toBe(
      'postgresql://u:p@127.0.0.1:5433/db',
    );
  });

  it('enables TCP keepAlive so a severed socket is detected and evicted from the pool', () => {
    const cfg = buildPgPoolConfig('postgresql://u:p@127.0.0.1:5433/db');
    expect(cfg.keepAlive).toBe(true);
    expect(cfg.keepAliveInitialDelayMillis).toBeGreaterThan(0);
  });

  it('bounds how long a new connection attempt waits before failing fast', () => {
    expect(
      buildPgPoolConfig('postgresql://u:p@127.0.0.1:5433/db').connectionTimeoutMillis,
    ).toBeGreaterThan(0);
  });
});

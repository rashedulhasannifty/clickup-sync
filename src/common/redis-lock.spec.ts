import { acquireLock, type LockRedis } from './redis-lock';

/** Minimal in-memory stand-in for the two Redis commands the lock uses. */
export class FakeLockRedis implements LockRedis {
  store = new Map<string, string>();
  async set(key: string, value: string, _px: 'PX', _ttl: number, _nx: 'NX') {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async eval(_script: string, _n: number, key: string, token: string) {
    if (this.store.get(key) === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

describe('acquireLock', () => {
  it('grants the lock once and refuses a second holder', async () => {
    const redis = new FakeLockRedis();
    const a = await acquireLock(redis, 'k', 1000);
    const b = await acquireLock(redis, 'k', 1000);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('release frees the key for the next caller', async () => {
    const redis = new FakeLockRedis();
    const a = await acquireLock(redis, 'k', 1000);
    expect(await a!.release()).toBe(true);
    expect(await acquireLock(redis, 'k', 1000)).not.toBeNull();
  });

  it("a stale holder cannot delete someone else's lock", async () => {
    const redis = new FakeLockRedis();
    const a = await acquireLock(redis, 'k', 1000);
    redis.store.set('k', 'someone-else'); // a's TTL expired and another process took it
    expect(await a!.release()).toBe(false);
    expect(redis.store.get('k')).toBe('someone-else');
  });
});

import { randomBytes } from 'crypto';

/**
 * The two ioredis commands this lock needs. `QueueService.redis()` returns a
 * full ioredis client; cast it to this at the call site.
 */
export interface LockRedis {
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface LockHandle {
  readonly token: string;
  /** True if we still held the lock and deleted it; false if it had expired or moved on. */
  release(): Promise<boolean>;
}

// Compare-and-delete. A plain DEL could remove a lock that expired and was
// re-acquired by another process while we were still working.
const RELEASE_LUA =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/**
 * Single-holder mutex over `SET key token PX ttl NX`. Returns null when another
 * holder has it. Callers decide whether to wait or give up. The TTL is the
 * safety net for a holder that crashes without releasing.
 */
export async function acquireLock(redis: LockRedis, key: string, ttlMs: number): Promise<LockHandle | null> {
  const token = randomBytes(16).toString('hex');
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  return {
    token,
    release: async () => Number(await redis.eval(RELEASE_LUA, 1, key, token)) === 1,
  };
}

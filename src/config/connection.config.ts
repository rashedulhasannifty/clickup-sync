import type { PoolConfig } from 'pg';

const RETRY_STEP_MS = 500;
const RETRY_CAP_MS = 10_000;
const PG_KEEPALIVE_INITIAL_DELAY_MS = 10_000;
const PG_CONNECTION_TIMEOUT_MS = 10_000;

export interface BullConnectionOptions {
  url: string;
  /**
   * BullMQ requires this to be `null` for its blocking commands; any other
   * value makes workers throw instead of waiting on the queue.
   */
  maxRetriesPerRequest: null;
  /**
   * Returning a number always reconnects (never `null`), so a transient
   * loopback/proxy abort self-heals instead of flooding logs.
   */
  retryStrategy: (times: number) => number;
}

export function buildBullConnection(redisUrl: string): BullConnectionOptions {
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * RETRY_STEP_MS, RETRY_CAP_MS),
  };
}

export function buildPgPoolConfig(databaseUrl: string): PoolConfig {
  return {
    connectionString: databaseUrl,
    keepAlive: true,
    keepAliveInitialDelayMillis: PG_KEEPALIVE_INITIAL_DELAY_MS,
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
  };
}

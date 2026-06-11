import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import { QueueService } from '../queues/queue.service';
import { QUEUES } from '../queues/queue.constants';

const PING_TIMEOUT_MS = 3000;

/**
 * Liveness check for the Redis/BullMQ backbone. Without it `/health` reports
 * green on Postgres alone while Redis is down — at which point every queue and
 * worker is silently dead and webhooks pile up unprocessed. All queues share
 * one Redis connection, so pinging any single queue's client proves the whole
 * backbone is reachable.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicator: HealthIndicatorService,
    private readonly queues: QueueService,
  ) {}

  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicator.check(key);
    try {
      const client = await this.queues.get(QUEUES.CLICKUP_WEBHOOKS).client;
      // Bound the ping so a down/unreachable Redis fails the check fast instead
      // of hanging on ioredis's reconnect loop and stalling the whole probe.
      const pong = await this.withTimeout(client.ping(), PING_TIMEOUT_MS);
      if (pong !== 'PONG') return indicator.down({ message: `unexpected ping reply: ${pong}` });
      return indicator.up();
    } catch (e) {
      return indicator.down({ message: (e as Error)?.message ?? 'redis ping failed' });
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`redis ping timed out after ${ms}ms`)), ms)),
    ]);
  }
}

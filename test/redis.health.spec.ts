import { RedisHealthIndicator } from '../src/health/redis.health';
import { QUEUES } from '../src/queues/queue.constants';

function make(client: any) {
  const session = {
    up: jest.fn().mockReturnValue({ redis: { status: 'up' } }),
    down: jest.fn().mockReturnValue({ redis: { status: 'down' } }),
  };
  const healthIndicator = { check: jest.fn().mockReturnValue(session) } as any;
  const queues = { get: jest.fn().mockReturnValue({ client: Promise.resolve(client) }) } as any;
  return { indicator: new RedisHealthIndicator(healthIndicator, queues), session, queues };
}

describe('RedisHealthIndicator', () => {
  it('reports up when the queue Redis client returns PONG', async () => {
    const { indicator, session, queues } = make({ ping: jest.fn().mockResolvedValue('PONG') });
    await indicator.isHealthy('redis');
    expect(queues.get).toHaveBeenCalledWith(QUEUES.CLICKUP_WEBHOOKS);
    expect(session.up).toHaveBeenCalled();
    expect(session.down).not.toHaveBeenCalled();
  });

  it('reports down on an unexpected ping reply', async () => {
    const { indicator, session } = make({ ping: jest.fn().mockResolvedValue('NOPE') });
    await indicator.isHealthy('redis');
    expect(session.down).toHaveBeenCalled();
    expect(session.up).not.toHaveBeenCalled();
  });

  it('reports down (not throws) when the ping rejects — Redis unreachable', async () => {
    const { indicator, session } = make({ ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    await expect(indicator.isHealthy('redis')).resolves.toBeDefined();
    expect(session.down).toHaveBeenCalled();
  });
});

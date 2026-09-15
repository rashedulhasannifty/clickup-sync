import { Logger } from '@nestjs/common';
import { XeroScheduler } from './xero.scheduler';

function setup(status: string | null, busy: string[] = []) {
  const queue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue(busy.map((name) => ({ name }))) };
  const queues = { get: jest.fn(() => queue), defaultJobOptions: () => ({ attempts: 5 }) };
  const repo = { get: jest.fn().mockResolvedValue(status ? { status } : null) };
  return { s: new XeroScheduler(queues as never, repo as never), queue, queues };
}

describe('XeroScheduler', () => {
  it('enqueues the hourly sync on the xero-sync queue when connected and idle', async () => {
    const { s, queue, queues } = setup('CONNECTED');
    await s.hourlySync();
    expect(queues.get).toHaveBeenCalledWith('xero-sync');
    expect(queue.add).toHaveBeenCalledWith('xero-sync-run', { entity: 'all' }, { attempts: 5 });
  });

  it('skips every cron when not connected', async () => {
    for (const status of [null, 'DISCONNECTED', 'NEEDS_RECONNECT']) {
      const { s, queue } = setup(status);
      await s.hourlySync();
      await s.nightlyReconcile();
      await s.keepalive();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it('skips a job whose previous run is still in flight, but not other job types', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { s, queue } = setup('CONNECTED', ['xero-sync-run']);
    await s.hourlySync();
    expect(queue.add).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('xero-sync-run'));
    await s.nightlyReconcile();
    expect(queue.add).toHaveBeenCalledWith('xero-reconcile-open', { entity: 'all' }, { attempts: 5 });
    warn.mockRestore();
  });

  it('keep-alive enqueues the token keep-alive job', async () => {
    const { s, queue } = setup('CONNECTED');
    await s.keepalive();
    expect(queue.add).toHaveBeenCalledWith('xero-token-keepalive', { entity: 'all' }, { attempts: 5 });
  });
});

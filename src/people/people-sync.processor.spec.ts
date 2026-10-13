import { DelayedError, UnrecoverableError } from 'bullmq';
import { ProviderRateLimitedError } from './attendance-provider';
import { PeopleSyncProcessor } from './people-sync.processor';

function make(run: jest.Mock) {
  const sync = {
    run,
    enqueue: jest.fn().mockResolvedValue({ queued: true }),
    split: jest.fn(),
  };
  const jobLogs = {
    started: jest.fn().mockResolvedValue({ id: 1n }),
    finished: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new PeopleSyncProcessor(sync as never, jobLogs as never, {} as never);
  return { processor, sync, jobLogs };
}
const job = (data: Record<string, unknown>) => ({
  id: 'j1',
  name: 'sync-attendance',
  data: { entity: 'attendance', lookbackDays: 7, trigger: 'cron', ...data },
  moveToDelayed: jest.fn().mockResolvedValue(undefined),
  updateData: jest.fn().mockResolvedValue(undefined),
  attemptsMade: 0,
  opts: { attempts: 5 },
});

describe('PeopleSyncProcessor', () => {
  it('queues the older part of a long window as its own job', async () => {
    const { processor, sync } = make(
      jest.fn().mockResolvedValue({ remaining: { from: '2026-10-01', to: '2026-10-04' } }),
    );
    await processor.process(job({}) as never, 'tok');
    expect(sync.run).toHaveBeenCalledWith(7, undefined);
    expect(sync.enqueue).toHaveBeenCalledWith(7, 'cron', { from: '2026-10-01', to: '2026-10-04' });
  });

  it('runs an explicit window, and refuses a malformed one without retrying', async () => {
    const { processor, sync } = make(jest.fn().mockResolvedValue({ remaining: null }));
    await processor.process(job({ from: '2026-10-01', to: '2026-10-04' }) as never, 'tok');
    expect(sync.run).toHaveBeenCalledWith(7, { from: '2026-10-01', to: '2026-10-04' });
    expect(sync.enqueue).not.toHaveBeenCalled();
    await expect(processor.process(job({ from: '2026-10-05', to: '2026-10-04' }) as never, 'tok')).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('a rate-limited call waits for the slot instead of failing', async () => {
    const retryAt = new Date(Date.now() + 200_000);
    const { processor, jobLogs } = make(jest.fn().mockRejectedValue(new ProviderRateLimitedError('wait', retryAt)));
    const j = job({});
    await expect(processor.process(j as never, 'tok')).rejects.toBeInstanceOf(DelayedError);
    expect(j.moveToDelayed).toHaveBeenCalledWith(retryAt.getTime() + 1_000, 'tok');
    expect(jobLogs.failed).not.toHaveBeenCalled();
    expect(jobLogs.finished).toHaveBeenCalledWith(1n, undefined, 'delayed', 'wait');
  });

  it('a piece that fails for good still lets the older days be fetched, and only names itself', async () => {
    const { processor, sync, jobLogs } = make(jest.fn().mockRejectedValue(new Error('HTTP 502')));
    sync.split.mockReturnValue({
      chunk: { from: '2026-10-05', to: '2026-10-07' },
      remaining: { from: '2026-10-01', to: '2026-10-04' },
    });
    const early = job({ from: '2026-10-01', to: '2026-10-07' });
    await expect(processor.process(early as never, 'tok')).rejects.toThrow('HTTP 502');
    expect(sync.enqueue).not.toHaveBeenCalled(); // attempts left: BullMQ retries it

    const last = { ...job({ from: '2026-10-01', to: '2026-10-07' }), attemptsMade: 4 };
    await expect(processor.process(last as never, 'tok')).rejects.toThrow('HTTP 502');
    expect(jobLogs.failed).toHaveBeenCalled();
    expect(last.updateData).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-05', to: '2026-10-07' }));
    expect(sync.enqueue).toHaveBeenCalledWith(7, 'cron', { from: '2026-10-01', to: '2026-10-04' });
  });
});

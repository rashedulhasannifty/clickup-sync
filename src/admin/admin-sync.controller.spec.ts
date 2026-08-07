import { BadRequestException } from '@nestjs/common';
import { AdminSyncController } from './admin-sync.controller';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

function makeController(overrides: Partial<Record<string, any>> = {}) {
  const queues = overrides.queues ?? { get: () => ({ add: jest.fn() }), defaultJobOptions: () => ({}) };
  const settings = overrides.settings ?? {};
  const prisma = overrides.prisma ?? {};
  const tasksRepo = overrides.tasksRepo ?? {};
  const timeEntriesRepo = overrides.timeEntriesRepo ?? {};
  return new AdminSyncController(queues as any, settings as any, prisma as any, tasksRepo as any, timeEntriesRepo as any);
}

describe('POST reconcile-window', () => {
  it('enqueues one job per configured space per 30-day slice for a 90-day lookback', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const controller = makeController({ queues: { get: () => ({ add }), defaultJobOptions: () => ({}) } });

    const res = await controller.reconcileTimeEntriesWindow({ lookbackDays: 90 });

    const slices = Math.ceil(90 / 30); // 3
    expect(res.queued).toBe(CLICKUP_SPACES.length * slices);
    expect(add).toHaveBeenCalledTimes(CLICKUP_SPACES.length * slices);
    // each add is the windowed reconcile job, deprioritized
    const [name, payload, opts] = add.mock.calls[0];
    expect(name).toBe('reconcile-time-entries-window');
    expect(opts.priority).toBe(100);
    // payload keys must match what TimeEntrySyncProcessor destructures for
    // RECONCILE_TIME_ENTRIES_WINDOW (spaceId/startDate/endDate), not e.g. startMs/endMs.
    expect(payload).toEqual({ spaceId: expect.any(String), startDate: expect.any(Number), endDate: expect.any(Number) });
  });

  it('rejects an unknown spaceId', async () => {
    const controller = makeController({ queues: { get: () => ({ add: jest.fn() }), defaultJobOptions: () => ({}) } });
    await expect(controller.reconcileTimeEntriesWindow({ spaceId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

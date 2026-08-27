import { BadRequestException } from '@nestjs/common';
import { AdminSyncController } from './admin-sync.controller';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { RECONCILE_WINDOW_SLICE_DAYS } from '../sync/reconcile-window.util';
import { BULK_SWEEP_PRIORITY } from '../queues/queue.constants';

function makeController(overrides: Partial<Record<string, any>> = {}) {
  const queues = overrides.queues ?? { get: () => ({ add: jest.fn() }), defaultJobOptions: () => ({}) };
  const settings = overrides.settings ?? {};
  const prisma = overrides.prisma ?? {};
  const tasksRepo = overrides.tasksRepo ?? {};
  const timeEntriesRepo = overrides.timeEntriesRepo ?? {};
  return new AdminSyncController(queues as any, settings as any, prisma as any, tasksRepo as any, timeEntriesRepo as any);
}

describe('POST reconcile-window', () => {
  it('enqueues one job per configured space per date-slice for a 90-day lookback', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const controller = makeController({ queues: { get: () => ({ add }), defaultJobOptions: () => ({}) } });

    const res = await controller.reconcileTimeEntriesWindow({ lookbackDays: 90 });

    // Derive from the shared constant rather than hardcoding: the slice width
    // is sized against PRUNE_SAFETY_MAX_ENTRIES and may shrink again as entry
    // volume grows.
    const slices = Math.ceil(90 / RECONCILE_WINDOW_SLICE_DAYS);
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

  it('clamps an unbounded lookbackDays to the configured maximum instead of fanning out unboundedly', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const controller = makeController({ queues: { get: () => ({ add }), defaultJobOptions: () => ({}) } });

    const res = await controller.reconcileTimeEntriesWindow({ lookbackDays: 100000 });

    const slices = Math.ceil(400 / RECONCILE_WINDOW_SLICE_DAYS); // clamped from the requested 100000 days
    expect(res.queued).toBe(CLICKUP_SPACES.length * slices);
    expect(add).toHaveBeenCalledTimes(CLICKUP_SPACES.length * slices);
  });
});

/**
 * BullMQ treats priority 0 (the default) as the HIGHEST priority: unprioritized
 * jobs sit in the FIFO `wait` list, which is drained before the prioritized set.
 * A bulk sweep left at the default therefore head-of-line-blocks every live
 * webhook job enqueued after it — 50k tasks at the 30 jobs/min ClickUp limiter
 * is ~28 hours of real-time sync lag, with nothing logged or failing to show it.
 */
describe('bulk sweeps must not head-of-line-block live webhook jobs', () => {
  const TASKS = [
    { taskId: 't1', spaceId: CLICKUP_SPACES[0].id },
    { taskId: 't2', spaceId: CLICKUP_SPACES[1].id },
  ];

  it('sync-all deprioritizes every job (shares clickup-time-entries with webhooks)', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const controller = makeController({
      queues: { get: () => ({ add }), defaultJobOptions: () => ({ attempts: 5 }) },
      tasksRepo: { findAllIds: jest.fn().mockResolvedValue(TASKS) },
    });

    await controller.syncAllTimeEntries();

    expect(add).toHaveBeenCalledTimes(TASKS.length);
    add.mock.calls.forEach(([, , opts]) => expect(opts).toMatchObject({ priority: BULK_SWEEP_PRIORITY }));
  });

  it('tasks/reconcile deprioritizes every job (shares clickup-tasks with webhooks)', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const controller = makeController({
      queues: {
        get: () => ({ add, getJobs: jest.fn().mockResolvedValue([]) }),
        defaultJobOptions: () => ({ attempts: 5 }),
      },
      tasksRepo: { findAllIds: jest.fn().mockResolvedValue(TASKS) },
    });

    await controller.reconcileTasks();

    expect(add).toHaveBeenCalledTimes(TASKS.length);
    add.mock.calls.forEach(([, , opts]) => expect(opts).toMatchObject({ priority: BULK_SWEEP_PRIORITY }));
  });

  it('the windowed reconcile stays deprioritized', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const controller = makeController({ queues: { get: () => ({ add }), defaultJobOptions: () => ({}) } });

    await controller.reconcileTimeEntriesWindow({ lookbackDays: 30 });

    add.mock.calls.forEach(([, , opts]) => expect(opts).toMatchObject({ priority: BULK_SWEEP_PRIORITY }));
  });
});

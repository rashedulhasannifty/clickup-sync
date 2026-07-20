import { BadRequestException } from '@nestjs/common';
import { AdminSyncController } from '../src/admin/admin-sync.controller';

describe('AdminSyncController', () => {
  function makeQueues() {
    const add = jest.fn().mockResolvedValue({});
    // getJobs defaults to empty so the reconcile in-flight guard finds no
    // running sweep and proceeds to enqueue.
    const getJobs = jest.fn().mockResolvedValue([]);
    return { get: jest.fn().mockReturnValue({ add, getJobs }), defaultJobOptions: jest.fn().mockReturnValue({}), webhookJobOptions: jest.fn().mockReturnValue({}) } as any;
  }

  function makeSettings(maxBackfillLookbackDays = 1095) {
    return {
      getBackfillMaxLookbackDays: () => maxBackfillLookbackDays,
    } as any;
  }

  function makePrisma() {
    return {
      clickupTask: { findMany: jest.fn().mockResolvedValue([]) },
      syncJobLog: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
  }

  function makeTasksRepo() {
    return { findAllIds: jest.fn().mockResolvedValue([]), countActive: jest.fn().mockResolvedValue(0) } as any;
  }

  function makeTimeEntriesRepo() {
    return { findUnreplacedTaggedEntries: jest.fn().mockResolvedValue([]) } as any;
  }

  function makeCtrl(over: Partial<{ queues: any; settings: any; prisma: any; tasksRepo: any; timeEntriesRepo: any }> = {}) {
    return new AdminSyncController(
      over.queues ?? makeQueues(),
      over.settings ?? makeSettings(),
      over.prisma ?? makePrisma(),
      over.tasksRepo ?? makeTasksRepo(),
      over.timeEntriesRepo ?? makeTimeEntriesRepo(),
    );
  }

  describe('syncTask', () => {
    it('queues SYNC_CLICKUP_TASK on clickup-tasks queue and returns taskId', () => {
      const queues = makeQueues();
      const ctrl = makeCtrl({ queues });
      const result = ctrl.syncTask({ taskId: '86abc' });
      expect(result).toEqual({ queued: true, taskId: '86abc' });
      expect(queues.get).toHaveBeenCalledWith('clickup-tasks');
    });
  });

  describe('backfill', () => {
    it('uses configured lookback when lookbackDays is not provided', () => {
      const result = makeCtrl().backfill({ spaceId: '3577824' });
      expect(result).toEqual({ queued: true, spaceId: '3577824', lookbackDays: 30 });
    });

    it('uses provided lookbackDays over configured default', () => {
      const result = makeCtrl().backfill({ spaceId: '3589129', lookbackDays: 7 });
      expect(result).toEqual({ queued: true, spaceId: '3589129', lookbackDays: 7 });
    });

    it('throws BadRequestException for unknown spaceId', () => {
      expect(() => makeCtrl().backfill({ spaceId: 'bad-id' })).toThrow(BadRequestException);
    });

    it('queues on clickup-backfills queue', () => {
      const queues = makeQueues();
      makeCtrl({ queues }).backfill({ spaceId: '3525433' });
      expect(queues.get).toHaveBeenCalledWith('clickup-backfills');
    });

    it('allows unknown spaceId when allowUnknownSpaces is true', () => {
      const result = makeCtrl().backfill({ spaceId: 'test-space-999', allowUnknownSpaces: true });
      expect(result).toEqual({ queued: true, spaceId: 'test-space-999', lookbackDays: 30 });
    });

    it('uses provided lookbackDays for unknown space instead of default 30', () => {
      const result = makeCtrl().backfill({ spaceId: 'test-space-999', allowUnknownSpaces: true, lookbackDays: 7 });
      expect(result).toEqual({ queued: true, spaceId: 'test-space-999', lookbackDays: 7 });
    });

    it('rejects lookbackDays above the configured cap', () => {
      const ctrl = makeCtrl({ settings: makeSettings(1095) });
      expect(() => ctrl.backfill({ spaceId: '3589129', lookbackDays: 2000 })).toThrow(BadRequestException);
    });

    it('accepts lookbackDays at or below the configured cap', () => {
      const ctrl = makeCtrl({ settings: makeSettings(3650) });
      const result = ctrl.backfill({ spaceId: '3589129', lookbackDays: 2000 });
      expect(result).toEqual({ queued: true, spaceId: '3589129', lookbackDays: 2000 });
    });
  });

  describe('backfillActive', () => {
    function makeQueuesWithJobs(jobsByQueue: Record<string, any[]>) {
      const getJobs = jest.fn((_states: string[]) => Promise.resolve([])); // default
      const queueMocks = new Map<string, any>();
      for (const [name, jobs] of Object.entries(jobsByQueue)) {
        queueMocks.set(name, { getJobs: jest.fn().mockResolvedValue(jobs), add: jest.fn() });
      }
      const get = jest.fn((name: string) => queueMocks.get(name) ?? { getJobs, add: jest.fn() });
      return { get, defaultJobOptions: jest.fn().mockReturnValue({}), webhookJobOptions: jest.fn().mockReturnValue({}) } as any;
    }

    it('returns empty list when no jobs are active', async () => {
      const ctrl = makeCtrl({ queues: makeQueuesWithJobs({ 'clickup-backfills': [], 'clickup-time-entries': [] }) });
      await expect(ctrl.backfillActive()).resolves.toEqual({ spaces: [] });
    });

    it('reports backfill phase as "fetching" with no total', async () => {
      const queues = makeQueuesWithJobs({
        'clickup-backfills': [{ data: { spaceId: '3589129' } }],
        'clickup-time-entries': [],
      });
      const result = await makeCtrl({ queues }).backfillActive();
      expect(result.spaces).toEqual([
        { spaceId: '3589129', phase: 'fetching', total: null, done: null, remaining: 0 },
      ]);
    });

    it('attributes time-entry queue depth to spaces via clickup_tasks', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([
        { taskId: 't1', spaceId: '3589129' },
        { taskId: 't2', spaceId: '3589129' },
        { taskId: 't3', spaceId: '3577824' },
      ]);
      prisma.syncJobLog.findMany.mockResolvedValue([
        { entityId: '3589129', tasksSynced: 100, finishedAt: new Date() },
        { entityId: '3577824', tasksSynced: 50, finishedAt: new Date() },
      ]);
      const queues = makeQueuesWithJobs({
        'clickup-backfills': [],
        'clickup-time-entries': [
          { data: { taskId: 't1' } },
          { data: { taskId: 't2' } },
          { data: { taskId: 't3' } },
        ],
      });
      const result = await makeCtrl({ queues, prisma }).backfillActive();
      const byId = Object.fromEntries(result.spaces.map((s) => [s.spaceId, s]));
      expect(byId['3589129']).toEqual({ spaceId: '3589129', phase: 'time-entries', total: 100, done: 98, remaining: 2 });
      expect(byId['3577824']).toEqual({ spaceId: '3577824', phase: 'time-entries', total: 50, done: 49, remaining: 1 });
    });

    it('clamps done to >= 0 when webhook drains outrun the last backfill', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([{ taskId: 't1', spaceId: 'X' }]);
      prisma.syncJobLog.findMany.mockResolvedValue([{ entityId: 'X', tasksSynced: 0, finishedAt: new Date() }]);
      const queues = makeQueuesWithJobs({
        'clickup-backfills': [],
        'clickup-time-entries': [{ data: { taskId: 't1' } }],
      });
      const result = await makeCtrl({ queues, prisma }).backfillActive();
      // total=0, remaining=1 → would compute done=-1 if not clamped; we fall back to total=remaining=1.
      expect(result.spaces[0]).toMatchObject({ phase: 'time-entries', done: 0, total: 1, remaining: 1 });
    });

    it('backfill-phase entry takes precedence over time-entries entry for the same space', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([{ taskId: 't1', spaceId: '3589129' }]);
      const queues = makeQueuesWithJobs({
        'clickup-backfills': [{ data: { spaceId: '3589129' } }],
        'clickup-time-entries': [{ data: { taskId: 't1' } }],
      });
      const result = await makeCtrl({ queues, prisma }).backfillActive();
      expect(result.spaces).toHaveLength(1);
      expect(result.spaces[0]).toEqual({
        spaceId: '3589129',
        phase: 'fetching',
        total: null,
        done: null,
        remaining: 1,
      });
    });
  });

  describe('backfillReplacement', () => {
    it('enqueues tagged-entry payloads carrying tags + original logger', async () => {
      const repo = {
        findUnreplacedTaggedEntries: jest.fn().mockResolvedValue([
          {
            time_entry_id: 'e1',
            task_id: 't1',
            user_id: '54569564',
            start_time: new Date(1700000000000),
            end_time: new Date(1700003600000),
            duration_hours: 1,
            billable: true,
            description: 'Internal meeting',
            tag_names: ['ahmad'],
          },
        ]),
      } as any;
      const queues = makeQueues();
      const result = await makeCtrl({ queues, timeEntriesRepo: repo }).backfillReplacement({ limit: 10 });

      expect(result).toEqual({ queued: 1, scanned: 1, limit: 10 });
      expect(repo.findUnreplacedTaggedEntries).toHaveBeenCalledWith(10);
      // The job must carry tags + the actual logger so the worker can route
      // without re-fetching anything from ClickUp.
      const add = (queues.get as jest.Mock).mock.results[0].value.add as jest.Mock;
      expect(add).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeEntryId: 'e1',
          taskId: 't1',
          originalUserId: '54569564',
          tags: ['ahmad'],
          durationHours: 1,
          billable: true,
        }),
        expect.any(Object),
      );
    });

    it('skips rows that came back without any tag names', async () => {
      const repo = {
        findUnreplacedTaggedEntries: jest.fn().mockResolvedValue([
          { time_entry_id: 'e1', task_id: 't1', user_id: 'u1', start_time: null, end_time: null, duration_hours: 0, billable: false, description: null, tag_names: [] },
        ]),
      } as any;
      const queues = makeQueues();
      const result = await makeCtrl({ queues, timeEntriesRepo: repo }).backfillReplacement({});
      expect(result).toEqual({ queued: 0, scanned: 1, limit: 500 });
    });

    it('clamps limit to 2000', async () => {
      const repo = { findUnreplacedTaggedEntries: jest.fn().mockResolvedValue([]) } as any;
      const result = await makeCtrl({ queues: makeQueues(), timeEntriesRepo: repo }).backfillReplacement({ limit: 9999 });
      expect(repo.findUnreplacedTaggedEntries).toHaveBeenCalledWith(2000);
      expect(result.limit).toBe(2000);
    });
  });

  describe('reconcileTasks', () => {
    it('enqueues a reconcile job per stored task on clickup-tasks with a 365-day window by default', async () => {
      const tasksRepo = { findAllIds: jest.fn().mockResolvedValue([
        { taskId: 't1', spaceId: 's1' },
        { taskId: 't2', spaceId: 's1' },
      ]) } as any;
      const queues = makeQueues();
      const result = await makeCtrl({ tasksRepo, queues }).reconcileTasks();

      expect(result).toEqual({ queued: 2 });
      expect(queues.get).toHaveBeenCalledWith('clickup-tasks');
      const add = (queues.get as jest.Mock).mock.results[0].value.add as jest.Mock;
      expect(add).toHaveBeenCalledTimes(2);
      const [jobName, payload] = add.mock.calls[0];
      expect(jobName).toBe('reconcile-clickup-task');
      expect(payload.taskId).toBe('t1');
      expect(typeof payload.startDate).toBe('number');
      expect(typeof payload.endDate).toBe('number');
      // default lookback 365 days → ~ a year of window
      expect(payload.endDate - payload.startDate).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
    });

    it('respects an explicit lookbackDays override', async () => {
      const tasksRepo = { findAllIds: jest.fn().mockResolvedValue([{ taskId: 't1', spaceId: 's1' }]), countActive: jest.fn() } as any;
      const queues = makeQueues();
      await makeCtrl({ tasksRepo, queues }).reconcileTasks('10');
      const add = (queues.get as jest.Mock).mock.results[0].value.add as jest.Mock;
      const [, payload] = add.mock.calls[0];
      const days = (payload.endDate - payload.startDate) / (24 * 60 * 60 * 1000);
      expect(Math.round(days)).toBe(10);
    });

    it('refuses to start a second sweep while a reconcile is in flight (no enqueue)', async () => {
      const add = jest.fn();
      const getJobs = jest.fn().mockResolvedValue([{ name: 'reconcile-clickup-task' }]);
      const queues = { get: jest.fn().mockReturnValue({ add, getJobs }), defaultJobOptions: jest.fn().mockReturnValue({}), webhookJobOptions: jest.fn().mockReturnValue({}) } as any;
      const tasksRepo = { findAllIds: jest.fn() } as any;

      const result = await makeCtrl({ tasksRepo, queues }).reconcileTasks();

      expect(result).toEqual({ queued: 0, alreadyRunning: true });
      expect(add).not.toHaveBeenCalled();
      expect(tasksRepo.findAllIds).not.toHaveBeenCalled(); // short-circuits before scanning tasks
    });
  });

  describe('reconcileActive', () => {
    // clickup-tasks queue carrying a mix of job names; only reconcile jobs count.
    function makeQueuesWithTaskJobs(jobs: Array<{ name: string }>) {
      const getJobs = jest.fn().mockResolvedValue(jobs);
      const get = jest.fn((name: string) => (name === 'clickup-tasks' ? { getJobs, add: jest.fn() } : { getJobs: jest.fn().mockResolvedValue([]), add: jest.fn() }));
      return { get, defaultJobOptions: jest.fn().mockReturnValue({}), webhookJobOptions: jest.fn().mockReturnValue({}) } as any;
    }

    it('reports remaining reconcile jobs (ignoring other clickup-tasks jobs) with total from stored task count', async () => {
      const queues = makeQueuesWithTaskJobs([
        { name: 'reconcile-clickup-task' },
        { name: 'reconcile-clickup-task' },
        { name: 'sync-clickup-task' }, // must be ignored
        { name: 'reconcile-clickup-task' },
      ]);
      const tasksRepo = { findAllIds: jest.fn(), countActive: jest.fn().mockResolvedValue(10) } as any;
      const result = await makeCtrl({ queues, tasksRepo }).reconcileActive();
      expect(result).toEqual({ active: true, total: 10, done: 7, remaining: 3 });
    });

    it('is idle (no count query) when no reconcile jobs are queued', async () => {
      const queues = makeQueuesWithTaskJobs([{ name: 'sync-clickup-task' }]);
      const tasksRepo = { findAllIds: jest.fn(), countActive: jest.fn() } as any;
      const result = await makeCtrl({ queues, tasksRepo }).reconcileActive();
      expect(result).toEqual({ active: false, total: 0, done: 0, remaining: 0 });
      expect(tasksRepo.countActive).not.toHaveBeenCalled();
    });

    it('clamps done to >= 0 when tasks were deleted mid-run (remaining > current total)', async () => {
      const queues = makeQueuesWithTaskJobs([
        { name: 'reconcile-clickup-task' },
        { name: 'reconcile-clickup-task' },
      ]);
      const tasksRepo = { findAllIds: jest.fn(), countActive: jest.fn().mockResolvedValue(1) } as any;
      const result = await makeCtrl({ queues, tasksRepo }).reconcileActive();
      expect(result).toEqual({ active: true, total: 1, done: 0, remaining: 2 });
    });
  });
});

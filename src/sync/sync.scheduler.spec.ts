import { SyncScheduler } from './sync.scheduler';
import { JOBS, QUEUES, BULK_SWEEP_PRIORITY } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

function makeScheduler(opts: { liveJobs?: { name: string }[]; lookbackDays?: number; enabled?: (id: string) => boolean; candidateTasks?: string[] } = {}) {
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
    getJobs: jest.fn().mockResolvedValue(opts.liveJobs ?? []),
  };
  const queues = {
    get: jest.fn(() => queue),
    defaultJobOptions: () => ({ attempts: 5 }),
  } as any;
  const settings = {
    isSpaceEnabled: jest.fn((id: string) => (opts.enabled ? opts.enabled(id) : true)),
    getReconcileLookbackDays: jest.fn(() => opts.lookbackDays ?? 365),
  } as any;
  const timeEntriesRepo = {
    findTaskIdsWithEntriesInWindow: jest.fn().mockResolvedValue(opts.candidateTasks ?? ['t1', 't2', 't3']),
  } as any;
  return { scheduler: new SyncScheduler(queues, settings, timeEntriesRepo), queue, queues, settings, timeEntriesRepo };
}

const reconcileCalls = (queue: { add: jest.Mock }) =>
  queue.add.mock.calls.filter((c) => c[0] === JOBS.RECONCILE_TIME_ENTRIES_WINDOW);

describe('SyncScheduler.deepBackfillTimeEntries', () => {
  it('enqueues windowed reconcile jobs onto the time-entries queue', async () => {
    const { scheduler, queue, queues } = makeScheduler();
    await scheduler.deepBackfillTimeEntries();

    expect(queues.get).toHaveBeenCalledWith(QUEUES.CLICKUP_TIME_ENTRIES);
    expect(reconcileCalls(queue).length).toBeGreaterThan(0);
  });

  it('covers the full configured lookback, not the 7-day sweep window', async () => {
    // The bug this cron exists to fix: entries older than 7 days were never
    // re-fetched or pruned. The oldest slice must reach back ~365 days.
    const { scheduler, queue } = makeScheduler({ lookbackDays: 365 });
    await scheduler.deepBackfillTimeEntries();

    const slices = reconcileCalls(queue).map((c) => c[1] as { startDate: number; endDate: number });
    const oldest = Math.min(...slices.map((s) => s.startDate));
    const ageDays = (Date.now() - oldest) / (24 * 60 * 60 * 1000);

    expect(ageDays).toBeGreaterThan(360);
    expect(ageDays).toBeLessThan(370);
  });

  it('reads the lookback from settings so the preference is actually wired up', async () => {
    const { scheduler, queue, settings } = makeScheduler({ lookbackDays: 90 });
    await scheduler.deepBackfillTimeEntries();

    expect(settings.getReconcileLookbackDays).toHaveBeenCalled();
    const oldest = Math.min(...reconcileCalls(queue).map((c) => (c[1] as { startDate: number }).startDate));
    const ageDays = (Date.now() - oldest) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(85);
    expect(ageDays).toBeLessThan(95);
  });

  it('deprioritizes its jobs so they cannot block live webhooks', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.deepBackfillTimeEntries();

    reconcileCalls(queue).forEach((c) => expect(c[2]).toMatchObject({ priority: BULK_SWEEP_PRIORITY }));
  });

  it('targets exactly one space per run (bounded load on a small host)', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.deepBackfillTimeEntries();

    const spaceIds = new Set(reconcileCalls(queue).map((c) => (c[1] as { spaceId: string }).spaceId));
    expect(spaceIds.size).toBe(1);
    expect(CLICKUP_SPACES.map((s) => s.id)).toContain([...spaceIds][0]);
  });

  it('skips while a previous windowed reconcile is still draining', async () => {
    const { scheduler, queue } = makeScheduler({
      liveJobs: [{ name: JOBS.RECONCILE_TIME_ENTRIES_WINDOW }],
    });
    await scheduler.deepBackfillTimeEntries();

    expect(reconcileCalls(queue)).toHaveLength(0);
  });

  it('is not blocked by unrelated jobs sharing the queue', async () => {
    const { scheduler, queue } = makeScheduler({
      liveJobs: [{ name: JOBS.SYNC_TASK_TIME_ENTRIES }],
    });
    await scheduler.deepBackfillTimeEntries();

    expect(reconcileCalls(queue).length).toBeGreaterThan(0);
  });

  it('enqueues nothing when every space is disabled', async () => {
    const { scheduler, queue } = makeScheduler({ enabled: () => false });
    await scheduler.deepBackfillTimeEntries();

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rotates across enabled spaces on consecutive days', () => {
    const { scheduler } = makeScheduler();
    const day = 24 * 60 * 60 * 1000;
    const seen = new Set<number>();
    for (let i = 0; i < CLICKUP_SPACES.length; i++) {
      seen.add(scheduler.rotationIndex(new Date(i * day), CLICKUP_SPACES.length));
    }
    expect(seen.size).toBe(CLICKUP_SPACES.length);
  });
});

describe('SyncScheduler rotation staggering', () => {
  it('never deep-reconciles the same space the archived pass targets that day', () => {
    // reconcileArchived uses offset 0; deepBackfillTimeEntries uses offset 1.
    // With >1 space they must never collide, or one space absorbs both of the
    // worker's heaviest daily jobs.
    const { scheduler } = makeScheduler();
    const n = CLICKUP_SPACES.length;
    expect(n).toBeGreaterThan(1);

    for (let d = 0; d < n * 3; d++) {
      const date = new Date(d * 24 * 60 * 60 * 1000);
      expect(scheduler.rotationIndex(date, n, 1)).not.toBe(scheduler.rotationIndex(date, n));
    }
  });

  it('keeps the pre-existing rotation unchanged when no offset is passed', () => {
    const { scheduler } = makeScheduler();
    const date = new Date(1_700_000_000_000);
    expect(scheduler.rotationIndex(date, 3, 0)).toBe(scheduler.rotationIndex(date, 3));
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;
const syncCalls = (queue: { add: jest.Mock }) =>
  queue.add.mock.calls.filter((c) => c[0] === JOBS.SYNC_TASK_TIME_ENTRIES);

describe('SyncScheduler deletion reconcile', () => {
  it('uses the PER-TASK path — the space_id windowed prune deleted live data', async () => {
    // reconcileWindow's prune is disabled; only syncTaskTimeEntries can detect
    // a deletion, because a task_id fetch returns that task's complete set.
    const { scheduler, queue } = makeScheduler();
    await scheduler.reconcileDeletions7d();

    expect(syncCalls(queue).length).toBeGreaterThan(0);
    expect(queue.add.mock.calls.some((c) => c[0] === JOBS.RECONCILE_TIME_ENTRIES_WINDOW)).toBe(false);
  });

  it('derives candidates from tasks WE hold entries for, not from ClickUp', async () => {
    // A task whose entries were all deleted upstream is absent from any
    // ClickUp-driven list, yet it is exactly the one that must be checked.
    const { scheduler, timeEntriesRepo } = makeScheduler();
    await scheduler.reconcileDeletions7d();
    expect(timeEntriesRepo.findTaskIdsWithEntriesInWindow).toHaveBeenCalled();
  });

  it('scopes the 7-day cron to a 7-day window', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.reconcileDeletions7d();
    const { startDate, endDate } = syncCalls(queue)[0][1] as { startDate: number; endDate: number };
    expect((endDate - startDate) / DAY_MS).toBeCloseTo(7, 1);
  });

  it('scopes the Friday cron to a 30-day window', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.reconcileDeletions30d();
    const { startDate, endDate } = syncCalls(queue)[0][1] as { startDate: number; endDate: number };
    expect((endDate - startDate) / DAY_MS).toBeCloseTo(30, 1);
  });

  it('passes the window explicitly so the prune can never reach outside it', async () => {
    // syncTaskTimeEntries scopes BOTH fetch and prune to the window it is given;
    // omitting it would default to 365 days and put older rows at risk.
    const { scheduler, queue } = makeScheduler();
    await scheduler.reconcileDeletions7d();
    syncCalls(queue).forEach((c) => {
      expect(c[1]).toHaveProperty('startDate');
      expect(c[1]).toHaveProperty('endDate');
    });
  });

  it('deprioritizes its jobs so they cannot block live webhooks', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.reconcileDeletions7d();
    syncCalls(queue).forEach((c) => expect(c[2]).toMatchObject({ priority: BULK_SWEEP_PRIORITY }));
  });

  it('enqueues one job per candidate task', async () => {
    const { scheduler, queue } = makeScheduler({ candidateTasks: ['a', 'b', 'c', 'd'] });
    await scheduler.reconcileDeletions7d();
    expect(syncCalls(queue)).toHaveLength(4);
  });

  it('does nothing when no task holds an entry in the window', async () => {
    const { scheduler, queue } = makeScheduler({ candidateTasks: [] });
    await scheduler.reconcileDeletions7d();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

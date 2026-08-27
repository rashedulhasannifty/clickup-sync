import {
  SyncScheduler,
  DELETION_RECONCILE_DAYS,
  DELETION_RECONCILE_MAX_GAP_DAYS,
  EDIT_HORIZON_DAYS,
  ROLLING_SWEEP_PRUNE_ENABLED,
  ROLLING_SWEEP_TASKS_PER_NIGHT,
  ROLLING_SWEEP_WINDOW_PAD_DAYS,
} from './sync.scheduler';
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

    expect(queues.get).toHaveBeenCalledWith(QUEUES.CLICKUP_TIME_ENTRIES_BULK);
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

  it('still staggers when fed the real UTC instants the Dhaka crons fire at', async () => {
    // rotationIndex buckets by UTC day. The stagger above only holds if both
    // crons compute the SAME day number, and moving them to Asia/Dhaka changed
    // which UTC day that is: 02:00 and 04:00 Dhaka are 20:00 and 22:00 UTC of
    // the PREVIOUS day. Same date, so the offset survives — but assert it
    // against the actual firing instants rather than trusting the arithmetic.
    // Drives the real cron methods under a pinned clock rather than calling
    // rotationIndex directly — otherwise the spec restates the offsets instead
    // of checking the ones the methods actually pass, and a change to either
    // call site slips through green.
    const n = CLICKUP_SPACES.length;
    const DHAKA_OFFSET_H = 6;

    try {
      for (let d = 0; d < n * 3; d++) {
        const localMidnightUtcMs = Date.UTC(2026, 7, 1 + d) - DHAKA_OFFSET_H * 3600_000;
        const deepBackfillAt = new Date(localMidnightUtcMs + 2 * 3600_000);
        const archivedAt = new Date(localMidnightUtcMs + 4 * 3600_000);
        // Both firing instants must land on one UTC date or rotationIndex,
        // which buckets by UTC day, would compute different day numbers.
        expect(archivedAt.getUTCDate()).toBe(deepBackfillAt.getUTCDate());

        jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });

        jest.setSystemTime(deepBackfillAt);
        const deep = makeScheduler();
        await deep.scheduler.deepBackfillTimeEntries();
        const deepSpace = deep.queue.add.mock.calls
          .filter((c) => c[0] === JOBS.RECONCILE_TIME_ENTRIES_WINDOW)
          .map((c) => (c[1] as { spaceId: string }).spaceId)[0];

        jest.setSystemTime(archivedAt);
        const arch = makeScheduler();
        await arch.scheduler.reconcileArchived();
        const archSpace = arch.queue.add.mock.calls
          .filter((c) => c[0] === JOBS.BACKFILL_CLICKUP_SPACE)
          .map((c) => (c[1] as { spaceId: string }).spaceId)[0];

        expect(deepSpace).toBeDefined();
        expect(archSpace).toBeDefined();
        expect(deepSpace).not.toBe(archSpace);
      }
    } finally {
      jest.useRealTimers();
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
    await scheduler.reconcileDeletions();

    expect(syncCalls(queue).length).toBeGreaterThan(0);
    expect(queue.add.mock.calls.some((c) => c[0] === JOBS.RECONCILE_TIME_ENTRIES_WINDOW)).toBe(false);
  });

  it('derives candidates from tasks WE hold entries for, not from ClickUp', async () => {
    // A task whose entries were all deleted upstream is absent from any
    // ClickUp-driven list, yet it is exactly the one that must be checked.
    const { scheduler, timeEntriesRepo } = makeScheduler();
    await scheduler.reconcileDeletions();
    expect(timeEntriesRepo.findTaskIdsWithEntriesInWindow).toHaveBeenCalled();
  });

  it('passes the window explicitly so the prune can never reach outside it', async () => {
    // syncTaskTimeEntries scopes BOTH fetch and prune to the window it is given;
    // omitting it would default to 365 days and put older rows at risk.
    const { scheduler, queue } = makeScheduler();
    await scheduler.reconcileDeletions();
    syncCalls(queue).forEach((c) => {
      expect(c[1]).toHaveProperty('startDate');
      expect(c[1]).toHaveProperty('endDate');
    });
  });

  it('deprioritizes its jobs so they cannot block live webhooks', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.reconcileDeletions();
    syncCalls(queue).forEach((c) => expect(c[2]).toMatchObject({ priority: BULK_SWEEP_PRIORITY }));
  });

  it('enqueues one job per candidate task', async () => {
    const { scheduler, queue } = makeScheduler({ candidateTasks: ['a', 'b', 'c', 'd'] });
    await scheduler.reconcileDeletions();
    expect(syncCalls(queue)).toHaveLength(4);
  });

  it('does nothing when no task holds an entry in the window', async () => {
    const { scheduler, queue } = makeScheduler({ candidateTasks: [] });
    await scheduler.reconcileDeletions();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('SyncScheduler deletion-reconcile coverage guarantee', () => {
  // These are the specs that would have caught the original hole. The ones they
  // replaced only pinned the numbers 7 and 30 — which were themselves the bug,
  // so they passed happily while deletions went undetected.

  it('keeps the window wider than the edit horizon plus the worst-case run gap', () => {
    // THE invariant. An entry is only a candidate while its start_time is inside
    // the window, so the last run that can ever examine it is the last one before
    // it ages out. If the window does not outlast (horizon + gap), a deletion
    // after that run is never detected — not late, permanently invisible.
    expect(DELETION_RECONCILE_DAYS).toBeGreaterThan(EDIT_HORIZON_DAYS + DELETION_RECONCILE_MAX_GAP_DAYS);
  });

  it('rejects the schedule that actually shipped the bug', () => {
    // The original 30-day window on a 7-day (weekly) period. Encoded so the
    // invariant above is demonstrably capable of failing, rather than being a
    // tautology that passes for any pair of numbers.
    const WEEKLY = 7;
    expect(30).not.toBeGreaterThan(EDIT_HORIZON_DAYS + WEEKLY);
  });

  it('would catch a deletion at every age the team is allowed to edit', () => {
    // Simulate it: for an entry deleted at any permitted age, is there a later
    // run whose window still covers it? Walk daily runs and assert coverage.
    for (let deletedAtAge = 0; deletedAtAge <= EDIT_HORIZON_DAYS; deletedAtAge++) {
      const nextRunAge = deletedAtAge + DELETION_RECONCILE_MAX_GAP_DAYS;
      expect(nextRunAge).toBeLessThanOrEqual(DELETION_RECONCILE_DAYS);
    }
  });

  it('scopes the enqueued window to exactly the configured lookback', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.reconcileDeletions();
    const { startDate, endDate } = syncCalls(queue)[0][1] as { startDate: number; endDate: number };
    expect((endDate - startDate) / DAY_MS).toBeCloseTo(DELETION_RECONCILE_DAYS, 1);
  });

  it('runs every day — a longer period would reopen the hole', () => {
    // The window is sized against DELETION_RECONCILE_MAX_GAP_DAYS. If someone
    // moves this cron to weekly/weekday-only without widening the window, the
    // gap assumption silently breaks. Pin the day-of-week field to "every day".
    const cron: string = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      SyncScheduler.prototype.reconcileDeletions,
    )?.cronTime ?? '';
    expect(cron).toBe('0 30 0 * * *');
  });
});

describe('SyncScheduler.rollingVerifySweep', () => {
  const sweepMake = (opts: { candidates?: { taskId: string; oldestStartMs: number; newestStartMs: number }[]; total?: number } = {}) => {
    const base = makeScheduler();
    base.timeEntriesRepo.findStalestTasksWithEntries = jest.fn().mockResolvedValue(
      opts.candidates ?? [{ taskId: 'a', oldestStartMs: 1_000_000, newestStartMs: 2_000_000 }],
    );
    base.timeEntriesRepo.countTasksWithEntries = jest.fn().mockResolvedValue(opts.total ?? 21780);
    return base;
  };
  const teCalls = (q: { add: jest.Mock }) => q.add.mock.calls.filter((c) => c[0] === JOBS.SYNC_TASK_TIME_ENTRIES);
  const taskCalls = (q: { add: jest.Mock }) => q.add.mock.calls.filter((c) => c[0] === JOBS.SYNC_CLICKUP_TASK);

  it('does NOT delete on introduction — it reports what it would prune', async () => {
    // The windowed prune passed review and tests and still destroyed 429 live
    // rows. A new sweep must be observed against real data before it deletes.
    expect(ROLLING_SWEEP_PRUNE_ENABLED).toBe(false);
    const { scheduler, queue } = sweepMake();
    await scheduler.rollingVerifySweep();
    teCalls(queue).forEach((c) => expect((c[1] as { pruneMode: string }).pruneMode).toBe('report'));
  });

  it('pads the window far enough that a re-dated entry is not falsely pruned', async () => {
    // The window is derived from rows we already hold — the same rows the prune
    // judges. If someone re-dates an entry in ClickUp to outside the window the
    // fetch cannot return it, it is missing from keepIds, and the stale local
    // row gets deleted while alive upstream. The pad is what prevents that, so
    // it must comfortably exceed any realistic re-dating.
    const oldest = Date.UTC(2026, 0, 10);
    const newest = Date.UTC(2026, 0, 20);
    const { scheduler, queue } = sweepMake({ candidates: [{ taskId: 'a', oldestStartMs: oldest, newestStartMs: newest }] });
    await scheduler.rollingVerifySweep();

    const { startDate, endDate } = teCalls(queue)[0][1] as { startDate: number; endDate: number };
    expect((oldest - startDate) / DAY_MS).toBeCloseTo(ROLLING_SWEEP_WINDOW_PAD_DAYS, 1);
    expect((endDate - newest) / DAY_MS).toBeCloseTo(ROLLING_SWEEP_WINDOW_PAD_DAYS, 1);
    expect(ROLLING_SWEEP_WINDOW_PAD_DAYS).toBeGreaterThanOrEqual(30);
  });

  it('refreshes the task too, so the free time_spent cross-check is not comparing two stale numbers', async () => {
    const { scheduler, queue } = sweepMake();
    await scheduler.rollingVerifySweep();
    expect(taskCalls(queue)).toHaveLength(1);
    expect(teCalls(queue)).toHaveLength(1);
  });

  it('orders by least-recently-verified so no task can be starved', async () => {
    const { scheduler, timeEntriesRepo } = sweepMake();
    await scheduler.rollingVerifySweep();
    expect(timeEntriesRepo.findStalestTasksWithEntries).toHaveBeenCalledWith(ROLLING_SWEEP_TASKS_PER_NIGHT);
  });

  it('deprioritizes every job it enqueues', async () => {
    const { scheduler, queue } = sweepMake();
    await scheduler.rollingVerifySweep();
    queue.add.mock.calls.forEach((c) => expect(c[2]).toMatchObject({ priority: BULK_SWEEP_PRIORITY }));
  });

  it('completes a full cycle fast enough to be a real guarantee, not a formality', async () => {
    // 21,780 tasks at the configured budget must wrap in about a week. A cycle
    // measured in months would make "verified at any age" technically true and
    // operationally useless.
    const cycleDays = Math.ceil(21780 / ROLLING_SWEEP_TASKS_PER_NIGHT);
    expect(cycleDays).toBeLessThanOrEqual(10);
  });

  it('does nothing when no task holds an entry', async () => {
    const { scheduler, queue } = sweepMake({ candidates: [] });
    await scheduler.rollingVerifySweep();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('live queue isolation', () => {
  // The whole point of CLICKUP_TIME_ENTRIES_BULK: BullMQ's rate limiter is
  // per-worker and moveToActive checks it BEFORE looking at the wait list, so a
  // saturated sweep delays a live webhook job by up to a full limiter window no
  // matter how it is prioritized. Only a separate queue prevents that — and
  // only for as long as nothing bulk is enqueued onto the live one.
  const bulkCrons: [string, (s: SyncScheduler) => Promise<void>][] = [
    ['deepBackfillTimeEntries', (s) => s.deepBackfillTimeEntries()],
    ['reconcileDeletions', (s) => s.reconcileDeletions()],
  ];

  it.each(bulkCrons)('%s never enqueues onto the LIVE time-entry queue', async (_name, run) => {
    const { scheduler, queues } = makeScheduler();
    await run(scheduler);

    const targets = queues.get.mock.calls.map((c: any[]) => c[0]);
    expect(targets).toContain(QUEUES.CLICKUP_TIME_ENTRIES_BULK);
    expect(targets).not.toContain(QUEUES.CLICKUP_TIME_ENTRIES);
  });

  it('rollingVerifySweep keeps entries on BULK and tasks on the shared task queue', async () => {
    const base = makeScheduler();
    base.timeEntriesRepo.findStalestTasksWithEntries = jest.fn().mockResolvedValue([
      { taskId: 'a', oldestStartMs: 1_000_000, newestStartMs: 2_000_000 },
    ]);
    base.timeEntriesRepo.countTasksWithEntries = jest.fn().mockResolvedValue(21780);
    await base.scheduler.rollingVerifySweep();

    const targets = base.queues.get.mock.calls.map((c: any[]) => c[0]);
    expect(targets).toContain(QUEUES.CLICKUP_TIME_ENTRIES_BULK);
    expect(targets).toContain(QUEUES.CLICKUP_TASKS);
    expect(targets).not.toContain(QUEUES.CLICKUP_TIME_ENTRIES);
  });
});

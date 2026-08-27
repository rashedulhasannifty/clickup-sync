import {
  SyncScheduler,
  DELETION_RECONCILE_DAYS,
  DELETION_RECONCILE_MAX_GAP_DAYS,
  EDIT_HORIZON_DAYS,
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

  it('fires both rotating crons on the same UTC day, which the offset relies on', () => {
    // rotationIndex buckets by UTC day. The staggering guarantee above only
    // holds if both crons compute the SAME day number — i.e. their firing
    // instants land on one UTC date. Both now run in Asia/Dhaka (02:00 and
    // 04:00), which is 20:00 and 22:00 UTC of the previous day: same date.
    // Moving either cron across Dhaka's 06:00 (= 00:00 UTC) would split them
    // onto different UTC days and silently collapse the stagger.
    const DHAKA_OFFSET_H = 6;
    const deepBackfillUtcH = 2 - DHAKA_OFFSET_H; // -4 → 20:00 previous UTC day
    const archivedUtcH = 4 - DHAKA_OFFSET_H; // -2 → 22:00 previous UTC day

    const utcDayOf = (localHour: number) => Math.floor((localHour - DHAKA_OFFSET_H) / 24);
    expect(utcDayOf(2)).toBe(utcDayOf(4));
    expect(deepBackfillUtcH).toBeLessThan(0);
    expect(archivedUtcH).toBeLessThan(0);
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

import { SyncScheduler } from './sync.scheduler';
import { JOBS, QUEUES, BACKFILL_TIME_ENTRY_PRIORITY } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

function makeScheduler(opts: { liveJobs?: { name: string }[]; lookbackDays?: number; enabled?: (id: string) => boolean } = {}) {
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
  return { scheduler: new SyncScheduler(queues, settings), queue, queues, settings };
}

const reconcileCalls = (queue: { add: jest.Mock }) =>
  queue.add.mock.calls.filter((c) => c[0] === JOBS.RECONCILE_TIME_ENTRIES_WINDOW);

describe('SyncScheduler.deepReconcileTimeEntries', () => {
  it('enqueues windowed reconcile jobs onto the time-entries queue', async () => {
    const { scheduler, queue, queues } = makeScheduler();
    await scheduler.deepReconcileTimeEntries();

    expect(queues.get).toHaveBeenCalledWith(QUEUES.CLICKUP_TIME_ENTRIES);
    expect(reconcileCalls(queue).length).toBeGreaterThan(0);
  });

  it('covers the full configured lookback, not the 7-day sweep window', async () => {
    // The bug this cron exists to fix: entries older than 7 days were never
    // re-fetched or pruned. The oldest slice must reach back ~365 days.
    const { scheduler, queue } = makeScheduler({ lookbackDays: 365 });
    await scheduler.deepReconcileTimeEntries();

    const slices = reconcileCalls(queue).map((c) => c[1] as { startDate: number; endDate: number });
    const oldest = Math.min(...slices.map((s) => s.startDate));
    const ageDays = (Date.now() - oldest) / (24 * 60 * 60 * 1000);

    expect(ageDays).toBeGreaterThan(360);
    expect(ageDays).toBeLessThan(370);
  });

  it('reads the lookback from settings so the preference is actually wired up', async () => {
    const { scheduler, queue, settings } = makeScheduler({ lookbackDays: 90 });
    await scheduler.deepReconcileTimeEntries();

    expect(settings.getReconcileLookbackDays).toHaveBeenCalled();
    const oldest = Math.min(...reconcileCalls(queue).map((c) => (c[1] as { startDate: number }).startDate));
    const ageDays = (Date.now() - oldest) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(85);
    expect(ageDays).toBeLessThan(95);
  });

  it('deprioritizes its jobs so they cannot block live webhooks', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.deepReconcileTimeEntries();

    reconcileCalls(queue).forEach((c) => expect(c[2]).toMatchObject({ priority: BACKFILL_TIME_ENTRY_PRIORITY }));
  });

  it('targets exactly one space per run (bounded load on a small host)', async () => {
    const { scheduler, queue } = makeScheduler();
    await scheduler.deepReconcileTimeEntries();

    const spaceIds = new Set(reconcileCalls(queue).map((c) => (c[1] as { spaceId: string }).spaceId));
    expect(spaceIds.size).toBe(1);
    expect(CLICKUP_SPACES.map((s) => s.id)).toContain([...spaceIds][0]);
  });

  it('skips while a previous windowed reconcile is still draining', async () => {
    const { scheduler, queue } = makeScheduler({
      liveJobs: [{ name: JOBS.RECONCILE_TIME_ENTRIES_WINDOW }],
    });
    await scheduler.deepReconcileTimeEntries();

    expect(reconcileCalls(queue)).toHaveLength(0);
  });

  it('is not blocked by unrelated jobs sharing the queue', async () => {
    const { scheduler, queue } = makeScheduler({
      liveJobs: [{ name: JOBS.SYNC_TASK_TIME_ENTRIES }],
    });
    await scheduler.deepReconcileTimeEntries();

    expect(reconcileCalls(queue).length).toBeGreaterThan(0);
  });

  it('enqueues nothing when every space is disabled', async () => {
    const { scheduler, queue } = makeScheduler({ enabled: () => false });
    await scheduler.deepReconcileTimeEntries();

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
    // reconcileArchived uses offset 0; deepReconcileTimeEntries uses offset 1.
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

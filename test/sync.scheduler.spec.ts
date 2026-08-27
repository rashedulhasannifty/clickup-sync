import { SyncScheduler } from '../src/sync/sync.scheduler';
import { JOBS } from '../src/queues/queue.constants';
import { CLICKUP_SPACES } from '../src/config/clickup-spaces.config';

function makeQueues(liveJobs: any[] = []) {
  const queue = { add: jest.fn().mockResolvedValue(undefined), getJobs: jest.fn().mockResolvedValue(liveJobs) };
  const queues = { get: jest.fn().mockReturnValue(queue), defaultJobOptions: jest.fn().mockReturnValue({}) };
  return { queues, queue };
}
/** Only the deletion-reconcile crons touch this; the sweeps under test don't. */
function makeTimeEntriesRepo() {
  return { findTaskIdsWithEntriesInWindow: jest.fn().mockResolvedValue([]) } as any;
}

function makeSettings(disabled: string[] = []) {
  return { isSpaceEnabled: (id: string) => !disabled.includes(id) } as any;
}

describe('SyncScheduler.reconcileRecentUpdates', () => {
  it('enqueues one bounded backfill per enabled space', async () => {
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings(), makeTimeEntriesRepo()).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length);
    for (const space of CLICKUP_SPACES) {
      expect(queue.add).toHaveBeenCalledWith(
        JOBS.BACKFILL_CLICKUP_SPACE,
        // includeArchived:false keeps the recurring reconcile off the expensive
        // per-list archived scan (manual backfills still run it).
        { spaceId: space.id, lookbackDays: 1, timeEntryLookbackDays: 7, includeArchived: false },
        {},
      );
    }
  });

  it('skips a space whose backfill is still in flight (overlap guard)', async () => {
    const busy = CLICKUP_SPACES[0].id;
    const { queues, queue } = makeQueues([{ name: JOBS.BACKFILL_CLICKUP_SPACE, data: { spaceId: busy } }]);
    await new SyncScheduler(queues as any, makeSettings(), makeTimeEntriesRepo()).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length - 1);
    const enqueued = queue.add.mock.calls.map((c: any[]) => c[1].spaceId);
    expect(enqueued).not.toContain(busy);
  });

  // Task 5: CLICKUP_BACKFILLS is now shared with SYNC_LIST_CATALOG jobs. A
  // queued/retrying catalog job for a space must NOT make that space look
  // "busy" — otherwise the 12-hourly reconcile silently skips it.
  it('does not treat a pending list-catalog job as an in-flight backfill', async () => {
    const spaceId = CLICKUP_SPACES[0].id;
    const { queues, queue } = makeQueues([{ name: JOBS.SYNC_LIST_CATALOG, data: { spaceId } }]);
    await new SyncScheduler(queues as any, makeSettings(), makeTimeEntriesRepo()).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length);
    const enqueued = queue.add.mock.calls.map((c: any[]) => c[1].spaceId);
    expect(enqueued).toContain(spaceId);
  });

  it('skips a space disabled in settings', async () => {
    const off = CLICKUP_SPACES[0].id;
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings([off]), makeTimeEntriesRepo()).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length - 1);
    const enqueued = queue.add.mock.calls.map((c: any[]) => c[1].spaceId);
    expect(enqueued).not.toContain(off);
  });
});

describe('SyncScheduler.syncListCatalogs', () => {
  it('enqueues a SYNC_LIST_CATALOG job per enabled space', async () => {
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings(), makeTimeEntriesRepo()).syncListCatalogs();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length);
    for (const space of CLICKUP_SPACES) {
      expect(queue.add).toHaveBeenCalledWith(JOBS.SYNC_LIST_CATALOG, { spaceId: space.id }, {});
    }
  });

  it('skips a space disabled in settings', async () => {
    const off = CLICKUP_SPACES[0].id;
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings([off]), makeTimeEntriesRepo()).syncListCatalogs();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length - 1);
    const enqueued = queue.add.mock.calls.map((c: any[]) => c[1].spaceId);
    expect(enqueued).not.toContain(off);
  });
});

describe('SyncScheduler.rotationIndex', () => {
  const s = new SyncScheduler({} as any, {} as any, {} as any);
  it('advances by one per UTC day and wraps modulo count', () => {
    const day0 = new Date('2026-01-01T12:00:00Z');
    const day1 = new Date('2026-01-02T12:00:00Z');
    const day3 = new Date('2026-01-04T12:00:00Z'); // 3 days later, count=3 → same index
    // advances by exactly +1 per day (mod count) — pins the step, not just "differs"
    expect((s.rotationIndex(day1, 3) - s.rotationIndex(day0, 3) + 3) % 3).toBe(1);
    expect(s.rotationIndex(day0, 3)).toBe(s.rotationIndex(day3, 3));
    expect(s.rotationIndex(day0, 3)).toBeGreaterThanOrEqual(0);
    expect(s.rotationIndex(day0, 3)).toBeLessThan(3);
  });
  it('guards count <= 0', () => {
    expect(s.rotationIndex(new Date('2026-01-01T00:00:00Z'), 0)).toBe(0);
  });
});

describe('SyncScheduler.reconcileArchived', () => {
  it('enqueues an archived backfill for exactly one enabled space in rotation', async () => {
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings(), makeTimeEntriesRepo()).reconcileArchived();
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [job, data] = queue.add.mock.calls[0];
    expect(job).toBe(JOBS.BACKFILL_CLICKUP_SPACE);
    expect(data).toMatchObject({ includeArchived: true, lookbackDays: 30, timeEntryLookbackDays: 7 });
    expect(CLICKUP_SPACES.map((sp) => sp.id)).toContain(data.spaceId);
  });

  it('rotates only among enabled spaces (picks the single enabled one)', async () => {
    const enabledId = CLICKUP_SPACES[0].id;
    const disabled = CLICKUP_SPACES.slice(1).map((sp) => sp.id);
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings(disabled), makeTimeEntriesRepo()).reconcileArchived();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1].spaceId).toBe(enabledId);
  });

  it('skips when the rotated space already has a backfill in flight', async () => {
    const live = CLICKUP_SPACES.map((sp) => ({ name: JOBS.BACKFILL_CLICKUP_SPACE, data: { spaceId: sp.id } }));
    const { queues, queue } = makeQueues(live);
    await new SyncScheduler(queues as any, makeSettings(), makeTimeEntriesRepo()).reconcileArchived();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not treat a pending list-catalog job as an in-flight backfill', async () => {
    const live = CLICKUP_SPACES.map((sp) => ({ name: JOBS.SYNC_LIST_CATALOG, data: { spaceId: sp.id } }));
    const { queues, queue } = makeQueues(live);
    await new SyncScheduler(queues as any, makeSettings(), makeTimeEntriesRepo()).reconcileArchived();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('enqueues nothing when all spaces are disabled', async () => {
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any, makeSettings(CLICKUP_SPACES.map((sp) => sp.id)), makeTimeEntriesRepo()).reconcileArchived();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

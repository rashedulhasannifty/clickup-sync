import { SyncScheduler } from '../src/sync/sync.scheduler';
import { JOBS } from '../src/queues/queue.constants';
import { CLICKUP_SPACES } from '../src/config/clickup-spaces.config';

function makeQueues(liveJobs: any[] = []) {
  const queue = { add: jest.fn().mockResolvedValue(undefined), getJobs: jest.fn().mockResolvedValue(liveJobs) };
  const queues = { get: jest.fn().mockReturnValue(queue), defaultJobOptions: jest.fn().mockReturnValue({}) };
  return { queues, queue };
}

describe('SyncScheduler.reconcileRecentUpdates', () => {
  it('enqueues one bounded backfill per space (lookbackDays:1, timeEntryLookbackDays:7)', async () => {
    const { queues, queue } = makeQueues([]);
    await new SyncScheduler(queues as any).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length);
    for (const space of CLICKUP_SPACES) {
      expect(queue.add).toHaveBeenCalledWith(
        JOBS.BACKFILL_CLICKUP_SPACE,
        { spaceId: space.id, lookbackDays: 1, timeEntryLookbackDays: 7 },
        {},
      );
    }
  });

  it('skips a space whose backfill is still in flight (overlap guard)', async () => {
    const busy = CLICKUP_SPACES[0].id;
    const { queues, queue } = makeQueues([{ data: { spaceId: busy } }]);
    await new SyncScheduler(queues as any).reconcileRecentUpdates();
    expect(queue.add).toHaveBeenCalledTimes(CLICKUP_SPACES.length - 1);
    const enqueued = queue.add.mock.calls.map((c: any[]) => c[1].spaceId);
    expect(enqueued).not.toContain(busy);
  });
});

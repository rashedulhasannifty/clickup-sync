import { BackfillService } from '../src/sync/backfill.service';
import { JOBS, QUEUES } from '../src/queues/queue.constants';

describe('BackfillService.backfillSpace — time-entry lookback window', () => {
  const RD_APPS_ID = '3589129'; // configured backfillLookbackDays = 20

  function makeDeps() {
    const queueAdd = jest.fn().mockResolvedValue({});
    const queues = {
      get: jest.fn().mockReturnValue({ add: queueAdd }),
      defaultJobOptions: jest.fn().mockReturnValue({}),
    } as any;
    const clickup = {
      getAllTasksBySpace: jest.fn().mockResolvedValue([{ id: 'task-1' }]),
    } as any;
    const tasks = {
      syncTasks: jest.fn().mockResolvedValue(undefined),
      patchSpaceNames: jest.fn().mockResolvedValue(undefined),
    } as any;
    const checkpoints = {
      markAttempt: jest.fn().mockResolvedValue(undefined),
      markSuccess: jest.fn().mockResolvedValue(undefined),
    } as any;
    return { queueAdd, queues, clickup, tasks, checkpoints };
  }

  function timeEntryJobs(queueAdd: jest.Mock) {
    return queueAdd.mock.calls.filter(([jobName]) => jobName === JOBS.SYNC_TASK_TIME_ENTRIES);
  }

  function startDateOf(call: any[]) {
    return call[1].startDate as number;
  }

  // Explicit override > configured floor. This is the bug that was masking
  // Hello Ahmad's January time entries: a 140-day manual backfill was getting
  // silently capped to the R&D Apps 20-day configured lookback.
  it('expands the time-entry window when lookbackDays override exceeds the space floor', async () => {
    const { queueAdd, queues, clickup, tasks, checkpoints } = makeDeps();
    const svc = new BackfillService(clickup, tasks, checkpoints, queues, { getTeamId: () => '3450636' } as any);

    const beforeMs = Date.now();
    await svc.backfillSpace(RD_APPS_ID, 140);
    const afterMs = Date.now();

    const calls = timeEntryJobs(queueAdd);
    expect(calls).toHaveLength(1);
    const days140Ms = 140 * 24 * 60 * 60 * 1000;
    expect(startDateOf(calls[0])).toBeGreaterThanOrEqual(beforeMs - days140Ms);
    expect(startDateOf(calls[0])).toBeLessThanOrEqual(afterMs - days140Ms + 5);
  });

  // Configured floor protects against short overrides. A 1-day scheduled
  // reconciliation must NOT shrink the time-entry window to 1 day, or any
  // time logged earlier in the week is invisible until the next full backfill.
  it('keeps the space floor when the lookbackDays override is shorter', async () => {
    const { queueAdd, queues, clickup, tasks, checkpoints } = makeDeps();
    const svc = new BackfillService(clickup, tasks, checkpoints, queues, { getTeamId: () => '3450636' } as any);

    const beforeMs = Date.now();
    await svc.backfillSpace(RD_APPS_ID, 1);
    const afterMs = Date.now();

    const calls = timeEntryJobs(queueAdd);
    expect(calls).toHaveLength(1);
    const days20Ms = 20 * 24 * 60 * 60 * 1000;
    expect(startDateOf(calls[0])).toBeGreaterThanOrEqual(beforeMs - days20Ms);
    expect(startDateOf(calls[0])).toBeLessThanOrEqual(afterMs - days20Ms + 5);
  });

  // Unknown space → no configured floor → use the override as-is.
  it('uses the lookbackDays override directly when the space is not configured', async () => {
    const { queueAdd, queues, clickup, tasks, checkpoints } = makeDeps();
    const svc = new BackfillService(clickup, tasks, checkpoints, queues, { getTeamId: () => '3450636' } as any);

    const beforeMs = Date.now();
    await svc.backfillSpace('99999999', 45);
    const afterMs = Date.now();

    const calls = timeEntryJobs(queueAdd);
    expect(calls).toHaveLength(1);
    const days45Ms = 45 * 24 * 60 * 60 * 1000;
    expect(startDateOf(calls[0])).toBeGreaterThanOrEqual(beforeMs - days45Ms);
    expect(startDateOf(calls[0])).toBeLessThanOrEqual(afterMs - days45Ms + 5);
  });
});

import { JOBS, QUEUES } from '../queues/queue.constants';
import { TimeEntrySyncProcessor } from './time-entry-sync.processor';

function makeJobLogs() {
  return { started: jest.fn().mockResolvedValue({ id: 'log1' }), finished: jest.fn(), failed: jest.fn() };
}

function makeProcessor(timeEntries: any, jobLogs = makeJobLogs()) {
  const deadLetters = { recordIfExhausted: jest.fn() };
  return { proc: new TimeEntrySyncProcessor(timeEntries, jobLogs as any, deadLetters as any), jobLogs };
}

describe('TimeEntrySyncProcessor', () => {
  it('routes RECONCILE_TIME_ENTRIES_WINDOW jobs to reconcileWindow', async () => {
    const timeEntries = { reconcileWindow: jest.fn().mockResolvedValue(5), syncTaskTimeEntries: jest.fn() };
    const { proc, jobLogs } = makeProcessor(timeEntries);
    await proc.process({ id: 'j1', name: JOBS.RECONCILE_TIME_ENTRIES_WINDOW, data: { spaceId: 'sp1', startDate: 1000, endDate: 2000 } } as any);
    expect(timeEntries.reconcileWindow).toHaveBeenCalledWith('sp1', 1000, 2000);
    expect(timeEntries.syncTaskTimeEntries).not.toHaveBeenCalled();
    expect(jobLogs.started).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'space', entityId: 'sp1' }));
  });

  it('routes other jobs to syncTaskTimeEntries', async () => {
    const timeEntries = { reconcileWindow: jest.fn(), syncTaskTimeEntries: jest.fn().mockResolvedValue(2) };
    const { proc } = makeProcessor(timeEntries);
    await proc.process({ id: 'j2', name: JOBS.SYNC_TASK_TIME_ENTRIES, data: { taskId: 'tk1', startDate: 1, endDate: 2 } } as any);
    // Defaults to 'delete' — every pre-existing caller keeps pruning.
    expect(timeEntries.syncTaskTimeEntries).toHaveBeenCalledWith('tk1', undefined, 1, 2, 'delete');
    expect(timeEntries.reconcileWindow).not.toHaveBeenCalled();
  });
});

describe('TimeEntrySyncProcessor prune mode', () => {
  it("defaults to 'delete' so an older job with no pruneMode still reconciles deletions", async () => {
    const timeEntries: any = { syncTaskTimeEntries: jest.fn().mockResolvedValue(0), reconcileWindow: jest.fn() };
    const { proc } = makeProcessor(timeEntries);
    await proc.process({ id: 'j', name: JOBS.SYNC_TASK_TIME_ENTRIES, data: { taskId: 't' } } as any);
    expect(timeEntries.syncTaskTimeEntries.mock.calls[0][4]).toBe('delete');
  });

  it("passes 'report' straight through, so the rolling sweep cannot delete while it is being observed", async () => {
    const timeEntries: any = { syncTaskTimeEntries: jest.fn().mockResolvedValue(0), reconcileWindow: jest.fn() };
    const { proc } = makeProcessor(timeEntries);
    await proc.process({ id: 'j', name: JOBS.SYNC_TASK_TIME_ENTRIES, data: { taskId: 't', pruneMode: 'report' } } as any);
    expect(timeEntries.syncTaskTimeEntries.mock.calls[0][4]).toBe('report');
  });
});

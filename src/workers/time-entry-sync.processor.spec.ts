import { JOBS, QUEUES } from '../queues/queue.constants';
import { TimeEntrySyncProcessor, TimeEntrySyncBulkProcessor } from './time-entry-sync.processor';
import { TimeEntrySyncHandler } from './time-entry-sync.handler';

function makeJobLogs() {
  return { started: jest.fn().mockResolvedValue({ id: 'log1' }), finished: jest.fn(), failed: jest.fn() };
}

function makeProcessor(timeEntries: any, jobLogs = makeJobLogs()) {
  const deadLetters = { recordIfExhausted: jest.fn() };
  const handler = new TimeEntrySyncHandler(timeEntries, jobLogs as any);
  return {
    proc: new TimeEntrySyncProcessor(handler, deadLetters as any),
    bulk: new TimeEntrySyncBulkProcessor(handler, deadLetters as any),
    jobLogs,
    deadLetters,
  };
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

describe('live / bulk processor parity', () => {
  // The two processors exist ONLY to bind different rate limiters. If their
  // behaviour ever diverges, a job means something different depending on which
  // queue happened to carry it.
  it('the bulk processor does the same work as the live one', async () => {
    const timeEntries: any = { syncTaskTimeEntries: jest.fn().mockResolvedValue(3), reconcileWindow: jest.fn() };
    const { bulk } = makeProcessor(timeEntries);
    await bulk.process({ id: 'b1', name: JOBS.SYNC_TASK_TIME_ENTRIES, data: { taskId: 'tk9', startDate: 5, endDate: 6 } } as any);
    expect(timeEntries.syncTaskTimeEntries).toHaveBeenCalledWith('tk9', undefined, 5, 6, 'delete');
  });

  it('each processor declares its own failure hook, so both still dead-letter', async () => {
    // @OnWorkerEvent is not reliably inherited. If the bulk processor ever loses
    // its own hook, exhausted jobs stop being recorded — silently, because
    // recordIfExhausted has no other caller.
    const timeEntries: any = { syncTaskTimeEntries: jest.fn(), reconcileWindow: jest.fn() };
    const { proc, bulk, deadLetters } = makeProcessor(timeEntries);
    const err = new Error('boom');
    await proc.onFailed({ id: 'x' } as any, err);
    await bulk.onFailed({ id: 'y' } as any, err);
    expect(deadLetters.recordIfExhausted).toHaveBeenCalledTimes(2);
  });

  it('tags job logs with the queue that actually ran the job', async () => {
    const timeEntries: any = { syncTaskTimeEntries: jest.fn().mockResolvedValue(1), reconcileWindow: jest.fn() };
    const { bulk, jobLogs } = makeProcessor(timeEntries);
    await bulk.process({ id: 'b2', name: JOBS.SYNC_TASK_TIME_ENTRIES, data: { taskId: 't' } } as any);
    expect(jobLogs.started).toHaveBeenCalledWith(
      expect.objectContaining({ queueName: QUEUES.CLICKUP_TIME_ENTRIES_BULK }),
    );
  });
});

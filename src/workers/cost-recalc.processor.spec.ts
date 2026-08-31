import { CostRecalcProcessor } from './cost-recalc.processor';

function makeDeps() {
  const recalculate = jest.fn().mockResolvedValue({ scanned: 3, updated: 3 });
  const started = jest.fn().mockResolvedValue({ id: 1n });
  const finished = jest.fn().mockResolvedValue({});
  const failed = jest.fn().mockResolvedValue({});
  const recordIfExhausted = jest.fn().mockResolvedValue(false);
  const proc = new CostRecalcProcessor(
    { recalculate } as any,
    { started, finished, failed } as any,
    { recordIfExhausted } as any,
  );
  return { proc, recalculate, started, finished, failed, recordIfExhausted };
}

describe('CostRecalcProcessor', () => {
  it('runs the recalculation and logs success', async () => {
    const { proc, recalculate, finished } = makeDeps();
    const res = await proc.process({ id: '42', name: 'recalculate-costs', data: { assigneeId: 'u1' } } as any);
    expect(recalculate).toHaveBeenCalledWith({ assigneeId: 'u1' });
    expect(finished).toHaveBeenCalledWith(1n, { timeEntriesSynced: 3 });
    expect(res).toEqual({ scanned: 3, updated: 3 });
  });

  it('logs failure and rethrows', async () => {
    const { proc, recalculate, failed } = makeDeps();
    const err = new Error('boom');
    recalculate.mockRejectedValueOnce(err);
    await expect(proc.process({ id: '1', name: 'recalculate-costs', data: {} } as any)).rejects.toThrow('boom');
    expect(failed).toHaveBeenCalledWith(1n, err);
  });
  // Regression: `entity_id` is indexed by `idx_sync_job_logs_entity(entity_type,
  // entity_id)`, and a btree index tuple caps out around 2704 bytes. Joining
  // 500 nine-character ClickUp task ids into that column made `started()` throw
  // — outside the try block, so the job failed and dead-lettered while the
  // PATCH that queued it had already committed the flags and returned success.
  describe('job-log scoping', () => {
    it('logs an assignee-scoped recalc against the assignee', async () => {
      const { proc, started } = makeDeps();
      await proc.process({ id: '42', name: 'recalculate-costs', data: { assigneeId: 'u1' } } as any);
      expect(started).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'assignee', entityId: 'u1' }));
    });

    it('falls back to the wildcard entity when the job is scoped to nothing', async () => {
      const { proc, started } = makeDeps();
      await proc.process({ id: '43', name: 'recalculate-costs', data: {} } as any);
      expect(started).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'assignee', entityId: '*' }));
    });

    it('logs a task-scoped recalc against the first task, with every id in the payload', async () => {
      const { proc, started } = makeDeps();
      const taskIds = ['86abc0001', '86abc0002', '86abc0003'];
      await proc.process({ id: '44', name: 'recalculate-costs', data: { taskIds } } as any);
      expect(started).toHaveBeenCalledWith(expect.objectContaining({
        entityType: 'task',
        entityId: '86abc0001',
        payload: { taskIds },
      }));
    });

    it('keeps entityId bounded for a task list at the 500-id cap', async () => {
      const { proc, started } = makeDeps();
      const taskIds = Array.from({ length: 500 }, (_, i) => `86abc${String(i).padStart(4, '0')}`);
      await proc.process({ id: '45', name: 'recalculate-costs', data: { taskIds } } as any);
      const arg = started.mock.calls[0][0];
      expect(arg.entityType).toBe('task');
      // Nowhere near the ~2704-byte btree index tuple limit.
      expect(arg.entityId.length).toBeLessThan(100);
      expect(arg.payload).toEqual({ taskIds });
    });
  });

  describe('job log scoping', () => {
    // Regression guard for the three-way. A two-way ternary labelled a
    // per-entry recalc as 'assignee' with entityId '*' — which also collides
    // with TaskHistoryRepository.forTask, whose 'task' rows are read as a
    // single task id.
    it('labels a per-entry recalc by time entry, first id indexed, full list in payload', async () => {
      const { proc, started, recalculate } = makeDeps();
      await proc.process({ id: '7', name: 'recalculate-costs', data: { timeEntryIds: ['e1', 'e2', 'e3'] } } as any);
      expect(started).toHaveBeenCalledWith(expect.objectContaining({
        entityType: 'timeEntry',
        entityId: 'e1',
        payload: { timeEntryIds: ['e1', 'e2', 'e3'] },
      }));
      expect(recalculate).toHaveBeenCalledWith(expect.objectContaining({ timeEntryIds: ['e1', 'e2', 'e3'] }));
    });

    it('still labels a task-scoped recalc by task', async () => {
      const { proc, started } = makeDeps();
      await proc.process({ id: '8', name: 'recalculate-costs', data: { taskIds: ['t1', 't2'] } } as any);
      expect(started).toHaveBeenCalledWith(expect.objectContaining({
        entityType: 'task', entityId: 't1', payload: { taskIds: ['t1', 't2'] },
      }));
    });

    it('still labels an assignee-scoped recalc by assignee', async () => {
      const { proc, started } = makeDeps();
      await proc.process({ id: '9', name: 'recalculate-costs', data: { assigneeId: 'u1' } } as any);
      expect(started).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'assignee', entityId: 'u1' }));
    });
  });

});

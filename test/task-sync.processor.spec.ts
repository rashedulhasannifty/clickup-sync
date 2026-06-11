import { TaskSyncProcessor } from '../src/workers/task-sync.processor';
import { JOBS } from '../src/queues/queue.constants';

function makeDeps() {
  const syncTask = jest.fn().mockResolvedValue({ taskId: 't1' });
  const softDeleteTask = jest.fn().mockResolvedValue({});
  const tasks = { syncTask, softDeleteTask } as any;
  const started = jest.fn().mockResolvedValue({ id: 1n });
  const finished = jest.fn().mockResolvedValue({});
  const failed = jest.fn().mockResolvedValue({});
  const jobLogs = { started, finished, failed } as any;
  const recordIfExhausted = jest.fn().mockResolvedValue(false);
  const deadLetters = { recordIfExhausted } as any;
  return { proc: new TaskSyncProcessor(tasks, jobLogs, deadLetters), syncTask, softDeleteTask, finished, failed, recordIfExhausted };
}

describe('TaskSyncProcessor', () => {
  it('syncs a task and logs success', async () => {
    const { proc, syncTask, finished } = makeDeps();
    await proc.process({ id: '1', name: JOBS.SYNC_CLICKUP_TASK, data: { taskId: 't1' } } as any);
    expect(syncTask).toHaveBeenCalledWith('t1');
    expect(finished).toHaveBeenCalledWith(1n, { tasksSynced: 1 });
  });

  it('soft-deletes on the delete job', async () => {
    const { proc, softDeleteTask, syncTask } = makeDeps();
    await proc.process({ id: '1', name: JOBS.DELETE_CLICKUP_TASK, data: { taskId: 't1' } } as any);
    expect(softDeleteTask).toHaveBeenCalledWith('t1');
    expect(syncTask).not.toHaveBeenCalled();
  });

  it('logs failure and rethrows', async () => {
    const { proc, syncTask, failed } = makeDeps();
    const err = new Error('boom');
    syncTask.mockRejectedValueOnce(err);
    await expect(proc.process({ id: '1', name: JOBS.SYNC_CLICKUP_TASK, data: { taskId: 't1' } } as any)).rejects.toThrow('boom');
    expect(failed).toHaveBeenCalledWith(1n, err);
  });

  it('routes exhausted jobs to dead-letter storage via the failed hook', async () => {
    const { proc, recordIfExhausted } = makeDeps();
    const job = { data: { taskId: 't1' } } as any;
    const err = new Error('boom');
    await proc.onFailed(job, err);
    expect(recordIfExhausted).toHaveBeenCalledWith(job, err);
  });
});

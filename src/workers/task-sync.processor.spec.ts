import { TaskSyncProcessor } from './task-sync.processor';

function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });
}

function makeDeps() {
  const syncTask = jest.fn().mockResolvedValue({ taskId: 't1' });
  const exists = jest.fn().mockResolvedValue(true);
  const softDeleteTask = jest.fn().mockResolvedValue({});
  const deleteByTaskId = jest.fn().mockResolvedValue(0);
  const started = jest.fn().mockResolvedValue({ id: 1n });
  const finished = jest.fn().mockResolvedValue({});
  const failed = jest.fn().mockResolvedValue({});
  const recordIfExhausted = jest.fn().mockResolvedValue(false);
  const proc = new TaskSyncProcessor(
    { syncTask, exists, softDeleteTask } as never,
    { started, finished, failed } as never,
    { recordIfExhausted } as never,
    { deleteByTaskId } as never,
    { reconcileTask: jest.fn() } as never,
  );
  return { proc, syncTask, exists, softDeleteTask, deleteByTaskId, finished, failed };
}

function job(data: { taskId: string }) {
  return { id: '9', name: 'sync-clickup-task', data } as never;
}

describe('TaskSyncProcessor — sync-clickup-task', () => {
  it('syncs a task that exists and logs one task synced', async () => {
    const { proc, syncTask, finished, softDeleteTask, deleteByTaskId } = makeDeps();
    const res = await proc.process(job({ taskId: 't1' }));
    expect(syncTask).toHaveBeenCalledWith('t1');
    expect(finished).toHaveBeenCalledWith(1n, { tasksSynced: 1 });
    expect(softDeleteTask).not.toHaveBeenCalled();
    expect(deleteByTaskId).not.toHaveBeenCalled();
    expect(res).toEqual({ taskId: 't1' });
  });

  it('on a 404 for a stored task: soft-deletes it, drops its time entries, does not throw', async () => {
    const { proc, syncTask, exists, softDeleteTask, deleteByTaskId, finished } = makeDeps();
    syncTask.mockRejectedValueOnce(httpError(404));
    exists.mockResolvedValueOnce(true);

    const res = await proc.process(job({ taskId: 'gone' }));

    expect(deleteByTaskId).toHaveBeenCalledWith('gone');
    expect(softDeleteTask).toHaveBeenCalledWith('gone');
    expect(finished).toHaveBeenCalledWith(1n, { tasksSynced: 0 });
    expect(res).toEqual({ taskId: 'gone', deleted: true });
  });

  it('on a 404 for a task we never stored: skips without tombstoning or deleting', async () => {
    const { proc, syncTask, exists, softDeleteTask, deleteByTaskId, finished } = makeDeps();
    syncTask.mockRejectedValueOnce(httpError(404));
    exists.mockResolvedValueOnce(false);

    const res = await proc.process(job({ taskId: 'never-seen' }));

    expect(softDeleteTask).not.toHaveBeenCalled();
    expect(deleteByTaskId).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledWith(1n, { tasksSynced: 0 });
    expect(res).toEqual({ taskId: 'never-seen', skipped: 'not-found-in-clickup' });
  });

  // The data-safety guarantee: a transient/non-404 failure must NOT be mistaken
  // for a deletion. It must rethrow (so the job retries / dead-letters) and must
  // never soft-delete or drop time entries.
  it('on a non-404 error (e.g. 500): rethrows and never deletes anything', async () => {
    const { proc, syncTask, softDeleteTask, deleteByTaskId, failed } = makeDeps();
    const err = httpError(500);
    syncTask.mockRejectedValueOnce(err);

    await expect(proc.process(job({ taskId: 't1' }))).rejects.toBe(err);

    expect(softDeleteTask).not.toHaveBeenCalled();
    expect(deleteByTaskId).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(1n, err);
  });
});

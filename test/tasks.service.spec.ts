import { TasksService } from '../src/tasks/tasks.service';

function makeDeps() {
  const getTask = jest.fn();
  const clickup = { getTask } as any;
  const normalizeTask = jest.fn((raw: any) => ({ taskId: raw.id, parentTaskId: raw.parent ?? null }));
  const normalizer = { normalizeTask } as any;
  const upsert = jest.fn().mockResolvedValue({});
  const softDelete = jest.fn().mockResolvedValue({});
  const findMissingParentIds = jest.fn();
  const repo = { upsert, softDelete, findMissingParentIds } as any;
  return { svc: new TasksService(clickup, normalizer, repo), getTask, normalizeTask, upsert, softDelete, findMissingParentIds };
}

describe('TasksService', () => {
  it('syncTask fetches from ClickUp, normalizes, and upserts', async () => {
    const { svc, getTask, upsert } = makeDeps();
    getTask.mockResolvedValue({ id: 't1' });
    const res = await svc.syncTask('t1');
    expect(getTask).toHaveBeenCalledWith('t1');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1' }));
    expect(res.taskId).toBe('t1');
  });

  it('syncTasks upserts every task and returns the count', async () => {
    const { svc, upsert } = makeDeps();
    const count = await svc.syncTasks([{ id: 'a' }, { id: 'b' }]);
    expect(count).toBe(2);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('syncTasks tolerates one failing upsert and still processes the rest', async () => {
    // A single bad row (e.g. a column-constraint violation) must not abort the
    // whole batch and fail an entire space backfill.
    const { svc, upsert } = makeDeps();
    upsert
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('value out of range for type integer'))
      .mockResolvedValueOnce({});

    const count = await svc.syncTasks([{ id: 'a' }, { id: 'bad' }, { id: 'c' }]);

    expect(upsert).toHaveBeenCalledTimes(3); // did not stop at the bad one
    expect(count).toBe(2); // only the two that succeeded
  });

  it('softDeleteTask delegates to the repository', async () => {
    const { svc, softDelete } = makeDeps();
    await svc.softDeleteTask('t9');
    expect(softDelete).toHaveBeenCalledWith('t9');
  });

  describe('syncMissingParents', () => {
    it('fetches+upserts only the ids the repo reports missing', async () => {
      const { svc, getTask, findMissingParentIds, upsert } = makeDeps();
      findMissingParentIds.mockResolvedValue(['p2']); // p1 already stored
      getTask.mockResolvedValue({ id: 'p2' });

      const synced = await svc.syncMissingParents(['p1', 'p2']);

      expect(findMissingParentIds).toHaveBeenCalledWith(['p1', 'p2']);
      expect(getTask).toHaveBeenCalledTimes(1);
      expect(getTask).toHaveBeenCalledWith('p2');
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(synced).toBe(1);
    });

    it('tolerates a 404/fetch failure on one parent and continues', async () => {
      const { svc, getTask, findMissingParentIds } = makeDeps();
      findMissingParentIds.mockResolvedValue(['gone', 'ok']);
      getTask.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce({ id: 'ok' });

      const synced = await svc.syncMissingParents(['gone', 'ok']);

      expect(synced).toBe(1); // only the reachable one
    });

    it('does nothing when no parents are missing', async () => {
      const { svc, getTask, findMissingParentIds } = makeDeps();
      findMissingParentIds.mockResolvedValue([]);
      const synced = await svc.syncMissingParents(['p1']);
      expect(getTask).not.toHaveBeenCalled();
      expect(synced).toBe(0);
    });
  });
});

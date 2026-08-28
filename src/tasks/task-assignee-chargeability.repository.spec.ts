import { TaskAssigneeChargeabilityRepository } from './task-assignee-chargeability.repository';

function makeRepo(over: Partial<Record<'findMany' | 'findUnique' | 'upsert' | 'deleteMany', jest.Mock>> = {}) {
  const findMany = over.findMany ?? jest.fn().mockResolvedValue([]);
  const findUnique = over.findUnique ?? jest.fn().mockResolvedValue(null);
  const upsert = over.upsert ?? jest.fn().mockResolvedValue({});
  const deleteMany = over.deleteMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { taskAssigneeChargeability: { findMany, findUnique, upsert, deleteMany } } as never;
  return { repo: new TaskAssigneeChargeabilityRepository(prisma), findMany, findUnique, upsert, deleteMany };
}

describe('TaskAssigneeChargeabilityRepository', () => {
  describe('findForTasks', () => {
    it('returns a Map keyed taskId|userId', async () => {
      const { repo } = makeRepo({
        findMany: jest.fn().mockResolvedValue([
          { taskId: 't1', userId: 'u1', chargeable: false },
          { taskId: 't2', userId: 'u1', chargeable: true },
        ]),
      });

      const map = await repo.findForTasks(['t1', 't2']);

      expect(map.get('t1|u1')).toBe(false);
      expect(map.get('t2|u1')).toBe(true);
      expect(map.get('t1|u2')).toBeUndefined();
    });

    // Guards the batch hot path: an empty `in` list is a full table scan in
    // waiting, and the cost paths call this once per batch regardless.
    it('does not query at all for an empty task list', async () => {
      const { repo, findMany } = makeRepo();
      const map = await repo.findForTasks([]);
      expect(findMany).not.toHaveBeenCalled();
      expect(map.size).toBe(0);
    });
  });

  describe('setRule', () => {
    it('writes and reports changed when there is no existing rule', async () => {
      const { repo, upsert } = makeRepo();
      const res = await repo.setRule({ taskId: 't1', userId: 'u1', chargeable: false, setBy: 'ops@x.com' });

      expect(res).toEqual({ changed: true });
      expect(upsert.mock.calls[0][0].create).toMatchObject({ taskId: 't1', userId: 'u1', chargeable: false, setBy: 'ops@x.com' });
    });

    // Idempotency, exactly like PATCH /admin/tasks/chargeable: writing the value
    // a row already holds must not enqueue a pointless recalculation.
    it('is a no-op when the stored value already matches', async () => {
      const { repo, upsert } = makeRepo({ findUnique: jest.fn().mockResolvedValue({ chargeable: false, note: 'existing', setBy: 'ops@x.com' }) });
      const res = await repo.setRule({ taskId: 't1', userId: 'u1', chargeable: false });

      expect(res).toEqual({ changed: false });
      expect(upsert).not.toHaveBeenCalled();
    });

    it('persists a note-only edit and reports changed=false', async () => {
      const { repo, upsert } = makeRepo({
        findUnique: jest.fn().mockResolvedValue({ chargeable: false, note: 'old', setBy: 'ops@x.com' }),
      });

      const res = await repo.setRule({ taskId: 't1', userId: 'u1', chargeable: false, note: 'new note' });

      expect(res).toEqual({ changed: false });
      expect(upsert).toHaveBeenCalled();
      expect(upsert.mock.calls[0][0].update).toEqual({ chargeable: false, note: 'new note' });
    });

    it('does not blank an existing note when flipping chargeability without resending note', async () => {
      const { repo, upsert } = makeRepo({
        findUnique: jest.fn().mockResolvedValue({ chargeable: false, note: 'existing', setBy: 'ops@x.com' }),
      });

      const res = await repo.setRule({ taskId: 't1', userId: 'u1', chargeable: true });

      expect(res).toEqual({ changed: true });
      const updatePayload = upsert.mock.calls[0][0].update;
      expect(updatePayload).not.toHaveProperty('note');
      expect(updatePayload).toEqual({ chargeable: true });
    });

    it('explicitly passing note: null clears an existing note', async () => {
      const { repo, upsert } = makeRepo({
        findUnique: jest.fn().mockResolvedValue({ chargeable: false, note: 'existing', setBy: 'ops@x.com' }),
      });

      const res = await repo.setRule({ taskId: 't1', userId: 'u1', chargeable: false, note: null });

      expect(res).toEqual({ changed: false });
      expect(upsert).toHaveBeenCalled();
      expect(upsert.mock.calls[0][0].update).toEqual({ chargeable: false, note: null });
    });
  });

  describe('findOne', () => {
    it('returns null (not false) when no rule exists', async () => {
      const { repo } = makeRepo();
      const result = await repo.findOne('t1', 'u1');
      expect(result).toBeNull();
      expect(typeof result).not.toBe('boolean');
    });
  });

  describe('clearRule', () => {
    it('reports changed only when a row was actually removed', async () => {
      const { repo } = makeRepo({ deleteMany: jest.fn().mockResolvedValue({ count: 0 }) });
      expect(await repo.clearRule('t1', 'u1')).toEqual({ changed: false });
    });
  });
});

import { TaskAssigneeChargeabilityRepository } from './task-assignee-chargeability.repository';

function makeRepo(over: Partial<Record<'findMany' | 'findUnique' | 'upsert' | 'deleteMany' | 'count' | 'taskFindMany' | 'entryGroupBy', jest.Mock>> = {}) {
  const findMany = over.findMany ?? jest.fn().mockResolvedValue([]);
  const findUnique = over.findUnique ?? jest.fn().mockResolvedValue(null);
  const upsert = over.upsert ?? jest.fn().mockResolvedValue({});
  const deleteMany = over.deleteMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const count = over.count ?? jest.fn().mockResolvedValue(0);
  const taskFindMany = over.taskFindMany ?? jest.fn().mockResolvedValue([]);
  const entryGroupBy = over.entryGroupBy ?? jest.fn().mockResolvedValue([]);
  const prisma = {
    taskAssigneeChargeability: { findMany, findUnique, upsert, deleteMany, count },
    clickupTask: { findMany: taskFindMany },
    clickupTimeEntry: { groupBy: entryGroupBy },
  } as never;
  return { repo: new TaskAssigneeChargeabilityRepository(prisma), findMany, findUnique, upsert, deleteMany, count, taskFindMany, entryGroupBy };
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

  describe('list', () => {
    const hrs = (n: number) => ({ toNumber: () => n });

    function listRepo(over = {}) {
      return makeRepo({
        findMany: jest.fn().mockResolvedValue([
          { taskId: 't1', userId: 'u1', chargeable: false, note: 'internal', setBy: 'a@b.c', updatedAt: new Date('2026-08-30') },
        ]),
        count: jest.fn().mockResolvedValue(1),
        taskFindMany: jest.fn().mockResolvedValue([{ taskId: 't1', taskName: 'Build it', spaceName: 'Projects' }]),
        entryGroupBy: jest.fn().mockResolvedValue([
          { taskId: 't1', userId: 'u1', _count: 3, _sum: { durationHours: hrs(12.75) }, _max: { userName: 'Md Mamun' } },
        ]),
        ...over,
      });
    }

    it('joins the task name and the time the rule affects', async () => {
      const { repo } = listRepo();
      const { items, total } = await repo.list({ limit: 50, offset: 0 });
      expect(total).toBe(1);
      expect(items[0]).toEqual({
        id: 't1|u1',
        taskId: 't1', taskName: 'Build it', spaceName: 'Projects',
        userId: 'u1', userName: 'Md Mamun',
        chargeable: false, note: 'internal', setBy: 'a@b.c',
        updatedAt: new Date('2026-08-30'),
        entryCount: 3, hours: 12.75,
      });
    });

    // The entry lookup is filtered by task id alone, so it returns rows for
    // (task, user) pairs that are NOT rules. Matching on the composite key —
    // not on taskId, and not on userId — is what keeps one rule's hours from
    // landing on another's row.
    // Two rules on the SAME task must not collide: the table keys rows on this.
    it('gives two rules on one task distinct ids', async () => {
      const { repo } = listRepo({
        findMany: jest.fn().mockResolvedValue([
          { taskId: 't1', userId: 'u1', chargeable: false, note: null, setBy: null, updatedAt: new Date() },
          { taskId: 't1', userId: 'u2', chargeable: false, note: null, setBy: null, updatedAt: new Date() },
        ]),
        count: jest.fn().mockResolvedValue(2),
      });
      const { items } = await repo.list({ limit: 50, offset: 0 });
      expect(items.map((i) => i.id)).toEqual(['t1|u1', 't1|u2']);
    });

    it('attributes hours to the exact (task, assignee) pair, never a partial match', async () => {
      const { repo } = listRepo({
        findMany: jest.fn().mockResolvedValue([
          { taskId: 't1', userId: 'u1', chargeable: false, note: null, setBy: null, updatedAt: new Date() },
          { taskId: 't2', userId: 'u2', chargeable: true, note: null, setBy: null, updatedAt: new Date() },
        ]),
        count: jest.fn().mockResolvedValue(2),
        taskFindMany: jest.fn().mockResolvedValue([
          { taskId: 't1', taskName: 'One', spaceName: null },
          { taskId: 't2', taskName: 'Two', spaceName: null },
        ]),
        entryGroupBy: jest.fn().mockResolvedValue([
          { taskId: 't1', userId: 'u1', _count: 3, _sum: { durationHours: hrs(12.75) }, _max: { userName: 'Ada' } },
          // Same task, different person — and same person, different task.
          // Neither is a rule; neither may contribute hours to one.
          { taskId: 't1', userId: 'u2', _count: 9, _sum: { durationHours: hrs(99) }, _max: { userName: 'Bob' } },
          { taskId: 't2', userId: 'u1', _count: 7, _sum: { durationHours: hrs(77) }, _max: { userName: 'Ada' } },
        ]),
      });

      const { items } = await repo.list({ limit: 50, offset: 0 });

      expect(items[0]).toMatchObject({ taskId: 't1', userId: 'u1', hours: 12.75, entryCount: 3 });
      expect(items[1]).toMatchObject({ taskId: 't2', userId: 'u2', hours: 0, entryCount: 0 });
    });

    // The prospective rule this screen exists to create: set before any time is
    // logged. It must still list, with zeros rather than being dropped.
    it('lists a rule whose assignee has logged nothing', async () => {
      const { repo } = listRepo({ entryGroupBy: jest.fn().mockResolvedValue([]) });
      const { items } = await repo.list({ limit: 50, offset: 0 });
      expect(items[0]).toMatchObject({ userId: 'u1', userName: null, entryCount: 0, hours: 0 });
    });

    it('survives a rule whose task row is missing', async () => {
      const { repo } = listRepo({ taskFindMany: jest.fn().mockResolvedValue([]) });
      const { items } = await repo.list({ limit: 50, offset: 0 });
      expect(items[0]).toMatchObject({ taskName: null, spaceName: null });
    });

    it('newest first, so a rule just set is at the top', async () => {
      const { repo, findMany } = listRepo();
      await repo.list({ limit: 50, offset: 0 });
      expect(findMany.mock.calls[0][0].orderBy).toEqual({ updatedAt: 'desc' });
    });

    it('paginates', async () => {
      const { repo, findMany } = listRepo();
      await repo.list({ limit: 25, offset: 50 });
      expect(findMany.mock.calls[0][0]).toMatchObject({ take: 25, skip: 50 });
    });

    // Same guard as findForTasks: an empty page must not turn into a scan.
    it('skips both joins when there are no rules', async () => {
      const { repo, taskFindMany, entryGroupBy } = listRepo({
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      });
      const { items, total } = await repo.list({ limit: 50, offset: 0 });
      expect(items).toEqual([]);
      expect(total).toBe(0);
      expect(taskFindMany).not.toHaveBeenCalled();
      expect(entryGroupBy).not.toHaveBeenCalled();
    });
  });

});

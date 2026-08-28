import { TimeEntriesRepository } from './time-entries.repository';

function makeRepo(deleteCount = 0) {
  const deleteMany = jest.fn().mockResolvedValue({ count: deleteCount });
  const prisma = { clickupTimeEntry: { deleteMany } } as any;
  return { repo: new TimeEntriesRepository(prisma), deleteMany };
}

describe('TimeEntriesRepository', () => {
  describe('deleteByTaskId', () => {
    it('deletes every time entry for the task (used when the task itself is deleted)', async () => {
      const { repo, deleteMany } = makeRepo();
      await repo.deleteByTaskId('t1');
      expect(deleteMany).toHaveBeenCalledWith({ where: { taskId: 't1' } });
    });
  });

  describe('pruneTaskEntriesOutsideSet', () => {
    it('deletes only rows in-scope (task, fetched users, within window) that ClickUp did not return', async () => {
      const { repo, deleteMany } = makeRepo(2);
      const deleted = await repo.pruneTaskEntriesOutsideSet({
        taskId: 't1',
        userIds: ['u9'],
        startMs: 1000,
        endMs: 2000,
        keepIds: ['te-A', 'te-B'],
      });

      expect(deleted).toBe(2);
      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          taskId: 't1',
          userId: { in: ['u9'] },
          startTime: { gte: new Date(1000), lte: new Date(2000) },
          timeEntryId: { notIn: ['te-A', 'te-B'] },
        },
      });
    });
  });

  describe('pruneWindowOutsideSet', () => {
    it('deletes only in-window rows for the space + members that are not kept, scoped via the task join', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
      const repo = new TimeEntriesRepository({ clickupTimeEntry: { deleteMany } } as any);

      const count = await repo.pruneWindowOutsideSet({
        spaceId: 'sp1',
        userIds: ['u1', 'u2'],
        startMs: 1000,
        endMs: 2000,
        keepIds: ['te1', 'te2'],
      });

      expect(count).toBe(3);
      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          task: { is: { spaceId: 'sp1' } },
          userId: { in: ['u1', 'u2'] },
          startTime: { gte: new Date(1000), lte: new Date(2000) },
          timeEntryId: { notIn: ['te1', 'te2'] },
        },
      });
    });
  });

  describe('local annotations', () => {
    it('never writes chargeable_override, so a resync cannot revert a user-set override', async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const repo = new TimeEntriesRepository({ clickupTimeEntry: { upsert } } as never);

      await repo.upsert(
        { timeEntryId: 'te1', taskId: 't1', userId: 'u1', raw: {} } as never,
        { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND', isChargeable: true },
      );

      const call = upsert.mock.calls[0][0];
      expect(call.create).not.toHaveProperty('chargeableOverride');
      expect(call.update).not.toHaveProperty('chargeableOverride');
    });

    it('does write is_chargeable, which is derived rather than user-set', async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const repo = new TimeEntriesRepository({ clickupTimeEntry: { upsert } } as never);

      await repo.upsert(
        { timeEntryId: 'te1', taskId: 't1', userId: 'u1', raw: {} } as never,
        { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NOT_CHARGEABLE', isChargeable: false },
      );

      const call = upsert.mock.calls[0][0];
      expect(call.update.isChargeable).toBe(false);
    });
  });
});

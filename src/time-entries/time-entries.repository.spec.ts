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

  describe('setChargeableOverride', () => {
    function overrideRepo(rows: { timeEntryId: string; chargeableOverride: boolean | null }[]) {
      const findMany = jest.fn().mockResolvedValue(rows);
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = { clickupTimeEntry: { findMany, updateMany } } as any;
      return { repo: new TimeEntriesRepository(prisma), findMany, updateMany };
    }

    // Prisma's `not: true` on a NULLABLE column does not reliably match NULL
    // rows, and "no override yet" is the majority case — a single-query
    // updateMany would silently skip exactly the entries being overridden for
    // the first time. Hence read-then-write on the differing subset.
    it('updates rows whose override differs, INCLUDING those with none yet', async () => {
      const { repo, updateMany } = overrideRepo([
        { timeEntryId: 'e1', chargeableOverride: null },
        { timeEntryId: 'e2', chargeableOverride: true },
        { timeEntryId: 'e3', chargeableOverride: false },
      ]);

      const res = await repo.setChargeableOverride(['e1', 'e2', 'e3'], false);

      expect(updateMany).toHaveBeenCalledWith({
        where: { timeEntryId: { in: ['e1', 'e2'] } },
        data: { chargeableOverride: false },
      });
      expect(res).toEqual({ changed: ['e1', 'e2'] });
    });

    it('clearing an override touches only rows that have one', async () => {
      const { repo, updateMany } = overrideRepo([
        { timeEntryId: 'e1', chargeableOverride: null },
        { timeEntryId: 'e2', chargeableOverride: true },
      ]);

      const res = await repo.setChargeableOverride(['e1', 'e2'], null);

      expect(updateMany).toHaveBeenCalledWith({
        where: { timeEntryId: { in: ['e2'] } },
        data: { chargeableOverride: null },
      });
      expect(res).toEqual({ changed: ['e2'] });
    });

    // Idempotence is what lets the caller skip the recalc: nothing changed
    // means no stored cost can have changed either.
    it('writes nothing when every row already holds the requested value', async () => {
      const { repo, updateMany } = overrideRepo([
        { timeEntryId: 'e1', chargeableOverride: true },
        { timeEntryId: 'e2', chargeableOverride: true },
      ]);

      const res = await repo.setChargeableOverride(['e1', 'e2'], true);

      expect(updateMany).not.toHaveBeenCalled();
      expect(res).toEqual({ changed: [] });
    });

    // Ids that match no row must not appear in `changed` — the recalc is
    // scoped to exactly what was written.
    it('ignores ids that match no entry', async () => {
      const { repo } = overrideRepo([{ timeEntryId: 'e1', chargeableOverride: null }]);
      const res = await repo.setChargeableOverride(['e1', 'ghost'], false);
      expect(res).toEqual({ changed: ['e1'] });
    });

    it('does not query at all for an empty id list', async () => {
      const { repo, findMany, updateMany } = overrideRepo([]);
      const res = await repo.setChargeableOverride([], false);
      expect(findMany).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
      expect(res).toEqual({ changed: [] });
    });
  });

});

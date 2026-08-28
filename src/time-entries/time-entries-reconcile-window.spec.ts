import { TimeEntriesRepository } from './time-entries.repository';
import { TimeEntriesService } from './time-entries.service';

function makeService(overrides: Partial<Record<string, any>> = {}) {
  const clickup = { getTimeEntriesWindow: jest.fn().mockResolvedValue([{ id: 'te1', task: { id: 'tk1' } }]) };
  const normalizer = { normalizeTimeEntry: (e: any) => ({ timeEntryId: e.id, taskId: e.task?.id ?? null, userId: 'u1', startTime: new Date(1500), endTime: new Date(1600), durationHours: 1, billable: true, description: null, raw: e }) };
  const repo = { upsert: jest.fn().mockResolvedValue(undefined), pruneWindowOutsideSet: jest.fn().mockResolvedValue(0) };
  const costs = { calculate: jest.fn().mockResolvedValue({ status: 'COST_CALCULATED', costCents: 0 }) };
  const queues = { get: () => ({ add: jest.fn() }), defaultJobOptions: () => ({}) };
  const members = { getMemberIds: jest.fn().mockResolvedValue(['u1', 'u2']) };
  const tagAssigneeMap = { findAllActive: jest.fn().mockResolvedValue([]) };
  const tasksRepo = { exists: jest.fn().mockResolvedValue(true) };
  const tasksService = { syncTask: jest.fn() };
  const settings = { getTeamId: () => 'team1', getPreferences: () => ({ cost: { rateMatching: 'start' } }) };
  const prisma = {
    clickupTask: { findMany: jest.fn().mockResolvedValue([]) },
    clickupTimeEntry: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const rules = { findForTasks: jest.fn().mockResolvedValue(new Map()), findOne: jest.fn().mockResolvedValue(null) };
  const svc = new TimeEntriesService(
    clickup as any, normalizer as any, repo as any, costs as any, queues as any,
    members as any, tagAssigneeMap as any, tasksRepo as any, tasksService as any, settings as any, prisma as any,
    rules as any,
  );
  return { svc, clickup, repo, members };
}

describe('reconcileWindow', () => {
  it('upserts fetched entries for the window/space/members it fetched', async () => {
    const { svc, clickup, repo, members } = makeService();
    const count = await svc.reconcileWindow('sp1', 1000, 2000);

    expect(count).toBe(1);
    expect(members.getMemberIds).toHaveBeenCalled();
    expect(clickup.getTimeEntriesWindow).toHaveBeenCalledWith('team1', {
      spaceId: 'sp1', assigneeIds: ['u1', 'u2'], startDate: 1000, endDate: 2000,
    });
    expect(repo.upsert).toHaveBeenCalledTimes(1);
  });

  // Regression guard for the 2026-08-25 data-loss incident. `reconcileWindow`
  // deleted 429 live entries in production because it treated a space_id-scoped
  // ClickUp response as an authoritative "what still exists" list. It is not:
  // re-syncing the same tasks by task_id restored every row and matched
  // ClickUp's own time_spent rollup. Deletion on this path is now hard-off.
  it('NEVER prunes, because a space_id-scoped fetch is not a complete set', async () => {
    const { svc, repo } = makeService();
    await svc.reconcileWindow('sp1', 1000, 2000);
    expect(repo.pruneWindowOutsideSet).not.toHaveBeenCalled();
  });

  it('does not prune even on a small response — size was never the safeguard', async () => {
    // The destructive slices returned only a few hundred entries each, far
    // under PRUNE_SAFETY_MAX_ENTRIES, so the truncation guard never fired.
    const { svc, clickup, repo } = makeService();
    clickup.getTimeEntriesWindow.mockResolvedValue([{ id: 'te1', task: { id: 'tk1' } }]);
    await svc.reconcileWindow('sp1', 1000, 2000);
    expect(repo.pruneWindowOutsideSet).not.toHaveBeenCalled();
  });

  it('skips the prune when the slice looks truncated (>= PRUNE_SAFETY_MAX_ENTRIES)', async () => {
    const { svc, clickup, repo } = makeService();
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `te${i}`, task: { id: 'tk1' } }));
    clickup.getTimeEntriesWindow.mockResolvedValue(many);

    await svc.reconcileWindow('sp1', 1000, 2000);

    expect(repo.pruneWindowOutsideSet).not.toHaveBeenCalled();
  });
});

describe('prune preview / prune parity', () => {
  // findTaskEntriesOutsideSet exists purely to PREVIEW what
  // pruneTaskEntriesOutsideSet will delete. If their WHERE clauses ever
  // diverge, the dry run stops predicting the deletion it is meant to de-risk —
  // and the whole reason the sweep ships in report-only mode evaporates.
  it('selects with exactly the same filter as the delete', async () => {
    let selectWhere: any, deleteWhere: any;
    const prisma: any = {
      clickupTimeEntry: {
        findMany: jest.fn((a: any) => { selectWhere = a.where; return Promise.resolve([]); }),
        deleteMany: jest.fn((a: any) => { deleteWhere = a.where; return Promise.resolve({ count: 0 }); }),
      },
    };
    const repo = new TimeEntriesRepository(prisma);
    const args = { taskId: 't1', userIds: ['u1', 'u2'], startMs: 1_000, endMs: 9_000, keepIds: ['k1'] };

    await repo.findTaskEntriesOutsideSet({ ...args });
    await repo.pruneTaskEntriesOutsideSet({ ...args });

    expect(selectWhere).toEqual(deleteWhere);
  });

  it('scopes to the task, the given users, the given window, and spares keepIds', async () => {
    let where: any;
    const prisma: any = {
      clickupTimeEntry: { findMany: jest.fn((a: any) => { where = a.where; return Promise.resolve([]); }) },
    };
    await new TimeEntriesRepository(prisma).findTaskEntriesOutsideSet({
      taskId: 't1', userIds: ['u1'], startMs: 1_000, endMs: 9_000, keepIds: ['k1'],
    });

    expect(where.taskId).toBe('t1');
    expect(where.userId).toEqual({ in: ['u1'] });
    expect(where.timeEntryId).toEqual({ notIn: ['k1'] });
    expect(where.startTime.gte.getTime()).toBe(1_000);
    expect(where.startTime.lte.getTime()).toBe(9_000);
  });
});

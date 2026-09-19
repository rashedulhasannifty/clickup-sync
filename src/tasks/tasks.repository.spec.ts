import { TasksRepository } from './tasks.repository';
import { NormalizedTask } from '../clickup/clickup-normalizer';

function makeTask(overrides: Partial<NormalizedTask> = {}): NormalizedTask {
  return {
    taskId: 't1',
    taskName: 'Task 1',
    spaceId: '3577824',
    spaceName: 'Digital Marketing',
    raw: {},
    ...overrides,
  } as NormalizedTask;
}

describe('TasksRepository.upsert', () => {
  function setup() {
    const upsert = jest.fn();
    const clickupTask = {
      upsert,
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = {
      $transaction: jest.fn((fn: any) => fn(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(0),
      clickupTask,
    } as unknown as never;
    return { repo: new TasksRepository(prisma), upsert };
  }

  it('does not blank an existing space name/id when the incoming values are null', () => {
    // The single-task/webhook fetch (GET /task/{id}) returns space.id but no
    // space.name, so a re-sync arrives with spaceName=null. That must not
    // overwrite a name a prior backfill already resolved.
    const { repo, upsert } = setup();
    repo.upsert(makeTask({ spaceId: null, spaceName: null }));

    const { update } = upsert.mock.calls[0][0];
    expect('spaceName' in update).toBe(false);
    expect('spaceId' in update).toBe(false);
    expect(update.syncCount).toEqual({ increment: 1 });
  });

  it('writes space name/id on update when the incoming values are present', () => {
    const { repo, upsert } = setup();
    repo.upsert(makeTask({ spaceId: '3577824', spaceName: 'Digital Marketing' }));

    const { update } = upsert.mock.calls[0][0];
    expect(update.spaceName).toBe('Digital Marketing');
    expect(update.spaceId).toBe('3577824');
  });

  it('always sets space fields on insert (create), even when null', () => {
    const { repo, upsert } = setup();
    repo.upsert(makeTask({ spaceId: null, spaceName: null }));

    const { create } = upsert.mock.calls[0][0];
    expect(create.spaceName).toBeNull();
    expect(create.syncCount).toBe(1);
    expect(create.isDeleted).toBe(false);
  });
});

describe('local annotations', () => {
  it('never writes is_chargeable, so a resync cannot revert a user-set flag', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const clickupTask = {
      upsert,
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = {
      $transaction: jest.fn((fn: any) => fn(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(0),
      clickupTask,
    } as unknown as never;
    const repo = new TasksRepository(prisma);

    await repo.upsert({ taskId: 't1', taskName: 'Fix webhook dedupe', raw: {} } as never);

    const call = upsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('isChargeable');
    expect(call.update).not.toHaveProperty('isChargeable');
  });
});

describe('TasksRepository.upsert scope_client_option_id', () => {
  function setup(parent: { scopeClientOptionId: string | null } | null = null) {
    const tx = {
      clickupTask: {
        findUnique: jest.fn().mockResolvedValue(parent),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const prisma = { $transaction: jest.fn((fn: any) => fn(tx)), clickupTask: tx.clickupTask } as unknown as never;
    return { repo: new TasksRepository(prisma), tx };
  }

  it('uses the task’s own option id', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ clientOptionId: 'acme', parentTaskId: null }));
    const call = tx.clickupTask.upsert.mock.calls[0][0];
    expect(call.create.scopeClientOptionId).toBe('acme');
    expect(call.update.scopeClientOptionId).toBe('acme');
  });

  it('a subtask with no client inherits its parent’s scope', async () => {
    const { repo, tx } = setup({ scopeClientOptionId: 'acme' });
    await repo.upsert(makeTask({ taskId: 's1', clientOptionId: null, parentTaskId: 'p1' }));
    expect(tx.clickupTask.findUnique).toHaveBeenCalledWith({
      where: { taskId: 'p1' },
      select: { scopeClientOptionId: true },
    });
    expect(tx.clickupTask.upsert.mock.calls[0][0].update.scopeClientOptionId).toBe('acme');
  });

  /** `$executeRaw` is a tagged template: call[0] is the SQL fragments, the rest are the bound values. */
  function rawCall(tx: any) {
    const [fragments, ...values] = tx.$executeRaw.mock.calls[0];
    return { sql: (fragments as string[]).join('?').replace(/\s+/g, ' ').trim(), values };
  }

  it('propagates down the WHOLE client-less subtree, not just direct children', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ taskId: 'p1', clientOptionId: 'bolt', parentTaskId: null }));
    const { sql, values } = rawCall(tx);
    // A single-level UPDATE left grandchildren on the previous client forever —
    // nothing re-syncs them, because changing p1 doesn't bump their date_updated.
    expect(sql).toContain('WITH RECURSIVE');
    expect(sql).toContain('JOIN subtree s ON c.parent_task_id = s.task_id');
    // Recursion must stop at a descendant that owns a client: its subtree is its own.
    expect(sql).toContain('WHERE c.client_option_id IS NULL');
    // Cycle-safe: UNION dedupes, UNION ALL would spin on a bad parent chain.
    expect(sql).not.toContain('UNION ALL');
    // Only rows that actually differ are written — every upsert runs this.
    expect(sql).toContain('IS DISTINCT FROM');
    expect(values).toEqual(['p1', 'bolt', 'bolt']);
  });

  it('a null scope clears the subtree that currently has one', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ taskId: 'p1', clientOptionId: null, parentTaskId: null }));
    const { values } = rawCall(tx);
    expect(values).toEqual(['p1', null, null]);
  });

  it('still never writes the local isChargeable annotation', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ clientOptionId: 'acme' }));
    const call = tx.clickupTask.upsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('isChargeable');
    expect(call.update).not.toHaveProperty('isChargeable');
  });
});

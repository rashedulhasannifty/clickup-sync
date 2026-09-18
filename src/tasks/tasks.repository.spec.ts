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
    const prisma = { $transaction: jest.fn((fn: any) => fn(prisma)), clickupTask } as unknown as never;
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
    const prisma = { $transaction: jest.fn((fn: any) => fn(prisma)), clickupTask } as unknown as never;
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

  it('propagates to client-less children, touching only rows that actually differ', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ taskId: 'p1', clientOptionId: 'bolt', parentTaskId: null }));
    expect(tx.clickupTask.updateMany).toHaveBeenCalledWith({
      where: {
        parentTaskId: 'p1',
        clientOptionId: null,
        OR: [{ scopeClientOptionId: null }, { scopeClientOptionId: { not: 'bolt' } }],
      },
      data: { scopeClientOptionId: 'bolt' },
    });
  });

  it('a null scope only clears children that currently have one', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ taskId: 'p1', clientOptionId: null, parentTaskId: null }));
    expect(tx.clickupTask.updateMany).toHaveBeenCalledWith({
      where: { parentTaskId: 'p1', clientOptionId: null, scopeClientOptionId: { not: null } },
      data: { scopeClientOptionId: null },
    });
  });

  it('still never writes the local isChargeable annotation', async () => {
    const { repo, tx } = setup();
    await repo.upsert(makeTask({ clientOptionId: 'acme' }));
    const call = tx.clickupTask.upsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty('isChargeable');
    expect(call.update).not.toHaveProperty('isChargeable');
  });
});

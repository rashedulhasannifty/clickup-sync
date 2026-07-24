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
    const prisma = { clickupTask: { upsert } } as unknown as never;
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

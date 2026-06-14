import { TaskHistoryRepository } from '../src/admin/task-history.repository';

describe('TaskHistoryRepository.forTask', () => {
  it('merges job logs and task events newest-first with string ids', async () => {
    const syncJobLog = {
      findMany: jest.fn().mockResolvedValue([
        { id: BigInt(10), queueName: 'clickup-tasks', jobName: 'sync', status: 'completed',
          errorMessage: null, startedAt: new Date('2026-06-01T10:00:00Z'), finishedAt: new Date('2026-06-01T10:00:05Z') },
      ]),
    };
    const clickupTaskEvent = {
      findMany: jest.fn().mockResolvedValue([
        { id: BigInt(20), eventType: 'taskStatusUpdated', occurredAt: new Date('2026-06-02T09:00:00Z'),
          changedByUserName: 'Ada', before: { status: 'open' }, after: { status: 'done' } },
      ]),
    };
    const repo = new TaskHistoryRepository({ syncJobLog, clickupTaskEvent } as any);

    const out = await repo.forTask('t1');

    expect(syncJobLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType: 'task', entityId: 't1' },
    }));
    expect(out[0].kind).toBe('event');     // 2026-06-02 is newer
    expect(out[1].kind).toBe('job');
    expect(out[0].id).toBe('20');          // BigInt serialized
    expect(out[1].id).toBe('10');
  });
});

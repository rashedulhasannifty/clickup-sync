import { DeadLetterService } from './dead-letter.service';

function makeJob(overrides: Partial<any> = {}): any {
  return {
    name: 'sync-clickup-task',
    queueName: 'clickup-tasks',
    data: { taskId: 'task-1' },
    opts: { attempts: 5 },
    attemptsMade: 5,
    ...overrides,
  };
}

describe('DeadLetterService.recordIfExhausted', () => {
  it('does NOT write a dead-letter row while retries remain', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1n });
    const svc = new DeadLetterService({ create } as any);

    const recorded = await svc.recordIfExhausted(
      makeJob({ attemptsMade: 2, opts: { attempts: 5 } }),
      new Error('boom'),
    );

    expect(recorded).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('writes a dead-letter row once attempts are exhausted', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1n });
    const svc = new DeadLetterService({ create } as any);

    const recorded = await svc.recordIfExhausted(makeJob(), new Error('boom'));

    expect(recorded).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'clickup-tasks',
        jobName: 'sync-clickup-task',
        entityId: 'task-1',
        payload: { taskId: 'task-1' },
        attemptsMade: 5,
      }),
    );
  });

  it('derives entityId from common job-data shapes', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1n });
    const svc = new DeadLetterService({ create } as any);

    await svc.recordIfExhausted(
      makeJob({ data: { timeEntryId: 'te-9' } }),
      new Error('x'),
    );
    await svc.recordIfExhausted(
      makeJob({ data: { spaceId: 'sp-3' } }),
      new Error('x'),
    );

    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({ entityId: 'te-9' }));
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({ entityId: 'sp-3' }));
  });

  it('treats a single-attempt job as exhausted on first failure', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1n });
    const svc = new DeadLetterService({ create } as any);

    const recorded = await svc.recordIfExhausted(
      makeJob({ attemptsMade: 1, opts: {} }),
      new Error('x'),
    );

    expect(recorded).toBe(true);
  });
});

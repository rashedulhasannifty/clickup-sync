import { NotFoundException } from '@nestjs/common';
import { AdminDeadLettersController } from '../src/admin/admin-dead-letters.controller';

describe('AdminDeadLettersController', () => {
  function makeQueues() {
    const add = jest.fn().mockResolvedValue({});
    const getJobs = jest.fn().mockResolvedValue([]);
    return { get: jest.fn().mockReturnValue({ add, getJobs }), defaultJobOptions: jest.fn().mockReturnValue({}), webhookJobOptions: jest.fn().mockReturnValue({}) } as any;
  }

  function makeDeadLetters(record: any = null) {
    return {
      findPending: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: jest.fn().mockResolvedValue(record),
      markRetried: jest.fn().mockResolvedValue({}),
      markResolved: jest.fn().mockResolvedValue({}),
    } as any;
  }

  function makeCtrl(over: Partial<{ queues: any; deadLetters: any }> = {}) {
    return new AdminDeadLettersController(
      over.queues ?? makeQueues(),
      over.deadLetters ?? makeDeadLetters(),
    );
  }

  describe('listDeadLetters', () => {
    it('clamps limit to 200 and returns repository result', async () => {
      const dl = makeDeadLetters();
      await makeCtrl({ deadLetters: dl }).listDeadLetters(999, 0);
      expect(dl.findPending).toHaveBeenCalledWith(200, 0);
    });
  });

  describe('retryDeadLetter', () => {
    it('throws NotFoundException when record does not exist', async () => {
      await expect(makeCtrl({ deadLetters: makeDeadLetters(null) }).retryDeadLetter('99')).rejects.toThrow(NotFoundException);
    });

    it('re-queues using record queueName+jobName+payload and marks retried', async () => {
      const queues = makeQueues();
      const record = { id: BigInt(1), queueName: 'clickup-tasks', jobName: 'sync-clickup-task', payload: { taskId: 'abc' } };
      const dl = makeDeadLetters(record);
      const result = await makeCtrl({ queues, deadLetters: dl }).retryDeadLetter('1');
      expect(result).toEqual({ requeued: true, id: '1', queueName: 'clickup-tasks', jobName: 'sync-clickup-task' });
      expect(dl.markRetried).toHaveBeenCalledWith(BigInt(1));
    });
  });
});

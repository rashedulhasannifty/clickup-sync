import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminController } from '../src/admin/admin.controller';

describe('AdminController', () => {
  function makeQueues() {
    const add = jest.fn().mockResolvedValue({});
    return { get: jest.fn().mockReturnValue({ add }), defaultJobOptions: jest.fn().mockReturnValue({}) } as any;
  }

  function makeDeadLetters(record: any = null) {
    return {
      findPending: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findById: jest.fn().mockResolvedValue(record),
      markRetried: jest.fn().mockResolvedValue({}),
    } as any;
  }

  function makeWebhooks(result: any = { action: 'created', webhookId: 'wh-1', secret: 'sec', endpoint: 'https://x.com' }) {
    return { register: jest.fn().mockResolvedValue(result) } as any;
  }

  function makeTimeEntriesRepo() {
    return {
      findUnreplacedAgencyEntries: jest.fn().mockResolvedValue([]),
    } as any;
  }

  describe('syncTask', () => {
    it('queues SYNC_CLICKUP_TASK on clickup-tasks queue and returns taskId', () => {
      const queues = makeQueues();
      const ctrl = new AdminController(queues, makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      const result = ctrl.syncTask({ taskId: '86abc' });
      expect(result).toEqual({ queued: true, taskId: '86abc' });
      expect(queues.get).toHaveBeenCalledWith('clickup-tasks');
    });
  });

  describe('backfill', () => {
    it('uses configured lookback when lookbackDays is not provided', () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      const result = ctrl.backfill({ spaceId: '3577824' });
      expect(result).toEqual({ queued: true, spaceId: '3577824', lookbackDays: 90 });
    });

    it('uses provided lookbackDays over configured default', () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      const result = ctrl.backfill({ spaceId: '3589129', lookbackDays: 7 });
      expect(result).toEqual({ queued: true, spaceId: '3589129', lookbackDays: 7 });
    });

    it('throws BadRequestException for unknown spaceId', () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      expect(() => ctrl.backfill({ spaceId: 'bad-id' })).toThrow(BadRequestException);
    });

    it('queues on clickup-backfills queue', () => {
      const queues = makeQueues();
      const ctrl = new AdminController(queues, makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      ctrl.backfill({ spaceId: '3525433' });
      expect(queues.get).toHaveBeenCalledWith('clickup-backfills');
    });

    it('allows unknown spaceId when allowUnknownSpaces is true', () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      const result = ctrl.backfill({ spaceId: 'test-space-999', allowUnknownSpaces: true });
      expect(result).toEqual({ queued: true, spaceId: 'test-space-999', lookbackDays: 30 });
    });

    it('uses provided lookbackDays for unknown space instead of default 30', () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      const result = ctrl.backfill({ spaceId: 'test-space-999', allowUnknownSpaces: true, lookbackDays: 7 });
      expect(result).toEqual({ queued: true, spaceId: 'test-space-999', lookbackDays: 7 });
    });
  });

  describe('syncRates', () => {
    it('queues SYNC_ASSIGNEE_RATES on assignee-rates queue', () => {
      const queues = makeQueues();
      const ctrl = new AdminController(queues, makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      const result = ctrl.syncRates();
      expect(result).toEqual({ queued: true });
      expect(queues.get).toHaveBeenCalledWith('assignee-rates');
    });
  });

  describe('registerWebhook', () => {
    it('delegates to ClickupWebhooksService.register', async () => {
      const webhooks = makeWebhooks({ action: 'existing', webhookId: 'w1', endpoint: 'https://x.com' });
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), webhooks, makeTimeEntriesRepo());
      const result = await ctrl.registerWebhook();
      expect(result).toEqual({ action: 'existing', webhookId: 'w1', endpoint: 'https://x.com' });
    });
  });

  describe('listDeadLetters', () => {
    it('clamps limit to 200 and returns repository result', async () => {
      const dl = makeDeadLetters();
      const ctrl = new AdminController(makeQueues(), dl, makeWebhooks(), makeTimeEntriesRepo());
      await ctrl.listDeadLetters(999, 0);
      expect(dl.findPending).toHaveBeenCalledWith(200, 0);
    });
  });

  describe('retryDeadLetter', () => {
    it('throws NotFoundException when record does not exist', async () => {
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(null), makeWebhooks(), makeTimeEntriesRepo());
      await expect(ctrl.retryDeadLetter('99')).rejects.toThrow(NotFoundException);
    });

    it('re-queues using record queueName+jobName+payload and marks retried', async () => {
      const queues = makeQueues();
      const record = { id: BigInt(1), queueName: 'clickup-tasks', jobName: 'sync-clickup-task', payload: { taskId: 'abc' } };
      const dl = makeDeadLetters(record);
      const ctrl = new AdminController(queues, dl, makeWebhooks(), makeTimeEntriesRepo());
      const result = await ctrl.retryDeadLetter('1');
      expect(result).toEqual({ requeued: true, id: '1', queueName: 'clickup-tasks', jobName: 'sync-clickup-task' });
      expect(dl.markRetried).toHaveBeenCalledWith(BigInt(1));
    });
  });

  describe('backfillReplacement', () => {
    it('returns queued count', async () => {
      process.env.CLICKUP_AGENCY_USER_ID = '3584055';
      const repo = { findUnreplacedAgencyEntries: jest.fn().mockResolvedValue([{ timeEntryId: 'e1', taskId: 't1', startTime: new Date(1700000000000), endTime: new Date(1700003600000), durationHours: { toNumber: () => 1 } as any, billable: true, description: null }]) } as any;
      const queues = makeQueues();
      const ctrl = new AdminController(queues, makeDeadLetters(), makeWebhooks(), repo);
      const result = await ctrl.backfillReplacement({ limit: 10 });
      expect(result.queued).toBe(1);
      expect(result.agencyUserId).toBe('3584055');
      delete process.env.CLICKUP_AGENCY_USER_ID;
    });

    it('throws BadRequestException if CLICKUP_AGENCY_USER_ID not set', async () => {
      delete process.env.CLICKUP_AGENCY_USER_ID;
      const ctrl = new AdminController(makeQueues(), makeDeadLetters(), makeWebhooks(), makeTimeEntriesRepo());
      await expect(ctrl.backfillReplacement({})).rejects.toThrow(BadRequestException);
    });
  });
});

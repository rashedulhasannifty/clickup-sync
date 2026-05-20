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

  function makeClickup() {
    return { getTeamMembers: jest.fn().mockResolvedValue([]) } as any;
  }

  function makeWebhooks(result: any = { action: 'created', webhookId: 'wh-1', secret: 'sec', endpoint: 'https://x.com' }) {
    return { register: jest.fn().mockResolvedValue(result) } as any;
  }

  function makeTimeEntriesRepo() {
    return {
      findUnreplacedAgencyEntries: jest.fn().mockResolvedValue([]),
    } as any;
  }

  function makeRatesRepo() {
    return {
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 }),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue(null),
    } as any;
  }

  function makeTagAssigneeRepo() {
    return {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  function makeTasksRepo() {
    return { findAllIds: jest.fn().mockResolvedValue([]) } as any;
  }

  function makeRatesService() {
    return {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  function makeCtrl(queues?: any, deadLetters?: any, webhooks?: any, timeEntriesRepo?: any) {
    return new AdminController(
      queues ?? makeQueues(),
      deadLetters ?? makeDeadLetters(),
      makeClickup(),
      webhooks ?? makeWebhooks(),
      timeEntriesRepo ?? makeTimeEntriesRepo(),
      makeRatesRepo(),
      makeTagAssigneeRepo(),
      makeTasksRepo(),
      makeRatesService(),
    );
  }

  describe('syncTask', () => {
    it('queues SYNC_CLICKUP_TASK on clickup-tasks queue and returns taskId', () => {
      const queues = makeQueues();
      const ctrl = makeCtrl(queues);
      const result = ctrl.syncTask({ taskId: '86abc' });
      expect(result).toEqual({ queued: true, taskId: '86abc' });
      expect(queues.get).toHaveBeenCalledWith('clickup-tasks');
    });
  });

  describe('backfill', () => {
    it('uses configured lookback when lookbackDays is not provided', () => {
      const result = makeCtrl().backfill({ spaceId: '3577824' });
      expect(result).toEqual({ queued: true, spaceId: '3577824', lookbackDays: 90 });
    });

    it('uses provided lookbackDays over configured default', () => {
      const result = makeCtrl().backfill({ spaceId: '3589129', lookbackDays: 7 });
      expect(result).toEqual({ queued: true, spaceId: '3589129', lookbackDays: 7 });
    });

    it('throws BadRequestException for unknown spaceId', () => {
      expect(() => makeCtrl().backfill({ spaceId: 'bad-id' })).toThrow(BadRequestException);
    });

    it('queues on clickup-backfills queue', () => {
      const queues = makeQueues();
      makeCtrl(queues).backfill({ spaceId: '3525433' });
      expect(queues.get).toHaveBeenCalledWith('clickup-backfills');
    });

    it('allows unknown spaceId when allowUnknownSpaces is true', () => {
      const result = makeCtrl().backfill({ spaceId: 'test-space-999', allowUnknownSpaces: true });
      expect(result).toEqual({ queued: true, spaceId: 'test-space-999', lookbackDays: 30 });
    });

    it('uses provided lookbackDays for unknown space instead of default 30', () => {
      const result = makeCtrl().backfill({ spaceId: 'test-space-999', allowUnknownSpaces: true, lookbackDays: 7 });
      expect(result).toEqual({ queued: true, spaceId: 'test-space-999', lookbackDays: 7 });
    });
  });

  describe('registerWebhook', () => {
    it('delegates to ClickupWebhooksService.register', async () => {
      const webhooks = makeWebhooks({ action: 'existing', webhookId: 'w1', endpoint: 'https://x.com' });
      const ctrl = makeCtrl(undefined, undefined, webhooks);
      const result = await ctrl.registerWebhook();
      expect(result).toEqual({ action: 'existing', webhookId: 'w1', endpoint: 'https://x.com' });
    });
  });

  describe('listDeadLetters', () => {
    it('clamps limit to 200 and returns repository result', async () => {
      const dl = makeDeadLetters();
      await makeCtrl(undefined, dl).listDeadLetters(999, 0);
      expect(dl.findPending).toHaveBeenCalledWith(200, 0);
    });
  });

  describe('retryDeadLetter', () => {
    it('throws NotFoundException when record does not exist', async () => {
      await expect(makeCtrl(undefined, makeDeadLetters(null)).retryDeadLetter('99')).rejects.toThrow(NotFoundException);
    });

    it('re-queues using record queueName+jobName+payload and marks retried', async () => {
      const queues = makeQueues();
      const record = { id: BigInt(1), queueName: 'clickup-tasks', jobName: 'sync-clickup-task', payload: { taskId: 'abc' } };
      const dl = makeDeadLetters(record);
      const result = await makeCtrl(queues, dl).retryDeadLetter('1');
      expect(result).toEqual({ requeued: true, id: '1', queueName: 'clickup-tasks', jobName: 'sync-clickup-task' });
      expect(dl.markRetried).toHaveBeenCalledWith(BigInt(1));
    });
  });

  describe('backfillReplacement', () => {
    it('returns queued count', async () => {
      process.env.CLICKUP_AGENCY_USER_ID = '3584055';
      const repo = { findUnreplacedAgencyEntries: jest.fn().mockResolvedValue([{ timeEntryId: 'e1', taskId: 't1', startTime: new Date(1700000000000), endTime: new Date(1700003600000), durationHours: { toNumber: () => 1 } as any, billable: true, description: null }]) } as any;
      const queues = makeQueues();
      const result = await makeCtrl(queues, undefined, undefined, repo).backfillReplacement({ limit: 10 });
      expect(result.queued).toBe(1);
      expect(result.agencyUserId).toBe('3584055');
      delete process.env.CLICKUP_AGENCY_USER_ID;
    });

    it('throws BadRequestException if CLICKUP_AGENCY_USER_ID not set', async () => {
      delete process.env.CLICKUP_AGENCY_USER_ID;
      await expect(makeCtrl().backfillReplacement({})).rejects.toThrow(BadRequestException);
    });
  });

  describe('rates CRUD', () => {
    it('listRates delegates to ratesRepo.findAll (read path stays on the repo)', async () => {
      const ratesRepo = makeRatesRepo();
      const ctrl = new AdminController(
        makeQueues(), makeDeadLetters(), makeClickup(), makeWebhooks(), makeTimeEntriesRepo(),
        ratesRepo, makeTagAssigneeRepo(), makeTasksRepo(), makeRatesService(),
      );
      await ctrl.listRates(1, 50);
      expect(ratesRepo.findAll).toHaveBeenCalledWith(1, 50);
    });

    it('createRate calls ratesService.create (mutation seam) with parsed dates', async () => {
      const ratesService = makeRatesService();
      const ctrl = new AdminController(
        makeQueues(), makeDeadLetters(), makeClickup(), makeWebhooks(), makeTimeEntriesRepo(),
        makeRatesRepo(), makeTagAssigneeRepo(), makeTasksRepo(), ratesService,
      );
      await ctrl.createRate({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 15000, validFrom: '2024-01-01' });
      expect(ratesService.create).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'u1', hourlyRateCents: 15000 }));
    });

    it('deleteRate calls ratesService.remove with parsed BigInt id', async () => {
      const ratesService = makeRatesService();
      const ctrl = new AdminController(
        makeQueues(), makeDeadLetters(), makeClickup(), makeWebhooks(), makeTimeEntriesRepo(),
        makeRatesRepo(), makeTagAssigneeRepo(), makeTasksRepo(), ratesService,
      );
      await ctrl.deleteRate('42');
      expect(ratesService.remove).toHaveBeenCalledWith(BigInt(42));
    });
  });

  describe('tag-assignee map CRUD', () => {
    it('listTagAssignee delegates to tagAssigneeRepo.findAll', async () => {
      const tagRepo = makeTagAssigneeRepo();
      const ctrl = new AdminController(
        makeQueues(), makeDeadLetters(), makeClickup(), makeWebhooks(), makeTimeEntriesRepo(),
        makeRatesRepo(), tagRepo, makeTasksRepo(), makeRatesService(),
      );
      await ctrl.listTagAssignee();
      expect(tagRepo.findAll).toHaveBeenCalled();
    });

    it('deleteTagAssignee calls tagAssigneeRepo.remove with parsed BigInt id', async () => {
      const tagRepo = makeTagAssigneeRepo();
      const ctrl = new AdminController(
        makeQueues(), makeDeadLetters(), makeClickup(), makeWebhooks(), makeTimeEntriesRepo(),
        makeRatesRepo(), tagRepo, makeTasksRepo(), makeRatesService(),
      );
      await ctrl.deleteTagAssignee('7');
      expect(tagRepo.remove).toHaveBeenCalledWith(BigInt(7));
    });
  });
});

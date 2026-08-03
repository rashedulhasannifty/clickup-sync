import { AdminWebhooksController } from '../src/admin/admin-webhooks.controller';

describe('AdminWebhooksController', () => {
  function makeQueues() {
    const add = jest.fn().mockResolvedValue({});
    const getJobs = jest.fn().mockResolvedValue([]);
    return { get: jest.fn().mockReturnValue({ add, getJobs }), defaultJobOptions: jest.fn().mockReturnValue({}), webhookJobOptions: jest.fn().mockReturnValue({}) } as any;
  }

  function makeWebhooks(result: any = { action: 'created', webhookId: 'wh-1', secret: 'sec', endpoint: 'https://x.com' }) {
    return { register: jest.fn().mockResolvedValue(result) } as any;
  }

  function makeWebhookEvents() {
    return {
      findFailed: jest.fn().mockResolvedValue([]),
      markRequeued: jest.fn().mockResolvedValue({}),
    } as any;
  }

  function makeWebhookParser() {
    return { parse: jest.fn((raw: unknown) => ({ eventType: 'taskUpdated', taskId: 'task-x', loggedUserId: null, fingerprint: 'fp-x', payload: raw })) } as any;
  }

  function makeSettings() {
    return {
      getPreferences: () => ({ sync: { backfillOnConnect: false } }),
      isSpaceEnabled: () => true,
    } as any;
  }

  function makeCtrl(over: Partial<{ queues: any; webhooks: any; webhookEvents: any; webhookParser: any; settings: any }> = {}) {
    return new AdminWebhooksController(
      over.queues ?? makeQueues(),
      over.webhooks ?? makeWebhooks(),
      over.webhookEvents ?? makeWebhookEvents(),
      over.webhookParser ?? makeWebhookParser(),
      over.settings ?? makeSettings(),
    );
  }

  describe('registerWebhook', () => {
    it('delegates to ClickupWebhooksService.register', async () => {
      const webhooks = makeWebhooks({ action: 'existing', webhookId: 'w1', endpoint: 'https://x.com' });
      const ctrl = makeCtrl({ webhooks });
      const result = await ctrl.registerWebhook({ email: 'owner@test.com', isMachine: false } as any);
      expect(result).toEqual({ action: 'existing', webhookId: 'w1', endpoint: 'https://x.com' });
    });
  });

  describe('rotateWebhook', () => {
    it('delegates to ClickupWebhooksService.rotate with the actor', async () => {
      const rotate = jest.fn().mockResolvedValue({ deletedId: 'old', rotated: true, result: { action: 'created', webhookId: 'wh-new', endpoint: 'https://x.com', secretStored: true } });
      const webhooks = { register: jest.fn(), rotate } as any;
      const ctrl = makeCtrl({ webhooks });
      const result = await ctrl.rotateWebhook({ email: 'owner@test.com', isMachine: false } as any);
      expect(rotate).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ deletedId: 'old', rotated: true });
    });
  });

  describe('retryFailedWebhooks', () => {
    it('re-enqueues each failed event after re-parsing its raw payload, and clears the failed marker', async () => {
      const queues = makeQueues();
      const rawA = { event: 'taskUpdated', task_id: 'A' };
      const rawB = { event: 'taskDeleted', task_id: 'B' };
      const webhookEvents = {
        findFailed: jest.fn().mockResolvedValue([
          { id: BigInt(10), fingerprint: 'fp-a', rawPayload: rawA },
          { id: BigInt(11), fingerprint: 'fp-b', rawPayload: rawB },
        ]),
        markRequeued: jest.fn().mockResolvedValue({}),
      } as any;
      const parser = makeWebhookParser();
      const result = await makeCtrl({ queues, webhookEvents, webhookParser: parser }).retryFailedWebhooks();

      expect(result).toEqual({ requeued: 2, scanned: 2, limit: 500 });
      expect(parser.parse).toHaveBeenCalledTimes(2);
      expect(parser.parse).toHaveBeenCalledWith(rawA);
      expect(parser.parse).toHaveBeenCalledWith(rawB);
      expect(webhookEvents.markRequeued).toHaveBeenCalledWith('fp-a');
      expect(webhookEvents.markRequeued).toHaveBeenCalledWith('fp-b');
      // Both jobs went onto clickup-webhooks
      const add = (queues.get as jest.Mock).mock.results[0].value.add as jest.Mock;
      expect(add).toHaveBeenCalledTimes(2);
    });

    it('clamps limit to 2000', async () => {
      const webhookEvents = { findFailed: jest.fn().mockResolvedValue([]), markRequeued: jest.fn() } as any;
      const result = await makeCtrl({ webhookEvents }).retryFailedWebhooks('9999');
      expect(webhookEvents.findFailed).toHaveBeenCalledWith(2000);
      expect(result.limit).toBe(2000);
    });
  });
});

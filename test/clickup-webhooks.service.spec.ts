import { ClickupWebhooksService } from '../src/clickup/clickup-webhooks.service';

describe('ClickupWebhooksService', () => {
  const ENDPOINT = 'https://app.example.com/webhooks/clickup';
  const TEAM_ID = '3450636';

  function makeSettings(events = 'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated') {
    return {
      getTeamId: () => TEAM_ID,
      getWebhookEndpoint: () => ENDPOINT,
      getWebhookEvents: () => events,
      setWebhookSecret: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  // The 4 events makeSettings() returns by default, as a sorted-agnostic array.
  const DEFAULT_EVENTS = ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskTimeTrackedUpdated'];

  function makeService(
    webhooks: any[],
    createResult = { id: 'new-id', secret: 'new-secret' },
    settings = makeSettings(),
  ) {
    const client = {
      getWebhooks: jest.fn().mockResolvedValue(webhooks),
      createWebhook: jest.fn().mockResolvedValue(createResult),
      updateWebhook: jest.fn().mockResolvedValue(undefined),
    } as any;
    return { svc: new ClickupWebhooksService(client, settings), client, settings };
  }

  it('returns existing (no-op) when an active webhook is already subscribed to the configured events', async () => {
    const webhooks = [{ id: 'existing-id', endpoint: ENDPOINT, events: DEFAULT_EVENTS, health: { status: 'active', fail_count: 0 } }];
    const { svc, client } = makeService(webhooks);
    const result = await svc.register();
    expect(result).toEqual({ action: 'existing', webhookId: 'existing-id', endpoint: ENDPOINT });
    expect(client.updateWebhook).not.toHaveBeenCalled();
    expect(client.createWebhook).not.toHaveBeenCalled();
  });

  it('updates an active webhook in place when configured events changed, reporting added events', async () => {
    const webhooks = [{ id: 'existing-id', endpoint: ENDPOINT, events: DEFAULT_EVENTS, health: { status: 'active', fail_count: 0 } }];
    const settings = makeSettings('taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated');
    const { svc, client } = makeService(webhooks, undefined, settings);
    const result = await svc.register();
    expect(result).toMatchObject({ action: 'updated', webhookId: 'existing-id', addedEvents: ['taskStatusUpdated'] });
    expect(client.updateWebhook).toHaveBeenCalledWith(
      'existing-id',
      expect.objectContaining({ endpoint: ENDPOINT, status: 'active' }),
    );
    expect(client.createWebhook).not.toHaveBeenCalled();
  });

  it('creates new webhook and stores the returned secret', async () => {
    const { svc, settings } = makeService([]);
    const result = await svc.register('alice');
    expect(result).toEqual({ action: 'created', webhookId: 'new-id', endpoint: ENDPOINT, secretStored: true });
    expect(settings.setWebhookSecret).toHaveBeenCalledWith('new-secret', 'alice');
  });

  it('reports secretStored=false when the secret cannot be persisted', async () => {
    const settings = makeSettings();
    settings.setWebhookSecret = jest.fn().mockRejectedValue(new Error('no key'));
    const result = await makeService([], { id: 'new-id', secret: 'new-secret' }, settings).svc.register();
    expect(result).toEqual({ action: 'created', webhookId: 'new-id', endpoint: ENDPOINT, secretStored: false });
  });

  it('ignores webhooks pointing to a different endpoint', async () => {
    const webhooks = [{ id: 'other', endpoint: 'https://other.com', health: { status: 'active', fail_count: 0 } }];
    const result = await makeService(webhooks).svc.register();
    expect(result.action).toBe('created');
  });

  it('reactivates and updates an existing webhook with non-active health instead of creating a duplicate', async () => {
    const webhooks = [{ id: 'bad', endpoint: ENDPOINT, events: DEFAULT_EVENTS, health: { status: 'failing', fail_count: 10 } }];
    const { svc, client } = makeService(webhooks);
    const result = await svc.register();
    expect(result.action).toBe('updated');
    expect(client.updateWebhook).toHaveBeenCalledWith('bad', { endpoint: ENDPOINT, events: DEFAULT_EVENTS, status: 'active' });
    expect(client.createWebhook).not.toHaveBeenCalled();
  });

  it('passes correct events to createWebhook', async () => {
    const { svc, client } = makeService([], { id: 'x', secret: 'y' }, makeSettings('taskCreated,taskDeleted'));
    await svc.register();
    expect(client.createWebhook).toHaveBeenCalledWith(TEAM_ID, ENDPOINT, ['taskCreated', 'taskDeleted']);
  });

  describe('listRegistered', () => {
    it('maps webhooks and computes drift vs the configured events', async () => {
      // Configured (desired) = 4 default events. Registered webhook is missing
      // taskTimeTrackedUpdated and has an extra taskCommentPosted.
      const registered = [
        {
          id: 'wh-1',
          endpoint: ENDPOINT,
          events: ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskCommentPosted'],
          health: { status: 'active', fail_count: 0 },
        },
      ];
      const { svc } = makeService(registered);
      const result = await svc.listRegistered();

      expect(result.configuredEndpoint).toBe(ENDPOINT);
      expect(result.desiredEvents).toEqual(DEFAULT_EVENTS);
      expect(result.webhooks).toHaveLength(1);
      const w = result.webhooks[0];
      expect(w.id).toBe('wh-1');
      expect(w.endpoint).toBe(ENDPOINT);
      expect(w.health).toEqual({ status: 'active', failCount: 0 });
      expect(w.missingEvents).toEqual(['taskTimeTrackedUpdated']);
      expect(w.extraEvents).toEqual(['taskCommentPosted']);
    });

    it('returns an empty list (no throw) when no webhooks are registered', async () => {
      const { svc } = makeService([]);
      const result = await svc.listRegistered();
      expect(result.webhooks).toEqual([]);
      expect(result.desiredEvents).toEqual(DEFAULT_EVENTS);
    });

    it('normalizes a webhook with missing events/health to empty array / null', async () => {
      const { svc } = makeService([{ id: 'wh-2', endpoint: undefined }]);
      const [w] = (await svc.listRegistered()).webhooks;
      expect(w.endpoint).toBeNull();
      expect(w.events).toEqual([]);
      expect(w.health).toBeNull();
      expect(w.missingEvents).toEqual(DEFAULT_EVENTS); // nothing registered → all desired missing
    });
  });
});

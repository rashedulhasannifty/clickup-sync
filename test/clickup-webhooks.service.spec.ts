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

  function makeService(
    webhooks: any[],
    createResult = { id: 'new-id', secret: 'new-secret' },
    settings = makeSettings(),
  ) {
    const client = {
      getWebhooks: jest.fn().mockResolvedValue(webhooks),
      createWebhook: jest.fn().mockResolvedValue(createResult),
    } as any;
    return { svc: new ClickupWebhooksService(client, settings), client, settings };
  }

  it('returns existing when active webhook found for same endpoint', async () => {
    const webhooks = [{ id: 'existing-id', endpoint: ENDPOINT, health: { status: 'active', fail_count: 0 } }];
    const result = await makeService(webhooks).svc.register();
    expect(result).toEqual({ action: 'existing', webhookId: 'existing-id', endpoint: ENDPOINT });
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

  it('ignores existing webhooks with non-active health status', async () => {
    const webhooks = [{ id: 'bad', endpoint: ENDPOINT, health: { status: 'failing', fail_count: 10 } }];
    const result = await makeService(webhooks).svc.register();
    expect(result.action).toBe('created');
  });

  it('passes correct events to createWebhook', async () => {
    const { svc, client } = makeService([], { id: 'x', secret: 'y' }, makeSettings('taskCreated,taskDeleted'));
    await svc.register();
    expect(client.createWebhook).toHaveBeenCalledWith(TEAM_ID, ENDPOINT, ['taskCreated', 'taskDeleted']);
  });
});

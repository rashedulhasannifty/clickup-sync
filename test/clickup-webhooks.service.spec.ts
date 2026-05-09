import { ClickupWebhooksService } from '../src/clickup/clickup-webhooks.service';

describe('ClickupWebhooksService', () => {
  const ENDPOINT = 'https://app.example.com/webhooks/clickup';
  const TEAM_ID = '3450636';

  function makeService(webhooks: any[], createResult = { id: 'new-id', secret: 'new-secret' }) {
    const client = {
      getWebhooks: jest.fn().mockResolvedValue(webhooks),
      createWebhook: jest.fn().mockResolvedValue(createResult),
    } as any;
    const config = {
      get: (key: string, def: string) => {
        if (key === 'CLICKUP_TEAM_ID') return TEAM_ID;
        if (key === 'CLICKUP_WEBHOOK_ENDPOINT') return ENDPOINT;
        if (key === 'CLICKUP_WEBHOOK_EVENTS') return 'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated';
        return def;
      },
    } as any;
    return new ClickupWebhooksService(client, config);
  }

  it('returns existing when active webhook found for same endpoint', async () => {
    const webhooks = [{ id: 'existing-id', endpoint: ENDPOINT, health: { status: 'active', fail_count: 0 } }];
    const result = await makeService(webhooks).register();
    expect(result).toEqual({ action: 'existing', webhookId: 'existing-id', endpoint: ENDPOINT });
  });

  it('creates new webhook when none match endpoint', async () => {
    const result = await makeService([]).register();
    expect(result).toEqual({ action: 'created', webhookId: 'new-id', secret: 'new-secret', endpoint: ENDPOINT });
  });

  it('ignores webhooks pointing to a different endpoint', async () => {
    const webhooks = [{ id: 'other', endpoint: 'https://other.com', health: { status: 'active', fail_count: 0 } }];
    const result = await makeService(webhooks).register();
    expect(result.action).toBe('created');
  });

  it('ignores existing webhooks with non-active health status', async () => {
    const webhooks = [{ id: 'bad', endpoint: ENDPOINT, health: { status: 'failing', fail_count: 10 } }];
    const result = await makeService(webhooks).register();
    expect(result.action).toBe('created');
  });

  it('passes correct events to createWebhook', async () => {
    const client = { getWebhooks: jest.fn().mockResolvedValue([]), createWebhook: jest.fn().mockResolvedValue({ id: 'x', secret: 'y' }) } as any;
    const config = { get: (k: string, d: string) => ({ CLICKUP_TEAM_ID: TEAM_ID, CLICKUP_WEBHOOK_ENDPOINT: ENDPOINT, CLICKUP_WEBHOOK_EVENTS: 'taskCreated,taskDeleted' }[k] ?? d) } as any;
    const svc = new ClickupWebhooksService(client, config);
    await svc.register();
    expect(client.createWebhook).toHaveBeenCalledWith(TEAM_ID, ENDPOINT, ['taskCreated', 'taskDeleted']);
  });
});

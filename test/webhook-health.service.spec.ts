import { WebhookHealthService } from '../src/clickup/webhook-health.service';

describe('WebhookHealthService', () => {
  const ENDPOINT = 'https://app.example.com/webhooks/clickup';

  function suspendedList() {
    return {
      configuredEndpoint: ENDPOINT,
      webhooks: [
        { id: 'wh1', endpoint: ENDPOINT, events: [], health: { status: 'suspended', failCount: 7 }, missingEvents: [], extraEvents: [] },
      ],
    };
  }

  function make(opts: { listResult?: any; configValue?: any; probeResult?: boolean } = {}) {
    const listResult = opts.listResult ?? suspendedList();
    const webhooks = {
      listRegistered: jest.fn().mockResolvedValue(listResult),
      register: jest.fn().mockResolvedValue({ action: 'updated', webhookId: 'wh1', endpoint: ENDPOINT, events: [], addedEvents: [] }),
    } as any;
    const auditLog = { create: jest.fn().mockResolvedValue(undefined) } as any;
    const config = { get: jest.fn().mockReturnValue(opts.configValue ?? true) } as any;
    const probe = { probe: jest.fn().mockResolvedValue(opts.probeResult ?? true) } as any;
    const svc = new WebhookHealthService(webhooks, auditLog, config, probe);
    return { svc, webhooks, auditLog, config, probe };
  }

  it('does nothing when disabled via boolean false', async () => {
    const { svc, webhooks } = make({ configValue: false });
    await svc.checkAndHeal();
    expect(webhooks.listRegistered).not.toHaveBeenCalled();
  });

  it('does nothing when disabled via string "false" (ConfigService may return the raw string)', async () => {
    const { svc, webhooks } = make({ configValue: 'false' });
    await svc.checkAndHeal();
    expect(webhooks.listRegistered).not.toHaveBeenCalled();
  });

  it('proceeds when enabled via string "true"', async () => {
    const { svc, webhooks } = make({ configValue: 'true' });
    await svc.checkAndHeal();
    expect(webhooks.listRegistered).toHaveBeenCalled();
  });

  it('does not heal when the configured webhook is active', async () => {
    const listResult = {
      configuredEndpoint: ENDPOINT,
      webhooks: [{ id: 'wh1', endpoint: ENDPOINT, events: [], health: { status: 'active', failCount: 0 }, missingEvents: [], extraEvents: [] }],
    };
    const { svc, webhooks, auditLog } = make({ listResult });
    await svc.checkAndHeal();
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('does not heal when no webhook matches the configured endpoint', async () => {
    const listResult = {
      configuredEndpoint: ENDPOINT,
      webhooks: [{ id: 'stale', endpoint: 'https://old.example.com/webhooks/clickup', events: [], health: { status: 'suspended', failCount: 3 }, missingEvents: [], extraEvents: [] }],
    };
    const { svc, webhooks, auditLog } = make({ listResult });
    await svc.checkAndHeal();
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('skips heal (no register, no audit) when the endpoint probe reports down', async () => {
    const { svc, webhooks, auditLog, probe } = make({ probeResult: false });
    await svc.checkAndHeal();
    expect(probe.probe).toHaveBeenCalledWith(ENDPOINT);
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('heals a suspended webhook when the endpoint probe reports up, writing one audit row', async () => {
    const { svc, webhooks, auditLog } = make();
    await svc.checkAndHeal();
    expect(webhooks.register).toHaveBeenCalledTimes(1);
    expect(auditLog.create).toHaveBeenCalledTimes(1);
    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'system:webhook-autoheal',
        method: 'CRON',
        path: '/system/webhook-autoheal',
        routePattern: '/system/webhook-autoheal',
        statusCode: 200,
        requestBody: { webhookId: 'wh1', previousStatus: 'suspended', failCount: 7 },
      }),
    );
  });

  it('only targets the configured-endpoint webhook when a stale one is also suspended', async () => {
    const listResult = {
      configuredEndpoint: ENDPOINT,
      webhooks: [
        { id: 'stale', endpoint: 'https://old.example.com/webhooks/clickup', events: [], health: { status: 'suspended', failCount: 9 }, missingEvents: [], extraEvents: [] },
        { id: 'wh1', endpoint: ENDPOINT, events: [], health: { status: 'suspended', failCount: 2 }, missingEvents: [], extraEvents: [] },
      ],
    };
    const { svc, webhooks, auditLog, probe } = make({ listResult });
    await svc.checkAndHeal();
    expect(probe.probe).toHaveBeenCalledWith(ENDPOINT);
    expect(webhooks.register).toHaveBeenCalledTimes(1);
    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { webhookId: 'wh1', previousStatus: 'suspended', failCount: 2 } }),
    );
  });

  it('stops healing after 3 heals of the same webhook within an hour', async () => {
    const { svc, webhooks, auditLog } = make();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    expect(webhooks.register).toHaveBeenCalledTimes(3);
    expect(auditLog.create).toHaveBeenCalledTimes(3);
  });
});

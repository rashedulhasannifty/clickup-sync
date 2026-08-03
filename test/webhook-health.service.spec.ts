import { WebhookHealthService } from '../src/clickup/webhook-health.service';

describe('WebhookHealthService', () => {
  const ENDPOINT = 'https://app.example.com/webhooks/clickup';

  function suspendedList() {
    return {
      configuredEndpoint: ENDPOINT,
      webhooks: [
        {
          id: 'wh1',
          endpoint: ENDPOINT,
          events: [],
          health: { status: 'suspended', failCount: 7 },
          missingEvents: [],
          extraEvents: [],
        },
      ],
    };
  }

  // Registered webhooks start active; a fresh delete+recreate returns 'created'.
  function createdResult(id = 'wh-new', secretStored = true) {
    return { action: 'created', webhookId: id, endpoint: ENDPOINT, secretStored };
  }

  function make(
    opts: {
      listResult?: any;
      configValue?: any;
      probeResult?: boolean;
      registerResult?: any;
      deleteResult?: any;
    } = {},
  ) {
    const listResult = opts.listResult ?? suspendedList();
    const registerResult = opts.registerResult ?? {
      action: 'updated',
      webhookId: 'wh1',
      endpoint: ENDPOINT,
      events: [],
      addedEvents: [],
    };
    const webhooks = {
      listRegistered: jest.fn().mockResolvedValue(listResult),
      register: jest.fn().mockResolvedValue(registerResult),
      deleteById: jest.fn().mockResolvedValue(opts.deleteResult ?? { deleted: true, id: 'wh1' }),
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
      webhooks: [
        {
          id: 'wh1',
          endpoint: ENDPOINT,
          events: [],
          health: { status: 'active', failCount: 0 },
          missingEvents: [],
          extraEvents: [],
        },
      ],
    };
    const { svc, webhooks, auditLog } = make({ listResult });
    await svc.checkAndHeal();
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('does not heal a "failing" webhook (it still receives events and self-recovers)', async () => {
    const listResult = {
      configuredEndpoint: ENDPOINT,
      webhooks: [
        {
          id: 'wh1',
          endpoint: ENDPOINT,
          events: [],
          health: { status: 'failing', failCount: 12 },
          missingEvents: [],
          extraEvents: [],
        },
      ],
    };
    const { svc, webhooks, auditLog, probe } = make({ listResult });
    await svc.checkAndHeal();
    expect(probe.probe).not.toHaveBeenCalled();
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('does not heal when no webhook matches the configured endpoint', async () => {
    const listResult = {
      configuredEndpoint: ENDPOINT,
      webhooks: [
        {
          id: 'stale',
          endpoint: 'https://old.example.com/webhooks/clickup',
          events: [],
          health: { status: 'suspended', failCount: 3 },
          missingEvents: [],
          extraEvents: [],
        },
      ],
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
        {
          id: 'stale',
          endpoint: 'https://old.example.com/webhooks/clickup',
          events: [],
          health: { status: 'suspended', failCount: 9 },
          missingEvents: [],
          extraEvents: [],
        },
        {
          id: 'wh1',
          endpoint: ENDPOINT,
          events: [],
          health: { status: 'suspended', failCount: 2 },
          missingEvents: [],
          extraEvents: [],
        },
      ],
    };
    const { svc, webhooks, auditLog, probe } = make({ listResult });
    await svc.checkAndHeal();
    expect(probe.probe).toHaveBeenCalledWith(ENDPOINT);
    expect(webhooks.register).toHaveBeenCalledTimes(1);
    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { webhookId: 'wh1', previousStatus: 'suspended', failCount: 2 },
      }),
    );
  });

  it('reactivates in place up to 3 times, then escalates to delete+recreate to rotate the secret', async () => {
    const { svc, webhooks, auditLog } = make();
    // First 3 runs PUT-reactivate (register returns the default 'updated').
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    expect(webhooks.deleteById).not.toHaveBeenCalled();
    expect(webhooks.register).toHaveBeenCalledTimes(3);

    // 4th run: reactivation isn't sticking (cap hit) → rotate the secret.
    webhooks.register.mockResolvedValueOnce(createdResult());
    await svc.checkAndHeal();
    expect(webhooks.deleteById).toHaveBeenCalledTimes(1);
    expect(webhooks.deleteById).toHaveBeenCalledWith('wh1');
    expect(webhooks.register).toHaveBeenCalledTimes(4);
    // The recreate is audited with the rotation details.
    expect(auditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ action: 'recreated', webhookId: 'wh-new', secretStored: true }),
      }),
    );
  });

  it('stops after the daily recreate cap, without deleting again (manual intervention required)', async () => {
    const { svc, webhooks } = make();
    // Drive it past the reactivation cap, then let it recreate. Because a fresh
    // recreate returns a NEW id, its reactivation counter resets — so each
    // recreate is reached again after 3 more reactivations. The per-endpoint
    // recreate cap (2/day) is what ultimately stops the churn.
    webhooks.register.mockImplementation(async () => createdResult('wh-new'));
    for (let i = 0; i < 40; i++) await svc.checkAndHeal();
    // Delete is called at most MAX_RECREATES_PER_DAY times for this endpoint.
    expect(webhooks.deleteById.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('recreates but flags when the new secret could not be stored (APP_ENCRYPTION_KEY)', async () => {
    const { svc, webhooks, auditLog } = make();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    webhooks.register.mockResolvedValueOnce(createdResult('wh-new', false));
    await svc.checkAndHeal();
    expect(webhooks.deleteById).toHaveBeenCalledTimes(1);
    expect(auditLog.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ action: 'recreated', secretStored: false }),
      }),
    );
  });

  it('does not claim a rotation when register still finds a match after delete (no-op)', async () => {
    const { svc, webhooks, auditLog } = make();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    await svc.checkAndHeal();
    // 4th run: cap hit → delete+recreate, but register returns 'updated' — a
    // webhook still matched after the delete, so the OLD secret was kept.
    webhooks.register.mockResolvedValueOnce({ action: 'updated', webhookId: 'wh1', endpoint: ENDPOINT, events: [], addedEvents: [] });
    await svc.checkAndHeal();
    expect(webhooks.deleteById).toHaveBeenCalledTimes(1);
    const last = auditLog.create.mock.calls.at(-1)![0];
    expect(last.requestBody.action).toBe('recreate-noop');
    // Must NOT falsely record a stored secret / successful rotation.
    expect(last.requestBody.secretStored).toBeUndefined();
  });

  it('does not delete+recreate when the endpoint probe reports down', async () => {
    const { svc, webhooks } = make({ probeResult: false });
    // Even past the reactivation cap, an unreachable endpoint blocks any write.
    for (let i = 0; i < 5; i++) await svc.checkAndHeal();
    expect(webhooks.register).not.toHaveBeenCalled();
    expect(webhooks.deleteById).not.toHaveBeenCalled();
  });

  it('resolves without throwing when register() rejects, and does not write an audit row', async () => {
    const { svc, webhooks, auditLog } = make();
    webhooks.register.mockRejectedValue(new Error('boom'));
    await expect(svc.checkAndHeal()).resolves.toBeUndefined();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it('skips the audit when register() reports the webhook already self-recovered', async () => {
    const { svc, webhooks, auditLog } = make({
      registerResult: { action: 'existing', webhookId: 'wh1', endpoint: ENDPOINT },
    });
    await svc.checkAndHeal();
    expect(webhooks.register).toHaveBeenCalledTimes(1);
    expect(auditLog.create).not.toHaveBeenCalled();
  });
});

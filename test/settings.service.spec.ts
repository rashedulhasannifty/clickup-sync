import { SettingsService } from '../src/settings/settings.service';

// Reversible fake "encryption" so we can assert what gets stored.
function makeCrypto() {
  return {
    isEnabled: true,
    encrypt: (s: string) => `enc:${s}`,
    decrypt: (b: string) => {
      if (!b.startsWith('enc:')) throw new Error('bad ciphertext');
      return b.slice(4);
    },
  } as any;
}

function makeRepo(row: any = null) {
  const store: { row: any } = { row };
  return {
    get: jest.fn(async () => store.row),
    upsert: jest.fn(async (data: any) => {
      store.row = { id: 'singleton', ...(store.row ?? {}), ...data, updatedAt: new Date() };
      return store.row;
    }),
  } as any;
}

describe('SettingsService', () => {
  afterEach(() => {
    for (const k of [
      'CLICKUP_API_TOKEN',
      'CLICKUP_TEAM_ID',
      'CLICKUP_WEBHOOK_SECRET',
      'CLICKUP_WEBHOOK_ENDPOINT',
      'CLICKUP_WEBHOOK_EVENTS',
    ]) {
      delete process.env[k];
    }
  });

  it('falls back to env when no DB row exists', async () => {
    process.env.CLICKUP_API_TOKEN = 'envtoken';
    process.env.CLICKUP_TEAM_ID = '777';
    const svc = new SettingsService(makeRepo(null), makeCrypto());
    await svc.onModuleInit();
    expect(svc.getApiToken()).toBe('envtoken');
    expect(svc.getTeamId()).toBe('777');
  });

  it('lets the DB value win over env', async () => {
    process.env.CLICKUP_TEAM_ID = '777';
    const repo = makeRepo({ id: 'singleton', clickupTeamId: '999', clickupApiTokenEnc: 'enc:dbtoken', updatedAt: new Date() });
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    expect(svc.getTeamId()).toBe('999');
    expect(svc.getApiToken()).toBe('dbtoken');
  });

  it('encrypts secrets on update and refreshes the cache', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    await svc.update({ apiToken: 'newtok', teamId: '111' }, 'alice');
    const arg = repo.upsert.mock.calls.at(-1)![0];
    expect(arg.clickupApiTokenEnc).toBe('enc:newtok');
    expect(arg.clickupTeamId).toBe('111');
    expect(arg.updatedBy).toBe('alice');
    expect(svc.getApiToken()).toBe('newtok');
  });

  it('does not write secret columns when secrets are not supplied', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    await svc.update({ teamId: '111' });
    const arg = repo.upsert.mock.calls.at(-1)![0];
    expect(arg.clickupApiTokenEnc).toBeUndefined();
    expect(arg.webhookSecretEnc).toBeUndefined();
  });

  it('masks secrets in getMasked', async () => {
    process.env.CLICKUP_API_TOKEN = 'pk_abcd1234';
    const svc = new SettingsService(makeRepo(null), makeCrypto());
    await svc.onModuleInit();
    const masked = svc.getMasked();
    expect(masked.apiTokenSet).toBe(true);
    expect(masked.apiTokenLast4).toBe('1234');
    expect((masked as unknown as Record<string, unknown>).apiToken).toBeUndefined();
    expect(masked.encryptionEnabled).toBe(true);
  });

  it('stores the webhook secret encrypted via setWebhookSecret', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    await svc.setWebhookSecret('whsec', 'bob');
    expect(repo.upsert.mock.calls.at(-1)![0].webhookSecretEnc).toBe('enc:whsec');
    expect(svc.getWebhookSecret()).toBe('whsec');
  });

  it('defaults spikeHoursCap to 12 when no DB row exists', async () => {
    const svc = new SettingsService(makeRepo(null), makeCrypto());
    await svc.onModuleInit();
    expect(svc.getSpikeHoursCap()).toBe(12);
    expect(svc.getMasked().spikeHoursCap).toBe(12);
  });

  it('reads spikeHoursCap from the DB row', async () => {
    const repo = makeRepo({ id: 'singleton', spikeHoursCap: 10, updatedAt: new Date() });
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    expect(svc.getSpikeHoursCap()).toBe(10);
  });

  it('round-trips spikeHoursCap through update()', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    const masked = await svc.update({ spikeHoursCap: 16 }, 'tester');
    expect(masked.spikeHoursCap).toBe(16);
    expect(svc.getSpikeHoursCap()).toBe(16);
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ spikeHoursCap: 16, updatedBy: 'tester' }),
    );
  });

  describe('getBackfillMaxLookbackDays', () => {
    it('defaults to 1095 when no DB row exists', async () => {
      const svc = new SettingsService(makeRepo(null), makeCrypto());
      await svc.onModuleInit();
      expect(svc.getBackfillMaxLookbackDays()).toBe(1095);
    });

    it('reads the configured value from preferences', async () => {
      const repo = makeRepo({ id: 'singleton', preferences: { sync: { maxBackfillLookbackDays: 1825 } }, updatedAt: new Date() });
      const svc = new SettingsService(repo, makeCrypto());
      await svc.onModuleInit();
      expect(svc.getBackfillMaxLookbackDays()).toBe(1825);
    });

    it('clamps a stored value above the 3650-day backstop', async () => {
      const repo = makeRepo({ id: 'singleton', preferences: { sync: { maxBackfillLookbackDays: 5000 } }, updatedAt: new Date() });
      const svc = new SettingsService(repo, makeCrypto());
      await svc.onModuleInit();
      expect(svc.getBackfillMaxLookbackDays()).toBe(3650);
    });

    it('clamps a stored value below 1 up to the floor', async () => {
      const repo = makeRepo({ id: 'singleton', preferences: { sync: { maxBackfillLookbackDays: 0 } }, updatedAt: new Date() });
      const svc = new SettingsService(repo, makeCrypto());
      await svc.onModuleInit();
      expect(svc.getBackfillMaxLookbackDays()).toBe(1);
    });

    it('round-trips through update()', async () => {
      const repo = makeRepo(null);
      const svc = new SettingsService(repo, makeCrypto());
      await svc.onModuleInit();
      await svc.update({ preferences: { sync: { maxBackfillLookbackDays: 1460 } } }, 'tester');
      expect(svc.getBackfillMaxLookbackDays()).toBe(1460);
      expect(svc.getPreferences().sync.maxBackfillLookbackDays).toBe(1460);
    });
  });
});

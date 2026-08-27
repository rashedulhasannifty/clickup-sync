import { SettingsService } from '../src/settings/settings.service';

function makeCrypto() {
  return { isEnabled: true, encrypt: (s: string) => `enc:${s}`, decrypt: (b: string) => b.slice(4) } as any;
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

describe('SettingsService preferences', () => {
  it('returns defaults when preferences column is null', async () => {
    const svc = new SettingsService(makeRepo(null), makeCrypto());
    await svc.onModuleInit();
    const prefs = svc.getMasked().preferences;
    expect(prefs.notifications.alerts.syncFail).toBe(true);
    expect(prefs.notifications.channels.pagerduty).toBe(false);
    expect(prefs.sync.reconcileLookbackDays).toBe(365);
    expect(prefs.sync.realtimeWebhooks).toBe(true);
    expect(prefs.sync.backfillOnConnect).toBe(true);
    expect(prefs.cost.autoRecalcOnRateChange).toBe(true);
    expect(prefs.cost.rateMatching).toBe('start');
    expect(prefs.failure.webhookRetryAttempts).toBe(5);
    expect(prefs.spaces).toEqual({});
  });

  it('deep-merges a partial preferences patch over current values', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    await svc.update({ preferences: { notifications: { channels: { slack: false } } } }, 'alice');
    const prefs = svc.getMasked().preferences;
    expect(prefs.notifications.channels.slack).toBe(false);
    expect(prefs.notifications.channels.email).toBe(true);
    expect(prefs.notifications.alerts.syncFail).toBe(true);
  });

  it('isSpaceEnabled defaults to true and honors an explicit false', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    expect(svc.isSpaceEnabled('3577824')).toBe(true);
    await svc.update({ preferences: { spaces: { '3577824': { enabled: false } } } });
    expect(svc.isSpaceEnabled('3577824')).toBe(false);
    expect(svc.isSpaceEnabled('9999999')).toBe(true);
  });

  it('exposes configuredSpaces from the static config', async () => {
    const svc = new SettingsService(makeRepo(null), makeCrypto());
    await svc.onModuleInit();
    const ids = svc.getMasked().configuredSpaces.map((s) => s.id);
    expect(ids).toContain('3577824');
  });

  it('deep-merges a cost preference without clobbering other cost keys', async () => {
    const repo = makeRepo(null);
    const svc = new SettingsService(repo, makeCrypto());
    await svc.onModuleInit();
    await svc.update({ preferences: { cost: { autoRecalcOnRateChange: false } } });
    const prefs = svc.getMasked().preferences;
    expect(prefs.cost.autoRecalcOnRateChange).toBe(false);
    expect(prefs.cost.rateMatching).toBe('start');
    expect(prefs.cost.excludedAssignees).toEqual([]);
  });
});

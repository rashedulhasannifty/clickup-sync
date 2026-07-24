import { SettingsService } from './settings.service';

function makeService(prefs: any) {
  const repo = { get: jest.fn().mockResolvedValue({ preferences: prefs }), upsert: jest.fn() } as any;
  const crypto = { isEnabled: false, encrypt: (s: string) => s, decrypt: (s: string) => s } as any;
  return new SettingsService(repo, crypto);
}

describe('SettingsService.getExcludedAssigneeIds', () => {
  it('returns an empty set when no excluded assignees are configured', async () => {
    const svc = makeService({});
    await svc.refresh();
    expect(svc.getExcludedAssigneeIds().size).toBe(0);
  });

  it('returns a set of the configured excluded assignee ids', async () => {
    const svc = makeService({ cost: { excludedAssignees: [{ id: 'u1', name: 'A', email: null }, { id: 'u2', name: 'B', email: null }] } });
    await svc.refresh();
    const ids = svc.getExcludedAssigneeIds();
    expect(ids.has('u1')).toBe(true);
    expect(ids.has('u2')).toBe(true);
    expect(ids.size).toBe(2);
  });
});

describe('SettingsService.getIncludeArchived', () => {
  it('defaults to true when unset', async () => {
    const svc = makeService({});
    await svc.refresh();
    expect(svc.getIncludeArchived()).toBe(true);
  });

  it('reflects the stored value', async () => {
    const svc = makeService({ sync: { includeArchived: false } });
    await svc.refresh();
    expect(svc.getIncludeArchived()).toBe(false);
  });
});

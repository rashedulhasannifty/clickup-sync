import { WorkspaceMembersService } from './workspace-members.service';

function makeClient(members: unknown[]) {
  const getTeamMembers = jest.fn().mockResolvedValue(members);
  return { client: { getTeamMembers } as any, getTeamMembers };
}

// SettingsService stub that resolves teamId from env (matching prior behavior).
const settings = { getTeamId: () => process.env.CLICKUP_TEAM_ID || '3450636' } as any;

describe('WorkspaceMembersService', () => {
  beforeEach(() => { delete process.env.CLICKUP_TEAM_ID; });

  it('returns member ids as strings, dropping members without an id', async () => {
    const { client } = makeClient([{ user: { id: 123 } }, { user: { id: '456' } }, { user: { id: null } }, { user: {} }, {}]);
    const svc = new WorkspaceMembersService(client, settings);
    expect(await svc.getMemberIds()).toEqual(['123', '456']);
  });

  it('caches across calls within the TTL window (single ClickUp fetch)', async () => {
    const { client, getTeamMembers } = makeClient([{ user: { id: 1 } }]);
    const svc = new WorkspaceMembersService(client, settings);
    await svc.getMemberIds();
    await svc.getMemberIds();
    expect(getTeamMembers).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent calls into a single ClickUp fetch', async () => {
    const { client, getTeamMembers } = makeClient([{ user: { id: 1 } }]);
    const svc = new WorkspaceMembersService(client, settings);
    const [a, b] = await Promise.all([svc.getMemberIds(), svc.getMemberIds()]);
    expect(a).toEqual(['1']);
    expect(b).toEqual(['1']);
    expect(getTeamMembers).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL elapses', async () => {
    const { client, getTeamMembers } = makeClient([{ user: { id: 1 } }]);
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      const svc = new WorkspaceMembersService(client, settings);
      await svc.getMemberIds();
      now.mockReturnValue(1_000_000 + 11 * 60 * 1000); // 11 min later, past the 10-min TTL
      await svc.getMemberIds();
      expect(getTeamMembers).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('passes CLICKUP_TEAM_ID through when fetching', async () => {
    process.env.CLICKUP_TEAM_ID = '999';
    const { client, getTeamMembers } = makeClient([{ user: { id: 1 } }]);
    const svc = new WorkspaceMembersService(client, settings);
    await svc.getMemberIds();
    expect(getTeamMembers).toHaveBeenCalledWith('999');
  });
});

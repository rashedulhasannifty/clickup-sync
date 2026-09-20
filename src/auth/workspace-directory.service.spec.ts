import { WorkspaceDirectoryService } from './workspace-directory.service';

function makeService(over: { members?: unknown[]; users?: unknown[]; invites?: unknown[] } = {}) {
  const getFullDirectory = jest.fn().mockResolvedValue(over.members ?? []);
  const listByOrgUsers = jest.fn().mockResolvedValue(over.users ?? []);
  const listByOrgInvites = jest.fn().mockResolvedValue(over.invites ?? []);
  const svc = new WorkspaceDirectoryService(
    { getFullDirectory } as any,
    { listByOrg: listByOrgUsers } as any,
    { listByOrg: listByOrgInvites } as any,
  );
  return { svc, getFullDirectory, listByOrgUsers, listByOrgInvites };
}

const member = { id: '1', name: 'Ada', email: 'ada@x.com', profilePicture: null, color: null, initials: null, role: 'member', lastActive: null, dateJoined: null, dateInvited: null, invitedByName: null };

describe('WorkspaceDirectoryService', () => {
  it('annotates ClickUp members against the org accounts and pending invites', async () => {
    const { svc } = makeService({
      members: [member],
      users: [{ id: 'u1', name: 'Ada', email: 'ada@x.com', role: 'ADMIN', status: 'ACTIVE', clickupUserId: null }],
    });
    const [row] = await svc.list('org1');
    expect(row.linkStatus).toBe('member');
    expect(row.appUser?.role).toBe('ADMIN');
    expect(row.canInvite).toBe(false);
  });

  it('scopes both lookups to the caller org', async () => {
    const { svc, listByOrgUsers, listByOrgInvites } = makeService();
    await svc.list('org1');
    expect(listByOrgUsers).toHaveBeenCalledWith('org1');
    expect(listByOrgInvites).toHaveBeenCalledWith('org1', 'PENDING');
  });

  it('serves the cached directory by default and refetches only when asked', async () => {
    const { svc, getFullDirectory } = makeService();
    await svc.list('org1');
    expect(getFullDirectory).toHaveBeenCalledWith({ refresh: false });
    await svc.list('org1', { refresh: true });
    expect(getFullDirectory).toHaveBeenLastCalledWith({ refresh: true });
  });

  it('ignores an invitation that is not pending', async () => {
    // The repository is asked for PENDING only; this guards the case where a
    // caller hands over a wider list — a revoked invite must not read as invited.
    const { svc } = makeService({
      members: [member],
      invites: [{ id: 'i1', email: 'ada@x.com', role: 'MEMBER', clickupUserId: null, status: 'REVOKED' }],
    });
    const [row] = await svc.list('org1');
    expect(row.linkStatus).toBe('none');
    expect(row.canInvite).toBe(true);
  });
});

import { AccessScopeService } from './access-scope.service';

function make(
  opts: {
    enabled?: boolean;
    user?: object;
    memberships?: object[];
    teamClients?: object[];
    teamMembers?: object[];
  } = {},
) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(opts.user ?? { clickupUserId: 'cu-me' }) },
    teamMember: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(opts.memberships ?? []) // the user's memberships
        .mockResolvedValueOnce(opts.teamMembers ?? []), // members of led teams
    },
    teamClient: { findMany: jest.fn().mockResolvedValue(opts.teamClients ?? []) },
  };
  const settings = { isTeamScopingEnabled: () => opts.enabled ?? true };
  return { svc: new AccessScopeService(prisma as any, settings as any), prisma };
}
const member = { userId: 'u1', orgId: 'o', role: 'MEMBER', email: 'm@x', isMachine: false } as any;

describe('AccessScopeService', () => {
  it('does not touch the DB for OWNER/ADMIN or the machine key', async () => {
    const { svc, prisma } = make();
    expect(await svc.forPrincipal({ ...member, role: 'OWNER', isMachine: true })).toEqual({
      kind: 'unrestricted',
      canEdit: true,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not touch the DB when the flag is off', async () => {
    const { svc, prisma } = make({ enabled: false });
    expect(await svc.forPrincipal(member)).toEqual({ kind: 'unrestricted', canEdit: false });
    expect(prisma.teamMember.findMany).not.toHaveBeenCalled();
  });

  it('builds a scoped scope from memberships', async () => {
    const { svc } = make({
      memberships: [{ teamId: 'A', role: 'LEAD' }],
      teamClients: [{ teamId: 'A', optionId: 'acme' }],
      teamMembers: [{ teamId: 'A', user: { clickupUserId: 'cu-2' } }],
    });
    const s = await svc.forPrincipal(member);
    expect(s.kind).toBe('scoped');
    if (s.kind === 'scoped') {
      expect([...s.clients]).toEqual([['acme', 'LEAD']]);
      expect(s.ledUserClickupIds).toEqual(['cu-2']);
    }
  });
});

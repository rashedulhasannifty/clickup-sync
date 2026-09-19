import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { resolveScope } from '../access/access-scope';
import { TeamsService } from './teams.service';

const admin = { userId: 'admin', orgId: 'org', role: 'ADMIN', email: 'a@x', isMachine: false } as any;
const leadOf = (teamId: string) =>
  resolveScope({
    role: 'MEMBER',
    scopingEnabled: true,
    selfClickupId: null,
    memberships: [{ teamId, role: 'LEAD' }],
    teamClients: [],
    teamMembers: [],
  });

function make(over: Record<string, jest.Mock> = {}) {
  const repo = {
    findInOrg: jest.fn().mockResolvedValue({ id: 'A' }),
    ownersOf: jest.fn().mockResolvedValue([]),
    replaceClients: jest.fn().mockResolvedValue([]),
    countClients: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: 'A', name: 'Team A' }),
    rename: jest.fn().mockResolvedValue({ id: 'A', name: 'New name' }),
    addMember: jest.fn().mockResolvedValue({}),
    setMemberRole: jest.fn().mockResolvedValue({}),
    removeMember: jest.fn().mockResolvedValue({}),
    readinessData: jest.fn(),
    membershipsOf: jest.fn().mockResolvedValue([]),
    activeOrgUsers: jest.fn().mockResolvedValue([]),
    ...over,
  };
  const users = { findById: jest.fn() };
  return { svc: new TeamsService(repo as any, users as any), repo, users };
}

describe('TeamsService', () => {
  it('setClients refuses options owned by another team without move', async () => {
    const { svc, repo } = make({
      ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'B', team: { id: 'B', name: 'Apps' } }]),
    });
    const err = await svc.setClients(admin, 'A', ['o1'], false).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().conflicts).toEqual([{ optionId: 'o1', teamId: 'B', teamName: 'Apps' }]);
    expect(repo.replaceClients).not.toHaveBeenCalled();
  });

  it('setClients with move reassigns and reports the from-team', async () => {
    const { svc, repo } = make({
      ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'B', team: { id: 'B', name: 'Apps' } }]),
    });
    const res = await svc.setClients(admin, 'A', ['o1', 'o2'], true);
    expect(repo.replaceClients).toHaveBeenCalledWith('A', ['o1', 'o2'], 'admin', true);
    expect(res).toEqual({ clients: 2, moved: [{ optionId: 'o1', fromTeamId: 'B' }] });
  });

  it('options already on this team are not conflicts', async () => {
    const { svc, repo } = make({
      ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'A', team: { id: 'A', name: 'Team A' } }]),
    });
    await svc.setClients(admin, 'A', ['o1'], false);
    expect(repo.replaceClients).toHaveBeenCalled();
  });

  it('setClients passes move=false through, so replaceClients never emits the steal clause', async () => {
    const { svc, repo } = make();
    await svc.setClients(admin, 'A', ['o1'], false);
    expect(repo.replaceClients).toHaveBeenCalledWith('A', ['o1'], 'admin', false);
  });

  it('setClients turns a concurrent claim (P2002 on replaceClients) into a conflict, not a silent no-op', async () => {
    const { svc } = make({ replaceClients: jest.fn().mockRejectedValue({ code: 'P2002' }) });
    await expect(svc.setClients(admin, 'A', ['o1'], true)).rejects.toBeInstanceOf(ConflictException);
  });

  it('setClients rejects an unknown option id instead of a raw FK error', async () => {
    const { svc } = make({ replaceClients: jest.fn().mockRejectedValue({ code: 'P2003' }) });
    await expect(svc.setClients(admin, 'A', ['bogus'], false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rolls the team back when its clients conflict', async () => {
    const { svc, repo } = make({
      ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'B', team: { id: 'B', name: 'Apps' } }]),
    });
    await expect(svc.create(admin, 'Team A', ['o1'])).rejects.toBeInstanceOf(ConflictException);
    expect(repo.delete).toHaveBeenCalledWith('A');
  });

  it('create surfaces the original conflict even if the rollback delete itself fails', async () => {
    const { svc } = make({
      ownersOf: jest.fn().mockResolvedValue([{ optionId: 'o1', teamId: 'B', team: { id: 'B', name: 'Apps' } }]),
      delete: jest.fn().mockRejectedValue(new Error('delete boom')),
    });
    await expect(svc.create(admin, 'Team A', ['o1'])).rejects.toBeInstanceOf(ConflictException);
  });

  it('deleteTeam returns the number of released clients', async () => {
    const { svc, repo } = make({ countClients: jest.fn().mockResolvedValue(5) });
    await expect(svc.deleteTeam('org', 'A')).resolves.toEqual({ releasedClients: 5 });
    expect(repo.delete).toHaveBeenCalledWith('A');
  });

  it('lead adds an existing ACTIVE org user, always as MEMBER', async () => {
    const { svc, repo, users } = make();
    users.findById.mockResolvedValue({ id: 'u2', orgId: 'org', status: 'ACTIVE' });
    await svc.leadAddMember(leadOf('A'), { ...admin, userId: 'lead', role: 'MEMBER' }, 'A', 'u2');
    expect(repo.addMember).toHaveBeenCalledWith('A', 'u2', 'MEMBER', 'lead');
  });

  it('lead cannot add to a team they do not lead', async () => {
    const { svc, repo } = make();
    await expect(svc.leadAddMember(leadOf('B'), { ...admin, role: 'MEMBER' }, 'A', 'u2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it('leadAddMember forbids a flag-off MEMBER (unrestricted but read-only)', async () => {
    const { svc, repo } = make();
    const flagOff = { kind: 'unrestricted', canEdit: false } as const;
    await expect(svc.leadAddMember(flagOff, { ...admin, role: 'MEMBER' }, 'A', 'u2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null],
    ['disabled', { id: 'u2', orgId: 'org', status: 'DISABLED' }],
    ['other org', { id: 'u2', orgId: 'other', status: 'ACTIVE' }],
  ])('lead cannot add a %s user', async (_label, user) => {
    const { svc, repo, users } = make();
    users.findById.mockResolvedValue(user);
    await expect(svc.leadAddMember(leadOf('A'), { ...admin, role: 'MEMBER' }, 'A', 'u2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.addMember).not.toHaveBeenCalled();
  });

  describe('addMember (Owner/Admin) validates the target user, same as the lead path', () => {
    it.each([
      ['unknown', null],
      ['disabled', { id: 'u2', orgId: 'org', status: 'DISABLED' }],
      ['other org', { id: 'u2', orgId: 'other', status: 'ACTIVE' }],
    ])('rejects a %s user', async (_label, user) => {
      const { svc, repo, users } = make();
      users.findById.mockResolvedValue(user);
      await expect(svc.addMember(admin, 'A', 'u2', 'MEMBER')).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it('adds a valid ACTIVE same-org user with the given role', async () => {
      const { svc, repo, users } = make();
      users.findById.mockResolvedValue({ id: 'u2', orgId: 'org', status: 'ACTIVE' });
      await svc.addMember(admin, 'A', 'u2', 'LEAD');
      expect(repo.addMember).toHaveBeenCalledWith('A', 'u2', 'LEAD', 'admin');
    });
  });

  describe('org-scoped team lookups 404 (not 403) a team from another org', () => {
    it('rename', async () => {
      const { svc, repo } = make({ findInOrg: jest.fn().mockResolvedValue(null) });
      await expect(svc.rename('org', 'A', 'New')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.rename).not.toHaveBeenCalled();
    });

    it('deleteTeam', async () => {
      const { svc, repo } = make({ findInOrg: jest.fn().mockResolvedValue(null) });
      await expect(svc.deleteTeam('org', 'A')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.countClients).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('setClients', async () => {
      const { svc, repo } = make({ findInOrg: jest.fn().mockResolvedValue(null) });
      await expect(svc.setClients(admin, 'A', ['o1'], false)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.ownersOf).not.toHaveBeenCalled();
      expect(repo.replaceClients).not.toHaveBeenCalled();
    });

    it('addMember', async () => {
      const { svc, repo } = make({ findInOrg: jest.fn().mockResolvedValue(null) });
      await expect(svc.addMember(admin, 'A', 'u2', 'MEMBER')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.addMember).not.toHaveBeenCalled();
    });

    it('setMemberRole', async () => {
      const { svc, repo } = make({ findInOrg: jest.fn().mockResolvedValue(null) });
      await expect(svc.setMemberRole('org', 'A', 'u2', 'LEAD')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.setMemberRole).not.toHaveBeenCalled();
    });

    it('removeMember', async () => {
      const { svc, repo } = make({ findInOrg: jest.fn().mockResolvedValue(null) });
      await expect(svc.removeMember('org', 'A', 'u2')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.removeMember).not.toHaveBeenCalled();
    });

    it("leadAddMember's Owner/Admin arm", async () => {
      const { svc, repo } = make({ findInOrg: jest.fn().mockResolvedValue(null) });
      const unrestricted = { kind: 'unrestricted', canEdit: true } as const;
      await expect(svc.leadAddMember(unrestricted, admin, 'A', 'u2')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.addMember).not.toHaveBeenCalled();
    });
  });

  it('readiness lists unassigned clients, team-less members, unlinked users and ambiguous names', async () => {
    const { svc } = make({
      readinessData: jest.fn().mockResolvedValue([
        [{ optionId: 'o9', name: 'Hotel' }],
        [{ id: 'u3', name: 'M', email: 'm@x' }],
        [{ id: 'u4', name: 'N', email: 'n@x' }],
        [
          { optionId: 'o1', name: 'Shared', team: { id: 'A' } },
          { optionId: 'o2', name: 'Shared', team: { id: 'B' } },
          { optionId: 'o3', name: 'Acme', team: { id: 'A' } },
          { optionId: 'o4', name: 'Acme', team: { id: 'A' } },
        ],
      ]),
    });
    await expect(svc.readiness('org')).resolves.toEqual({
      unassignedClients: [{ optionId: 'o9', name: 'Hotel' }],
      membersWithoutTeam: [{ id: 'u3', name: 'M', email: 'm@x' }],
      usersWithoutClickupLink: [{ id: 'u4', name: 'N', email: 'n@x' }],
      ambiguousNames: ['Shared'],
    });
  });

  describe('myTeams (R20)', () => {
    it('returns candidates: active org users not already a member of a led team', async () => {
      const { svc, repo } = make({
        membershipsOf: jest.fn().mockResolvedValue([
          {
            role: 'LEAD',
            team: {
              id: 'A',
              name: 'Team A',
              clients: [{ option: { name: 'Acme' } }],
              members: [
                { user: { id: 'lead', name: 'Lead', email: 'lead@x' } },
                { user: { id: 'u1', name: 'Existing', email: 'u1@x' } },
              ],
            },
          },
        ]),
        activeOrgUsers: jest.fn().mockResolvedValue([
          { id: 'lead', name: 'Lead', email: 'lead@x' },
          { id: 'u1', name: 'Existing', email: 'u1@x' },
          { id: 'u2', name: 'Candidate', email: 'u2@x' },
        ]),
      });
      const res = await svc.myTeams({ ...admin, userId: 'lead', role: 'MEMBER' }, leadOf('A'));
      expect(res.teams).toEqual([
        {
          id: 'A',
          name: 'Team A',
          role: 'LEAD',
          clients: ['Acme'],
          members: [
            { userId: 'lead', name: 'Lead', email: 'lead@x' },
            { userId: 'u1', name: 'Existing', email: 'u1@x' },
          ],
        },
      ]);
      expect(res.candidates).toEqual([{ id: 'u2', name: 'Candidate', email: 'u2@x' }]);
      expect(repo.activeOrgUsers).toHaveBeenCalledWith('org');
    });

    it("carries each member's clickupUserId and team role so a lead can link to their timesheet", async () => {
      const { svc } = make({
        membershipsOf: jest.fn().mockResolvedValue([
          {
            role: 'LEAD',
            team: {
              id: 'A',
              name: 'Team A',
              clients: [],
              members: [
                { role: 'LEAD', user: { id: 'lead', name: 'Lead', email: 'lead@x', clickupUserId: 'cu-1' } },
                { role: 'MEMBER', user: { id: 'u1', name: 'Unlinked', email: 'u1@x', clickupUserId: null } },
              ],
            },
          },
        ]),
      });
      const res = await svc.myTeams({ ...admin, userId: 'lead', role: 'MEMBER' }, leadOf('A'));
      expect(res.teams[0].members).toEqual([
        { userId: 'lead', name: 'Lead', email: 'lead@x', clickupUserId: 'cu-1', role: 'LEAD' },
        { userId: 'u1', name: 'Unlinked', email: 'u1@x', clickupUserId: null, role: 'MEMBER' },
      ]);
    });

    it("R33: a plain member's memberships never carry teammates' clickupUserId", async () => {
      const { svc } = make({
        membershipsOf: jest.fn().mockResolvedValue([
          {
            role: 'MEMBER',
            team: {
              id: 'A',
              name: 'Team A',
              clients: [],
              members: [
                { role: 'LEAD', user: { id: 'lead', name: 'Lead', email: 'lead@x', clickupUserId: 'cu-1' } },
                { role: 'MEMBER', user: { id: 'member', name: 'Member', email: 'member@x', clickupUserId: 'cu-2' } },
              ],
            },
          },
        ]),
      });
      const scope = resolveScope({
        role: 'MEMBER',
        scopingEnabled: true,
        selfClickupId: 'cu-2',
        memberships: [{ teamId: 'A', role: 'MEMBER' }],
        teamClients: [],
        teamMembers: [],
      });
      const res = await svc.myTeams({ ...admin, userId: 'member', role: 'MEMBER' }, scope);
      expect(res.teams[0].members).toEqual([
        { userId: 'lead', name: 'Lead', email: 'lead@x', clickupUserId: null, role: 'LEAD' },
        { userId: 'member', name: 'Member', email: 'member@x', clickupUserId: null, role: 'MEMBER' },
      ]);
    });

    it('returns no candidates when the caller leads nothing', async () => {
      const { svc, repo } = make({
        membershipsOf: jest.fn().mockResolvedValue([
          {
            role: 'MEMBER',
            team: { id: 'A', name: 'Team A', clients: [], members: [] },
          },
        ]),
      });
      const scope = resolveScope({
        role: 'MEMBER',
        scopingEnabled: true,
        selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'MEMBER' }],
        teamClients: [],
        teamMembers: [],
      });
      const res = await svc.myTeams({ ...admin, userId: 'member', role: 'MEMBER' }, scope);
      expect(res.candidates).toEqual([]);
      expect(repo.activeOrgUsers).not.toHaveBeenCalled();
    });

    it('returns no candidates for an unrestricted (Owner/Admin) caller', async () => {
      const { svc, repo } = make();
      const res = await svc.myTeams(admin, { kind: 'unrestricted', canEdit: true });
      expect(res.candidates).toEqual([]);
      expect(repo.activeOrgUsers).not.toHaveBeenCalled();
    });
  });
});

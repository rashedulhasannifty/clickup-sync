import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InvitationStatus, Role } from '@prisma/client';
import { InvitationService } from './invitation.service';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';

function deps() {
  const invites: any[] = [];
  const inviteRepo = {
    findPendingByEmail: jest.fn(async () => null),
    create: jest.fn(async (d) => { const row = { id: 'i' + invites.length, status: InvitationStatus.PENDING, teams: [], ...d }; invites.push(row); return row; }),
    findByTokenHash: jest.fn(async (h) => invites.find((i) => i.tokenHash === h) ?? null),
    findById: jest.fn(async (id) => invites.find((i) => i.id === id) ?? null),
    update: jest.fn(async (id, d) => { const i = invites.find((x) => x.id === id); Object.assign(i, d); return i; }),
    listByOrg: jest.fn(async () => invites),
  };
  const userRepo = { findByEmail: jest.fn(async () => null), create: jest.fn(async (d) => ({ id: 'newuser', ...d })) };
  const mailer = { sendInvite: jest.fn(async () => {}) };
  // Default: every team id the test hands in is treated as valid, unless a test
  // overrides countInOrg to simulate an unknown/foreign id.
  const teamsRepo = {
    countInOrg: jest.fn(async (_orgId: string, ids: string[]) => ids.length),
    addMember: jest.fn(async () => ({})),
  };
  const directory = { getDirectory: jest.fn(async () => [] as { id: string; email: string | null }[]) };
  return { invites, inviteRepo, userRepo, mailer, teamsRepo, directory };
}

function svc(d: ReturnType<typeof deps>, tokens: TokenService = new TokenService()) {
  return new InvitationService(
    d.inviteRepo as any,
    d.userRepo as any,
    new PermissionsService(),
    tokens,
    new PasswordService(),
    d.mailer as any,
    { get: () => 'org_seed' } as any,
    d.teamsRepo as any,
    d.directory as any,
  );
}

describe('InvitationService.create', () => {
  it('admin can invite a member; emails the link', async () => {
    const d = deps();
    await svc(d).create({ userId: 'a', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', isMachine: false }, { email: 'New@x.com', role: 'MEMBER' });
    expect(d.inviteRepo.create).toHaveBeenCalled();
    expect(d.mailer.sendInvite).toHaveBeenCalledWith('new@x.com', expect.any(String), expect.any(String), 'MEMBER');
  });

  it('member cannot invite', async () => {
    const d = deps();
    await expect(svc(d).create({ userId: 'm', orgId: 'org_seed', role: Role.MEMBER, email: null, isMachine: false }, { email: 'x@x.com', role: 'MEMBER' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects inviting an existing user', async () => {
    const d = deps();
    d.userRepo.findByEmail = jest.fn(async () => ({ id: 'exists' })) as any;
    await expect(svc(d).create({ userId: 'a', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', isMachine: false }, { email: 'exists@x.com', role: 'MEMBER' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InvitationService.create — teams and ClickUp link', () => {
  const actor = { userId: 'a', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', isMachine: false } as any;

  it('stores InvitationTeam rows and auto-matches clickupUserId from the directory by case-insensitive email', async () => {
    const d = deps();
    d.directory.getDirectory = jest.fn(async () => [{ id: 'cu1', email: 'NEW@X.COM' }]);
    await svc(d).create(actor, { email: 'new@x.com', role: 'MEMBER', teams: [{ teamId: 't1', role: 'LEAD' }] });
    expect(d.teamsRepo.countInOrg).toHaveBeenCalledWith('org_seed', ['t1']);
    expect(d.inviteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clickupUserId: 'cu1',
        teams: { create: [{ teamId: 't1', role: 'LEAD' }] },
      }),
    );
  });

  it('stores null and does not consult the directory when clickupUserId is explicitly null', async () => {
    const d = deps();
    await svc(d).create(actor, { email: 'new@x.com', role: 'MEMBER', clickupUserId: null });
    expect(d.directory.getDirectory).not.toHaveBeenCalled();
    expect(d.inviteRepo.create).toHaveBeenCalledWith(expect.objectContaining({ clickupUserId: null }));
  });

  it('rejects an unknown teamId with BadRequestException', async () => {
    const d = deps();
    d.teamsRepo.countInOrg = jest.fn(async (_orgId: string, _ids: string[]) => 0); // fewer matches than ids requested
    await expect(svc(d).create(actor, { email: 'new@x.com', role: 'MEMBER', teams: [{ teamId: 'bogus', role: 'MEMBER' }] }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(d.inviteRepo.create).not.toHaveBeenCalled();
  });
});

describe('InvitationService.accept', () => {
  it('creates a user with the invited role and marks accepted', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push({ id: 'i0', orgId: 'org_seed', email: 'new@x.com', role: Role.MEMBER, tokenHash, status: InvitationStatus.PENDING, expiresAt: new Date(Date.now() + 100000), org: { name: 'Acme' }, teams: [] });
    const user = await svc(d, tokens).accept(token, { name: 'New', password: 'longenough10' });
    expect(user.role).toBe(Role.MEMBER);
    expect(d.inviteRepo.update).toHaveBeenCalledWith('i0', expect.objectContaining({ status: InvitationStatus.ACCEPTED }));
  });

  it('rejects an expired invite', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push({ id: 'i0', orgId: 'org_seed', email: 'new@x.com', role: Role.MEMBER, tokenHash, status: InvitationStatus.PENDING, expiresAt: new Date(Date.now() - 1000), org: { name: 'Acme' }, teams: [] });
    await expect(svc(d, tokens).accept(token, { name: 'New', password: 'longenough10' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InvitationService.accept — teams and ClickUp link', () => {
  function pendingInvite(overrides: Record<string, unknown> = {}) {
    return {
      id: 'i0',
      orgId: 'org_seed',
      email: 'new@x.com',
      role: Role.MEMBER,
      status: InvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 100000),
      org: { name: 'Acme' },
      clickupUserId: null,
      invitedByUserId: 'inviter1',
      teams: [],
      ...overrides,
    };
  }

  it('creates the user with clickupUserId copied, then calls teams.addMember for each InvitationTeam with addedBy = invitedByUserId', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push(pendingInvite({
      tokenHash,
      clickupUserId: 'cu1',
      teams: [
        { teamId: 't1', role: 'LEAD', team: { id: 't1', name: 'Team One' } },
        { teamId: 't2', role: 'MEMBER', team: { id: 't2', name: 'Team Two' } },
      ],
    }));
    const user = await svc(d, tokens).accept(token, { name: 'New', password: 'longenough10' });
    expect((user as any).clickupUserId).toBe('cu1');
    expect(d.teamsRepo.addMember).toHaveBeenCalledWith('t1', 'newuser', 'LEAD', 'inviter1');
    expect(d.teamsRepo.addMember).toHaveBeenCalledWith('t2', 'newuser', 'MEMBER', 'inviter1');
  });

  it('still succeeds if addMember throws for one team: it logs and the user comes out team-less for that team', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push(pendingInvite({
      tokenHash,
      teams: [{ teamId: 't1', role: 'MEMBER', team: { id: 't1', name: 'Team One' } }],
    }));
    d.teamsRepo.addMember = jest.fn(async () => { throw new Error('boom'); });
    const user = await svc(d, tokens).accept(token, { name: 'New', password: 'longenough10' });
    expect(user).toBeDefined();
    expect(d.teamsRepo.addMember).toHaveBeenCalledWith('t1', 'newuser', 'MEMBER', 'inviter1');
    expect(d.inviteRepo.update).toHaveBeenCalledWith('i0', expect.objectContaining({ status: InvitationStatus.ACCEPTED }));
  });

  it('creates the user unlinked (and logs) when the invited clickupUserId is already linked to another account', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push(pendingInvite({ tokenHash, clickupUserId: 'cu-taken' }));
    d.userRepo.create = jest.fn(async (data: any) => {
      if (data.clickupUserId === 'cu-taken') {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      return { id: 'newuser', ...data };
    });
    const user = await svc(d, tokens).accept(token, { name: 'New', password: 'longenough10' });
    expect((user as any).clickupUserId).toBeNull();
  });
});

describe('InvitationService.revoke / resend — cross-org scope', () => {
  const actor = { userId: 'a', orgId: 'org_seed', role: Role.OWNER, email: null, isMachine: false } as any;

  it('revoke refuses an invite belonging to another org', async () => {
    const d = deps();
    d.invites.push({ id: 'i0', orgId: 'org_other', status: InvitationStatus.PENDING });
    await expect(svc(d).revoke(actor, 'i0')).rejects.toBeInstanceOf(BadRequestException);
    expect(d.inviteRepo.update).not.toHaveBeenCalled();
  });

  it('revoke marks an invite in the actor’s org REVOKED', async () => {
    const d = deps();
    d.invites.push({ id: 'i0', orgId: 'org_seed', status: InvitationStatus.PENDING });
    await svc(d).revoke(actor, 'i0');
    expect(d.inviteRepo.update).toHaveBeenCalledWith('i0', { status: InvitationStatus.REVOKED });
  });

  it('resend refuses an invite belonging to another org', async () => {
    const d = deps();
    d.invites.push({ id: 'i0', orgId: 'org_other', role: Role.MEMBER, email: 'x@y.com', status: InvitationStatus.PENDING });
    await expect(svc(d).resend(actor, 'i0')).rejects.toBeInstanceOf(BadRequestException);
    expect(d.mailer.sendInvite).not.toHaveBeenCalled();
  });
});

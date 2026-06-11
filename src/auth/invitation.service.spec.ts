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
    create: jest.fn(async (d) => { const row = { id: 'i' + invites.length, status: InvitationStatus.PENDING, ...d }; invites.push(row); return row; }),
    findByTokenHash: jest.fn(async (h) => invites.find((i) => i.tokenHash === h) ?? null),
    findById: jest.fn(async (id) => invites.find((i) => i.id === id) ?? null),
    update: jest.fn(async (id, d) => { const i = invites.find((x) => x.id === id); Object.assign(i, d); return i; }),
    listByOrg: jest.fn(async () => invites),
  };
  const userRepo = { findByEmail: jest.fn(async () => null), create: jest.fn(async (d) => ({ id: 'newuser', ...d })) };
  const mailer = { sendInvite: jest.fn(async () => {}) };
  return { invites, inviteRepo, userRepo, mailer };
}

describe('InvitationService.create', () => {
  it('admin can invite a member; emails the link', async () => {
    const d = deps();
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), new TokenService(), new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    await svc.create({ userId: 'a', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', isMachine: false }, { email: 'New@x.com', role: 'MEMBER' });
    expect(d.inviteRepo.create).toHaveBeenCalled();
    expect(d.mailer.sendInvite).toHaveBeenCalledWith('new@x.com', expect.any(String), expect.any(String), 'MEMBER');
  });

  it('member cannot invite', async () => {
    const d = deps();
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), new TokenService(), new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    await expect(svc.create({ userId: 'm', orgId: 'org_seed', role: Role.MEMBER, email: null, isMachine: false }, { email: 'x@x.com', role: 'MEMBER' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects inviting an existing user', async () => {
    const d = deps();
    d.userRepo.findByEmail = jest.fn(async () => ({ id: 'exists' })) as any;
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), new TokenService(), new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    await expect(svc.create({ userId: 'a', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', isMachine: false }, { email: 'exists@x.com', role: 'MEMBER' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InvitationService.accept', () => {
  it('creates a user with the invited role and marks accepted', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push({ id: 'i0', orgId: 'org_seed', email: 'new@x.com', role: Role.MEMBER, tokenHash, status: InvitationStatus.PENDING, expiresAt: new Date(Date.now() + 100000), org: { name: 'Acme' } });
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), tokens, new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    const user = await svc.accept(token, { name: 'New', password: 'longenough10' });
    expect(user.role).toBe(Role.MEMBER);
    expect(d.inviteRepo.update).toHaveBeenCalledWith('i0', expect.objectContaining({ status: InvitationStatus.ACCEPTED }));
  });

  it('rejects an expired invite', async () => {
    const d = deps();
    const tokens = new TokenService();
    const { token, tokenHash } = tokens.generate();
    d.invites.push({ id: 'i0', orgId: 'org_seed', email: 'new@x.com', role: Role.MEMBER, tokenHash, status: InvitationStatus.PENDING, expiresAt: new Date(Date.now() - 1000), org: { name: 'Acme' } });
    const svc = new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), tokens, new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
    await expect(svc.accept(token, { name: 'New', password: 'longenough10' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('InvitationService.revoke / resend — cross-org scope', () => {
  const actor = { userId: 'a', orgId: 'org_seed', role: Role.OWNER, email: null, isMachine: false } as any;
  function svcWith(d: ReturnType<typeof deps>) {
    return new InvitationService(d.inviteRepo as any, d.userRepo as any, new PermissionsService(), new TokenService(), new PasswordService(), d.mailer as any, { get: () => 'org_seed' } as any);
  }

  it('revoke refuses an invite belonging to another org', async () => {
    const d = deps();
    d.invites.push({ id: 'i0', orgId: 'org_other', status: InvitationStatus.PENDING });
    await expect(svcWith(d).revoke(actor, 'i0')).rejects.toBeInstanceOf(BadRequestException);
    expect(d.inviteRepo.update).not.toHaveBeenCalled();
  });

  it('revoke marks an invite in the actor’s org REVOKED', async () => {
    const d = deps();
    d.invites.push({ id: 'i0', orgId: 'org_seed', status: InvitationStatus.PENDING });
    await svcWith(d).revoke(actor, 'i0');
    expect(d.inviteRepo.update).toHaveBeenCalledWith('i0', { status: InvitationStatus.REVOKED });
  });

  it('resend refuses an invite belonging to another org', async () => {
    const d = deps();
    d.invites.push({ id: 'i0', orgId: 'org_other', role: Role.MEMBER, email: 'x@y.com', status: InvitationStatus.PENDING });
    await expect(svcWith(d).resend(actor, 'i0')).rejects.toBeInstanceOf(BadRequestException);
    expect(d.mailer.sendInvite).not.toHaveBeenCalled();
  });
});

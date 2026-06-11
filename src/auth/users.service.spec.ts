import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { PermissionsService } from './permissions.service';

function deps(initial: any[]) {
  const users = [...initial];
  const userRepo = {
    findById: jest.fn(async (id) => users.find((u) => u.id === id) ?? null),
    listByOrg: jest.fn(async () => users),
    countOwners: jest.fn(async () => users.filter((u) => u.role === Role.OWNER && u.status === UserStatus.ACTIVE).length),
    update: jest.fn(async (id, d) => { const u = users.find((x) => x.id === id); Object.assign(u, d); return u; }),
    delete: jest.fn(async (id) => { const i = users.findIndex((x) => x.id === id); users.splice(i, 1); }),
  };
  return { users, userRepo };
}
const sessions = { revokeAll: jest.fn(async () => {}) } as any;
const owner = { userId: 'o1', orgId: 'org_seed', role: Role.OWNER, email: 'o', isMachine: false };
const admin = { userId: 'a1', orgId: 'org_seed', role: Role.ADMIN, email: 'a', isMachine: false };

describe('UsersService.changeRole', () => {
  it('owner promotes a member to admin', async () => {
    const d = deps([{ id: 'm1', role: Role.MEMBER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    const u = await svc.changeRole(owner, 'm1', Role.ADMIN);
    expect(u.role).toBe(Role.ADMIN);
  });
  it('admin cannot promote to owner', async () => {
    const d = deps([{ id: 'm1', role: Role.MEMBER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.changeRole(admin, 'm1', Role.OWNER)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks demoting the last owner', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.changeRole(owner, 'o1', Role.ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UsersService.remove', () => {
  it('admin cannot remove an owner', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.remove(admin, 'o1')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks removing the last owner', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.remove(owner, 'o1')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('owner removes a member and revokes their sessions', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, status: UserStatus.ACTIVE }, { id: 'm1', role: Role.MEMBER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await svc.remove(owner, 'm1');
    expect(d.userRepo.delete).toHaveBeenCalledWith('m1');
    expect(sessions.revokeAll).toHaveBeenCalledWith('m1');
  });
  it('404s an unknown user', async () => {
    const d = deps([]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.remove(owner, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.transferOwnership', () => {
  it('promotes the target to owner and demotes the actor to admin', async () => {
    const d = deps([
      { id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE },
      { id: 'a1', role: Role.ADMIN, orgId: 'org_seed', status: UserStatus.ACTIVE },
    ]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await svc.transferOwnership(owner, 'a1');
    expect(d.users.find((u) => u.id === 'a1').role).toBe(Role.OWNER);
    expect(d.users.find((u) => u.id === 'o1').role).toBe(Role.ADMIN);
  });

  it('rejects self-transfer (would demote the sole owner → zero owners)', async () => {
    const d = deps([{ id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.transferOwnership(owner, 'o1')).rejects.toBeInstanceOf(BadRequestException);
    expect(d.users.find((u) => u.id === 'o1').role).toBe(Role.OWNER); // unchanged
  });

  it('rejects transferring ownership to a disabled user', async () => {
    const d = deps([
      { id: 'o1', role: Role.OWNER, orgId: 'org_seed', status: UserStatus.ACTIVE },
      { id: 'a1', role: Role.ADMIN, orgId: 'org_seed', status: UserStatus.DISABLED },
    ]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.transferOwnership(owner, 'a1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a target in a different org (cross-org IDOR → looks not-found)', async () => {
    const d = deps([{ id: 'x1', role: Role.ADMIN, orgId: 'org_other', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.transferOwnership(owner, 'x1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService — cross-org IDOR scoping', () => {
  it('changeRole on a user in another org looks "not found"', async () => {
    const d = deps([{ id: 'x1', role: Role.MEMBER, orgId: 'org_other', status: UserStatus.ACTIVE }]);
    const svc = new UsersService(d.userRepo as any, new PermissionsService(), sessions);
    await expect(svc.changeRole(owner, 'x1', Role.ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });
});

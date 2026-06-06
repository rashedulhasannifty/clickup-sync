import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

function deps() {
  const users: any[] = [];
  const userRepo = {
    findByEmail: jest.fn(async (e) => users.find((u) => u.email === e.toLowerCase()) ?? null),
    countOwners: jest.fn(async () => users.filter((u) => u.role === Role.OWNER).length),
    create: jest.fn(async (d) => { const u = { id: 'u' + users.length, status: UserStatus.ACTIVE, ...d, email: d.email }; users.push(u); return u; }),
    touchLogin: jest.fn(async () => {}),
  };
  const orgRepo = { rename: jest.fn(async () => {}), get: jest.fn(async () => ({ id: 'org_seed', name: 'Acme' })) };
  return { users, userRepo, orgRepo, password: new PasswordService() };
}

describe('AuthService.signup (claim seed org)', () => {
  it('creates the first user as OWNER and renames the org', async () => {
    const d = deps();
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, d.password);
    const user = await svc.signup({ email: 'O@x.com', password: 'longenough10', name: 'O', orgName: 'Acme' });
    expect(user.role).toBe(Role.OWNER);
    expect(d.orgRepo.rename).toHaveBeenCalledWith('org_seed', 'Acme');
    expect(d.userRepo.create.mock.calls[0][0].email).toBe('o@x.com');
  });

  it('refuses signup once an owner exists', async () => {
    const d = deps();
    d.userRepo.countOwners = jest.fn(async () => 1);
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, d.password);
    await expect(svc.signup({ email: 'b@x.com', password: 'longenough10', name: 'B', orgName: 'X' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a duplicate email', async () => {
    const d = deps();
    await d.userRepo.create({ email: 'dup@x.com', role: Role.OWNER });
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, d.password);
    await expect(svc.signup({ email: 'dup@x.com', password: 'longenough10', name: 'B', orgName: 'X' }))
      .rejects.toBeTruthy();
  });
});

describe('AuthService.login', () => {
  it('returns the user for correct credentials', async () => {
    const d = deps();
    const password = new PasswordService();
    const hash = await password.hash('longenough10');
    d.users.push({ id: 'u1', email: 'a@x.com', passwordHash: hash, role: Role.ADMIN, status: UserStatus.ACTIVE, orgId: 'org_seed' });
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, password);
    const user = await svc.login({ email: 'a@x.com', password: 'longenough10' });
    expect(user.id).toBe('u1');
  });

  it('rejects a wrong password with a generic error', async () => {
    const d = deps();
    const password = new PasswordService();
    d.users.push({ id: 'u1', email: 'a@x.com', passwordHash: await password.hash('right10char'), role: Role.ADMIN, status: UserStatus.ACTIVE });
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, password);
    await expect(svc.login({ email: 'a@x.com', password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a disabled user', async () => {
    const d = deps();
    const password = new PasswordService();
    d.users.push({ id: 'u1', email: 'a@x.com', passwordHash: await password.hash('right10char'), role: Role.ADMIN, status: UserStatus.DISABLED });
    const svc = new AuthService(d.userRepo as any, d.orgRepo as any, password);
    await expect(svc.login({ email: 'a@x.com', password: 'right10char' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

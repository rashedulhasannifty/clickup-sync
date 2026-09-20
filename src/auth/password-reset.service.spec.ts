import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';

const passwords = new PasswordService();

async function activeUser(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    orgId: 'org_seed',
    email: 'user@x.com',
    name: 'User',
    role: Role.MEMBER,
    status: UserStatus.ACTIVE,
    passwordHash: await passwords.hash('old-password-1'),
    ...over,
  };
}

function deps(user: any) {
  const rows: any[] = [];
  const resetRepo = {
    create: jest.fn(async (d: any) => {
      const row = { id: 'r' + rows.length, usedAt: null, ...d };
      rows.push(row);
      return row;
    }),
    findByTokenHash: jest.fn(async (h: string) => {
      const row = rows.find((r) => r.tokenHash === h);
      return row ? { ...row, user: users.byId(row.userId) } : null;
    }),
    markUsed: jest.fn(async (id: string) => {
      const row = rows.find((r) => r.id === id);
      row.usedAt = new Date();
      return row;
    }),
    deleteActiveForUser: jest.fn(async (userId: string) => {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].userId === userId && !rows[i].usedAt) rows.splice(i, 1);
    }),
  };
  const store: any[] = user ? [user] : [];
  const users = {
    byId: (id: string) => store.find((u) => u.id === id) ?? null,
    findByEmail: jest.fn(async (email: string) => store.find((u) => u.email === email) ?? null),
    findById: jest.fn(async (id: string) => store.find((u) => u.id === id) ?? null),
    update: jest.fn(async (id: string, d: any) => {
      const u = store.find((x) => x.id === id);
      Object.assign(u, d);
      return u;
    }),
  };
  const mailer = { sendPasswordReset: jest.fn(async (_to: string, _token: string) => {}) };
  const sessions = { revokeAll: jest.fn(async () => {}) };
  return { rows, resetRepo, users, mailer, sessions, store };
}

function svc(d: ReturnType<typeof deps>) {
  return new PasswordResetService(
    d.resetRepo as any,
    d.users as any,
    new TokenService(),
    passwords,
    d.mailer as any,
    d.sessions as any,
    new PermissionsService(),
  );
}

/** The plaintext token the service handed to the mailer on the last send. */
function sentToken(d: ReturnType<typeof deps>): string {
  return d.mailer.sendPasswordReset.mock.calls.at(-1)![1];
}

describe('PasswordResetService.request', () => {
  it('emails a link to an active user and stores only the token hash', async () => {
    const d = deps(await activeUser());
    await expect(svc(d).request('User@x.com', '1.2.3.4')).resolves.toEqual({ ok: true });
    expect(d.mailer.sendPasswordReset).toHaveBeenCalledWith('user@x.com', expect.any(String));
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].tokenHash).not.toBe(sentToken(d));
    expect(d.rows[0].tokenHash).toBe(new TokenService().hash(sentToken(d)));
  });

  it('says ok but sends nothing for an unknown email', async () => {
    const d = deps(null);
    await expect(svc(d).request('nobody@x.com', null)).resolves.toEqual({ ok: true });
    expect(d.mailer.sendPasswordReset).not.toHaveBeenCalled();
    expect(d.rows).toHaveLength(0);
  });

  it('says ok but sends nothing for a disabled user', async () => {
    const d = deps(await activeUser({ status: UserStatus.DISABLED }));
    await expect(svc(d).request('user@x.com', null)).resolves.toEqual({ ok: true });
    expect(d.mailer.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('invalidates an outstanding link when a new one is requested', async () => {
    const d = deps(await activeUser());
    const s = svc(d);
    await s.request('user@x.com', null);
    const first = sentToken(d);
    await s.request('user@x.com', null);
    expect(d.rows).toHaveLength(1);
    await expect(s.preview(first)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.preview(sentToken(d))).resolves.toEqual({ email: 'user@x.com' });
  });
});

describe('PasswordResetService.preview', () => {
  it('rejects an expired token', async () => {
    const d = deps(await activeUser());
    const s = svc(d);
    await s.request('user@x.com', null);
    d.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(s.preview(sentToken(d))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a garbage token', async () => {
    const d = deps(await activeUser());
    await expect(svc(d).preview('not-a-real-token')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PasswordResetService.reset', () => {
  it('sets the new password, marks the token used and revokes every session', async () => {
    const d = deps(await activeUser());
    const s = svc(d);
    await s.request('user@x.com', null);
    const user = await s.reset(sentToken(d), 'brand-new-password');
    expect(user.id).toBe('u1');
    expect(await passwords.verify('brand-new-password', d.store[0].passwordHash)).toBe(true);
    expect(d.rows[0].usedAt).toBeInstanceOf(Date);
    expect(d.sessions.revokeAll).toHaveBeenCalledWith('u1');
  });

  it('rejects a second use of the same token', async () => {
    const d = deps(await activeUser());
    const s = svc(d);
    await s.request('user@x.com', null);
    const token = sentToken(d);
    await s.reset(token, 'brand-new-password');
    await expect(s.reset(token, 'another-password-2')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired token', async () => {
    const d = deps(await activeUser());
    const s = svc(d);
    await s.request('user@x.com', null);
    d.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(s.reset(sentToken(d), 'brand-new-password')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a token whose user was disabled after the link was sent', async () => {
    const d = deps(await activeUser());
    const s = svc(d);
    await s.request('user@x.com', null);
    d.store[0].status = UserStatus.DISABLED;
    await expect(s.reset(sentToken(d), 'brand-new-password')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PasswordResetService.sendForUser', () => {
  const actor = (role: Role) => ({ userId: 'admin1', orgId: 'org_seed', role, email: 'a@x.com', isMachine: false });

  it('an admin can send a reset to a member', async () => {
    const d = deps(await activeUser());
    await expect(svc(d).sendForUser(actor(Role.ADMIN), 'u1')).resolves.toEqual({ ok: true });
    expect(d.mailer.sendPasswordReset).toHaveBeenCalledWith('user@x.com', expect.any(String));
  });

  it('an admin cannot send a reset to an owner', async () => {
    const d = deps(await activeUser({ role: Role.OWNER }));
    await expect(svc(d).sendForUser(actor(Role.ADMIN), 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(d.mailer.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('an owner can send a reset to an owner', async () => {
    const d = deps(await activeUser({ role: Role.OWNER }));
    await expect(svc(d).sendForUser(actor(Role.OWNER), 'u1')).resolves.toEqual({ ok: true });
  });

  it('refuses a user from another org', async () => {
    const d = deps(await activeUser({ orgId: 'org_other' }));
    await expect(svc(d).sendForUser(actor(Role.OWNER), 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a disabled user', async () => {
    const d = deps(await activeUser({ status: UserStatus.DISABLED }));
    await expect(svc(d).sendForUser(actor(Role.OWNER), 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PasswordResetService.changePassword', () => {
  it('rejects a wrong current password and leaves the hash alone', async () => {
    const d = deps(await activeUser());
    const before = d.store[0].passwordHash;
    await expect(svc(d).changePassword('u1', 'wrong-password', 'brand-new-password')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(d.store[0].passwordHash).toBe(before);
    expect(d.sessions.revokeAll).not.toHaveBeenCalled();
  });

  it('sets the new password and revokes every session when the current one is right', async () => {
    const d = deps(await activeUser());
    await expect(svc(d).changePassword('u1', 'old-password-1', 'brand-new-password')).resolves.toEqual({ ok: true });
    expect(await passwords.verify('brand-new-password', d.store[0].passwordHash)).toBe(true);
    expect(d.sessions.revokeAll).toHaveBeenCalledWith('u1');
  });

  it('rejects reusing the current password as the new one', async () => {
    const d = deps(await activeUser());
    await expect(svc(d).changePassword('u1', 'old-password-1', 'old-password-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { Role, UserStatus } from '@prisma/client';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from './decorators';
import { SEED_ORG_ID } from './org.repository';

function reflector(isPublic = false) {
  return { getAllAndOverride: (k: string) => (k === IS_PUBLIC_KEY ? isPublic : undefined) } as any;
}
function req(opts: Partial<{ cookies: any; headers: any; method: string }>) {
  return { cookies: {}, headers: {}, method: 'GET', ...opts };
}
function execCtx(request: any) {
  return { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => ({}), getClass: () => ({}) } as any;
}

describe('AuthGuard', () => {
  const config = { get: (k: string, d?: any) => (k === 'ADMIN_API_KEY' ? 'machine-key-value-min-32-characters-long' : d) } as any;

  it('allows public routes', async () => {
    const guard = new AuthGuard(reflector(true), {} as any, config);
    expect(await guard.canActivate(execCtx(req({})))).toBe(true);
  });

  it('accepts a valid session cookie and sets req.user', async () => {
    const session = { validate: jest.fn(async () => ({ user: { id: 'u1', orgId: 'org_seed', role: Role.ADMIN, email: 'a@x.com', status: UserStatus.ACTIVE } })) } as any;
    const guard = new AuthGuard(reflector(false), session, config);
    const r = req({ cookies: { clickup_sync_sid: 'tok' } });
    expect(await guard.canActivate(execCtx(r))).toBe(true);
    expect((r as any).user).toMatchObject({ userId: 'u1', role: Role.ADMIN, isMachine: false });
  });

  it('accepts a valid x-admin-key as synthetic Owner', async () => {
    const guard = new AuthGuard(reflector(false), { validate: jest.fn() } as any, config);
    const r = req({ headers: { 'x-admin-key': 'machine-key-value-min-32-characters-long' } });
    expect(await guard.canActivate(execCtx(r))).toBe(true);
    expect((r as any).user).toMatchObject({ userId: 'machine', orgId: SEED_ORG_ID, role: Role.OWNER, isMachine: true });
  });

  it('rejects when no credential is present', async () => {
    const guard = new AuthGuard(reflector(false), { validate: jest.fn(async () => null) } as any, config);
    await expect(guard.canActivate(execCtx(req({ cookies: { clickup_sync_sid: 'bad' } })))).rejects.toThrow();
  });

  it('rejects a mutating cookie request with a bad CSRF token', async () => {
    const session = { validate: jest.fn(async () => ({ user: { id: 'u1', orgId: 'o', role: Role.ADMIN, email: 'a', status: UserStatus.ACTIVE } })) } as any;
    const guard = new AuthGuard(reflector(false), session, config);
    const r = req({ method: 'POST', cookies: { clickup_sync_sid: 'tok', csrf: 'aaa' }, headers: { 'x-csrf-token': 'bbb' } });
    await expect(guard.canActivate(execCtx(r))).rejects.toThrow();
  });
});

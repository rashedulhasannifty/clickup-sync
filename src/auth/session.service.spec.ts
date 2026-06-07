import { Role, UserStatus } from '@prisma/client';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

function makeRepo() {
  const rows = new Map<string, any>();
  return {
    rows,
    create: jest.fn(async (d) => { const row = { id: 's1', createdAt: new Date(), lastSeenAt: null, ...d }; rows.set(d.tokenHash, { ...row, user: null }); return row; }),
    findByTokenHash: jest.fn(async (h) => rows.get(h) ?? null),
    touch: jest.fn(async () => {}),
    deleteByTokenHash: jest.fn(async (h) => { rows.delete(h); }),
    deleteAllForUser: jest.fn(async () => {}),
    deleteExpired: jest.fn(async () => {}),
  };
}

describe('SessionService', () => {
  const tokens = new TokenService();
  const config = { get: (k: string, d: any) => (k === 'SESSION_MAX_AGE_DAYS' ? 30 : k === 'SESSION_IDLE_TIMEOUT_DAYS' ? 7 : d) } as any;

  it('issues a token and stores only its hash', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', tokenHash: tokens.hash(token) }));
  });

  it('validates an active session and returns the user', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    const stored = repo.rows.get(tokens.hash(token));
    stored.expiresAt = new Date(Date.now() + 1000 * 60 * 60);
    stored.user = { id: 'user-1', orgId: 'org_seed', role: Role.OWNER, email: 'o@x.com', status: UserStatus.ACTIVE };
    const result = await svc.validate(token);
    expect(result?.user.id).toBe('user-1');
  });

  it('rejects an expired session and deletes it', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    const stored = repo.rows.get(tokens.hash(token));
    stored.expiresAt = new Date(Date.now() - 1000);
    stored.user = { id: 'user-1', status: UserStatus.ACTIVE };
    expect(await svc.validate(token)).toBeNull();
    expect(repo.deleteByTokenHash).toHaveBeenCalled();
  });

  it('rejects a session idle longer than the idle timeout and deletes it', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    const stored = repo.rows.get(tokens.hash(token));
    stored.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 20); // absolute cap not reached
    stored.user = { id: 'user-1', status: UserStatus.ACTIVE };
    // Last activity 8 days ago — beyond the 7-day idle timeout.
    stored.lastSeenAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8);
    stored.createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10);

    expect(await svc.validate(token)).toBeNull();
    expect(repo.deleteByTokenHash).toHaveBeenCalled();
  });

  it('keeps a session active within the idle window using createdAt when never touched', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    const stored = repo.rows.get(tokens.hash(token));
    stored.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 20);
    stored.user = { id: 'user-1', status: UserStatus.ACTIVE };
    stored.lastSeenAt = null; // never touched
    stored.createdAt = new Date(Date.now() - 1000 * 60 * 60); // created an hour ago

    const result = await svc.validate(token);
    expect(result?.user.id).toBe('user-1');
  });

  it('rejects a session whose user is disabled', async () => {
    const repo = makeRepo();
    const svc = new SessionService(repo as any, tokens, config);
    const { token } = await svc.issue('user-1', null, null);
    const stored = repo.rows.get(tokens.hash(token));
    stored.expiresAt = new Date(Date.now() + 100000);
    stored.user = { id: 'user-1', status: UserStatus.DISABLED };
    expect(await svc.validate(token)).toBeNull();
  });
});

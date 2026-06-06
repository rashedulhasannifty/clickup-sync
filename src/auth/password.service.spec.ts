import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes then verifies the same password', async () => {
    const hash = await svc.hash('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await svc.verify('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await svc.hash('right-password');
    expect(await svc.verify('wrong-password', hash)).toBe(false);
  });

  it('produces a unique salt per hash', async () => {
    const a = await svc.hash('same');
    const b = await svc.hash('same');
    expect(a).not.toEqual(b);
  });

  it('returns false for a malformed stored hash', async () => {
    expect(await svc.verify('x', 'not-a-real-hash')).toBe(false);
  });
});

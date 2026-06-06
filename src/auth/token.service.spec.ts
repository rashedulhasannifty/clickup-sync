import { TokenService } from './token.service';
import { sha256 } from '../common/utils/hash';

describe('TokenService', () => {
  const svc = new TokenService();

  it('generates a 64-char hex token and its sha256 hash', () => {
    const { token, tokenHash } = svc.generate();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(sha256(token));
  });

  it('produces distinct tokens', () => {
    expect(svc.generate().token).not.toEqual(svc.generate().token);
  });

  it('hashes a provided token deterministically', () => {
    expect(svc.hash('abc')).toBe(sha256('abc'));
  });

  it('computes a future expiry from days', () => {
    const now = new Date('2026-06-06T00:00:00Z');
    expect(svc.expiryFromDays(7, now).toISOString()).toBe('2026-06-13T00:00:00.000Z');
  });
});

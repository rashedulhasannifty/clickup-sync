import { CryptoService } from '../src/settings/crypto.service';

describe('CryptoService', () => {
  const KEY_HEX = 'a'.repeat(64); // 64 hex chars = 32 bytes

  function withKey(key: string | undefined): CryptoService {
    const prev = process.env.APP_ENCRYPTION_KEY;
    if (key === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = key;
    const svc = new CryptoService();
    if (prev === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = prev;
    return svc;
  }

  it('round-trips encrypt → decrypt', () => {
    const svc = withKey(KEY_HEX);
    expect(svc.isEnabled).toBe(true);
    const blob = svc.encrypt('pk_secret_token');
    expect(blob).not.toContain('pk_secret_token');
    expect(svc.decrypt(blob)).toBe('pk_secret_token');
  });

  it('produces different ciphertext each call (random IV)', () => {
    const svc = withKey(KEY_HEX);
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('is disabled and throws on encrypt when no key configured', () => {
    const svc = withKey(undefined);
    expect(svc.isEnabled).toBe(false);
    expect(() => svc.encrypt('x')).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('is disabled when the key is the wrong length', () => {
    expect(withKey('tooshort').isEnabled).toBe(false);
  });

  it('throws when decrypting tampered ciphertext (GCM auth)', () => {
    const svc = withKey(KEY_HEX);
    const buf = Buffer.from(svc.encrypt('hello'), 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow();
  });

  it('accepts a base64-encoded 32-byte key', () => {
    const svc = withKey(Buffer.alloc(32, 7).toString('base64'));
    expect(svc.isEnabled).toBe(true);
    expect(svc.decrypt(svc.encrypt('z'))).toBe('z');
  });
});

import { validateEnv } from '../src/config/env.validation';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x', CLICKUP_API_TOKEN: 'pk_test' };

  it('accepts ADMIN_API_KEY when provided', () => {
    const result = validateEnv({ ...base, ADMIN_API_KEY: 'my-key' });
    expect(result.ADMIN_API_KEY).toBe('my-key');
  });

  it('defaults ADMIN_API_KEY to empty string when omitted', () => {
    const result = validateEnv({ ...base });
    expect(result.ADMIN_API_KEY).toBe('');
  });

  describe('production mode requirements', () => {
    const prodBase = {
      ...base,
      NODE_ENV: 'production',
      APP_ENCRYPTION_KEY: 'a'.repeat(64),
      ADMIN_API_KEY: 'admin-key-min-32-chars-long-padding',
    };

    it('accepts production when APP_ENCRYPTION_KEY and ADMIN_API_KEY are present', () => {
      const result = validateEnv(prodBase);
      expect(result.NODE_ENV).toBe('production');
      expect(result.APP_ENCRYPTION_KEY).toBe('a'.repeat(64));
      expect(result.ADMIN_API_KEY).toBe('admin-key-min-32-chars-long-padding');
    });

    it('does NOT require CLICKUP_WEBHOOK_SECRET in production (now UI-managed)', () => {
      const result = validateEnv({ ...prodBase, CLICKUP_WEBHOOK_SECRET: '' });
      expect(result.CLICKUP_WEBHOOK_SECRET).toBe('');
    });

    it('rejects production when APP_ENCRYPTION_KEY is missing', () => {
      expect(() => validateEnv({ ...prodBase, APP_ENCRYPTION_KEY: '' }))
        .toThrow(/APP_ENCRYPTION_KEY/);
    });

    it('rejects production when APP_ENCRYPTION_KEY is too short (< 32 chars)', () => {
      expect(() => validateEnv({ ...prodBase, APP_ENCRYPTION_KEY: 'short' }))
        .toThrow(/APP_ENCRYPTION_KEY/);
    });

    it('rejects production when ADMIN_API_KEY is missing', () => {
      expect(() => validateEnv({ ...prodBase, ADMIN_API_KEY: '' }))
        .toThrow(/ADMIN_API_KEY is required/);
    });

    it('rejects production when ADMIN_API_KEY is too short (< 32 chars)', () => {
      expect(() => validateEnv({ ...prodBase, ADMIN_API_KEY: 'short' }))
        .toThrow(/at least 32 characters/);
    });

    it('rejects production when ADMIN_API_KEY is exactly 31 chars (boundary)', () => {
      expect(() => validateEnv({ ...prodBase, ADMIN_API_KEY: 'a'.repeat(31) }))
        .toThrow(/at least 32 characters/);
    });

    it('accepts production when ADMIN_API_KEY is exactly 32 chars (boundary)', () => {
      const result = validateEnv({ ...prodBase, ADMIN_API_KEY: 'a'.repeat(32) });
      expect(result.ADMIN_API_KEY).toBe('a'.repeat(32));
    });

    it('allows empty secrets in development (preserves dev-mode bypass)', () => {
      const result = validateEnv({
        ...base,
        NODE_ENV: 'development',
        CLICKUP_WEBHOOK_SECRET: '',
        ADMIN_API_KEY: '',
      });
      expect(result.CLICKUP_WEBHOOK_SECRET).toBe('');
      expect(result.ADMIN_API_KEY).toBe('');
    });
  });
});

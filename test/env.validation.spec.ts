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
      CLICKUP_WEBHOOK_SECRET: 'wh-secret-value',
      ADMIN_API_KEY: 'admin-key-min-32-chars-long-padding',
    };

    it('accepts production when CLICKUP_WEBHOOK_SECRET and ADMIN_API_KEY are present', () => {
      const result = validateEnv(prodBase);
      expect(result.NODE_ENV).toBe('production');
      expect(result.CLICKUP_WEBHOOK_SECRET).toBe('wh-secret-value');
    });

    it('rejects production when CLICKUP_WEBHOOK_SECRET is missing', () => {
      expect(() => validateEnv({ ...prodBase, CLICKUP_WEBHOOK_SECRET: '' }))
        .toThrow(/CLICKUP_WEBHOOK_SECRET/);
    });

    it('rejects production when ADMIN_API_KEY is missing', () => {
      expect(() => validateEnv({ ...prodBase, ADMIN_API_KEY: '' }))
        .toThrow(/ADMIN_API_KEY/);
    });

    it('rejects production when ADMIN_API_KEY is too short (< 32 chars)', () => {
      expect(() => validateEnv({ ...prodBase, ADMIN_API_KEY: 'short' }))
        .toThrow(/ADMIN_API_KEY/);
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

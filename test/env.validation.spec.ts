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
});

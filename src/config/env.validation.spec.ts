import { validateEnv } from './env.validation';

const base = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };

describe('validateEnv — Xero', () => {
  it('defaults both Xero vars to empty (feature off)', () => {
    const env = validateEnv({ ...base });
    expect(env.XERO_CLIENT_ID).toBe('');
    expect(env.XERO_CLIENT_SECRET).toBe('');
  });

  it('accepts both set', () => {
    const env = validateEnv({ ...base, XERO_CLIENT_ID: 'id', XERO_CLIENT_SECRET: 'secret' });
    expect(env.XERO_CLIENT_ID).toBe('id');
  });

  it('rejects only one of the pair being set', () => {
    expect(() => validateEnv({ ...base, XERO_CLIENT_ID: 'id' })).toThrow(/XERO_CLIENT_SECRET/);
    expect(() => validateEnv({ ...base, XERO_CLIENT_SECRET: 's' })).toThrow(/XERO_CLIENT_ID/);
  });
});

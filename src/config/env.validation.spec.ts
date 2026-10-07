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

describe('validateEnv — MAIL_FROM in production', () => {
  const prod = {
    ...base,
    NODE_ENV: 'production',
    APP_ENCRYPTION_KEY: 'a'.repeat(64),
    ADMIN_API_KEY: 'k'.repeat(32),
  };

  it('rejects the example.com placeholder when SMTP is configured', () => {
    expect(() => validateEnv({ ...prod, SMTP_HOST: 'email-smtp.ap-southeast-1.amazonaws.com' })).toThrow(/MAIL_FROM/);
    expect(() =>
      validateEnv({ ...prod, SMTP_HOST: 'smtp.x', MAIL_FROM: 'Nifty Log <no-reply@example.com>' }),
    ).toThrow(/MAIL_FROM/);
  });

  it('accepts a real sender', () => {
    const env = validateEnv({ ...prod, SMTP_HOST: 'smtp.x', MAIL_FROM: 'Nifty Log <noreply@niftyhq.ai>' });
    expect(env.MAIL_FROM).toBe('Nifty Log <noreply@niftyhq.ai>');
  });

  it('leaves the placeholder alone when no SMTP relay is set (dev transport only logs)', () => {
    expect(() => validateEnv({ ...prod })).not.toThrow();
  });

  it('does not apply outside production', () => {
    expect(() => validateEnv({ ...base, SMTP_HOST: 'smtp.x' })).not.toThrow();
  });
});

describe('validateEnv — ATTENDANCE_PROVIDER', () => {
  const prod = {
    ...base,
    NODE_ENV: 'production',
    APP_ENCRYPTION_KEY: 'a'.repeat(64),
    ADMIN_API_KEY: 'k'.repeat(32),
  };

  it('defaults to dummy outside production', () => {
    expect(validateEnv({ ...base }).ATTENDANCE_PROVIDER).toBe('dummy');
    expect(validateEnv({ ...base, NODE_ENV: 'test' }).ATTENDANCE_PROVIDER).toBe('dummy');
  });

  it('defaults to none in production, so the dummy cannot boot by omission', () => {
    expect(validateEnv({ ...prod }).ATTENDANCE_PROVIDER).toBe('none');
  });

  it('refuses an explicit dummy in production', () => {
    expect(() => validateEnv({ ...prod, ATTENDANCE_PROVIDER: 'dummy' })).toThrow(/ATTENDANCE_PROVIDER=dummy/);
    expect(() =>
      validateEnv({ ...prod, ATTENDANCE_PROVIDER: 'dummy', ATTENDANCE_DUMMY_ALLOW_IN_PROD: 'false' }),
    ).toThrow(/ATTENDANCE_PROVIDER=dummy/);
  });

  it('allows the dummy in production only with the explicit opt-in', () => {
    const env = validateEnv({ ...prod, ATTENDANCE_PROVIDER: 'dummy', ATTENDANCE_DUMMY_ALLOW_IN_PROD: 'true' });
    expect(env.ATTENDANCE_PROVIDER).toBe('dummy');
    expect(env.ATTENDANCE_DUMMY_ALLOW_IN_PROD).toBe(true);
  });

  it('accepts none anywhere and parses the opt-in string, not truthiness', () => {
    expect(validateEnv({ ...base, ATTENDANCE_PROVIDER: 'none' }).ATTENDANCE_PROVIDER).toBe('none');
    expect(validateEnv({ ...prod, ATTENDANCE_PROVIDER: 'none' }).ATTENDANCE_PROVIDER).toBe('none');
    expect(validateEnv({ ...base, ATTENDANCE_DUMMY_ALLOW_IN_PROD: 'false' }).ATTENDANCE_DUMMY_ALLOW_IN_PROD).toBe(false);
  });

  it('treats an empty value (a blank line in .env) as unset', () => {
    expect(validateEnv({ ...base, ATTENDANCE_PROVIDER: '' }).ATTENDANCE_PROVIDER).toBe('dummy');
    expect(validateEnv({ ...prod, ATTENDANCE_PROVIDER: '' }).ATTENDANCE_PROVIDER).toBe('none');
  });

  it('rejects an unknown provider', () => {
    expect(() => validateEnv({ ...base, ATTENDANCE_PROVIDER: 'nifty' })).toThrow(/ATTENDANCE_PROVIDER/);
  });
});

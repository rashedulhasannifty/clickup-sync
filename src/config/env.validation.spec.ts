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

describe('validateEnv — Stellar HRM API', () => {
  it('both empty by default, both set (trimmed) accepted, one alone refused', () => {
    expect(validateEnv({ ...base })).toMatchObject({ STELLAR_AUTH_USER: '', STELLAR_AUTH_CODE: '' });
    expect(validateEnv({ ...base, STELLAR_AUTH_USER: ' u ', STELLAR_AUTH_CODE: 'c' })).toMatchObject({
      STELLAR_AUTH_USER: 'u',
      STELLAR_AUTH_CODE: 'c',
    });
    expect(() => validateEnv({ ...base, STELLAR_AUTH_USER: 'u' })).toThrow(/STELLAR_AUTH_CODE/);
    expect(() => validateEnv({ ...base, STELLAR_AUTH_CODE: 'c' })).toThrow(/STELLAR_AUTH_USER/);
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

  it('accepts stellar anywhere, production included', () => {
    expect(validateEnv({ ...base, ATTENDANCE_PROVIDER: 'stellar' }).ATTENDANCE_PROVIDER).toBe('stellar');
    expect(validateEnv({ ...prod, ATTENDANCE_PROVIDER: 'stellar' }).ATTENDANCE_PROVIDER).toBe('stellar');
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

describe('validateEnv — documents storage (MinIO)', () => {
  const all = {
    DOCUMENTS_S3_ENDPOINT: 'http://localhost:9000',
    DOCUMENTS_S3_REGION: 'us-east-1',
    DOCUMENTS_S3_BUCKET: 'clickup-sync-documents',
    DOCUMENTS_S3_ACCESS_KEY_ID: 'app',
    DOCUMENTS_S3_SECRET_ACCESS_KEY: 'not-a-real-secret',
  };

  it('defaults to off, with path-style addressing on', () => {
    const env = validateEnv({ ...base });
    expect(env.DOCUMENTS_S3_ENDPOINT).toBe('');
    expect(env.DOCUMENTS_S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('accepts the full set and parses the path-style flag', () => {
    expect(validateEnv({ ...base, ...all }).DOCUMENTS_S3_BUCKET).toBe('clickup-sync-documents');
    expect(validateEnv({ ...base, ...all, DOCUMENTS_S3_FORCE_PATH_STYLE: 'false' }).DOCUMENTS_S3_FORCE_PATH_STYLE).toBe(false);
    expect(validateEnv({ ...base, ...all, DOCUMENTS_S3_FORCE_PATH_STYLE: '' }).DOCUMENTS_S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('rejects a partial set, naming each missing key', () => {
    for (const k of Object.keys(all) as (keyof typeof all)[]) {
      const { [k]: _omitted, ...rest } = all;
      void _omitted;
      expect(() => validateEnv({ ...base, ...rest })).toThrow(new RegExp(k));
    }
    expect(() => validateEnv({ ...base, DOCUMENTS_S3_BUCKET: 'b' })).toThrow(/DOCUMENTS_S3_ENDPOINT/);
  });

  it('rejects an endpoint that is not an http(s) URL', () => {
    expect(() => validateEnv({ ...base, ...all, DOCUMENTS_S3_ENDPOINT: 'localhost:9000' })).toThrow(/http\(s\) URL/);
  });
});

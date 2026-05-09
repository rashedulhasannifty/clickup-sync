import { UnauthorizedException } from '@nestjs/common';
import { AdminApiKeyGuard } from '../src/admin/admin-api-key.guard';

describe('AdminApiKeyGuard', () => {
  const KEY = 'super-secret-admin-key';

  function makeGuard(key: string) {
    return new AdminApiKeyGuard({ get: (_k: string, def: string) => key || def } as any);
  }

  function makeCtx(header: string | undefined) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-admin-key': header } }) }),
    } as any;
  }

  it('passes with correct key', () => {
    expect(makeGuard(KEY).canActivate(makeCtx(KEY))).toBe(true);
  });

  it('throws UnauthorizedException when header is missing', () => {
    expect(() => makeGuard(KEY).canActivate(makeCtx(undefined))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when key is wrong', () => {
    expect(() => makeGuard(KEY).canActivate(makeCtx('wrong-key'))).toThrow(UnauthorizedException);
  });

  it('passes when ADMIN_API_KEY is not configured (dev mode)', () => {
    expect(makeGuard('').canActivate(makeCtx(undefined))).toBe(true);
  });
});

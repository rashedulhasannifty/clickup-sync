import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * Credential-handling routes are unauthenticated by necessity, so the rate limit
 * is the only thing standing between them and an offline-speed guessing loop.
 * A route that loses its @UseGuards(ThrottlerGuard) fails here rather than
 * quietly becoming free to hammer.
 */
const MUST_THROTTLE = [
  'signup',
  'login',
  'forgotPassword',
  'previewReset',
  'resetPassword',
  'changePassword',
] as const;

function guards(method: string): unknown[] {
  return Reflect.getMetadata('__guards__', (AuthController.prototype as any)[method]) ?? [];
}

function isPublic(method: string): boolean {
  return Reflect.getMetadata(IS_PUBLIC_KEY, (AuthController.prototype as any)[method]) === true;
}

describe('AuthController rate limiting', () => {
  it.each(MUST_THROTTLE)('%s is throttled', (method) => {
    expect(guards(method)).toContain(ThrottlerGuard);
  });

  it('every password-reset route is reachable without a session', () => {
    // change-password is deliberately NOT here: it proves the current password
    // from an authenticated session instead of an emailed token.
    for (const method of ['forgotPassword', 'previewReset', 'resetPassword']) {
      expect(isPublic(method)).toBe(true);
    }
    expect(isPublic('changePassword')).toBe(false);
  });
});

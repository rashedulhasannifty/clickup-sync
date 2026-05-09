import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { WebhookSignatureGuard } from '../src/webhooks/webhook-signature.guard';

describe('WebhookSignatureGuard', () => {
  const SECRET = 'test-secret-key';
  const body = Buffer.from('{"event":"taskCreated","task_id":"abc"}');

  function makeGuard(secret: string) {
    return new WebhookSignatureGuard({ get: (_k: string, def: string) => secret || def } as any);
  }

  function makeCtx(rawBody: Buffer | undefined, signature: string | undefined) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-signature': signature }, rawBody }) }),
    } as any;
  }

  it('passes with correct HMAC-SHA256 signature', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(makeGuard(SECRET).canActivate(makeCtx(body, sig))).toBe(true);
  });

  it('throws UnauthorizedException when signature header is missing', () => {
    expect(() => makeGuard(SECRET).canActivate(makeCtx(body, undefined))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when signature is wrong', () => {
    expect(() => makeGuard(SECRET).canActivate(makeCtx(body, 'badsig'))).toThrow(UnauthorizedException);
  });

  it('passes and warns when CLICKUP_WEBHOOK_SECRET is empty (dev mode)', () => {
    expect(makeGuard('').canActivate(makeCtx(undefined, undefined))).toBe(true);
  });
});

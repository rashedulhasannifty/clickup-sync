import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request } from 'express';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const secret = this.config.get<string>('CLICKUP_WEBHOOK_SECRET', '');

    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        // Env validation catches this at boot; this is defense-in-depth.
        throw new InternalServerErrorException('Webhook secret missing in production');
      }
      this.logger.warn('CLICKUP_WEBHOOK_SECRET not set — skipping signature verification (dev mode)');
      return true;
    }

    const signature = req.headers['x-signature'] as string | undefined;
    if (!signature) throw new UnauthorizedException('Missing X-Signature header');

    const rawBody = req.rawBody;
    if (!rawBody) throw new UnauthorizedException('Raw body unavailable');

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(signature);

    if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}

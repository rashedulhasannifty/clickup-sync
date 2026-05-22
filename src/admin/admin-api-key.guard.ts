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
export class AdminApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(AdminApiKeyGuard.name);
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = this.config.get<string>('ADMIN_API_KEY', '');

    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        // Env validation catches this at boot; this is defense-in-depth.
        throw new InternalServerErrorException('Admin API key missing in production');
      }
      this.logger.warn('ADMIN_API_KEY not set — skipping admin auth (dev mode)');
      return true;
    }

    const provided = req.headers['x-admin-key'] as string | undefined;
    if (!provided) throw new UnauthorizedException('Missing x-admin-key header');

    const keyBuf = Buffer.from(apiKey);
    const providedBuf = Buffer.from(provided);
    if (keyBuf.length !== providedBuf.length || !crypto.timingSafeEqual(keyBuf, providedBuf)) {
      throw new UnauthorizedException('Invalid admin API key');
    }

    return true;
  }
}

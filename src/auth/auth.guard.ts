import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as crypto from 'crypto';
import { IS_PUBLIC_KEY } from './decorators';
import { SessionService } from './session.service';
import { SEED_ORG_ID } from './org.repository';
import { AuthPrincipal } from './auth.types';

export const SESSION_COOKIE = 'clickup_sync_sid';
const CSRF_COOKIE = 'csrf';
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();

    const apiKey = this.config.get<string>('ADMIN_API_KEY', '');
    const provided = req.headers['x-admin-key'] as string | undefined;
    if (apiKey && provided && this.timingSafeEqual(apiKey, provided)) {
      req.user = { userId: 'machine', orgId: SEED_ORG_ID, role: Role.OWNER, email: null, isMachine: true } as AuthPrincipal;
      return true;
    }

    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException('Not authenticated');
    const row = await this.sessions.validate(token);
    if (!row) throw new UnauthorizedException('Session invalid or expired');

    if (MUTATING.has(req.method)) {
      const header = req.headers['x-csrf-token'] as string | undefined;
      const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
      if (!header || !cookie || header !== cookie) throw new ForbiddenException('CSRF token mismatch');
    }

    req.user = {
      userId: row.user.id,
      orgId: row.user.orgId,
      role: row.user.role,
      email: row.user.email,
      isMachine: false,
    } as AuthPrincipal;
    return true;
  }

  private timingSafeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  }
}

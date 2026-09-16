import { Controller, Delete, Get, HttpCode, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import type { AuthPrincipal } from '../auth/auth.types';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { XeroAuthService } from './xero-auth.service';

/**
 * Roles are set per route, not on the class: the callback must stay @Public()
 * (Xero redirects the browser here; authorisation comes from the single-use `state`).
 * The interceptor audits the mutating routes (connect, disconnect, sync) and skips GETs.
 */
@ApiTags('xero')
@ApiSecurity('x-admin-key')
@UseInterceptors(AuditLogInterceptor)
@Controller('xero')
export class XeroAuthController {
  constructor(private readonly auth: XeroAuthService) {}

  @Post('connect')
  @HttpCode(200)
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Start the Xero OAuth flow; returns the consent URL to navigate to' })
  connect(@CurrentUser() user: AuthPrincipal) {
    return this.auth.startConnect(user);
  }

  @Get('callback')
  @Public()
  @ApiExcludeEndpoint()
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    res.redirect(302, await this.auth.handleCallback({ code, state, error }));
  }

  @Delete('connection')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Disconnect Xero (synced data is kept)' })
  disconnect() {
    return this.auth.disconnect();
  }

  @Delete('data')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Disconnect Xero AND erase every synced row, so a different organisation can be connected' })
  eraseData() {
    return this.auth.eraseData();
  }

  @Get('status')
  @Roles(Role.OWNER, Role.ADMIN)
  @ApiOperation({ summary: 'Xero connection and per-entity sync status' })
  status() {
    return this.auth.status();
  }

  @Post('sync')
  @HttpCode(202)
  @Roles(Role.OWNER, Role.ADMIN)
  @ApiOperation({ summary: 'Queue a Xero sync now; full=true re-reads everything, ignoring watermarks' })
  sync(@Query('full') full?: string) {
    return this.auth.requestSync({ full: full === 'true' });
  }
}

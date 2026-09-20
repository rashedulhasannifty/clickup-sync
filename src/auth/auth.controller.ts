import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { SessionService } from './session.service';
import { OrgRepository } from './org.repository';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public, CurrentUser } from './decorators';
import { SESSION_COOKIE } from './auth.guard';
import { AuthPrincipal } from './auth.types';
import { AccessScopeService } from '../access/access-scope.service';
import { Scope } from '../access/scope.decorator';
import { AccessScope } from '../access/access-scope';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly resets: PasswordResetService,
    private readonly sessions: SessionService,
    private readonly orgs: OrgRepository,
    private readonly access: AccessScopeService,
  ) {}

  private async setSession(res: Response, req: Request, userId: string) {
    const { token } = await this.sessions.issue(userId, req.ip ?? null, (req.headers['user-agent'] as string) ?? null);
    const csrf = randomBytes(16).toString('hex');
    const secure = process.env.NODE_ENV === 'production';
    const maxAge = this.sessions.cookieMaxAgeMs();
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge });
    res.cookie('csrf', csrf, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge });
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('signup')
  async signup(@Body() dto: SignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.signup(dto);
    await this.setSession(res, req, user.id);
    const org = await this.orgs.get();
    return { user: this.publicUser(user), org: { id: org?.id, name: org?.name } };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(dto);
    await this.setSession(res, req, user.id);
    const org = await this.orgs.get();
    return { user: this.publicUser(user), org: { id: org?.id, name: org?.name } };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    // Always { ok: true }: a different answer for a known address would make
    // this endpoint an account enumerator.
    return this.resets.request(dto.email, req.ip ?? null);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Get('reset-password/:token')
  async previewReset(@Param('token') token: string) {
    return this.resets.preview(token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('reset-password/:token')
  async resetPassword(
    @Param('token') token: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.resets.reset(token, dto.password);
    // reset() revoked every session, including any this browser held; issue a
    // fresh one so the person lands signed in rather than back at the login form.
    await this.setSession(res, req, user.id);
    const org = await this.orgs.get();
    return { user: this.publicUser(user), org: { id: org?.id, name: org?.name } };
  }

  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('change-password')
  async changePassword(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.resets.changePassword(principal.userId, dto.currentPassword, dto.newPassword);
    // Same as reset: every session died, so re-issue this one.
    await this.setSession(res, req, principal.userId);
    return { ok: true };
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await this.sessions.revoke(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie('csrf', { path: '/' });
    return { ok: true };
  }

  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revokeAll(user.userId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie('csrf', { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthPrincipal, @Scope() scope: AccessScope) {
    if (!user) throw new UnauthorizedException();
    const org = await this.orgs.get(user.orgId);
    return {
      user: { id: user.userId, email: user.email, role: user.role, isMachine: user.isMachine },
      org: { id: org?.id, name: org?.name },
      access: await this.access.summary(user, scope),
    };
  }

  private publicUser(u: { id: string; email: string; name: string | null; role: string }) {
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }
}

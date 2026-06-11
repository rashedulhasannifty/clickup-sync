import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { InvitationService } from './invitation.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { Public, Roles, CurrentUser } from './decorators';
import { AuthPrincipal } from './auth.types';

@ApiTags('invitations')
@Controller()
export class InvitationController {
  constructor(private readonly invites: InvitationService) {}

  @Roles(Role.OWNER, Role.ADMIN)
  @Post('invitations')
  create(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateInvitationDto) {
    return this.invites.create(user, dto);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Get('invitations')
  list(@CurrentUser() user: AuthPrincipal) {
    return this.invites.list(user.orgId);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(200)
  @Post('invitations/:id/resend')
  resend(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.invites.resend(user, id);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @HttpCode(200)
  @Post('invitations/:id/revoke')
  revoke(@Param('id') id: string) {
    return this.invites.revoke(id);
  }

  @Public()
  @Get('auth/invitations/:token')
  preview(@Param('token') token: string) {
    return this.invites.preview(token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('auth/invitations/:token/accept')
  async accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    const user = await this.invites.accept(token, dto);
    return { ok: true, email: user.email };
  }
}

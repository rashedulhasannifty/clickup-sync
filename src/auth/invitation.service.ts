import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationStatus, Role, User, UserStatus } from '@prisma/client';
import { InvitationRepository } from './invitation.repository';
import { UserRepository } from './user.repository';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import { MailerService } from './mailer.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AuthPrincipal } from './auth.types';
import { SEED_ORG_ID } from './org.repository';

const INVITE_TTL_DAYS = 7;

@Injectable()
export class InvitationService {
  constructor(
    private readonly invites: InvitationRepository,
    private readonly users: UserRepository,
    private readonly perms: PermissionsService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async create(actor: AuthPrincipal, dto: CreateInvitationDto) {
    const role = dto.role as Role;
    if (!this.perms.canInviteWithRole(actor.role, role)) {
      throw new ForbiddenException('You cannot invite a user with that role.');
    }
    const email = dto.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw new BadRequestException('A user with that email already exists.');
    }
    const existing = await this.invites.findPendingByEmail(actor.orgId, email);
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = this.tokens.expiryFromDays(INVITE_TTL_DAYS);
    if (existing) {
      await this.invites.update(existing.id, { tokenHash, role, expiresAt, status: InvitationStatus.PENDING, invitedByUserId: actor.userId });
    } else {
      await this.invites.create({ orgId: actor.orgId, email, role, tokenHash, expiresAt, invitedByUserId: actor.userId });
    }
    const orgName = this.config.get<string>('DEFAULT_ORG_NAME', 'your team');
    await this.mailer.sendInvite(email, token, orgName, role);
    return { ok: true, email };
  }

  list(orgId: string) {
    return this.invites.listByOrg(orgId);
  }

  async resend(actor: AuthPrincipal, id: string) {
    const inv = await this.invites.findById(id);
    if (!inv || inv.status !== InvitationStatus.PENDING) throw new BadRequestException('No pending invite.');
    const { token, tokenHash } = this.tokens.generate();
    await this.invites.update(id, { tokenHash, expiresAt: this.tokens.expiryFromDays(INVITE_TTL_DAYS) });
    await this.mailer.sendInvite(inv.email, token, this.config.get<string>('DEFAULT_ORG_NAME', 'your team'), inv.role);
    return { ok: true };
  }

  async revoke(id: string) {
    await this.invites.update(id, { status: InvitationStatus.REVOKED });
    return { ok: true };
  }

  /** Public lookup for the accept screen. */
  async preview(token: string) {
    const inv = await this.invites.findByTokenHash(this.tokens.hash(token));
    if (!inv || inv.status !== InvitationStatus.PENDING || inv.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invitation is invalid or has expired.');
    }
    return { email: inv.email, role: inv.role, orgName: (inv as any).org?.name ?? 'your team' };
  }

  async accept(token: string, dto: AcceptInvitationDto): Promise<User> {
    const inv = await this.invites.findByTokenHash(this.tokens.hash(token));
    if (!inv || inv.status !== InvitationStatus.PENDING || inv.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invitation is invalid or has expired.');
    }
    if (await this.users.findByEmail(inv.email)) {
      throw new BadRequestException('An account with this email already exists.');
    }
    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create({
      email: inv.email,
      passwordHash,
      name: dto.name.trim(),
      role: inv.role,
      status: UserStatus.ACTIVE,
      org: { connect: { id: inv.orgId ?? SEED_ORG_ID } },
    });
    await this.invites.update(inv.id, { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() });
    return user;
  }
}

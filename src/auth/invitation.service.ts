import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationStatus, Role, TeamRole, User, UserStatus } from '@prisma/client';
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
import { TeamsRepository } from '../teams/teams.repository';
import { WorkspaceMembersService } from '../clickup/workspace-members.service';

const INVITE_TTL_DAYS = 7;

/** Duck-typed Prisma error code check — matches the convention already used in
 *  src/teams/teams.service.ts and src/webhooks/webhook-events.repository.ts. */
function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined;
}

/** True only for a P2002 whose violated unique constraint is the ClickUp-user
 *  column — never for an unrelated collision (e.g. a concurrent double-accept
 *  racing on the `email` unique constraint), which must surface as-is instead
 *  of being mislabelled as a link conflict and silently retried. */
function isClickupUserIdConflict(err: unknown): boolean {
  if (prismaErrorCode(err) !== 'P2002') return false;
  const target = (err as { meta?: { target?: unknown } })?.meta?.target;
  const targets = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return targets.some((t) => /clickup/i.test(String(t)));
}

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    private readonly invites: InvitationRepository,
    private readonly users: UserRepository,
    private readonly perms: PermissionsService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
    private readonly teams: TeamsRepository,
    private readonly directory: WorkspaceMembersService,
  ) {}

  /** Resolves the invite's ClickUp link: `undefined` auto-matches by email against
   *  the workspace directory, `null` (or an explicit id) is used as-is. The
   *  directory call is best-effort — a ClickUp outage, bad token, or rate limit
   *  must never block creating (and emailing) the invite over this optional
   *  convenience field; the readiness summary already surfaces unlinked users. */
  private async resolveClickupUserId(email: string, dto: CreateInvitationDto): Promise<string | null> {
    if (dto.clickupUserId !== undefined) return dto.clickupUserId;
    try {
      const members = await this.directory.getDirectory();
      return members.find((m) => m.email?.toLowerCase() === email)?.id ?? null;
    } catch (err) {
      this.logger.warn(`Could not auto-match a ClickUp identity for invite ${email}; creating unlinked (${String(err)}).`);
      return null;
    }
  }

  private async assertTeamsInOrg(orgId: string, teamIds: string[]): Promise<void> {
    if (!teamIds.length) return;
    const uniqueIds = [...new Set(teamIds)];
    // A duplicate teamId would otherwise hit InvitationTeam's
    // @@id([invitationId, teamId]) as an uncaught P2002 (500) on write — reject
    // it up front instead.
    if (uniqueIds.length !== teamIds.length) throw new BadRequestException('Duplicate team ids in the invitation.');
    const count = await this.teams.countInOrg(orgId, uniqueIds);
    if (count !== uniqueIds.length) throw new BadRequestException('One or more team ids are unknown.');
  }

  async create(actor: AuthPrincipal, dto: CreateInvitationDto) {
    const role = dto.role as Role;
    if (!this.perms.canInviteWithRole(actor.role, role)) {
      throw new ForbiddenException('You cannot invite a user with that role.');
    }
    const email = dto.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw new BadRequestException('A user with that email already exists.');
    }
    const teamIds = dto.teams?.map((t) => t.teamId) ?? [];
    await this.assertTeamsInOrg(actor.orgId, teamIds);
    const clickupUserId = await this.resolveClickupUserId(email, dto);
    const teamsCreate = dto.teams?.map((t) => ({ teamId: t.teamId, role: t.role as TeamRole })) ?? [];

    const existing = await this.invites.findPendingByEmail(actor.orgId, email);
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = this.tokens.expiryFromDays(INVITE_TTL_DAYS);
    if (existing) {
      await this.invites.update(existing.id, {
        tokenHash,
        role,
        expiresAt,
        status: InvitationStatus.PENDING,
        invitedByUserId: actor.userId,
        clickupUserId,
        // Re-invite replaces the team assignments wholesale: drop whatever was
        // there before, then write the newly requested set.
        teams: { deleteMany: {}, create: teamsCreate },
      });
    } else {
      await this.invites.create({
        orgId: actor.orgId,
        email,
        role,
        tokenHash,
        expiresAt,
        invitedByUserId: actor.userId,
        clickupUserId,
        teams: { create: teamsCreate },
      });
    }
    const orgName = this.config.get<string>('DEFAULT_ORG_NAME', 'your team');
    await this.mailer.sendInvite(email, token, orgName, role);
    return { ok: true, email };
  }

  async list(orgId: string) {
    const invites = await this.invites.listByOrg(orgId);
    // tokenHash is stripped defensively here even though the repository query
    // already omits it — a single-use invitation secret must never reach the API
    // response under any circumstance.
    return invites.map(({ tokenHash: _tokenHash, teams, ...inv }: any) => ({
      ...inv,
      teams: (teams ?? []).map((t: any) => ({ teamId: t.teamId, teamName: t.team?.name ?? null, role: t.role })),
    }));
  }

  async resend(actor: AuthPrincipal, id: string) {
    const inv = await this.invites.findById(id);
    // Org-scope: an invite belonging to another org must be unaddressable.
    if (!inv || inv.orgId !== actor.orgId || inv.status !== InvitationStatus.PENDING) throw new BadRequestException('No pending invite.');
    const { token, tokenHash } = this.tokens.generate();
    await this.invites.update(id, { tokenHash, expiresAt: this.tokens.expiryFromDays(INVITE_TTL_DAYS) });
    await this.mailer.sendInvite(inv.email, token, this.config.get<string>('DEFAULT_ORG_NAME', 'your team'), inv.role);
    return { ok: true };
  }

  async revoke(actor: AuthPrincipal, id: string) {
    const inv = await this.invites.findById(id);
    // Org-scope: don't let an admin revoke another org's invitation by id.
    if (!inv || inv.orgId !== actor.orgId) throw new BadRequestException('Invitation not found.');
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
    const baseData = {
      email: inv.email,
      passwordHash,
      name: dto.name.trim(),
      role: inv.role,
      status: UserStatus.ACTIVE,
      org: { connect: { id: inv.orgId ?? SEED_ORG_ID } },
    };
    // The account must never fail to be created over a ClickUp-link collision: if
    // the invited clickupUserId is already linked to someone else (P2002 on that
    // unique column specifically), fall back to creating the user unlinked and log
    // it — the readiness summary (usersWithoutClickupLink) surfaces them for a
    // manual fix. Any other P2002 (e.g. a concurrent double-accept racing on the
    // `email` unique constraint) is a different failure and must rethrow as-is,
    // not be mislabelled as a link conflict and retried identically.
    let user: User;
    try {
      user = await this.users.create({ ...baseData, clickupUserId: inv.clickupUserId ?? null });
    } catch (err) {
      if (!inv.clickupUserId || !isClickupUserIdConflict(err)) throw err;
      this.logger.warn(
        `Invite accept for ${inv.email}: clickupUserId ${inv.clickupUserId} is already linked to another account; creating unlinked.`,
      );
      user = await this.users.create({ ...baseData, clickupUserId: null });
    }
    await this.invites.update(inv.id, { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() });

    // Team memberships are applied sequentially and idempotently, not inside the
    // user-creation transaction — see the "Invitations carry teams" section of the
    // design spec for the deviation. A failing team never blocks account creation;
    // it's logged and the user shows up team-less in the readiness summary.
    const invitedByUserId = inv.invitedByUserId ?? user.id;
    for (const row of inv.teams ?? []) {
      try {
        await this.teams.addMember(row.teamId, user.id, row.role, invitedByUserId);
      } catch (err) {
        this.logger.warn(`Invite accept for ${inv.email}: failed to add team ${row.teamId} (${String(err)}).`);
      }
    }

    return user;
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TeamRole } from '@prisma/client';
import { AccessScope, isUnrestricted } from '../access/access-scope';
import { AuthPrincipal } from '../auth/auth.types';
import { UserRepository } from '../auth/user.repository';
import { TeamsRepository } from './teams.repository';

/** Duck-typed Prisma error code check — works for real PrismaClientKnownRequestErrors
 *  and for plain `{code}` objects in tests, matching the style already used in
 *  src/webhooks/webhook-events.repository.ts. */
function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined;
}

@Injectable()
export class TeamsService {
  constructor(
    private readonly repo: TeamsRepository,
    private readonly users: UserRepository,
  ) {}

  /** Org-scoped existence check: a team id from another org must 404, never 403 —
   *  a 403 would confirm the id exists somewhere. Matches src/auth/users.service.ts. */
  private async assertTeam(orgId: string, teamId: string): Promise<void> {
    const found = await this.repo.findInOrg(teamId, orgId);
    if (!found) throw new NotFoundException('Team not found');
  }

  /** Shared by the admin and lead add-member paths: the target must be an existing,
   *  ACTIVE, same-org user. Previously only the lead path checked this. */
  private async assertMemberCandidate(actor: AuthPrincipal, userId: string) {
    const user = await this.users.findById(userId);
    if (!user || user.orgId !== actor.orgId || user.status !== 'ACTIVE') {
      throw new BadRequestException('User not found or inactive');
    }
    return user;
  }

  async list(orgId: string) {
    const teams = await this.repo.listFull(orgId);
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      clients: t.clients.map((c) => ({
        optionId: c.option.optionId,
        name: c.option.name,
        archived: c.option.archived,
      })),
      members: t.members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        clickupUserId: m.user.clickupUserId,
      })),
      pendingInvites: t.invitations
        .filter((i) => i.invitation.status === 'PENDING')
        .map((i) => ({ invitationId: i.invitation.id, email: i.invitation.email, role: i.role })),
    }));
  }

  /** Adds `teamName` to the client-options catalog from ClientsModule's ClientOptionsRepository. */
  async withTeamNames(
    options: { optionId: string; fieldId: string; name: string; archived: boolean; teamId: string | null }[],
  ) {
    const teamIds = [...new Set(options.map((o) => o.teamId).filter((id): id is string => id != null))];
    const teams = teamIds.length ? await this.repo.teamNames(teamIds) : [];
    const nameById = new Map(teams.map((t) => [t.id, t.name]));
    return options.map((o) => ({ ...o, teamName: o.teamId ? (nameById.get(o.teamId) ?? null) : null }));
  }

  async create(actor: AuthPrincipal, name: string, optionIds: string[]) {
    let team: { id: string; name: string };
    try {
      team = await this.repo.create(actor.orgId, name);
    } catch (err) {
      if (prismaErrorCode(err) === 'P2002') throw new ConflictException('A team with that name already exists');
      throw err;
    }
    try {
      await this.setClients(actor, team.id, optionIds, false);
    } catch (err) {
      // A conflicting client set must never leave a half-made team behind. Swallow a
      // failed rollback delete so the original conflict (not a secondary delete error)
      // is what the caller sees.
      await this.repo.delete(team.id).catch(() => {});
      throw err;
    }
    return team;
  }

  async rename(orgId: string, id: string, name: string) {
    await this.assertTeam(orgId, id);
    try {
      return await this.repo.rename(id, name);
    } catch (err) {
      if (prismaErrorCode(err) === 'P2002') throw new ConflictException('A team with that name already exists');
      throw err;
    }
  }

  async deleteTeam(orgId: string, id: string) {
    await this.assertTeam(orgId, id);
    const releasedClients = await this.repo.countClients(id);
    await this.repo.delete(id);
    return { releasedClients };
  }

  async setClients(actor: AuthPrincipal, teamId: string, optionIds: string[], move: boolean) {
    await this.assertTeam(actor.orgId, teamId);
    const owners = (await this.repo.ownersOf(optionIds)).filter((o) => o.teamId !== teamId);
    if (owners.length && !move) {
      throw new ConflictException({
        message: 'Some clients belong to another team',
        conflicts: owners.map((o) => ({ optionId: o.optionId, teamId: o.team.id, teamName: o.team.name })),
      });
    }
    try {
      await this.repo.replaceClients(teamId, optionIds, actor.userId, move);
    } catch (err) {
      const code = prismaErrorCode(err);
      if (code === 'P2003') throw new BadRequestException('One or more client option ids do not exist');
      if (code === 'P2002') throw new ConflictException('Some clients belong to another team');
      throw err;
    }
    return {
      clients: optionIds.length,
      moved: owners.map((o) => ({ optionId: o.optionId, fromTeamId: o.team.id })),
    };
  }

  async addMember(actor: AuthPrincipal, teamId: string, userId: string, role: TeamRole) {
    await this.assertTeam(actor.orgId, teamId);
    await this.assertMemberCandidate(actor, userId);
    return this.repo.addMember(teamId, userId, role, actor.userId);
  }

  async setMemberRole(orgId: string, teamId: string, userId: string, role: TeamRole) {
    await this.assertTeam(orgId, teamId);
    return this.repo.setMemberRole(teamId, userId, role);
  }

  async removeMember(orgId: string, teamId: string, userId: string) {
    await this.assertTeam(orgId, teamId);
    return this.repo.removeMember(teamId, userId);
  }

  async leadAddMember(scope: AccessScope, actor: AuthPrincipal, teamId: string, userId: string) {
    if (isUnrestricted(scope) && scope.canEdit) {
      // Owner/Admin using this endpoint: still an org-scoped id, so 404 (not a bare
      // Forbidden) on a team from another org.
      await this.assertTeam(actor.orgId, teamId);
    } else if (!(scope.kind === 'scoped' && scope.ledTeamIds.includes(teamId))) {
      // A scoped lead's `ledTeamIds` come only from their own TeamMember rows, which
      // are inherently within their own org — no separate org check needed there.
      throw new ForbiddenException('Team lead access required');
    }

    await this.assertMemberCandidate(actor, userId);
    return this.repo.addMember(teamId, userId, 'MEMBER', actor.userId);
  }

  async readiness(orgId: string) {
    const [unassignedClients, membersWithoutTeam, usersWithoutClickupLink, allOptions] =
      await this.repo.readinessData(orgId);
    const teamsByName = new Map<string, Set<string>>();
    for (const o of allOptions as { name: string; team: { id: string } | null }[]) {
      if (!o.team) continue;
      const ids = teamsByName.get(o.name) ?? new Set<string>();
      ids.add(o.team.id);
      teamsByName.set(o.name, ids);
    }
    const ambiguousNames = [...teamsByName.entries()].filter(([, ids]) => ids.size >= 2).map(([name]) => name);
    return { unassignedClients, membersWithoutTeam, usersWithoutClickupLink, ambiguousNames };
  }

  /** R20/R33: the caller's own memberships, plus candidates for teams they LEAD.
   *  Never cost, or other members' ClickUp ids outside a team the caller LEADS —
   *  `clickupUserId` is populated only for members of a led team (so a lead can
   *  link to a member's timesheet); for a team the caller merely belongs to,
   *  every member's `clickupUserId` comes back null.
   *
   *  "Led" is derived from the membership rows, not from `scope.ledTeamIds`:
   *  an unrestricted caller (Owner/Admin, or ANY caller while the flag is off —
   *  `resolveScope` gives both `{ kind: 'unrestricted' }`) has no `ledTeamIds`
   *  on their scope, but if they happen to hold a LEAD membership row they must
   *  still get the timesheet link and lead-only `candidates` a scoped LEAD gets.
   *  Scope only narrows a MEMBER; it must never take away from an unrestricted
   *  caller what their own membership rows already grant. */
  async myTeams(actor: AuthPrincipal, scope: AccessScope) {
    const memberships = await this.repo.membershipsOf(actor.userId);
    const ledTeamIds = isUnrestricted(scope)
      ? memberships.filter((m) => m.role === 'LEAD').map((m) => m.team.id)
      : scope.ledTeamIds;
    const teams = memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      role: m.role,
      clients: m.team.clients.map((c) => c.option.name),
      members: m.team.members.map((mm) => ({
        userId: mm.user.id,
        name: mm.user.name,
        email: mm.user.email,
        clickupUserId: ledTeamIds.includes(m.team.id) ? mm.user.clickupUserId : null,
        role: mm.role,
      })),
    }));

    let candidates: { id: string; name: string | null; email: string }[] = [];
    if (ledTeamIds.length) {
      const alreadyMembers = new Set(
        teams.filter((t) => ledTeamIds.includes(t.id)).flatMap((t) => t.members.map((mm) => mm.userId)),
      );
      const users = await this.repo.activeOrgUsers(actor.orgId);
      candidates = users
        .filter((u) => !alreadyMembers.has(u.id))
        .map((u) => ({ id: u.id, name: u.name, email: u.email }));
    }

    return { teams, candidates };
  }
}

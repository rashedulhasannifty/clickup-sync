import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, TeamRole } from '@prisma/client';
import { AccessScope, isUnrestricted } from '../access/access-scope';
import { AuthPrincipal } from '../auth/auth.types';
import { UserRepository } from '../auth/user.repository';
import { TeamsRepository } from './teams.repository';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class TeamsService {
  constructor(
    private readonly repo: TeamsRepository,
    private readonly users: UserRepository,
  ) {}

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
      if (isUniqueViolation(err)) throw new ConflictException('A team with that name already exists');
      throw err;
    }
    try {
      await this.setClients(actor, team.id, optionIds, false);
    } catch (err) {
      // A conflicting client set must never leave a half-made team behind.
      await this.repo.delete(team.id);
      throw err;
    }
    return team;
  }

  async rename(id: string, name: string) {
    try {
      return await this.repo.rename(id, name);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A team with that name already exists');
      throw err;
    }
  }

  async deleteTeam(id: string) {
    const releasedClients = await this.repo.countClients(id);
    await this.repo.delete(id);
    return { releasedClients };
  }

  async setClients(actor: AuthPrincipal, teamId: string, optionIds: string[], move: boolean) {
    const owners = (await this.repo.ownersOf(optionIds)).filter((o) => o.teamId !== teamId);
    if (owners.length && !move) {
      throw new ConflictException({
        message: 'Some clients belong to another team',
        conflicts: owners.map((o) => ({ optionId: o.optionId, teamId: o.team.id, teamName: o.team.name })),
      });
    }
    await this.repo.replaceClients(teamId, optionIds, actor.userId);
    return {
      clients: optionIds.length,
      moved: owners.map((o) => ({ optionId: o.optionId, fromTeamId: o.team.id })),
    };
  }

  addMember(teamId: string, userId: string, role: TeamRole, addedBy: string) {
    return this.repo.addMember(teamId, userId, role, addedBy);
  }

  setMemberRole(teamId: string, userId: string, role: TeamRole) {
    return this.repo.setMemberRole(teamId, userId, role);
  }

  removeMember(teamId: string, userId: string) {
    return this.repo.removeMember(teamId, userId);
  }

  async leadAddMember(scope: AccessScope, actor: AuthPrincipal, teamId: string, userId: string) {
    const allowed =
      (isUnrestricted(scope) && scope.canEdit) || (scope.kind === 'scoped' && scope.ledTeamIds.includes(teamId));
    if (!allowed) throw new ForbiddenException('Team lead access required');

    const user = await this.users.findById(userId);
    if (!user || user.orgId !== actor.orgId || user.status !== 'ACTIVE') {
      throw new BadRequestException('User not found or inactive');
    }
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

  /** R20: the caller's own memberships, plus candidates for teams they LEAD. Never
   *  cost, other people's ClickUp ids, or teams the caller isn't in. */
  async myTeams(actor: AuthPrincipal, scope: AccessScope) {
    const memberships = await this.repo.membershipsOf(actor.userId);
    const teams = memberships.map((m) => ({
      id: m.team.id,
      name: m.team.name,
      role: m.role,
      clients: m.team.clients.map((c) => c.option.name),
      members: m.team.members.map((mm) => ({ userId: mm.user.id, name: mm.user.name, email: mm.user.email })),
    }));

    const ledTeamIds = scope.kind === 'scoped' ? scope.ledTeamIds : [];
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

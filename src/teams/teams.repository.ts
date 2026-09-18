import { Injectable } from '@nestjs/common';
import { TeamRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listFull(orgId: string) {
    return this.prisma.team.findMany({
      where: { orgId },
      orderBy: { name: 'asc' },
      include: {
        clients: { include: { option: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, clickupUserId: true, status: true } } },
        },
        invitations: { include: { invitation: { select: { id: true, email: true, status: true } } } },
      },
    });
  }

  /** Org-scoped existence check — used to 404 (not 403) a team id from another org. */
  findInOrg(id: string, orgId: string) {
    return this.prisma.team.findFirst({ where: { id, orgId }, select: { id: true } });
  }

  create(orgId: string, name: string) {
    return this.prisma.team.create({ data: { orgId, name } });
  }

  rename(id: string, name: string) {
    return this.prisma.team.update({ where: { id }, data: { name } });
  }

  countClients(teamId: string) {
    return this.prisma.teamClient.count({ where: { teamId } });
  }

  // Cascades clients/members/invitation_teams (see prisma/schema.prisma onDelete: Cascade).
  delete(id: string) {
    return this.prisma.team.delete({ where: { id } });
  }

  ownersOf(optionIds: string[]) {
    return this.prisma.teamClient.findMany({
      where: { optionId: { in: optionIds } },
      include: { team: { select: { id: true, name: true } } },
    });
  }

  /**
   * Replace a team's client set atomically. The "steal" clause (deleting another
   * team's claim on an option so this team can take it) only runs when `move` is
   * true — otherwise a concurrent move elsewhere must never be silently undone by
   * this call. `createMany` deliberately omits `skipDuplicates`: it's built only
   * from options not already on this team, so any concurrent claim on the same
   * option (optionId is TeamClient's PK) surfaces as P2002 instead of a silent
   * no-op, and the caller turns that into a 409.
   */
  async replaceClients(teamId: string, optionIds: string[], addedBy: string, move: boolean) {
    const existing = await this.prisma.teamClient.findMany({
      where: { teamId, optionId: { in: optionIds } },
      select: { optionId: true },
    });
    const alreadyOnTeam = new Set(existing.map((e) => e.optionId));
    const toInsert = optionIds.filter((id) => !alreadyOnTeam.has(id));

    return this.prisma.$transaction([
      this.prisma.teamClient.deleteMany({
        where: move
          ? {
              OR: [
                { teamId, optionId: { notIn: optionIds } },
                { optionId: { in: optionIds }, teamId: { not: teamId } },
              ],
            }
          : { teamId, optionId: { notIn: optionIds } },
      }),
      this.prisma.teamClient.createMany({
        data: toInsert.map((optionId) => ({ optionId, teamId, addedBy })),
      }),
    ]);
  }

  addMember(teamId: string, userId: string, role: TeamRole, addedBy: string) {
    return this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId, role, addedBy },
      update: {}, // idempotent: never silently change an existing role here
    });
  }

  setMemberRole(teamId: string, userId: string, role: TeamRole) {
    return this.prisma.teamMember.update({ where: { teamId_userId: { teamId, userId } }, data: { role } });
  }

  removeMember(teamId: string, userId: string) {
    return this.prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });
  }

  membershipsOf(userId: string) {
    return this.prisma.teamMember.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            clients: { include: { option: true } },
            members: { include: { user: { select: { id: true, name: true, email: true } } } },
          },
        },
      },
    });
  }

  /** Active users in an org, for the lead add-member candidate list. */
  activeOrgUsers(orgId: string) {
    return this.prisma.user.findMany({
      where: { orgId, status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  teamNames(ids: string[]) {
    return this.prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  }

  readinessData(orgId: string) {
    return Promise.all([
      this.prisma.clickupClientOption.findMany({ where: { archived: false, team: null }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({
        where: { orgId, role: 'MEMBER', status: 'ACTIVE', teamMemberships: { none: {} } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.user.findMany({
        where: { orgId, status: 'ACTIVE', clickupUserId: null },
        select: { id: true, name: true, email: true },
      }),
      // archived:false here too — an archived duplicate name must not report a live name as ambiguous.
      this.prisma.clickupClientOption.findMany({ where: { archived: false }, include: { team: true } }),
    ]);
  }
}

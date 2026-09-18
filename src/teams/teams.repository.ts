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

  /** Replace a team's client set atomically; moved options are deleted from their old team first. */
  replaceClients(teamId: string, optionIds: string[], addedBy: string) {
    return this.prisma.$transaction([
      this.prisma.teamClient.deleteMany({
        where: {
          OR: [
            { teamId, optionId: { notIn: optionIds } },
            { optionId: { in: optionIds }, teamId: { not: teamId } },
          ],
        },
      }),
      this.prisma.teamClient.createMany({
        data: optionIds.map((optionId) => ({ optionId, teamId, addedBy })),
        skipDuplicates: true,
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
      this.prisma.clickupClientOption.findMany({ include: { team: true } }),
    ]);
  }
}

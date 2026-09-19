import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuthPrincipal } from '../auth/auth.types';
import {
  AccessScope,
  canEditChargeability,
  isLeadAnywhere,
  isUnrestricted,
  resolveScope,
  timesheetUserIds,
} from './access-scope';

export interface AccessSummary {
  scopingEnabled: boolean;
  unrestricted: boolean;
  teams: { id: string; name: string; role: 'LEAD' | 'MEMBER' }[];
  canSeeCost: boolean;
  canSeeSprints: boolean;
  canEditChargeability: boolean;
  hasClickupLink: boolean;
  timesheetUserIds: string[] | null;
}

@Injectable()
export class AccessScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Resolved fresh on every call — membership changes apply to the very next request. */
  async forPrincipal(p: AuthPrincipal): Promise<AccessScope> {
    const scopingEnabled = this.settings.isTeamScopingEnabled();
    if (p.isMachine || p.role !== 'MEMBER' || !scopingEnabled) {
      return resolveScope({
        role: p.role,
        scopingEnabled,
        selfClickupId: null,
        memberships: [],
        teamClients: [],
        teamMembers: [],
      });
    }
    const [user, memberships] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: p.userId }, select: { clickupUserId: true } }),
      this.prisma.teamMember.findMany({ where: { userId: p.userId }, select: { teamId: true, role: true } }),
    ]);
    const teamIds = memberships.map((m) => m.teamId);
    const ledIds = memberships.filter((m) => m.role === 'LEAD').map((m) => m.teamId);
    const [teamClients, ledMembers] = await Promise.all([
      this.prisma.teamClient.findMany({ where: { teamId: { in: teamIds } }, select: { teamId: true, optionId: true } }),
      ledIds.length
        ? this.prisma.teamMember.findMany({
            where: { teamId: { in: ledIds } },
            select: { teamId: true, user: { select: { clickupUserId: true } } },
          })
        : Promise.resolve([] as { teamId: string; user: { clickupUserId: string | null } }[]),
    ]);
    return resolveScope({
      role: 'MEMBER',
      scopingEnabled,
      selfClickupId: user?.clickupUserId ?? null,
      memberships,
      teamClients,
      teamMembers: ledMembers.map((m) => ({ teamId: m.teamId, clickupUserId: m.user.clickupUserId })),
    });
  }

  async summary(p: AuthPrincipal, s: AccessScope): Promise<AccessSummary> {
    const teams = p.isMachine
      ? []
      : await this.prisma.teamMember.findMany({
          where: { userId: p.userId },
          select: { role: true, team: { select: { id: true, name: true } } },
          orderBy: { team: { name: 'asc' } },
        });
    const user = p.isMachine
      ? null
      : await this.prisma.user.findUnique({ where: { id: p.userId }, select: { clickupUserId: true } });
    const unrestricted = isUnrestricted(s);
    return {
      scopingEnabled: this.settings.isTeamScopingEnabled(),
      unrestricted,
      teams: teams.map((t) => ({ id: t.team.id, name: t.team.name, role: t.role })),
      canSeeCost: unrestricted || isLeadAnywhere(s),
      canSeeSprints: unrestricted || isLeadAnywhere(s),
      canEditChargeability: unrestricted ? canEditChargeability(s, null) : isLeadAnywhere(s),
      hasClickupLink: !!user?.clickupUserId,
      timesheetUserIds: timesheetUserIds(s),
    };
  }
}

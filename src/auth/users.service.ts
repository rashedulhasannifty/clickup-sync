import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { UserRepository } from './user.repository';
import { PermissionsService } from './permissions.service';
import { SessionService } from './session.service';
import { AuthPrincipal } from './auth.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly perms: PermissionsService,
    private readonly sessions: SessionService,
  ) {}

  list(orgId: string) {
    return this.users.listByOrg(orgId);
  }

  private async require(actor: AuthPrincipal, id: string) {
    const u = await this.users.findById(id);
    // Scope by the actor's org: a user in a different org must be unaddressable
    // (looks "not found"), never manageable. Latent today under the single seed
    // org, but a hard horizontal-privilege boundary the moment multi-org lands.
    if (!u || u.orgId !== actor.orgId) throw new NotFoundException('User not found');
    return u;
  }

  async changeRole(actor: AuthPrincipal, targetId: string, desired: Role) {
    const target = await this.require(actor, targetId);
    if (!this.perms.canAssignRole(actor.role, target.role, desired)) {
      throw new ForbiddenException('You cannot assign that role.');
    }
    if (target.role === Role.OWNER && desired !== Role.OWNER) {
      const owners = await this.users.countOwners(target.orgId);
      if (this.perms.wouldRemoveLastOwner(target.role, owners)) {
        throw new BadRequestException('Cannot demote the last owner.');
      }
    }
    return this.users.update(targetId, { role: desired });
  }

  async setStatus(actor: AuthPrincipal, targetId: string, status: 'ACTIVE' | 'DISABLED') {
    const target = await this.require(actor, targetId);
    if (!this.perms.canManageUser(actor.role, target.role)) {
      throw new ForbiddenException('You cannot manage this user.');
    }
    if (status === 'DISABLED' && target.role === Role.OWNER) {
      const owners = await this.users.countOwners(target.orgId);
      if (this.perms.wouldRemoveLastOwner(target.role, owners)) {
        throw new BadRequestException('Cannot disable the last owner.');
      }
    }
    if (status === 'DISABLED') await this.sessions.revokeAll(targetId);
    return this.users.update(targetId, { status });
  }

  async remove(actor: AuthPrincipal, targetId: string) {
    const target = await this.require(actor, targetId);
    if (!this.perms.canManageUser(actor.role, target.role)) {
      throw new ForbiddenException('You cannot remove this user.');
    }
    if (target.role === Role.OWNER) {
      const owners = await this.users.countOwners(target.orgId);
      if (this.perms.wouldRemoveLastOwner(target.role, owners)) {
        throw new BadRequestException('Cannot remove the last owner.');
      }
    }
    await this.sessions.revokeAll(targetId);
    await this.users.delete(targetId);
    return { ok: true };
  }

  async transferOwnership(actor: AuthPrincipal, targetId: string) {
    if (actor.role !== Role.OWNER) throw new ForbiddenException('Only an owner can transfer ownership.');
    // Self-transfer would run update(self, OWNER) then update(self, ADMIN) and
    // net-demote the sole owner to ADMIN — leaving the org with ZERO owners.
    if (targetId === actor.userId) throw new BadRequestException('You already own this org.');
    const target = await this.require(actor, targetId); // org-scoped + existence
    // Don't hand ownership to a disabled account, or the org's only owner becomes
    // one that can't log in.
    if (target.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Cannot transfer ownership to a disabled user.');
    }
    await this.users.update(targetId, { role: Role.OWNER });
    await this.users.update(actor.userId, { role: Role.ADMIN });
    return { ok: true, newOwnerId: target.id };
  }
}

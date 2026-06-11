import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Pure RBAC rules for the permission matrix. No I/O — callers pass in the
 * actor's role and the relevant target facts. Owner > Admin > Member.
 */
@Injectable()
export class PermissionsService {
  /** Can `actor` change a user currently at `current` to `desired`? */
  canAssignRole(actor: Role, current: Role, desired: Role): boolean {
    if (actor === Role.OWNER) return true;
    if (actor === Role.ADMIN) {
      const within = (r: Role) => r === Role.MEMBER || r === Role.ADMIN;
      return within(current) && within(desired);
    }
    return false;
  }

  /** Can `actor` remove/disable a user whose role is `target`? */
  canManageUser(actor: Role, target: Role): boolean {
    if (actor === Role.OWNER) return true;
    if (actor === Role.ADMIN) return target === Role.MEMBER || target === Role.ADMIN;
    return false;
  }

  /** Can `actor` create an invitation for `role`? Owners are never invited. */
  canInviteWithRole(actor: Role, role: Role): boolean {
    if (role === Role.OWNER) return false;
    return actor === Role.OWNER || actor === Role.ADMIN;
  }

  /** True when changing/removing an OWNER would drop the org below one owner. */
  wouldRemoveLastOwner(targetRole: Role, currentOwnerCount: number): boolean {
    return targetRole === Role.OWNER && currentOwnerCount <= 1;
  }
}

import { Role } from '@prisma/client';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  const p = new PermissionsService();

  describe('canAssignRole', () => {
    const cases: Array<[Role, Role, Role, boolean]> = [
      [Role.OWNER, Role.MEMBER, Role.ADMIN, true],
      [Role.OWNER, Role.ADMIN, Role.OWNER, true],
      [Role.ADMIN, Role.MEMBER, Role.ADMIN, true],
      [Role.ADMIN, Role.ADMIN, Role.MEMBER, true],
      [Role.ADMIN, Role.MEMBER, Role.OWNER, false],
      [Role.ADMIN, Role.OWNER, Role.MEMBER, false],
      [Role.MEMBER, Role.MEMBER, Role.ADMIN, false],
    ];
    it.each(cases)('actor=%s current=%s desired=%s => %s', (actor, current, desired, allowed) => {
      expect(p.canAssignRole(actor, current, desired)).toBe(allowed);
    });
  });

  describe('canManageUser (remove/disable)', () => {
    it('owner can manage an admin', () => {
      expect(p.canManageUser(Role.OWNER, Role.ADMIN)).toBe(true);
    });
    it('admin can manage a member', () => {
      expect(p.canManageUser(Role.ADMIN, Role.MEMBER)).toBe(true);
    });
    it('admin cannot manage an owner', () => {
      expect(p.canManageUser(Role.ADMIN, Role.OWNER)).toBe(false);
    });
    it('member can manage nobody', () => {
      expect(p.canManageUser(Role.MEMBER, Role.MEMBER)).toBe(false);
    });
  });

  describe('canInviteWithRole', () => {
    it('admin can invite admin and member', () => {
      expect(p.canInviteWithRole(Role.ADMIN, Role.ADMIN)).toBe(true);
      expect(p.canInviteWithRole(Role.ADMIN, Role.MEMBER)).toBe(true);
    });
    it('nobody can invite an owner', () => {
      expect(p.canInviteWithRole(Role.OWNER, Role.OWNER)).toBe(false);
    });
    it('member cannot invite', () => {
      expect(p.canInviteWithRole(Role.MEMBER, Role.MEMBER)).toBe(false);
    });
  });

  describe('isLastOwnerBlocking', () => {
    it('blocks demoting/removing when only one owner remains', () => {
      expect(p.wouldRemoveLastOwner(Role.OWNER, 1)).toBe(true);
      expect(p.wouldRemoveLastOwner(Role.OWNER, 2)).toBe(false);
      expect(p.wouldRemoveLastOwner(Role.ADMIN, 1)).toBe(false);
    });
  });
});

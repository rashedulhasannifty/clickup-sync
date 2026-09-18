import { ForbiddenException } from '@nestjs/common';
import { resolveScope } from './access-scope';
import { requireLead, requireLeadView, requireUnrestricted } from './scope.decorator';

const mk = (role: 'LEAD' | 'MEMBER' | null) =>
  resolveScope({
    role: 'MEMBER',
    scopingEnabled: true,
    selfClickupId: null,
    memberships: role ? [{ teamId: 'A', role }] : [],
    teamClients: [],
    teamMembers: [],
  });

describe('scope assertions', () => {
  it('requireLead passes for a lead, throws for a plain member', () => {
    expect(() => requireLead(mk('LEAD'))).not.toThrow();
    expect(() => requireLead(mk('MEMBER'))).toThrow(ForbiddenException);
  });
  it('requireLead throws for flag-off MEMBER (unrestricted but cannot edit)', () => {
    const s = resolveScope({
      role: 'MEMBER',
      scopingEnabled: false,
      selfClickupId: null,
      memberships: [],
      teamClients: [],
      teamMembers: [],
    });
    expect(() => requireLead(s)).toThrow(ForbiddenException);
  });
  it('requireUnrestricted throws for any scoped user', () => {
    expect(() => requireUnrestricted(mk('LEAD'))).toThrow(ForbiddenException);
  });
});

describe('requireLeadView', () => {
  it('passes for a lead', () => {
    expect(() => requireLeadView(mk('LEAD'))).not.toThrow();
  });
  it('passes for OWNER/ADMIN (unrestricted, canEdit true)', () => {
    const s = resolveScope({
      role: 'OWNER',
      scopingEnabled: true,
      selfClickupId: null,
      memberships: [],
      teamClients: [],
      teamMembers: [],
    });
    expect(() => requireLeadView(s)).not.toThrow();
  });
  it('passes for a flag-off MEMBER (unrestricted, canEdit false)', () => {
    const s = resolveScope({
      role: 'MEMBER',
      scopingEnabled: false,
      selfClickupId: null,
      memberships: [],
      teamClients: [],
      teamMembers: [],
    });
    expect(() => requireLeadView(s)).not.toThrow();
  });
  it('throws for a scoped plain member', () => {
    expect(() => requireLeadView(mk('MEMBER'))).toThrow(ForbiddenException);
  });
  it('throws for a scoped user with no teams', () => {
    expect(() => requireLeadView(mk(null))).toThrow(ForbiddenException);
  });
});

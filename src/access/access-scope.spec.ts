import {
  resolveScope,
  visibleClientIds,
  leadClientIds,
  canSeeCost,
  canEditChargeability,
  isLeadAnywhere,
  timesheetUserIds,
  ScopeInputs,
} from './access-scope';

const base: ScopeInputs = {
  role: 'MEMBER',
  scopingEnabled: true,
  selfClickupId: 'cu-me',
  memberships: [],
  teamClients: [],
  teamMembers: [],
};

describe('resolveScope', () => {
  it('OWNER and ADMIN are unrestricted and can edit', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const s = resolveScope({ ...base, role });
      expect(s).toEqual({ kind: 'unrestricted', canEdit: true });
      expect(canSeeCost(s, null)).toBe(true);
      expect(canEditChargeability(s, 'x')).toBe(true);
      expect(timesheetUserIds(s)).toBeNull();
    }
  });

  it('flag off: MEMBER reads everything (incl. cost) but cannot edit — exactly today', () => {
    const s = resolveScope({ ...base, scopingEnabled: false });
    expect(s).toEqual({ kind: 'unrestricted', canEdit: false });
    expect(visibleClientIds(s)).toBeNull();
    expect(canSeeCost(s, 'any')).toBe(true);
    expect(canEditChargeability(s, 'any')).toBe(false);
  });

  it('MEMBER with no teams sees nothing (default deny)', () => {
    const s = resolveScope(base);
    expect(visibleClientIds(s)).toEqual([]);
    expect(leadClientIds(s)).toEqual([]);
    expect(isLeadAnywhere(s)).toBe(false);
    expect(timesheetUserIds(s)).toEqual(['cu-me']);
  });

  it('plain member: sees team clients, no cost, no edit', () => {
    const s = resolveScope({
      ...base,
      memberships: [{ teamId: 'A', role: 'MEMBER' }],
      teamClients: [{ teamId: 'A', optionId: 'acme' }],
    });
    expect(visibleClientIds(s)).toEqual(['acme']);
    expect(leadClientIds(s)).toEqual([]);
    expect(canSeeCost(s, 'acme')).toBe(false);
    expect(canEditChargeability(s, 'acme')).toBe(false);
    expect(timesheetUserIds(s)).toEqual(['cu-me']);
  });

  it('lead of A and member of B: per-client rights', () => {
    const s = resolveScope({
      ...base,
      memberships: [
        { teamId: 'A', role: 'LEAD' },
        { teamId: 'B', role: 'MEMBER' },
      ],
      teamClients: [
        { teamId: 'A', optionId: 'acme' },
        { teamId: 'B', optionId: 'bolt' },
      ],
      teamMembers: [
        { teamId: 'A', clickupUserId: 'cu-1' },
        { teamId: 'A', clickupUserId: null },
        { teamId: 'A', clickupUserId: 'cu-me' },
      ],
    });
    expect(visibleClientIds(s)!.sort()).toEqual(['acme', 'bolt']);
    expect(leadClientIds(s)).toEqual(['acme']);
    expect(canSeeCost(s, 'acme')).toBe(true);
    expect(canSeeCost(s, 'bolt')).toBe(false);
    expect(canSeeCost(s, null)).toBe(false);
    expect(canEditChargeability(s, 'bolt')).toBe(false);
    expect(isLeadAnywhere(s)).toBe(true);
    expect(timesheetUserIds(s)!.sort()).toEqual(['cu-1', 'cu-me']);
  });

  it('LEAD wins when the same client is reachable through two memberships', () => {
    const s = resolveScope({
      ...base,
      memberships: [
        { teamId: 'A', role: 'MEMBER' },
        { teamId: 'A2', role: 'LEAD' },
      ],
      teamClients: [
        { teamId: 'A', optionId: 'acme' },
        { teamId: 'A2', optionId: 'acme' },
      ],
    });
    expect(canSeeCost(s, 'acme')).toBe(true);
  });

  it('a user with no ClickUp link has an empty own timesheet set, but keeps led members', () => {
    const s = resolveScope({
      ...base,
      selfClickupId: null,
      memberships: [{ teamId: 'A', role: 'LEAD' }],
      teamMembers: [{ teamId: 'A', clickupUserId: 'cu-1' }],
    });
    expect(timesheetUserIds(s)).toEqual(['cu-1']);
  });
});

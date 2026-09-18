import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminTasksController } from './admin-tasks.controller';
import { AuthPrincipal } from '../auth/auth.types';
import { AccessScope } from '../access/access-scope';

// Unrestricted-with-canEdit: the pre-Task-14 Owner/Admin behaviour. Used as the
// default scope for tests that predate per-route scoping.
const unrestricted: AccessScope = { kind: 'unrestricted', canEdit: true };

describe('AdminTasksController', () => {
  function makeCtrl(over: {
    setChargeable?: jest.Mock;
    add?: jest.Mock;
    list?: jest.Mock;
    setOverride?: jest.Mock;
    assertTasks?: jest.Mock;
    assertEntries?: jest.Mock;
  } = {}) {
    const add = over.add ?? jest.fn();
    const queues = { get: () => ({ add }), defaultJobOptions: () => ({}) } as never;
    const repo = { setChargeable: over.setChargeable ?? jest.fn().mockResolvedValue({ count: 2 }) } as never;
    const rules = { setRule: jest.fn(), clearRule: jest.fn(), list: over.list ?? jest.fn().mockResolvedValue({ items: [], total: 0 }) } as never;
    const setChargeableOverride = over.setOverride ?? jest.fn().mockResolvedValue({ changed: ['e1', 'e2'] });
    const entries = { setChargeableOverride } as never;
    const access = {
      assertTasks: over.assertTasks ?? jest.fn().mockResolvedValue(undefined),
      assertEntries: over.assertEntries ?? jest.fn().mockResolvedValue(undefined),
    } as never;
    return {
      ctrl: new AdminTasksController(queues, repo, rules, entries, access),
      add, repo,
      rules: rules as never as { list: jest.Mock },
      setChargeableOverride,
      access: access as never as { assertTasks: jest.Mock; assertEntries: jest.Mock },
    };
  }

  describe('setEntryChargeableOverride', () => {
    it('writes the override and recalcs ONLY the entries that changed', async () => {
      const { ctrl, add, setChargeableOverride } = makeCtrl({
        // 'e3' was already non-chargeable, so the repository reports two.
        setOverride: jest.fn().mockResolvedValue({ changed: ['e1', 'e2'] }),
      });

      const res = await ctrl.setEntryChargeableOverride({ timeEntryIds: ['e1', 'e2', 'e3'], chargeable: false }, unrestricted);

      expect(setChargeableOverride).toHaveBeenCalledWith(['e1', 'e2', 'e3'], false);
      // The job names the CHANGED ids, not the requested ones — re-costing an
      // untouched entry is wasted work and a misleading job log.
      expect(add.mock.calls[0][1]).toEqual({ timeEntryIds: ['e1', 'e2'] });
      expect(res).toEqual({ updated: 2, requested: 3, queued: true });
    });

    it('clears an override', async () => {
      const { ctrl, setChargeableOverride } = makeCtrl();
      await ctrl.setEntryChargeableOverride({ timeEntryIds: ['e1'], chargeable: null }, unrestricted);
      expect(setChargeableOverride).toHaveBeenCalledWith(['e1'], null);
    });

    // Nothing changed means no stored cost can have changed either.
    it('skips the recalc when nothing changed', async () => {
      const { ctrl, add } = makeCtrl({ setOverride: jest.fn().mockResolvedValue({ changed: [] }) });
      const res = await ctrl.setEntryChargeableOverride({ timeEntryIds: ['e1'], chargeable: true }, unrestricted);
      expect(add).not.toHaveBeenCalled();
      expect(res).toEqual({ updated: 0, requested: 1, queued: false });
    });

    // Also guarded by the DTO; kept here so a direct service call can't bypass it.
    it('rejects a batch over the cap', async () => {
      const { ctrl } = makeCtrl();
      const ids = Array.from({ length: 501 }, (_, i) => `e${i}`);
      await expect(ctrl.setEntryChargeableOverride({ timeEntryIds: ids, chargeable: false }, unrestricted))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    // Flag-off parity: a flag-off MEMBER is unrestricted-with-canEdit:false, and
    // must still be 403'd exactly as an unauthenticated write was before Task 14.
    it('rejects a flag-off MEMBER', async () => {
      const flagOff: AccessScope = { kind: 'unrestricted', canEdit: false };
      const assertEntries = jest.fn().mockRejectedValue(new ForbiddenException('Not allowed to change chargeability'));
      const { ctrl, add } = makeCtrl({ assertEntries });
      await expect(ctrl.setEntryChargeableOverride({ timeEntryIds: ['e1'], chargeable: false }, flagOff))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(add).not.toHaveBeenCalled();
    });
  });

  it('sets the flag and enqueues a recalc scoped to those tasks', async () => {
    const { ctrl, add, repo } = makeCtrl();

    const res = await ctrl.setChargeable({ taskIds: ['t1', 't2'], chargeable: false }, unrestricted);

    expect((repo as never as { setChargeable: jest.Mock }).setChargeable).toHaveBeenCalledWith(['t1', 't2'], false);
    expect(add.mock.calls[0][1]).toEqual({ taskIds: ['t1', 't2'] });
    expect(res).toEqual({ updated: 2, requested: 2, queued: true });
  });

  it('skips the recalc when nothing actually changed', async () => {
    const { ctrl, add } = makeCtrl({ setChargeable: jest.fn().mockResolvedValue({ count: 0 }) });

    const res = await ctrl.setChargeable({ taskIds: ['t1'], chargeable: true }, unrestricted);

    expect(add).not.toHaveBeenCalled();
    expect(res).toEqual({ updated: 0, requested: 1, queued: false });
  });

  it('rejects more than 500 task ids', async () => {
    const { ctrl } = makeCtrl();
    const taskIds = Array.from({ length: 501 }, (_, i) => `t${i}`);

    await expect(ctrl.setChargeable({ taskIds, chargeable: false }, unrestricted)).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('lead scoping', () => {
    // Same lead scope shape as ChargeabilityAccessService.spec: a lead of team A
    // (client 'acme'), a mere MEMBER of team B (client 'bolt').
    const lead: AccessScope = {
      kind: 'scoped',
      clients: new Map([['acme', 'LEAD'], ['bolt', 'MEMBER']]),
      ledUserClickupIds: [],
      selfClickupId: null,
      ledTeamIds: ['A'],
    };

    it("an out-of-scope bulk request leaves tasksRepo.setChargeable and queues.get().add uncalled", async () => {
      const assertTasks = jest.fn().mockRejectedValue(new ForbiddenException('Not allowed to change chargeability for one or more items'));
      const { ctrl, add, repo } = makeCtrl({ assertTasks });

      await expect(ctrl.setChargeable({ taskIds: ['t1', 't2'], chargeable: false }, lead)).rejects.toBeInstanceOf(ForbiddenException);

      expect((repo as never as { setChargeable: jest.Mock }).setChargeable).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it('an in-scope request enqueues RECALCULATE_COSTS with the same payload as before', async () => {
      const assertTasks = jest.fn().mockResolvedValue(undefined);
      const { ctrl, add, repo } = makeCtrl({ assertTasks });

      const res = await ctrl.setChargeable({ taskIds: ['t1', 't2'], chargeable: false }, lead);

      expect(assertTasks).toHaveBeenCalledWith(lead, ['t1', 't2']);
      expect((repo as never as { setChargeable: jest.Mock }).setChargeable).toHaveBeenCalledWith(['t1', 't2'], false);
      expect(add.mock.calls[0][1]).toEqual({ taskIds: ['t1', 't2'] });
      expect(res).toEqual({ updated: 2, requested: 2, queued: true });
    });
  });

  describe('setAssigneeChargeable', () => {
    function makeRuleCtrl(over: { setRule?: jest.Mock; clearRule?: jest.Mock; assertTasks?: jest.Mock } = {}) {
      const add = jest.fn();
      const queues = { get: () => ({ add }), defaultJobOptions: () => ({}) } as never;
      const tasksRepo = { setChargeable: jest.fn() } as never;
      const rules = {
        setRule: over.setRule ?? jest.fn().mockResolvedValue({ changed: true }),
        clearRule: over.clearRule ?? jest.fn().mockResolvedValue({ changed: true }),
      } as never;
      const entries = { setChargeableOverride: jest.fn().mockResolvedValue({ changed: [] }) } as never;
      const access = { assertTasks: over.assertTasks ?? jest.fn().mockResolvedValue(undefined), assertEntries: jest.fn() } as never;
      return { ctrl: new AdminTasksController(queues, tasksRepo, rules, entries, access), add, rules };
    }

    const user: AuthPrincipal = {
      userId: 'u-admin',
      orgId: 'org1',
      role: Role.ADMIN,
      email: 'admin@example.com',
      isMachine: false,
    };
    const machineUser: AuthPrincipal = {
      userId: 'machine',
      orgId: 'org1',
      role: Role.OWNER,
      email: null,
      isMachine: true,
    };

    it('sets the rule and enqueues a recalc scoped to that assignee on that task', async () => {
      const { ctrl, add, rules } = makeRuleCtrl();

      const res = await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: false }, user, unrestricted);

      expect((rules as never as { setRule: jest.Mock }).setRule).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 't1', userId: 'u1', chargeable: false }),
      );
      // Both scopes: the recalc service ANDs them, so only this assignee's
      // entries on this task are re-costed.
      expect(add.mock.calls[0][1]).toEqual({ assigneeId: 'u1', taskIds: ['t1'] });
      expect(res).toEqual({ changed: true, queued: true });
    });

    it('clears the rule when chargeable is null', async () => {
      const { ctrl, rules } = makeRuleCtrl();
      await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: null }, user, unrestricted);
      expect((rules as never as { clearRule: jest.Mock }).clearRule).toHaveBeenCalledWith('t1', 'u1');
    });

    it('skips the recalc when nothing changed', async () => {
      const { ctrl, add } = makeRuleCtrl({ setRule: jest.fn().mockResolvedValue({ changed: false }) });
      const res = await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: false }, user, unrestricted);
      expect(add).not.toHaveBeenCalled();
      expect(res).toEqual({ changed: false, queued: false });
    });

    // Defect fix 1: an omitted note must stay `undefined` through to the repository,
    // never coerced to `null` — `null` means "clear the note" there.
    it('passes an omitted note through as undefined, not coerced to null', async () => {
      const { ctrl, rules } = makeRuleCtrl();
      await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: false }, user, unrestricted);
      expect((rules as never as { setRule: jest.Mock }).setRule).toHaveBeenCalledWith(
        expect.objectContaining({ note: undefined }),
      );
    });

    // Defect fix 1: a note-only edit (chargeable value unchanged) must not enqueue
    // a recalculation job, since `changed` gates the job and stored cost can't have moved.
    it('does not enqueue a recalc for a note-only edit', async () => {
      const { ctrl, add } = makeRuleCtrl({ setRule: jest.fn().mockResolvedValue({ changed: false }) });
      const res = await ctrl.setAssigneeChargeable(
        't1',
        { userId: 'u1', chargeable: false, note: 'updated note text' },
        user,
        unrestricted,
      );
      expect(add).not.toHaveBeenCalled();
      expect(res).toEqual({ changed: false, queued: false });
    });

    // Defect fix 2: setBy must be populated from the authenticated principal.
    it('populates setBy from the authenticated user email', async () => {
      const { ctrl, rules } = makeRuleCtrl();
      await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: true }, user, unrestricted);
      expect((rules as never as { setRule: jest.Mock }).setRule).toHaveBeenCalledWith(
        expect.objectContaining({ setBy: 'admin@example.com' }),
      );
    });

    // Defect fix 2: the machine principal has no email, so setBy falls back to userId ('machine').
    it('falls back to userId for setBy when the principal has no email (machine key)', async () => {
      const { ctrl, rules } = makeRuleCtrl();
      await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: true }, machineUser, unrestricted);
      expect((rules as never as { setRule: jest.Mock }).setRule).toHaveBeenCalledWith(
        expect.objectContaining({ setBy: 'machine' }),
      );
    });
  });

  describe('listChargeabilityRules', () => {
    it('defaults to the first 50', async () => {
      const { ctrl, rules } = makeCtrl();
      await ctrl.listChargeabilityRules(unrestricted);
      expect(rules.list).toHaveBeenCalledWith({ limit: 50, offset: 0, clientOptionIds: null });
    });

    it('passes through an explicit page', async () => {
      const { ctrl, rules } = makeCtrl();
      await ctrl.listChargeabilityRules(unrestricted, '25', '75');
      expect(rules.list).toHaveBeenCalledWith({ limit: 25, offset: 75, clientOptionIds: null });
    });

    // Query strings are user input: a huge limit is a denial-of-service in
    // waiting, and a negative offset is a Prisma error rather than a page.
    it.each([
      ['9999', '0', 500, 0],
      ['0', '0', 50, 0],
      ['-5', '-10', 50, 0],
      ['abc', 'xyz', 50, 0],
    ])('clamps limit=%s offset=%s', async (limit, offset, wantLimit, wantOffset) => {
      const { ctrl, rules } = makeCtrl();
      await ctrl.listChargeabilityRules(unrestricted, limit, offset);
      expect(rules.list).toHaveBeenCalledWith({ limit: wantLimit, offset: wantOffset, clientOptionIds: null });
    });

    // Flag-off parity: a flag-off MEMBER is unrestricted-with-canEdit:false and
    // is not a lead anywhere, so it is 403'd exactly as before Task 14.
    it('rejects a flag-off MEMBER', async () => {
      const flagOff: AccessScope = { kind: 'unrestricted', canEdit: false };
      const { ctrl } = makeCtrl();
      expect(() => ctrl.listChargeabilityRules(flagOff)).toThrow(ForbiddenException);
    });

    it('filters to the LEAD clients for a scoped lead', async () => {
      const lead: AccessScope = {
        kind: 'scoped',
        clients: new Map([['acme', 'LEAD'], ['bolt', 'MEMBER']]),
        ledUserClickupIds: [],
        selfClickupId: null,
        ledTeamIds: ['A'],
      };
      const { ctrl, rules } = makeCtrl();
      await ctrl.listChargeabilityRules(lead);
      expect(rules.list).toHaveBeenCalledWith({ limit: 50, offset: 0, clientOptionIds: ['acme'] });
    });
  });

});

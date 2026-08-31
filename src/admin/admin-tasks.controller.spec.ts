import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminTasksController } from './admin-tasks.controller';
import { AuthPrincipal } from '../auth/auth.types';

describe('AdminTasksController', () => {
  function makeCtrl(over: { setChargeable?: jest.Mock; add?: jest.Mock; list?: jest.Mock } = {}) {
    const add = over.add ?? jest.fn();
    const queues = { get: () => ({ add }), defaultJobOptions: () => ({}) } as never;
    const repo = { setChargeable: over.setChargeable ?? jest.fn().mockResolvedValue({ count: 2 }) } as never;
    const rules = { setRule: jest.fn(), clearRule: jest.fn(), list: over.list ?? jest.fn().mockResolvedValue({ items: [], total: 0 }) } as never;
    return { ctrl: new AdminTasksController(queues, repo, rules), add, repo, rules: rules as never as { list: jest.Mock } };
  }

  it('sets the flag and enqueues a recalc scoped to those tasks', async () => {
    const { ctrl, add, repo } = makeCtrl();

    const res = await ctrl.setChargeable({ taskIds: ['t1', 't2'], chargeable: false });

    expect((repo as never as { setChargeable: jest.Mock }).setChargeable).toHaveBeenCalledWith(['t1', 't2'], false);
    expect(add.mock.calls[0][1]).toEqual({ taskIds: ['t1', 't2'] });
    expect(res).toEqual({ updated: 2, requested: 2, queued: true });
  });

  it('skips the recalc when nothing actually changed', async () => {
    const { ctrl, add } = makeCtrl({ setChargeable: jest.fn().mockResolvedValue({ count: 0 }) });

    const res = await ctrl.setChargeable({ taskIds: ['t1'], chargeable: true });

    expect(add).not.toHaveBeenCalled();
    expect(res).toEqual({ updated: 0, requested: 1, queued: false });
  });

  it('rejects more than 500 task ids', async () => {
    const { ctrl } = makeCtrl();
    const taskIds = Array.from({ length: 501 }, (_, i) => `t${i}`);

    await expect(ctrl.setChargeable({ taskIds, chargeable: false })).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('setAssigneeChargeable', () => {
    function makeRuleCtrl(over: { setRule?: jest.Mock; clearRule?: jest.Mock } = {}) {
      const add = jest.fn();
      const queues = { get: () => ({ add }), defaultJobOptions: () => ({}) } as never;
      const tasksRepo = { setChargeable: jest.fn() } as never;
      const rules = {
        setRule: over.setRule ?? jest.fn().mockResolvedValue({ changed: true }),
        clearRule: over.clearRule ?? jest.fn().mockResolvedValue({ changed: true }),
      } as never;
      return { ctrl: new AdminTasksController(queues, tasksRepo, rules), add, rules };
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

      const res = await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: false }, user);

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
      await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: null }, user);
      expect((rules as never as { clearRule: jest.Mock }).clearRule).toHaveBeenCalledWith('t1', 'u1');
    });

    it('skips the recalc when nothing changed', async () => {
      const { ctrl, add } = makeRuleCtrl({ setRule: jest.fn().mockResolvedValue({ changed: false }) });
      const res = await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: false }, user);
      expect(add).not.toHaveBeenCalled();
      expect(res).toEqual({ changed: false, queued: false });
    });

    // Defect fix 1: an omitted note must stay `undefined` through to the repository,
    // never coerced to `null` — `null` means "clear the note" there.
    it('passes an omitted note through as undefined, not coerced to null', async () => {
      const { ctrl, rules } = makeRuleCtrl();
      await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: false }, user);
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
      );
      expect(add).not.toHaveBeenCalled();
      expect(res).toEqual({ changed: false, queued: false });
    });

    // Defect fix 2: setBy must be populated from the authenticated principal.
    it('populates setBy from the authenticated user email', async () => {
      const { ctrl, rules } = makeRuleCtrl();
      await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: true }, user);
      expect((rules as never as { setRule: jest.Mock }).setRule).toHaveBeenCalledWith(
        expect.objectContaining({ setBy: 'admin@example.com' }),
      );
    });

    // Defect fix 2: the machine principal has no email, so setBy falls back to userId ('machine').
    it('falls back to userId for setBy when the principal has no email (machine key)', async () => {
      const { ctrl, rules } = makeRuleCtrl();
      await ctrl.setAssigneeChargeable('t1', { userId: 'u1', chargeable: true }, machineUser);
      expect((rules as never as { setRule: jest.Mock }).setRule).toHaveBeenCalledWith(
        expect.objectContaining({ setBy: 'machine' }),
      );
    });
  });

  describe('listChargeabilityRules', () => {
    it('defaults to the first 50', async () => {
      const { ctrl, rules } = makeCtrl();
      await ctrl.listChargeabilityRules();
      expect(rules.list).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    });

    it('passes through an explicit page', async () => {
      const { ctrl, rules } = makeCtrl();
      await ctrl.listChargeabilityRules('25', '75');
      expect(rules.list).toHaveBeenCalledWith({ limit: 25, offset: 75 });
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
      await ctrl.listChargeabilityRules(limit, offset);
      expect(rules.list).toHaveBeenCalledWith({ limit: wantLimit, offset: wantOffset });
    });
  });

});

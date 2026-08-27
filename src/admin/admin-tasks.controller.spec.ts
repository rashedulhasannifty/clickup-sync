import { BadRequestException } from '@nestjs/common';
import { AdminTasksController } from './admin-tasks.controller';

describe('AdminTasksController', () => {
  function makeCtrl(over: { setChargeable?: jest.Mock; add?: jest.Mock } = {}) {
    const add = over.add ?? jest.fn();
    const queues = { get: () => ({ add }), defaultJobOptions: () => ({}) } as never;
    const repo = { setChargeable: over.setChargeable ?? jest.fn().mockResolvedValue({ count: 2 }) } as never;
    return { ctrl: new AdminTasksController(queues, repo), add, repo };
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
});

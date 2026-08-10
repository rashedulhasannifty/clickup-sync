import { RatesService } from './rates.service';
import { JOBS } from '../queues/queue.constants';

function makeDeps(autoRecalc = true) {
  const created = { id: '1', assigneeId: 'u1', assigneeName: null, assigneeEmail: null, currency: 'AUD', hourlyRateCents: 100, validFrom: new Date(), validTo: null, updatedAt: new Date() };
  const repo = {
    create: jest.fn().mockResolvedValue(created),
    createWithSuccession: jest.fn().mockResolvedValue(created),
    update: jest.fn().mockResolvedValue({ ...created, assigneeId: 'u2' }),
    remove: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue({ ...created, assigneeId: 'u3' }),
  };
  const add = jest.fn().mockResolvedValue(undefined);
  const queues = { get: jest.fn().mockReturnValue({ add }), defaultJobOptions: jest.fn().mockReturnValue({}) };
  const settings = { getPreferences: () => ({ cost: { autoRecalcOnRateChange: autoRecalc } }) } as any;
  return { svc: new RatesService(repo as any, queues as any, settings), repo, queues, add };
}

describe('RatesService', () => {
  it('create writes via succession then enqueues a scoped recalculation', async () => {
    const { svc, repo, add } = makeDeps();
    const r = await svc.create({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 100, validFrom: new Date() } as any);
    expect(repo.createWithSuccession).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(JOBS.RECALCULATE_COSTS, { assigneeId: 'u1' }, {});
    expect(r.assigneeId).toBe('u1');
  });

  it('propagates a blocked create and does NOT enqueue recalc', async () => {
    const { svc, repo, add } = makeDeps();
    (repo.createWithSuccession as jest.Mock).mockRejectedValueOnce(new Error('overlap'));
    await expect(svc.create({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 100, validFrom: new Date() } as any)).rejects.toThrow('overlap');
    expect(add).not.toHaveBeenCalled();
  });

  it('update enqueues for the updated rate\'s assignee', async () => {
    const { svc, add } = makeDeps();
    await svc.update(5n, { hourlyRateCents: 200 });
    expect(add).toHaveBeenCalledWith(JOBS.RECALCULATE_COSTS, { assigneeId: 'u2' }, {});
  });

  it('remove looks up the assignee, deletes, then enqueues', async () => {
    const { svc, repo, add } = makeDeps();
    await svc.remove(7n);
    expect(repo.findById).toHaveBeenCalledWith(7n);
    expect(repo.remove).toHaveBeenCalledWith(7n);
    expect(add).toHaveBeenCalledWith(JOBS.RECALCULATE_COSTS, { assigneeId: 'u3' }, {});
  });

  it('a failed enqueue does not throw (rate write already succeeded)', async () => {
    const { svc, add } = makeDeps();
    add.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.create({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 1, validFrom: new Date() } as any)).resolves.toBeDefined();
  });

  describe('auto-recalc toggle', () => {
    it('does NOT enqueue recalc on create when autoRecalcOnRateChange is false', async () => {
      const { svc, add } = makeDeps(false);
      await svc.create({ assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 100, validFrom: new Date() } as any);
      expect(add).not.toHaveBeenCalled();
    });

    it('does NOT enqueue recalc on update when autoRecalcOnRateChange is false', async () => {
      const { svc, add } = makeDeps(false);
      await svc.update(5n, { hourlyRateCents: 200 });
      expect(add).not.toHaveBeenCalled();
    });

    it('does NOT enqueue recalc on remove when autoRecalcOnRateChange is false', async () => {
      const { svc, add } = makeDeps(false);
      await svc.remove(7n);
      expect(add).not.toHaveBeenCalled();
    });
  });
});

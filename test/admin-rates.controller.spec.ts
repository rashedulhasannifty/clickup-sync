import { AdminRatesController } from '../src/admin/admin-rates.controller';

describe('AdminRatesController', () => {
  function makeQueuesWithAdd() {
    const add = jest.fn().mockResolvedValue({});
    const queues = { get: jest.fn().mockReturnValue({ add, getJobs: jest.fn().mockResolvedValue([]) }), defaultJobOptions: jest.fn().mockReturnValue({}), webhookJobOptions: jest.fn().mockReturnValue({}) } as any;
    return { queues, add };
  }

  function makeRatesRepo() {
    return {
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 }),
      update: jest.fn().mockResolvedValue({}),
    } as any;
  }

  function makeRatesService() {
    return {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  function makeSettings(excludedAssignees: any[] = []) {
    return {
      getPreferences: () => ({ cost: { excludedAssignees } }),
      update: jest.fn().mockResolvedValue({}),
    } as any;
  }

  function makeCtrl(over: Partial<{ queues: any; ratesRepo: any; ratesService: any; settings: any }> = {}) {
    return new AdminRatesController(
      over.queues ?? makeQueuesWithAdd().queues,
      over.ratesRepo ?? makeRatesRepo(),
      over.ratesService ?? makeRatesService(),
      over.settings ?? makeSettings(),
    );
  }

  describe('rates CRUD', () => {
    it('listRates delegates to ratesRepo.findAll (read path stays on the repo)', async () => {
      const ratesRepo = makeRatesRepo();
      await makeCtrl({ ratesRepo }).listRates(1, 50);
      expect(ratesRepo.findAll).toHaveBeenCalledWith(1, 50);
    });

    it('createRate calls ratesService.create (mutation seam) with parsed dates', async () => {
      const ratesService = makeRatesService();
      await makeCtrl({ ratesService }).createRate({
        assigneeId: 'u1', currency: 'AUD', hourlyRateCents: 15000, validFrom: '2024-01-01',
      } as any);
      expect(ratesService.create).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'u1', hourlyRateCents: 15000 }));
    });

    it('deleteRate calls ratesService.remove with parsed BigInt id', async () => {
      const ratesService = makeRatesService();
      await makeCtrl({ ratesService }).deleteRate('42');
      expect(ratesService.remove).toHaveBeenCalledWith(BigInt(42));
    });
  });

  describe('excluded-assignees', () => {
    const user = { email: 'admin@x.com' } as any;

    it('GET returns the stored list', () => {
      const ctrl = makeCtrl({ settings: makeSettings([{ id: 'u1', name: 'A', email: null }]) });
      expect(ctrl.listExcludedAssignees()).toEqual({ assignees: [{ id: 'u1', name: 'A', email: null }] });
    });

    it('PUT add-only enqueues the added id', async () => {
      const { queues, add } = makeQueuesWithAdd();
      const ctrl = makeCtrl({ queues, settings: makeSettings([]) });
      const result = await ctrl.updateExcludedAssignees({ assignees: [{ id: 'u1' }] } as any, user);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(expect.any(String), { assigneeId: 'u1' }, expect.any(Object));
      expect(result.recalculated).toContain('u1');
    });

    it('PUT remove-only enqueues the removed id', async () => {
      const { queues, add } = makeQueuesWithAdd();
      const ctrl = makeCtrl({ queues, settings: makeSettings([{ id: 'u1', name: 'A', email: null }]) });
      const result = await ctrl.updateExcludedAssignees({ assignees: [] } as any, user);
      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith(expect.any(String), { assigneeId: 'u1' }, expect.any(Object));
      expect(result.recalculated).toContain('u1');
      expect(result.assignees).toEqual([]);
    });

    it('PUT mixed enqueues only the added + removed ids, not the unchanged one', async () => {
      const { queues, add } = makeQueuesWithAdd();
      const ctrl = makeCtrl({ queues, settings: makeSettings([{ id: 'u1' }, { id: 'u2' }]) });
      await ctrl.updateExcludedAssignees({ assignees: [{ id: 'u2' }, { id: 'u3' }] } as any, user);
      expect(add).toHaveBeenCalledTimes(2);
      const enqueuedIds = new Set(add.mock.calls.map((c) => c[1].assigneeId));
      expect(enqueuedIds).toEqual(new Set(['u1', 'u3']));
    });

    it('PUT no-op (unchanged list) enqueues nothing', async () => {
      const { queues, add } = makeQueuesWithAdd();
      const ctrl = makeCtrl({ queues, settings: makeSettings([{ id: 'u1', name: 'A', email: null }]) });
      const result = await ctrl.updateExcludedAssignees({ assignees: [{ id: 'u1', name: 'A', email: null }] } as any, user);
      expect(add).not.toHaveBeenCalled();
      expect(result.recalculated).toEqual([]);
    });
  });
});

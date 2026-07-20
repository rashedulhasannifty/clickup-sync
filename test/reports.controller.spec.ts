import { BadRequestException } from '@nestjs/common';
import { ReportsController } from '../src/reports/reports.controller';

describe('ReportsController', () => {
  // Build a controller wiring the six report sub-services + settings + budgets.
  // Each `over` key replaces one collaborator; the rest are inert stubs. Keeps
  // call sites short and resilient to the constructor arg order.
  function makeCtrl(over: Partial<{
    tasks: any; timeEntries: any; costTrend: any; cycleTime: any; anomaly: any; ops: any; settings: any; budgets: any;
  }> = {}) {
    return new ReportsController(
      over.tasks ?? {},
      over.timeEntries ?? {},
      over.costTrend ?? { costTrend: jest.fn().mockResolvedValue([]) },
      over.cycleTime ?? {},
      over.anomaly ?? {},
      over.ops ?? {},
      over.settings ?? makeSettings(),
      over.budgets ?? makeBudgets(),
    );
  }

  function makeSettings(cap = 12, medianEnabled = true) {
    return {
      getSpikeHoursCap: jest.fn().mockReturnValue(cap),
      isSpikeMedianEnabled: jest.fn().mockReturnValue(medianEnabled),
    } as any;
  }

  function makeBudgets() {
    return { clientBudgetStatus: jest.fn().mockResolvedValue([]) } as any;
  }

  describe('overviewDeltas', () => {
    function makeTimeEntriesWithDeltas() {
      return {
        overviewDeltas: jest.fn().mockResolvedValue({
          current: { totalHours: 10, totalCostAud: 1000 },
          prior:   { totalHours: 8,  totalCostAud: 800 },
        }),
      } as any;
    }

    it('passes from/to through to the service', async () => {
      const timeEntries = makeTimeEntriesWithDeltas();
      const ctrl = makeCtrl({ timeEntries });
      await ctrl.overviewDeltas('2026-05-01', '2026-05-31');
      expect(timeEntries.overviewDeltas).toHaveBeenCalledWith('2026-05-01', '2026-05-31');
    });

    it('returns the service result unchanged', async () => {
      const timeEntries = makeTimeEntriesWithDeltas();
      const ctrl = makeCtrl({ timeEntries });
      const result = await ctrl.overviewDeltas();
      expect(result).toEqual({
        current: { totalHours: 10, totalCostAud: 1000 },
        prior:   { totalHours: 8,  totalCostAud: 800 },
      });
    });
  });

  describe('anomalies', () => {
    it('returns the service result unchanged', async () => {
      const anomaly = {
        anomalies: jest.fn().mockResolvedValue({
          dailySpikes: [{ date: '2026-05-04', totalCostAud: 1920, medianAud: 456, multiplier: 4.21 }],
          clientSpikes: [],
        }),
      } as any;
      const ctrl = makeCtrl({ anomaly });
      const result = await ctrl.anomalies();
      expect(anomaly.anomalies).toHaveBeenCalledTimes(1);
      expect(result.dailySpikes).toHaveLength(1);
      expect(result.clientSpikes).toEqual([]);
    });
  });

  describe('costTrend', () => {
    it('passes bucket + from + to through to the service for valid bucket', async () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      await ctrl.costTrend('day', '2026-05-01', '2026-05-21');
      expect(costTrend.costTrend).toHaveBeenCalledWith('day', '2026-05-01', '2026-05-21');
    });

    it('rejects bucket="hour" with BadRequestException', () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      expect(() => ctrl.costTrend('hour' as any)).toThrow(BadRequestException);
      expect(costTrend.costTrend).not.toHaveBeenCalled();
    });

    it('rejects missing bucket', () => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      expect(() => ctrl.costTrend(undefined as any)).toThrow(BadRequestException);
      expect(costTrend.costTrend).not.toHaveBeenCalled();
    });

    it.each(['day', 'week', 'month'] as const)('accepts bucket=%s', async (b) => {
      const costTrend = { costTrend: jest.fn().mockResolvedValue([]) } as any;
      const ctrl = makeCtrl({ costTrend });
      await ctrl.costTrend(b);
      expect(costTrend.costTrend).toHaveBeenCalledWith(b, undefined, undefined);
    });
  });

  describe('hourSpikes', () => {
    it('passes the settings cap + from/to into the service with default limit/includeResolved', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = makeCtrl({ anomaly, settings });
      const result = await ctrl.hourSpikes('2026-06-01', '2026-06-10');
      expect(settings.getSpikeHoursCap).toHaveBeenCalledTimes(1);
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false, true);
      expect(result.cap).toBe(10);
    });

    it('passes the cap, range, limit and includeResolved through', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = makeCtrl({ anomaly, settings });
      await ctrl.hourSpikes('2026-06-01', '2026-06-10', '40', 'true');
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 40, true, true);
    });

    it('forwards medianEnabled=false from settings into the service', async () => {
      const anomaly = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], watchlistTotal: 0, byUser: { buckets: [], users: [] } }) } as any;
      const ctrl = makeCtrl({ anomaly, settings: makeSettings(10, false) });
      await ctrl.hourSpikes('2026-06-01', '2026-06-10');
      expect(anomaly.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10', 20, false, false);
    });
  });

  describe('budgetStatus', () => {
    it('delegates to budgets.clientBudgetStatus with the given month', async () => {
      const budgets = makeBudgets();
      const ctrl = makeCtrl({ budgets });
      await ctrl.budgetStatus('2026-06');
      expect(budgets.clientBudgetStatus).toHaveBeenCalledWith({ month: '2026-06' });
    });

    it('passes undefined month when not supplied', async () => {
      const budgets = makeBudgets();
      const ctrl = makeCtrl({ budgets });
      await ctrl.budgetStatus();
      expect(budgets.clientBudgetStatus).toHaveBeenCalledWith({ month: undefined });
    });
  });
});

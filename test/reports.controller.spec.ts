import { BadRequestException } from '@nestjs/common';
import { ReportsController } from '../src/reports/reports.controller';

describe('ReportsController', () => {
  function makeService() {
    return {
      costTrend: jest.fn().mockResolvedValue([]),
    } as any;
  }

  function makeSettings(cap = 12) {
    return { getSpikeHoursCap: jest.fn().mockReturnValue(cap) } as any;
  }

  describe('overviewDeltas', () => {
    function makeServiceWithDeltas() {
      return {
        overviewDeltas: jest.fn().mockResolvedValue({
          current: { totalHours: 10, totalCostAud: 1000 },
          prior:   { totalHours: 8,  totalCostAud: 800 },
        }),
      } as any;
    }

    it('passes from/to through to the service', async () => {
      const svc = makeServiceWithDeltas();
      const ctrl = new ReportsController(svc, makeSettings());
      await ctrl.overviewDeltas('2026-05-01', '2026-05-31');
      expect(svc.overviewDeltas).toHaveBeenCalledWith('2026-05-01', '2026-05-31');
    });

    it('returns the service result unchanged', async () => {
      const svc = makeServiceWithDeltas();
      const ctrl = new ReportsController(svc, makeSettings());
      const result = await ctrl.overviewDeltas();
      expect(result).toEqual({
        current: { totalHours: 10, totalCostAud: 1000 },
        prior:   { totalHours: 8,  totalCostAud: 800 },
      });
    });
  });

  describe('anomalies', () => {
    it('returns the service result unchanged', async () => {
      const svc = {
        anomalies: jest.fn().mockResolvedValue({
          dailySpikes: [{ date: '2026-05-04', totalCostAud: 1920, medianAud: 456, multiplier: 4.21 }],
          clientSpikes: [],
        }),
      } as any;
      const ctrl = new ReportsController(svc, makeSettings());
      const result = await ctrl.anomalies();
      expect(svc.anomalies).toHaveBeenCalledTimes(1);
      expect(result.dailySpikes).toHaveLength(1);
      expect(result.clientSpikes).toEqual([]);
    });
  });

  describe('costTrend', () => {
    it('passes bucket + from + to through to the service for valid bucket', async () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc, makeSettings());
      await ctrl.costTrend('day', '2026-05-01', '2026-05-21');
      expect(svc.costTrend).toHaveBeenCalledWith('day', '2026-05-01', '2026-05-21');
    });

    it('rejects bucket="hour" with BadRequestException', () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc, makeSettings());
      expect(() => ctrl.costTrend('hour' as any)).toThrow(BadRequestException);
      expect(svc.costTrend).not.toHaveBeenCalled();
    });

    it('rejects missing bucket', () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc, makeSettings());
      expect(() => ctrl.costTrend(undefined as any)).toThrow(BadRequestException);
      expect(svc.costTrend).not.toHaveBeenCalled();
    });

    it.each(['day', 'week', 'month'] as const)('accepts bucket=%s', async (b) => {
      const svc = makeService();
      const ctrl = new ReportsController(svc, makeSettings());
      await ctrl.costTrend(b);
      expect(svc.costTrend).toHaveBeenCalledWith(b, undefined, undefined);
    });
  });

  describe('hourSpikes', () => {
    it('passes the settings cap + from/to into the service', async () => {
      const svc = { hourSpikes: jest.fn().mockResolvedValue({ cap: 10, watchlist: [], byUser: { buckets: [], users: [] } }) } as any;
      const settings = makeSettings(10);
      const ctrl = new ReportsController(svc, settings);
      const result = await ctrl.hourSpikes('2026-06-01', '2026-06-10');
      expect(settings.getSpikeHoursCap).toHaveBeenCalledTimes(1);
      expect(svc.hourSpikes).toHaveBeenCalledWith(10, '2026-06-01', '2026-06-10');
      expect(result.cap).toBe(10);
    });
  });
});

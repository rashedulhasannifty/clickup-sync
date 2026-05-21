import { BadRequestException } from '@nestjs/common';
import { ReportsController } from '../src/reports/reports.controller';

describe('ReportsController', () => {
  function makeService() {
    return {
      costTrend: jest.fn().mockResolvedValue([]),
    } as any;
  }

  describe('costTrend', () => {
    it('passes bucket + from + to through to the service for valid bucket', async () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc);
      await ctrl.costTrend('day', '2026-05-01', '2026-05-21');
      expect(svc.costTrend).toHaveBeenCalledWith('day', '2026-05-01', '2026-05-21');
    });

    it('rejects bucket="hour" with BadRequestException', () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc);
      expect(() => ctrl.costTrend('hour' as any)).toThrow(BadRequestException);
      expect(svc.costTrend).not.toHaveBeenCalled();
    });

    it('rejects missing bucket', () => {
      const svc = makeService();
      const ctrl = new ReportsController(svc);
      expect(() => ctrl.costTrend(undefined as any)).toThrow(BadRequestException);
      expect(svc.costTrend).not.toHaveBeenCalled();
    });

    it.each(['day', 'week', 'month'] as const)('accepts bucket=%s', async (b) => {
      const svc = makeService();
      const ctrl = new ReportsController(svc);
      await ctrl.costTrend(b);
      expect(svc.costTrend).toHaveBeenCalledWith(b, undefined, undefined);
    });
  });
});

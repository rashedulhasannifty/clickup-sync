import { CycleTimeReportService } from '../src/reports/cycle-time-report.service';

describe('CycleTimeReportService', () => {
  function makePrisma() {
    return { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
  }

  describe('cycleTime', () => {
    it('maps weekly raw rows to { bucket, meanHours, medianHours, p90Hours, taskCount, meta.minOccurredAt }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        // items
        .mockResolvedValueOnce([
          { bucket: '2026-05-04', mean_hours: 25.5, median_hours: 22.0, p90_hours: 48.0, task_count: BigInt(4) },
        ])
        // meta
        .mockResolvedValueOnce([{ min_occurred_at: new Date('2026-04-10T10:00:00Z') }]);
      const result = await new CycleTimeReportService(prisma).cycleTime({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'), groupBy: 'week',
      });
      expect(result.items[0]).toEqual({
        bucket: '2026-05-04', meanHours: 25.5, medianHours: 22.0, p90Hours: 48.0, taskCount: 4,
      });
      expect(result.meta.minOccurredAt).toBe('2026-04-10T10:00:00.000Z');
    });

    it('returns empty items + null meta when no events exist', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ min_occurred_at: null }]);
      const result = await new CycleTimeReportService(prisma).cycleTime({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'), groupBy: 'week',
      });
      expect(result.items).toEqual([]);
      expect(result.meta.minOccurredAt).toBeNull();
    });
  });

  describe('timeInStatus', () => {
    it('maps rows to { status, color, totalHours, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { status: 'in progress', color: '#3b82f6', total_hours: 124.5, task_count: BigInt(12) },
        ])
        .mockResolvedValueOnce([{ min_occurred_at: new Date('2026-04-10T10:00:00Z') }]);
      const result = await new CycleTimeReportService(prisma).timeInStatus({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'),
      });
      expect(result.items[0]).toEqual({
        status: 'in progress', color: '#3b82f6', totalHours: 124.5, taskCount: 12,
      });
    });
  });
});

import { CostTrendReportService } from '../src/reports/cost-trend-report.service';

describe('CostTrendReportService', () => {
  function makePrisma() {
    return { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
  }

  describe('costTrend', () => {
    it('maps raw rows to { bucket, totalCostAud, totalHours, entryCount } and sorts ascending', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { bucket: '2026-05-18', total_cost_cents: BigInt(120000), total_hours: 8,   entry_count: 4 },
        { bucket: '2026-05-19', total_cost_cents: BigInt(0),      total_hours: 0,   entry_count: 0 },
        { bucket: '2026-05-20', total_cost_cents: BigInt(45000),  total_hours: 3.5, entry_count: 2 },
      ]);
      const result = await new CostTrendReportService(prisma).costTrend('day');
      expect(result).toEqual([
        { bucket: '2026-05-18', totalCostAud: 1200, totalHours: 8,   entryCount: 4 },
        { bucket: '2026-05-19', totalCostAud: 0,    totalHours: 0,   entryCount: 0 },
        { bucket: '2026-05-20', totalCostAud: 450,  totalHours: 3.5, entryCount: 2 },
      ]);
    });

    it('throws on invalid bucket value', async () => {
      const prisma = makePrisma();
      await expect(new CostTrendReportService(prisma).costTrend('hour' as any))
        .rejects.toThrow(/bucket/i);
    });

    it("emits SQL containing date_trunc('day', ...) at Asia/Dhaka for bucket=day", async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new CostTrendReportService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/date_trunc\('day'/);
      expect(sqlText).toMatch(/Asia\/Dhaka/);
      expect(sqlText).not.toMatch(/Australia\/Sydney/);
    });

    it('emits the Sunday-shift week expression for bucket=week', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new CostTrendReportService(prisma).costTrend('week');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      // The Sunday-start trick: shift +1 day, truncate to ISO week (Monday),
      // shift back -1 day. We assert both halves of the shift are present.
      expect(sqlText).toMatch(/date_trunc\('week'/);
      expect(sqlText).toMatch(/\+ interval '1 day'/);
      expect(sqlText).toMatch(/- interval '1 day'/);
    });

    it("emits date_trunc('month', ...) for bucket=month", async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new CostTrendReportService(prisma).costTrend('month');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/date_trunc\('month'/);
    });

    it('uses generate_series so empty buckets are returned with zeros', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new CostTrendReportService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/generate_series/);
      expect(sqlText).toMatch(/LEFT JOIN/i);
    });

    it('filters out soft-deleted tasks', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new CostTrendReportService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/t\.is_deleted\s*=\s*false/);
    });
  });

  // Regression: `clickup_time_entries.start_time` is a `timestamptz`. Bucketing
  // it into a Dhaka calendar day needs a SINGLE `AT TIME ZONE 'Asia/Dhaka'`.
  describe('start_time Dhaka-day bucketing (timestamptz, single conversion)', () => {
    const sqlOf = (call: any): string => call.sql ?? call.text ?? String(call);
    const cases: Array<[string, (s: CostTrendReportService) => Promise<unknown>]> = [
      ['costTrend', (s) => s.costTrend('day')],
      ['costTrendByAssignee', (s) => s.costTrendByAssignee('day')],
    ];
    it.each(cases)('%s buckets start_time with single Asia/Dhaka conversion', async (_name, run) => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await run(new CostTrendReportService(prisma));
      const allSql = prisma.$queryRaw.mock.calls.map((c: any[]) => sqlOf(c[0])).join('\n---\n');
      expect(allSql).not.toMatch(/start_time\s+AT TIME ZONE 'UTC'/);
      expect(allSql).toMatch(/start_time\s+AT TIME ZONE 'Asia\/Dhaka'/);
    });
  });

  describe('costTrendByAssignee', () => {
    // The method issues two $queryRaw calls in order: (1) the bucket axis via
    // generate_series, (2) the per-(bucket, assignee) cost aggregate.
    function mockTwoQueries(prisma: any, buckets: any[], agg: any[]) {
      prisma.$queryRaw
        .mockResolvedValueOnce(buckets)
        .mockResolvedValueOnce(agg);
    }

    it('builds a continuous bucket axis with per-assignee dollar values', async () => {
      const prisma = makePrisma();
      mockTwoQueries(
        prisma,
        [{ bucket: '2026-05-18' }, { bucket: '2026-05-19' }, { bucket: '2026-05-20' }],
        [
          { bucket: '2026-05-18', segment: 'Alice', cost_cents: BigInt(120000) },
          { bucket: '2026-05-18', segment: 'Bob',   cost_cents: BigInt(40000) },
          { bucket: '2026-05-20', segment: 'Alice', cost_cents: BigInt(60000) },
        ],
      );
      const result = await new CostTrendReportService(prisma).costTrendByAssignee('day');
      expect(result.buckets).toEqual(['2026-05-18', '2026-05-19', '2026-05-20']);
      // Alice (1800 total) ranks above Bob (400).
      expect(result.assignees).toEqual(['Alice', 'Bob']);
      expect(result.points).toEqual([
        { bucket: '2026-05-18', values: { Alice: 1200, Bob: 400 } },
        { bucket: '2026-05-19', values: { Alice: 0,    Bob: 0 } },
        { bucket: '2026-05-20', values: { Alice: 600,  Bob: 0 } },
      ]);
    });

    it('returns every assignee (no "Other") by default, ordered by total cost', async () => {
      const prisma = makePrisma();
      // 10 assignees — more than the old default cap of 8 — none should collapse.
      const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
      mockTwoQueries(
        prisma,
        [{ bucket: '2026-05-18' }],
        names.map((n, idx) => ({
          bucket: '2026-05-18',
          segment: n,
          // Descending cost so the expected order is the input order.
          cost_cents: BigInt((names.length - idx) * 10000),
        })),
      );
      const result = await new CostTrendReportService(prisma).costTrendByAssignee('day');
      expect(result.assignees).toEqual(names);
      expect(result.assignees).not.toContain('Other');
    });

    it('collapses assignees beyond topN into an "Other" segment', async () => {
      const prisma = makePrisma();
      mockTwoQueries(
        prisma,
        [{ bucket: '2026-05-18' }],
        [
          { bucket: '2026-05-18', segment: 'A', cost_cents: BigInt(50000) },
          { bucket: '2026-05-18', segment: 'B', cost_cents: BigInt(40000) },
          { bucket: '2026-05-18', segment: 'C', cost_cents: BigInt(30000) },
        ],
      );
      const result = await new CostTrendReportService(prisma).costTrendByAssignee('day', undefined, undefined, 2);
      expect(result.assignees).toEqual(['A', 'B', 'Other']);
      expect(result.points[0].values).toEqual({ A: 500, B: 400, Other: 300 });
    });

    it('throws on an invalid bucket value', async () => {
      const prisma = makePrisma();
      await expect(new CostTrendReportService(prisma).costTrendByAssignee('hour' as any))
        .rejects.toThrow(/bucket/i);
    });

    it('emits generate_series for the axis and groups by bucket + assignee at Asia/Dhaka', async () => {
      const prisma = makePrisma();
      mockTwoQueries(prisma, [], []);
      await new CostTrendReportService(prisma).costTrendByAssignee('day');
      const axisSql: string = prisma.$queryRaw.mock.calls[0][0].sql ?? String(prisma.$queryRaw.mock.calls[0][0]);
      const aggSql: string  = prisma.$queryRaw.mock.calls[1][0].sql ?? String(prisma.$queryRaw.mock.calls[1][0]);
      expect(axisSql).toMatch(/generate_series/);
      expect(aggSql).toMatch(/GROUP BY 1, 2/);
      expect(aggSql).toMatch(/Asia\/Dhaka/);
      expect(aggSql).toMatch(/t\.is_deleted\s*=\s*false/);
    });
  });

  describe('costTrendByClient', () => {
    function mockTwoQueries(prisma: any, buckets: any[], agg: any[]) {
      prisma.$queryRaw
        .mockResolvedValueOnce(buckets)
        .mockResolvedValueOnce(agg);
    }

    it('builds a continuous bucket axis with per-client dollar values, ordered by cost', async () => {
      const prisma = makePrisma();
      mockTwoQueries(
        prisma,
        [{ bucket: '2026-05-18' }, { bucket: '2026-05-19' }, { bucket: '2026-05-20' }],
        [
          { bucket: '2026-05-18', segment: 'Acme',  cost_cents: BigInt(120000) },
          { bucket: '2026-05-18', segment: 'Globex', cost_cents: BigInt(40000) },
          { bucket: '2026-05-20', segment: 'Acme',  cost_cents: BigInt(60000) },
        ],
      );
      const result = await new CostTrendReportService(prisma).costTrendByClient('day');
      expect(result.buckets).toEqual(['2026-05-18', '2026-05-19', '2026-05-20']);
      // Acme (1800 total) ranks above Globex (400); no "Other" by default.
      expect(result.clients).toEqual(['Acme', 'Globex']);
      expect(result.clients).not.toContain('Other');
      expect(result.points).toEqual([
        { bucket: '2026-05-18', values: { Acme: 1200, Globex: 400 } },
        { bucket: '2026-05-19', values: { Acme: 0,    Globex: 0 } },
        { bucket: '2026-05-20', values: { Acme: 600,  Globex: 0 } },
      ]);
    });

    it('groups by the task client and coalesces empty client to "No client"', async () => {
      const prisma = makePrisma();
      mockTwoQueries(prisma, [], []);
      await new CostTrendReportService(prisma).costTrendByClient('day');
      const aggSql: string = prisma.$queryRaw.mock.calls[1][0].sql ?? String(prisma.$queryRaw.mock.calls[1][0]);
      expect(aggSql).toMatch(/t\.client/);
      expect(aggSql).toMatch(/No client/);
      expect(aggSql).toMatch(/GROUP BY 1, 2/);
      expect(aggSql).toMatch(/Asia\/Dhaka/);
    });

    it('throws on an invalid bucket value', async () => {
      const prisma = makePrisma();
      await expect(new CostTrendReportService(prisma).costTrendByClient('year' as any))
        .rejects.toThrow(/bucket/i);
    });
  });
});

import { AnomalyReportService } from '../src/reports/anomaly-report.service';

describe('AnomalyReportService', () => {
  function makePrisma(overrides: Partial<Record<string, any>> = {}) {
    const base = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      spikeNotification: { findMany: jest.fn().mockResolvedValue([]) },
      spikeResolution: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { ...base, ...overrides } as any;
  }

  describe('anomalies', () => {
    it('maps daily spike rows to { date, totalCostAud, medianAud, multiplier }', async () => {
      const prisma = makePrisma();
      // Two raw queries: daily, then client. Stub in order.
      prisma.$queryRaw
        .mockResolvedValueOnce([{
          date: '2026-05-04',
          total_cost_cents: BigInt(192000),
          median_cost_cents: 45600,
          multiplier: 4.21,
        }])
        .mockResolvedValueOnce([]);
      const result = await new AnomalyReportService(prisma).anomalies();
      expect(result.dailySpikes).toEqual([{
        date: '2026-05-04',
        totalCostAud: 1920,
        medianAud: 456,
        multiplier: 4.21,
      }]);
    });

    it('maps client spike rows to { client, lastWeekCostAud, baselineMedianAud, multiplier }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          client: 'Acme',
          week_cost_cents: BigInt(210000),
          baseline_median_cents: 67000,
          multiplier: 3.13,
        }]);
      const result = await new AnomalyReportService(prisma).anomalies();
      expect(result.clientSpikes).toEqual([{
        client: 'Acme',
        lastWeekCostAud: 2100,
        baselineMedianAud: 670,
        multiplier: 3.13,
      }]);
    });

    it('returns empty arrays when no spikes', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await new AnomalyReportService(prisma).anomalies();
      expect(result).toEqual({ dailySpikes: [], clientSpikes: [] });
    });

    it("daily query uses Asia/Dhaka, percentile_cont(0.5), $50 floor, 2x median, soft-delete filter", async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new AnomalyReportService(prisma).anomalies();
      const dailyCall = prisma.$queryRaw.mock.calls[0][0];
      const sql: string = dailyCall.sql ?? dailyCall.text ?? String(dailyCall);
      expect(sql).toMatch(/Asia\/Dhaka/);
      expect(sql).toMatch(/percentile_cont\(0\.5\)/);
      expect(sql).toMatch(/5000/);              // $50 floor in cents
      expect(sql).toMatch(/2\s*\*\s*m\.median/i);
      expect(sql).toMatch(/t\.is_deleted\s*=\s*false/);
    });

    it('client query uses Sunday-start week shift and 90-day baseline excluding last 7 days', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new AnomalyReportService(prisma).anomalies();
      const clientCall = prisma.$queryRaw.mock.calls[1][0];
      const sql: string = clientCall.sql ?? clientCall.text ?? String(clientCall);
      expect(sql).toMatch(/date_trunc\('week'/);
      expect(sql).toMatch(/\+ interval '1 day'/);
      expect(sql).toMatch(/- interval '1 day'/);
      expect(sql).toMatch(/interval '90 days'/);
      expect(sql).toMatch(/interval '7 days'/);
      expect(sql).toMatch(/t\.is_deleted\s*=\s*false/);
    });
  });

  // Regression: `clickup_time_entries.start_time` is a `timestamptz`. Bucketing
  // it into a Dhaka calendar day needs a SINGLE `AT TIME ZONE 'Asia/Dhaka'`.
  describe('start_time Dhaka-day bucketing (timestamptz, single conversion)', () => {
    const sqlOf = (call: any): string => call.sql ?? call.text ?? String(call);
    const cases: Array<[string, (s: AnomalyReportService) => Promise<unknown>]> = [
      ['hourSpikes', (s) => s.hourSpikes(8)],
      ['anomalies', (s) => s.anomalies()],
    ];
    it.each(cases)('%s buckets start_time with single Asia/Dhaka conversion', async (_name, run) => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await run(new AnomalyReportService(prisma));
      const allSql = prisma.$queryRaw.mock.calls.map((c: any[]) => sqlOf(c[0])).join('\n---\n');
      expect(allSql).not.toMatch(/start_time\s+AT TIME ZONE 'UTC'/);
      expect(allSql).toMatch(/start_time\s+AT TIME ZONE 'Asia\/Dhaka'/);
    });
  });

  describe('hourSpikes', () => {
    // Helper: stub the 3 raw queries in the order hourSpikes calls them.
    function stub(prisma: any, baseline: any[], display: any[], axis: string[]) {
      prisma.$queryRaw
        .mockResolvedValueOnce(baseline)
        .mockResolvedValueOnce(display)
        .mockResolvedValueOnce(axis.map((bucket) => ({ bucket })));
    }

    it('flags an absolute-only spike (over cap, under 2x median)', async () => {
      const prisma = makePrisma();
      // median(8,8,8) = 8 → 2x = 16; 14h is > cap(12) but < 16 → absolute only.
      stub(
        prisma,
        [
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-01', hours: 8 },
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-02', hours: 8 },
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-03', hours: 8 },
        ],
        [{ user_id: 'u1', user_name: 'Ann', day: '2026-06-10', hours: 14 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.cap).toBe(12);
      expect(r.watchlist).toHaveLength(1);
      expect(r.watchlist[0]).toMatchObject({ userId: 'u1', userName: 'Ann', date: '2026-06-10', hours: 14, rule: 'absolute' });
      expect(r.byUser.users[0].points[0]).toEqual({ date: '2026-06-10', hours: 14, isSpike: true });
    });

    it('flags a relative-only spike (over 2x median and >= 4h, under cap)', async () => {
      const prisma = makePrisma();
      // median(3,3,3) = 3 → 2x = 6; 7h > 6 and >= 4, and 7 < cap(12) → relative only.
      stub(
        prisma,
        [
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-01', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-02', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-03', hours: 3 },
        ],
        [{ user_id: 'u2', user_name: 'Bob', day: '2026-06-10', hours: 7 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist[0]).toMatchObject({ rule: 'relative', hours: 7, median: 3 });
      expect(r.watchlist[0].multiplier).toBeCloseTo(7 / 3, 4);
    });

    it('does not flag when the 4h floor suppresses a small-median spike', async () => {
      const prisma = makePrisma();
      // median(1,1,1) = 1 → 2x = 2; 3h > 2 but 3 < 4 floor, and 3 < cap → no spike.
      stub(
        prisma,
        [
          { user_id: 'u3', user_name: 'Cy', day: '2026-06-01', hours: 1 },
          { user_id: 'u3', user_name: 'Cy', day: '2026-06-02', hours: 1 },
          { user_id: 'u3', user_name: 'Cy', day: '2026-06-03', hours: 1 },
        ],
        [{ user_id: 'u3', user_name: 'Cy', day: '2026-06-10', hours: 3 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist).toHaveLength(0);
      expect(r.byUser.users[0].points[0].isSpike).toBe(false);
    });

    it('does not flag a normal day (neither rule)', async () => {
      const prisma = makePrisma();
      // median 6 → 2x = 12; 6h is < cap(12) and < 12 → no spike.
      stub(
        prisma,
        [
          { user_id: 'u4', user_name: 'Di', day: '2026-06-01', hours: 6 },
          { user_id: 'u4', user_name: 'Di', day: '2026-06-02', hours: 6 },
        ],
        [{ user_id: 'u4', user_name: 'Di', day: '2026-06-10', hours: 6 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist).toHaveLength(0);
    });

    it("classifies a day as 'both' when over cap and over 2x median", async () => {
      const prisma = makePrisma();
      // median(5,5) = 5 → 2x = 10; 15h > cap(12) and > 10 → both.
      stub(
        prisma,
        [
          { user_id: 'u5', user_name: 'Ed', day: '2026-06-01', hours: 5 },
          { user_id: 'u5', user_name: 'Ed', day: '2026-06-02', hours: 5 },
        ],
        [{ user_id: 'u5', user_name: 'Ed', day: '2026-06-10', hours: 15 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist[0].rule).toBe('both');
    });

    it('ranks the watchlist by raw hours descending and caps at 20', async () => {
      const prisma = makePrisma();
      const baseline: any[] = [];
      const display: any[] = [];
      const axis: string[] = [];
      // 25 distinct users, each one spike day with hours 100..76 (all over cap).
      for (let i = 0; i < 25; i++) {
        const day = `2026-06-${String(i + 1).padStart(2, '0')}`;
        display.push({ user_id: `u${i}`, user_name: `U${i}`, day, hours: 100 - i });
        axis.push(day);
      }
      stub(prisma, baseline, display, axis);
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-01', '2026-06-25');
      expect(r.watchlist).toHaveLength(20);
      expect(r.watchlist[0].hours).toBe(100);
      expect(r.watchlist[19].hours).toBe(81);
    });

    it('zero-fills days with no entries in each user series', async () => {
      const prisma = makePrisma();
      stub(
        prisma,
        [],
        [{ user_id: 'u6', user_name: 'Fi', day: '2026-06-02', hours: 5 }],
        ['2026-06-01', '2026-06-02', '2026-06-03'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-01', '2026-06-03');
      expect(r.byUser.buckets).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
      expect(r.byUser.users[0].points.map((p: any) => p.hours)).toEqual([0, 5, 0]);
    });

    it('computes an even-length median by averaging the two middle values', async () => {
      const prisma = makePrisma();
      // median(4,8) = 6 → 2x = 12; an 8h day is < cap(12) and < 12 → NOT a spike,
      // proving the median is 6 (not 4 or 8). A 13h day would be absolute via cap.
      stub(
        prisma,
        [
          { user_id: 'u7', user_name: 'Gwen', day: '2026-06-01', hours: 4 },
          { user_id: 'u7', user_name: 'Gwen', day: '2026-06-02', hours: 8 },
        ],
        [{ user_id: 'u7', user_name: 'Gwen', day: '2026-06-10', hours: 8 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist).toHaveLength(0);
    });

    it('reports multiplier null for a user with no baseline (median 0) flagged by the cap', async () => {
      const prisma = makePrisma();
      // No baseline rows → median 0 → relative rule cannot fire; 5h > cap(4) → absolute.
      stub(
        prisma,
        [],
        [{ user_id: 'u8', user_name: 'Hal', day: '2026-06-10', hours: 5 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(4, '2026-06-10', '2026-06-10');
      expect(r.watchlist).toHaveLength(1);
      expect(r.watchlist[0]).toMatchObject({ rule: 'absolute', median: 0, multiplier: null });
    });

    it('returns watchlistTotal and respects the limit', async () => {
      const prisma = makePrisma();
      const display: any[] = [];
      const axis: string[] = [];
      for (let i = 0; i < 25; i++) {
        const day = `2026-06-${String(i + 1).padStart(2, '0')}`;
        display.push({ user_id: `u${i}`, user_name: `U${i}`, day, hours: 100 - i });
        axis.push(day);
      }
      stub(prisma, [], display, axis);
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-01', '2026-06-25', 5);
      expect(r.watchlist).toHaveLength(5);
      expect(r.watchlistTotal).toBe(25);
      expect(r.watchlist[0].hours).toBe(100);
    });

    it('excludes resolved days by default and marks resolved=false on the rest', async () => {
      const prisma = makePrisma();
      stub(
        prisma,
        [],
        [
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-10', hours: 20 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-11', hours: 18 },
        ],
        ['2026-06-10', '2026-06-11'],
      );
      prisma.spikeResolution.findMany.mockResolvedValue([
        { clickupUserId: 'u1', spikeDate: new Date('2026-06-10T00:00:00.000Z') },
      ]);
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-01', '2026-06-30');
      expect(r.watchlist).toHaveLength(1);
      expect(r.watchlist[0]).toMatchObject({ userId: 'u2', resolved: false });
      expect(r.watchlistTotal).toBe(1);
    });

    it('includes resolved days (resolved=true) when includeResolved is set', async () => {
      const prisma = makePrisma();
      stub(
        prisma,
        [],
        [
          { user_id: 'u1', user_name: 'Ann', day: '2026-06-10', hours: 20 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-11', hours: 18 },
        ],
        ['2026-06-10', '2026-06-11'],
      );
      prisma.spikeResolution.findMany.mockResolvedValue([
        { clickupUserId: 'u1', spikeDate: new Date('2026-06-10T00:00:00.000Z') },
      ]);
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-01', '2026-06-30', 20, true);
      expect(r.watchlist).toHaveLength(2);
      expect(r.watchlist.find((w: any) => w.userId === 'u1')!.resolved).toBe(true);
      expect(r.watchlist.find((w: any) => w.userId === 'u2')!.resolved).toBe(false);
      expect(r.watchlistTotal).toBe(2);
    });

    it('removes a median-only spike when the median rule is disabled', async () => {
      const prisma = makePrisma();
      // relative-only spike: median(3,3,3)=3 → 2x=6; 7h > 6, >= 4, < cap(12).
      // With the median rule off, this day is no longer flagged at all.
      stub(
        prisma,
        [
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-01', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-02', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-03', hours: 3 },
        ],
        [{ user_id: 'u2', user_name: 'Bob', day: '2026-06-10', hours: 7 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10', 20, false, false);
      expect(r.watchlist).toHaveLength(0); // median-only day dropped from detection
      expect(r.byUser.users[0].points[0].isSpike).toBe(false); // and from the chart
    });

    it('keeps cap spikes when the median rule is disabled and strips their median fields', async () => {
      const prisma = makePrisma();
      // median(3,3,3)=3 → 2x=6; 7h is over 2x median AND over cap(4) → 'both' normally;
      // with the median rule off, the relative half drops and it is a plain cap spike.
      stub(
        prisma,
        [
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-01', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-02', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-03', hours: 3 },
        ],
        [{ user_id: 'u2', user_name: 'Bob', day: '2026-06-10', hours: 7 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(4, '2026-06-10', '2026-06-10', 20, false, false);
      expect(r.watchlist).toHaveLength(1);
      expect(r.watchlist[0]).toMatchObject({ rule: 'absolute', median: 0, multiplier: null });
    });

    it('flags a median-only spike with median fields when the rule is enabled (default)', async () => {
      const prisma = makePrisma();
      stub(
        prisma,
        [
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-01', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-02', hours: 3 },
          { user_id: 'u2', user_name: 'Bob', day: '2026-06-03', hours: 3 },
        ],
        [{ user_id: 'u2', user_name: 'Bob', day: '2026-06-10', hours: 7 }],
        ['2026-06-10'],
      );
      const r = await new AnomalyReportService(prisma).hourSpikes(12, '2026-06-10', '2026-06-10');
      expect(r.watchlist).toHaveLength(1);
      expect(r.watchlist[0]).toMatchObject({ rule: 'relative', median: 3 });
      expect(r.watchlist[0].multiplier).toBeCloseTo(7 / 3, 4);
    });
  });

  describe('hourSpikes notified enrichment', () => {
    it('marks a watchlist row notified when a SpikeNotification exists for it', async () => {
      const prisma = makePrisma();
      const day = '2026-06-10';
      // baseline rows (median), display rows (the spike day), axis rows (day series)
      prisma.$queryRaw
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 5 }])      // baseline
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 20 }])     // display
        .mockResolvedValueOnce([{ bucket: day }]);                                              // axis
      prisma.spikeNotification.findMany.mockResolvedValue([
        { clickupUserId: '123', spikeDate: new Date('2026-06-10T00:00:00.000Z') },
      ]);

      const res = await new AnomalyReportService(prisma).hourSpikes(12, day, day);
      expect(res.watchlist).toHaveLength(1);
      expect(res.watchlist[0]).toMatchObject({ userId: '123', date: day, notified: true });
    });

    it('leaves rows not-notified when no SpikeNotification matches', async () => {
      const prisma = makePrisma();
      const day = '2026-06-10';
      prisma.$queryRaw
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 5 }])
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 20 }])
        .mockResolvedValueOnce([{ bucket: day }]);
      // findMany defaults to [] from makePrisma
      const res = await new AnomalyReportService(prisma).hourSpikes(12, day, day);
      expect(res.watchlist[0].notified).toBe(false);
    });

    it('skips the notification lookup when there are no spikes', async () => {
      const prisma = makePrisma();
      const day = '2026-06-10';
      // baseline + display both have only a normal (non-spike) day, axis one bucket
      prisma.$queryRaw
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 5 }])  // baseline
        .mockResolvedValueOnce([{ user_id: '123', user_name: 'Rashedul', day, hours: 5 }])  // display (5h, under cap, not 2x median)
        .mockResolvedValueOnce([{ bucket: day }]);                                          // axis
      const res = await new AnomalyReportService(prisma).hourSpikes(12, day, day);
      expect(res.watchlist).toHaveLength(0);
      expect(prisma.spikeNotification.findMany).not.toHaveBeenCalled();
    });
  });
});

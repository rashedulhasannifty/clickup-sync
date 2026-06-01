import { ReportsService } from '../src/reports/reports.service';

describe('ReportsService', () => {
  function makePrisma(overrides: Partial<Record<string, any>> = {}) {
    const base = {
      clickupTask: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      clickupTimeEntry: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      syncCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      clickupWebhookEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      syncJobLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      deadLetterJob: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr)),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    return { ...base, ...overrides } as any;
  }

  describe('tasksSummary', () => {
    it('returns bySpace (collapsed by space_id via raw SQL), byStatus, byStatusType and total', async () => {
      const prisma = makePrisma();
      // bySpace now comes from $queryRaw so old tasks with NULL space_name
      // don't split into a second row; MAX(space_name) resolves the name.
      prisma.$queryRaw.mockResolvedValueOnce([
        { space_id: '3577824', space_name: 'Digital Marketing', count: BigInt(5) },
      ]);
      prisma.clickupTask.groupBy
        .mockResolvedValueOnce([{ status: 'in progress', _count: { taskId: 3 } }])
        .mockResolvedValueOnce([{ statusType: 'open', _count: { taskId: 4 } }]);
      prisma.clickupTask.count.mockResolvedValue(10);
      const result = await new ReportsService(prisma).tasksSummary();
      expect(result.total).toBe(10);
      expect(result.bySpace[0]).toEqual({ spaceId: '3577824', spaceName: 'Digital Marketing', count: 5 });
      expect(result.byStatus[0]).toEqual({ status: 'in progress', count: 3 });
      expect(result.byStatusType[0]).toEqual({ statusType: 'open', count: 4 });
    });
  });

  describe('tasksBySpaceStatus', () => {
    it('maps groupBy rows to spaceName, status, count', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.groupBy.mockResolvedValue([
        { spaceName: 'Projects', status: 'complete', _count: { taskId: 12 } },
      ]);
      const result = await new ReportsService(prisma).tasksBySpaceStatus();
      expect(result[0]).toEqual({ spaceName: 'Projects', status: 'complete', count: 12 });
    });
  });

  describe('tasksClients', () => {
    it('maps distinct client rows to { client, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { client: 'Acme Corp', task_count: BigInt(12) },
        { client: 'Globex', task_count: BigInt(3) },
      ]);
      const result = await new ReportsService(prisma).tasksClients();
      expect(result).toEqual([
        { client: 'Acme Corp', taskCount: 12 },
        { client: 'Globex', taskCount: 3 },
      ]);
    });

    it('excludes soft-deleted tasks and empty clients in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).tasksClients();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/client\s*<>\s*''/);
    });
  });

  describe('tasks (client filter)', () => {
    it('adds an exact client equality to the where clause when client is given', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBe('Acme Corp');
    });

    it('omits the client clause when client is undefined', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBeUndefined();
    });
  });

  describe('timeEntriesByUser', () => {
    it('converts durationHours.toNumber() and costCents BigInt to totalCostAud', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([{
        userId: 'u1', userName: 'Alice', userEmail: 'alice@x.com',
        _sum: { durationHours: { toNumber: () => 8 }, costCents: BigInt(120000) },
      }]);
      const result = await new ReportsService(prisma).timeEntriesByUser();
      expect(result[0].totalHours).toBe(8);
      expect(result[0].totalCostAud).toBe(1200);
    });

    it('handles null sums gracefully', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([{
        userId: 'u2', userName: null, userEmail: null,
        _sum: { durationHours: null, costCents: null },
      }]);
      const result = await new ReportsService(prisma).timeEntriesByUser();
      expect(result[0].totalHours).toBe(0);
      expect(result[0].totalCostAud).toBe(0);
    });
  });

  describe('timeEntriesBillableSummary', () => {
    it('separates billable and non-billable rows', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { billable: true, _sum: { durationHours: { toNumber: () => 10 }, costCents: BigInt(150000) } },
        { billable: false, _sum: { durationHours: { toNumber: () => 5 }, costCents: BigInt(0) } },
      ]);
      const result = await new ReportsService(prisma).timeEntriesBillableSummary();
      expect(result.billableHours).toBe(10);
      expect(result.billableCostAud).toBe(1500);
      expect(result.nonBillableHours).toBe(5);
      expect(result.nonBillableCostAud).toBe(0);
    });

    it('returns zeros when no entries exist', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([]);
      const result = await new ReportsService(prisma).timeEntriesBillableSummary();
      expect(result).toEqual({ billableHours: 0, nonBillableHours: 0, billableCostAud: 0, nonBillableCostAud: 0 });
    });
  });

  describe('timeEntriesByClient', () => {
    it('maps raw SQL result to client, totalHours, totalCostAud', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ client: 'Acme Corp', total_hours: 5.5, total_cost_cents: 82500 }]);
      const result = await new ReportsService(prisma).timeEntriesByClient();
      expect(result[0]).toEqual({ client: 'Acme Corp', totalHours: 5.5, totalCostAud: 825 });
    });

    it('excludes soft-deleted tasks from the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).timeEntriesByClient();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/t\.is_deleted\s*=\s*false/);
    });
  });

  describe('timeEntriesByDepartment', () => {
    it('maps raw SQL result to department, totalHours, totalCostAud', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ department: 'Engineering', total_hours: 20, total_cost_cents: 300000 }]);
      const result = await new ReportsService(prisma).timeEntriesByDepartment();
      expect(result[0]).toEqual({ department: 'Engineering', totalHours: 20, totalCostAud: 3000 });
    });
  });

  describe('sprintPoints', () => {
    it('maps groupBy to spaceName, status, totalPoints', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.groupBy.mockResolvedValue([
        { spaceName: 'R&D Apps', status: 'complete', _sum: { sprintPoints: 21 } },
      ]);
      const result = await new ReportsService(prisma).sprintPoints();
      expect(result[0]).toEqual({ spaceName: 'R&D Apps', status: 'complete', totalPoints: 21 });
    });

    it('defaults totalPoints to 0 when sum is null', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.groupBy.mockResolvedValue([{ spaceName: 'X', status: 'open', _sum: { sprintPoints: null } }]);
      const result = await new ReportsService(prisma).sprintPoints();
      expect(result[0].totalPoints).toBe(0);
    });
  });

  describe('syncHealth', () => {
    it('marks Stale when lastSuccessfulSyncAt is > 60 min ago', async () => {
      const prisma = makePrisma();
      prisma.syncCheckpoint.findMany.mockResolvedValue([
        { scopeId: '3577824', lastSuccessfulSyncAt: new Date(Date.now() - 90 * 60_000) },
      ]);
      const result = await new ReportsService(prisma).syncHealth();
      expect(result[0].spaceName).toBe('Digital Marketing');
      expect(result[0].status).toBe('Stale');
    });

    it('marks Fresh when lastSuccessfulSyncAt is < 60 min ago', async () => {
      const prisma = makePrisma();
      prisma.syncCheckpoint.findMany.mockResolvedValue([
        { scopeId: '3589129', lastSuccessfulSyncAt: new Date(Date.now() - 10 * 60_000) },
      ]);
      const result = await new ReportsService(prisma).syncHealth();
      expect(result[0].spaceName).toBe('R&D Apps');
      expect(result[0].status).toBe('Fresh');
    });

    it('marks Unknown when lastSuccessfulSyncAt is null', async () => {
      const prisma = makePrisma();
      prisma.syncCheckpoint.findMany.mockResolvedValue([
        { scopeId: '3525433', lastSuccessfulSyncAt: null },
      ]);
      const result = await new ReportsService(prisma).syncHealth();
      expect(result[0].spaceName).toBe('Projects');
      expect(result[0].status).toBe('Unknown');
      expect(result[0].ageMinutes).toBeNull();
    });

    it('uses scopeId as spaceName when not in CLICKUP_SPACES', async () => {
      const prisma = makePrisma();
      prisma.syncCheckpoint.findMany.mockResolvedValue([
        { scopeId: 'unknown-space', lastSuccessfulSyncAt: null },
      ]);
      const result = await new ReportsService(prisma).syncHealth();
      expect(result[0].spaceName).toBe('unknown-space');
    });
  });

  describe('webhookEvents', () => {
    it('serializes BigInt id to string and respects limit cap', async () => {
      const prisma = makePrisma();
      prisma.clickupWebhookEvent.findMany.mockResolvedValue([{ id: BigInt(42), eventType: 'taskCreated', taskId: 'abc', status: 'received', receivedAt: new Date(), processedAt: null }]);
      prisma.clickupWebhookEvent.count.mockResolvedValue(1);
      const result = await new ReportsService(prisma).webhookEvents(999);
      expect(result.items[0].id).toBe('42');
      expect(result.total).toBe(1);
    });
  });

  describe('jobLogs', () => {
    it('serializes BigInt id to string and exposes the recovered flag from raw SQL', async () => {
      const prisma = makePrisma();
      // jobLogs now uses $queryRaw twice: once for items (with `recovered` per
      // row), once for total. Stub both in order.
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            id: BigInt(7),
            queue_name: 'clickup-tasks',
            job_name: 'sync',
            status: 'failed',
            entity_id: 'e1',
            error_message: 'boom',
            started_at: new Date(1700000000000),
            finished_at: new Date(1700000005000),
            tasks_synced: null,
            time_entries_synced: null,
            recovered: true,
          },
        ])
        .mockResolvedValueOnce([{ count: BigInt(1) }]);
      const result = await new ReportsService(prisma).jobLogs();
      expect(result.items[0].id).toBe('7');
      expect(result.items[0].status).toBe('failed');
      expect(result.items[0].recovered).toBe(true);
      expect(result.items[0].durationMs).toBe(5000);
      expect(result.total).toBe(1);
    });
  });

  describe('deadLetters', () => {
    it('serializes BigInt id to string', async () => {
      const prisma = makePrisma();
      prisma.deadLetterJob.findMany.mockResolvedValue([{ id: BigInt(3), queueName: 'clickup-tasks', jobName: 'sync', entityId: null, errorMessage: 'boom', failedAt: new Date() }]);
      prisma.deadLetterJob.count.mockResolvedValue(1);
      const result = await new ReportsService(prisma).deadLetters();
      expect(result.items[0].id).toBe('3');
    });
  });

  describe('stats', () => {
    it('returns all four dashboard stats', async () => {
      const prisma = makePrisma();
      prisma.syncJobLog.count.mockResolvedValue(3);
      prisma.deadLetterJob.count.mockResolvedValue(2);
      prisma.clickupWebhookEvent.count.mockResolvedValue(150);
      prisma.clickupTimeEntry.count.mockResolvedValue(7);
      const result = await new ReportsService(prisma).stats();
      expect(result).toEqual({ failedJobsLast24h: 3, deadLetterPending: 2, webhooksLast24h: 150, missingRateEntries: 7 });
    });
  });

  describe('missingRates', () => {
    it('queries NO_RATE_FOUND entries grouped by user and maps fields', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { user_id: 'u1', user_name: 'Alice', user_email: 'a@x.com', missing_count: BigInt(3), affected_hours: 5.5, first_date: new Date('2025-01-01'), latest_date: new Date('2025-01-15') },
      ]);
      const result = await new ReportsService(prisma).missingRates();
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('u1');
      expect(result[0].missingCount).toBe(3);
      expect(result[0].affectedHours).toBe(5.5);
    });

    it('returns empty array when no missing-rate entries exist', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await new ReportsService(prisma).missingRates();
      expect(result).toEqual([]);
    });
  });

  describe('spaces', () => {
    it('returns per-space aggregated stats', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { space_id: '3577824', space_name: 'Digital Marketing', task_count: BigInt(10), open_count: BigInt(5), hours_logged: 20.5, cost_cents: 5000 },
      ]);
      const result = await new ReportsService(prisma).spaces();
      expect(result).toHaveLength(1);
      expect(result[0].spaceId).toBe('3577824');
      expect(result[0].spaceName).toBe('Digital Marketing');
      expect(result[0].taskCount).toBe(10);
      expect(result[0].openCount).toBe(5);
      expect(result[0].hoursLogged).toBe(20.5);
      expect(result[0].costAud).toBe(50);
    });

    it('returns empty array when no spaces exist', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await new ReportsService(prisma).spaces();
      expect(result).toEqual([]);
    });
  });

  describe('overviewDeltas', () => {
    it('returns current + prior totals mapped to dollars', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total_hours: 124.5, total_cost_cents: BigInt(1843250) }])
        .mockResolvedValueOnce([{ total_hours: 105.0, total_cost_cents: BigInt(1560000) }]);
      const result = await new ReportsService(prisma).overviewDeltas(
        '2026-05-01T00:00:00.000Z',
        '2026-05-31T23:59:59.999Z',
      );
      expect(result).toEqual({
        current: { totalHours: 124.5, totalCostAud: 18432.5 },
        prior:   { totalHours: 105,   totalCostAud: 15600 },
      });
    });

    it('computes the prior window as [from - (to - from), from)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 0, total_cost_cents: BigInt(0) }]);
      await new ReportsService(prisma).overviewDeltas(
        '2026-05-15T00:00:00.000Z',
        '2026-05-20T00:00:00.000Z',
      );
      const priorCall = prisma.$queryRaw.mock.calls[1][0];
      const sqlText: string = priorCall.sql ?? priorCall.text ?? String(priorCall);
      expect(sqlText).toMatch(/SUM\(e\.cost_cents\)/);
      const values: unknown[] = priorCall.values ?? [];
      const isoStrings = values
        .map(v => (v instanceof Date ? v.toISOString() : String(v)))
        .join(' ');
      expect(isoStrings).toMatch(/2026-05-10T00:00:00\.000Z/);
      expect(isoStrings).toMatch(/2026-05-15T00:00:00\.000Z/);
    });

    it('excludes soft-deleted tasks in both windows', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 0, total_cost_cents: BigInt(0) }]);
      await new ReportsService(prisma).overviewDeltas();
      const call0: string = prisma.$queryRaw.mock.calls[0][0].sql ?? String(prisma.$queryRaw.mock.calls[0][0]);
      const call1: string = prisma.$queryRaw.mock.calls[1][0].sql ?? String(prisma.$queryRaw.mock.calls[1][0]);
      expect(call0).toMatch(/t\.is_deleted\s*=\s*false/);
      expect(call1).toMatch(/t\.is_deleted\s*=\s*false/);
    });

    it('handles null sums (no rows in window)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: null, total_cost_cents: null }]);
      const result = await new ReportsService(prisma).overviewDeltas();
      expect(result.current).toEqual({ totalHours: 0, totalCostAud: 0 });
      expect(result.prior).toEqual({ totalHours: 0, totalCostAud: 0 });
    });
  });

  describe('costTrend', () => {
    it('maps raw rows to { bucket, totalCostAud, totalHours, entryCount } and sorts ascending', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { bucket: '2026-05-18', total_cost_cents: BigInt(120000), total_hours: 8,   entry_count: 4 },
        { bucket: '2026-05-19', total_cost_cents: BigInt(0),      total_hours: 0,   entry_count: 0 },
        { bucket: '2026-05-20', total_cost_cents: BigInt(45000),  total_hours: 3.5, entry_count: 2 },
      ]);
      const result = await new ReportsService(prisma).costTrend('day');
      expect(result).toEqual([
        { bucket: '2026-05-18', totalCostAud: 1200, totalHours: 8,   entryCount: 4 },
        { bucket: '2026-05-19', totalCostAud: 0,    totalHours: 0,   entryCount: 0 },
        { bucket: '2026-05-20', totalCostAud: 450,  totalHours: 3.5, entryCount: 2 },
      ]);
    });

    it('throws on invalid bucket value', async () => {
      const prisma = makePrisma();
      await expect(new ReportsService(prisma).costTrend('hour' as any))
        .rejects.toThrow(/bucket/i);
    });

    it("emits SQL containing date_trunc('day', ...) at Asia/Dhaka for bucket=day", async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/date_trunc\('day'/);
      expect(sqlText).toMatch(/Asia\/Dhaka/);
      expect(sqlText).not.toMatch(/Australia\/Sydney/);
    });

    it('emits the Sunday-shift week expression for bucket=week', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('week');
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
      await new ReportsService(prisma).costTrend('month');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/date_trunc\('month'/);
    });

    it('uses generate_series so empty buckets are returned with zeros', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/generate_series/);
      expect(sqlText).toMatch(/LEFT JOIN/i);
    });

    it('filters out soft-deleted tasks', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).costTrend('day');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/t\.is_deleted\s*=\s*false/);
    });
  });

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
      const result = await new ReportsService(prisma).cycleTime({
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
      const result = await new ReportsService(prisma).cycleTime({
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
      const result = await new ReportsService(prisma).timeInStatus({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'),
      });
      expect(result.items[0]).toEqual({
        status: 'in progress', color: '#3b82f6', totalHours: 124.5, taskCount: 12,
      });
    });
  });

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
      const result = await new ReportsService(prisma).anomalies();
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
      const result = await new ReportsService(prisma).anomalies();
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
      const result = await new ReportsService(prisma).anomalies();
      expect(result).toEqual({ dailySpikes: [], clientSpikes: [] });
    });

    it("daily query uses Asia/Dhaka, percentile_cont(0.5), $50 floor, 2x median, soft-delete filter", async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new ReportsService(prisma).anomalies();
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
      await new ReportsService(prisma).anomalies();
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

  describe('timeEntriesList (client filter + column)', () => {
    it('filters by client via the task relation in where.AND', async () => {
      const prisma = makePrisma();
      await new ReportsService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: 'Acme Corp' } });
    });

    it('selects the related task client and maps it onto each row', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 't1', taskId: 'k1', userId: 'u1', userName: 'Alice', userEmail: 'a@x.com',
        startTime: new Date('2026-05-01T00:00:00Z'), endTime: null,
        durationHours: { toNumber: () => 2 }, hourlyRateCents: BigInt(15000),
        costCents: BigInt(30000), status: 'COST_CALCULATED', billable: true,
        description: null, syncedAt: new Date('2026-05-01T00:00:00Z'), rateId: null, currency: 'USD',
        task: { taskName: 'Build thing', client: 'Acme Corp' },
      }]);
      prisma.clickupTimeEntry.count.mockResolvedValue(1);
      const result = await new ReportsService(prisma).timeEntriesList();
      const selectArg = prisma.clickupTimeEntry.findMany.mock.calls[0][0].select;
      expect(selectArg.task.select.client).toBe(true);
      expect(result.items[0].client).toBe('Acme Corp');
    });

    it('maps client to null when the entry has no task', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 't2', taskId: null, userId: 'u1', userName: 'Bob', userEmail: null,
        startTime: new Date('2026-05-01T00:00:00Z'), endTime: null,
        durationHours: { toNumber: () => 1 }, hourlyRateCents: BigInt(0),
        costCents: BigInt(0), status: 'SYNCED', billable: false,
        description: null, syncedAt: new Date('2026-05-01T00:00:00Z'), rateId: null, currency: 'USD',
        task: null,
      }]);
      prisma.clickupTimeEntry.count.mockResolvedValue(1);
      const result = await new ReportsService(prisma).timeEntriesList();
      expect(result.items[0].client).toBeNull();
    });
  });
});

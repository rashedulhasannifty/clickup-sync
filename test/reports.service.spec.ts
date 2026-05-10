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
    it('returns bySpace, byStatus and total from $transaction', async () => {
      const prisma = makePrisma();
      prisma.$transaction.mockResolvedValue([
        [{ spaceId: '3577824', spaceName: 'Digital Marketing', _count: { taskId: 5 } }],
        [{ status: 'in progress', _count: { taskId: 3 } }],
        10,
      ]);
      const result = await new ReportsService(prisma).tasksSummary();
      expect(result.total).toBe(10);
      expect(result.bySpace[0]).toEqual({ spaceId: '3577824', spaceName: 'Digital Marketing', count: 5 });
      expect(result.byStatus[0]).toEqual({ status: 'in progress', count: 3 });
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
      prisma.$transaction.mockResolvedValue([
        [{ id: BigInt(42), eventType: 'taskCreated', taskId: 'abc', status: 'received', receivedAt: new Date(), processedAt: null }],
        1,
      ]);
      const result = await new ReportsService(prisma).webhookEvents(999);
      expect(result.items[0].id).toBe('42');
      expect(result.total).toBe(1);
    });
  });

  describe('jobLogs', () => {
    it('serializes BigInt id to string', async () => {
      const prisma = makePrisma();
      prisma.$transaction.mockResolvedValue([
        [{ id: BigInt(7), queueName: 'clickup-tasks', jobName: 'sync', status: 'completed', entityId: 'e1', errorMessage: null, finishedAt: new Date() }],
        1,
      ]);
      const result = await new ReportsService(prisma).jobLogs();
      expect(result.items[0].id).toBe('7');
    });
  });

  describe('deadLetters', () => {
    it('serializes BigInt id to string', async () => {
      const prisma = makePrisma();
      prisma.$transaction.mockResolvedValue([
        [{ id: BigInt(3), queueName: 'clickup-tasks', jobName: 'sync', entityId: null, errorMessage: 'boom', failedAt: new Date() }],
        1,
      ]);
      const result = await new ReportsService(prisma).deadLetters();
      expect(result.items[0].id).toBe('3');
    });
  });

  describe('stats', () => {
    it('returns all four dashboard stats', async () => {
      const prisma = makePrisma();
      prisma.$transaction.mockResolvedValue([3, 2, 150, 7]);
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
});

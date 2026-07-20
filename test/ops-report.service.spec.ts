import { OpsReportService } from '../src/reports/ops-report.service';

describe('OpsReportService', () => {
  function makePrisma(overrides: Partial<Record<string, any>> = {}) {
    const base = {
      clickupTimeEntry: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      syncCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      clickupWebhookEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      syncJobLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      deadLetterJob: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    return { ...base, ...overrides } as any;
  }

  describe('syncHealth', () => {
    it('marks Stale when lastSuccessfulSyncAt is older than 12h', async () => {
      const prisma = makePrisma();
      prisma.syncCheckpoint.findMany.mockResolvedValue([
        { scopeId: '3577824', lastSuccessfulSyncAt: new Date(Date.now() - 13 * 60 * 60_000) },
      ]);
      const result = await new OpsReportService(prisma).syncHealth();
      expect(result[0].spaceName).toBe('Digital Marketing');
      expect(result[0].status).toBe('Stale');
    });

    it('marks Fresh when lastSuccessfulSyncAt is within 12h (90 min, previously Stale)', async () => {
      const prisma = makePrisma();
      prisma.syncCheckpoint.findMany.mockResolvedValue([
        { scopeId: '3589129', lastSuccessfulSyncAt: new Date(Date.now() - 90 * 60_000) },
      ]);
      const result = await new OpsReportService(prisma).syncHealth();
      expect(result[0].spaceName).toBe('R&D Apps');
      expect(result[0].status).toBe('Fresh');
    });

    it('marks Unknown when lastSuccessfulSyncAt is null', async () => {
      const prisma = makePrisma();
      prisma.syncCheckpoint.findMany.mockResolvedValue([
        { scopeId: '3525433', lastSuccessfulSyncAt: null },
      ]);
      const result = await new OpsReportService(prisma).syncHealth();
      expect(result[0].spaceName).toBe('Projects');
      expect(result[0].status).toBe('Unknown');
      expect(result[0].ageMinutes).toBeNull();
    });

    it('uses scopeId as spaceName when not in CLICKUP_SPACES', async () => {
      const prisma = makePrisma();
      prisma.syncCheckpoint.findMany.mockResolvedValue([
        { scopeId: 'unknown-space', lastSuccessfulSyncAt: null },
      ]);
      const result = await new OpsReportService(prisma).syncHealth();
      expect(result[0].spaceName).toBe('unknown-space');
    });
  });

  describe('webhookEvents', () => {
    it('serializes BigInt id to string and respects limit cap', async () => {
      const prisma = makePrisma();
      prisma.clickupWebhookEvent.findMany.mockResolvedValue([{ id: BigInt(42), eventType: 'taskCreated', taskId: 'abc', status: 'received', receivedAt: new Date(), processedAt: null }]);
      prisma.clickupWebhookEvent.count.mockResolvedValue(1);
      const result = await new OpsReportService(prisma).webhookEvents(999);
      expect(result.items[0].id).toBe('42');
      expect(result.total).toBe(1);
    });

    it('builds a filtered where clause and returns distinct event types', async () => {
      const prisma = makePrisma();
      // First findMany = page items; second findMany = distinct event types.
      prisma.clickupWebhookEvent.findMany
        .mockResolvedValueOnce([{ id: BigInt(7), eventType: 'taskUpdated', taskId: 't1', status: 'failed', receivedAt: new Date(), processedAt: null }])
        .mockResolvedValueOnce([{ eventType: 'taskCreated' }, { eventType: 'taskUpdated' }]);
      prisma.clickupWebhookEvent.count.mockResolvedValue(1);

      const result = await new OpsReportService(prisma).webhookEvents(50, 0, 'failed', 'taskUpdated', '123');

      // The page query (first findMany call) gets the composed where clause.
      const pageWhere = prisma.clickupWebhookEvent.findMany.mock.calls[0][0].where;
      expect(pageWhere.status).toBe('failed');
      expect(pageWhere.eventType).toBe('taskUpdated');
      // All-digit search also matches the numeric primary key exactly.
      expect(pageWhere.OR).toEqual(
        expect.arrayContaining([
          { taskId: { contains: '123', mode: 'insensitive' } },
          { eventType: { contains: '123', mode: 'insensitive' } },
          { id: BigInt(123) },
        ]),
      );
      // count() is scoped to the same filter.
      expect(prisma.clickupWebhookEvent.count).toHaveBeenCalledWith({ where: pageWhere });
      // Distinct list is surfaced for the filter dropdown.
      expect(result.eventTypes).toEqual(['taskCreated', 'taskUpdated']);
    });

    it('omits the id OR-term when the search is not all digits', async () => {
      const prisma = makePrisma();
      prisma.clickupWebhookEvent.findMany.mockResolvedValue([]);
      prisma.clickupWebhookEvent.count.mockResolvedValue(0);

      await new OpsReportService(prisma).webhookEvents(50, 0, undefined, undefined, 'task');

      const pageWhere = prisma.clickupWebhookEvent.findMany.mock.calls[0][0].where;
      expect(pageWhere.OR).toEqual([
        { taskId: { contains: 'task', mode: 'insensitive' } },
        { eventType: { contains: 'task', mode: 'insensitive' } },
      ]);
      expect(pageWhere.status).toBeUndefined();
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
      const result = await new OpsReportService(prisma).jobLogs();
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
      const result = await new OpsReportService(prisma).deadLetters();
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
      const result = await new OpsReportService(prisma).stats();
      expect(result).toEqual({ failedJobsLast24h: 3, deadLetterPending: 2, webhooksLast24h: 150, missingRateEntries: 7, lastWebhookEventAt: null });
    });
  });

  describe('missingRates', () => {
    it('queries NO_RATE_FOUND entries grouped by user and maps fields', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        {
          user_id: 'u1',
          user_name: 'Alice',
          user_email: 'a@x.com',
          missing_count: BigInt(3),
          affected_hours: 5.5,
          first_date: new Date('2025-01-01'),
          latest_date: new Date('2025-01-15'),
          affected_task_count: BigInt(2),
          affected_tasks: [
            { taskId: 't1', taskName: 'Task one' },
            { taskId: 't2', taskName: 'Task two' },
          ],
        },
      ]);
      const result = await new OpsReportService(prisma).missingRates();
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('u1');
      expect(result[0].missingCount).toBe(3);
      expect(result[0].affectedHours).toBe(5.5);
      expect(result[0].affectedTaskCount).toBe(2);
      expect(result[0].affectedTasks).toEqual([
        { taskId: 't1', taskName: 'Task one' },
        { taskId: 't2', taskName: 'Task two' },
      ]);
    });

    it('defaults affectedTasks to empty array when DB returns null', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        {
          user_id: 'u2',
          user_name: 'Bob',
          user_email: 'b@x.com',
          missing_count: BigInt(1),
          affected_hours: 0.5,
          first_date: new Date('2025-02-01'),
          latest_date: new Date('2025-02-01'),
          affected_task_count: BigInt(0),
          affected_tasks: null,
        },
      ]);
      const result = await new OpsReportService(prisma).missingRates();
      expect(result[0].affectedTasks).toEqual([]);
      expect(result[0].affectedTaskCount).toBe(0);
    });

    it('returns empty array when no missing-rate entries exist', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await new OpsReportService(prisma).missingRates();
      expect(result).toEqual([]);
    });
  });

  describe('stats excludedIds filtering', () => {
    it('counts COST_EXCLUDED as not-missing and excludes excluded users while keeping NULL-userId rows', async () => {
      const prisma = makePrisma();
      await new OpsReportService(prisma).stats(['u1']);
      // 4th count call (missingRateEntries) is on clickupTimeEntry.count
      const where = prisma.clickupTimeEntry.count.mock.calls[0][0].where;
      expect(where.status).toEqual({ notIn: ['COST_CALCULATED', 'COST_EXCLUDED'] });
      expect(where.OR).toEqual([{ userId: null }, { userId: { notIn: ['u1'] } }]);
    });

    it('omits the userId filter when no ids are excluded', async () => {
      const prisma = makePrisma();
      await new OpsReportService(prisma).stats();
      const where = prisma.clickupTimeEntry.count.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });
  });

  describe('missingRates excludedIds SQL safety', () => {
    it('does not throw when the excluded list is empty (no Prisma.join on [])', async () => {
      const prisma = makePrisma();
      await expect(new OpsReportService(prisma).missingRates([])).resolves.toBeDefined();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('builds the query with excluded ids without throwing', async () => {
      const prisma = makePrisma();
      await expect(new OpsReportService(prisma).missingRates(['u1'])).resolves.toBeDefined();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});

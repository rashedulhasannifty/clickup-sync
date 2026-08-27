import { TimeEntriesReportService } from '../src/reports/time-entries-report.service';

describe('TimeEntriesReportService', () => {
  function makePrisma(overrides: Partial<Record<string, any>> = {}) {
    const base = {
      clickupTimeEntry: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    return { ...base, ...overrides } as any;
  }

  describe('timeEntriesByUser', () => {
    it('converts durationHours.toNumber() and costCents BigInt to totalCostAud', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([{
        userId: 'u1', userName: 'Alice', userEmail: 'alice@x.com',
        _sum: { durationHours: { toNumber: () => 8 }, costCents: BigInt(120000) },
      }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser();
      expect(result[0].totalHours).toBe(8);
      expect(result[0].totalCostAud).toBe(1200);
    });

    it('handles null sums gracefully', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([{
        userId: 'u2', userName: null, userEmail: null,
        _sum: { durationHours: null, costCents: null },
      }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser();
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesBillableSummary();
      expect(result.billableHours).toBe(10);
      expect(result.billableCostAud).toBe(1500);
      expect(result.nonBillableHours).toBe(5);
      expect(result.nonBillableCostAud).toBe(0);
    });

    it('returns zeros when no entries exist', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesBillableSummary();
      expect(result).toEqual({ billableHours: 0, nonBillableHours: 0, billableCostAud: 0, nonBillableCostAud: 0 });
    });
  });

  describe('timeEntriesByClient', () => {
    it('maps raw SQL result to client, totalHours, totalCostAud', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ client: 'Acme Corp', total_hours: 5.5, total_cost_cents: 82500 }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByClient();
      expect(result[0]).toEqual({ client: 'Acme Corp', totalHours: 5.5, totalCostAud: 825 });
    });

    it('excludes soft-deleted tasks from the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TimeEntriesReportService(prisma).timeEntriesByClient();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/t\.is_deleted\s*=\s*false/);
    });
  });

  describe('timeEntriesByDepartment', () => {
    it('maps raw SQL result to department, totalHours, totalCostAud', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ department: 'Engineering', total_hours: 20, total_cost_cents: 300000 }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByDepartment();
      expect(result[0]).toEqual({ department: 'Engineering', totalHours: 20, totalCostAud: 3000 });
    });
  });

  describe('overviewDeltas', () => {
    it('returns current + prior totals mapped to dollars', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total_hours: 124.5, total_cost_cents: BigInt(1843250) }])
        .mockResolvedValueOnce([{ total_hours: 105.0, total_cost_cents: BigInt(1560000) }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas(
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
      await new TimeEntriesReportService(prisma).overviewDeltas(
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
      await new TimeEntriesReportService(prisma).overviewDeltas();
      const call0: string = prisma.$queryRaw.mock.calls[0][0].sql ?? String(prisma.$queryRaw.mock.calls[0][0]);
      const call1: string = prisma.$queryRaw.mock.calls[1][0].sql ?? String(prisma.$queryRaw.mock.calls[1][0]);
      expect(call0).toMatch(/t\.is_deleted\s*=\s*false/);
      expect(call1).toMatch(/t\.is_deleted\s*=\s*false/);
    });

    it('handles null sums (no rows in window)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: null, total_cost_cents: null }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas();
      expect(result.current).toEqual({ totalHours: 0, totalCostAud: 0 });
      expect(result.prior).toEqual({ totalHours: 0, totalCostAud: 0 });
    });
  });

  // Regression: `clickup_time_entries.start_time` is a `timestamptz`. Bucketing
  // it into a Dhaka calendar day needs a SINGLE `AT TIME ZONE 'Asia/Dhaka'`. The
  // old double form collapses a timestamptz to the UTC date, mis-assigning
  // early-Dhaka-morning entries to the previous day. Guard the timesheet query.
  describe('start_time Dhaka-day bucketing (timestamptz, single conversion)', () => {
    it('timesheet buckets start_time with single Asia/Dhaka conversion', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TimeEntriesReportService(prisma).timesheet('u1');
      const allSql = prisma.$queryRaw.mock.calls.map((c: any[]) => {
        const call = c[0];
        return call.sql ?? call.text ?? String(call);
      }).join('\n---\n');
      expect(allSql).not.toMatch(/start_time\s+AT TIME ZONE 'UTC'/);
      expect(allSql).toMatch(/start_time\s+AT TIME ZONE 'Asia\/Dhaka'/);
    });
  });

  describe('timeEntriesList (client filter + column)', () => {
    it('wraps a single client in an IN clause inside where.AND (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp'] } } });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp,Globex',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp', 'Globex'] } } });
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesList();
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesList();
      expect(result.items[0].client).toBeNull();
    });
  });

  describe('timeEntriesList (list filter + column)', () => {
    it('wraps a single listId in an IN clause inside where.AND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1'] } } });
    });

    it('splits a comma-separated listId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, 'L1,L2',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1', 'L2'] } } });
    });

    it('selects the related task listName and maps it onto each row', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 't1', taskId: 'k1', userId: 'u1', userName: 'Alice', userEmail: 'a@x.com',
        startTime: new Date('2026-05-01T00:00:00Z'), endTime: null,
        durationHours: { toNumber: () => 2 }, hourlyRateCents: BigInt(15000),
        costCents: BigInt(30000), status: 'COST_CALCULATED', billable: true,
        description: null, syncedAt: new Date('2026-05-01T00:00:00Z'), rateId: null, currency: 'USD',
        task: { taskName: 'Build thing', client: 'Acme Corp', listName: 'Backlog' },
      }]);
      prisma.clickupTimeEntry.count.mockResolvedValue(1);
      const result = await new TimeEntriesReportService(prisma).timeEntriesList();
      const selectArg = prisma.clickupTimeEntry.findMany.mock.calls[0][0].select;
      expect(selectArg.task.select.listName).toBe(true);
      expect(result.items[0].listName).toBe('Backlog');
    });

    it('maps listName to null when the entry has no task', async () => {
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesList();
      expect(result.items[0].listName).toBeNull();
    });
  });

  describe('timeEntriesList (folder filter)', () => {
    it('wraps a single folderId in an IN clause inside where.AND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: { in: ['F1'] } } });
    });

    it('splits a comma-separated folderId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'F1,F2',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: { in: ['F1', 'F2'] } } });
    });
  });

  describe('timeEntriesList (archived filter)', () => {
    it("pushes a NOT-archived-task clause when archived='exclude' (keeps task-less entries)", async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'exclude',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ NOT: { task: { archived: true } } });
    });

    it("pushes an archived-task clause when archived='only'", async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'only',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { archived: true } });
    });

    it("adds no archived clause when archived='include' or undefined", async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'include',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).not.toContainEqual({ task: { archived: true } });
      expect(and).not.toContainEqual({ NOT: { task: { archived: true } } });
    });
  });

  describe('timeEntriesList (sprintStatus filter)', () => {
    function callList(prisma: any, sprintStatus?: string, listId?: string) {
      return new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, listId, undefined, undefined,
        sprintStatus,
      );
    }

    it('adds a task.listId-IN clause scoped to non-archived lists when sprintStatus="active"', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ list_id: 'L1' }, { list_id: 'L2' }]);
      await callList(prisma, 'active');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1', 'L2'] } } });
      const rawCall = prisma.$queryRaw.mock.calls[0][0];
      expect(rawCall.values).toEqual([false]);
    });

    it('adds a task.listId-IN clause scoped to archived lists when sprintStatus="completed"', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ list_id: 'L3' }]);
      await callList(prisma, 'completed');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L3'] } } });
      const rawCall = prisma.$queryRaw.mock.calls[0][0];
      expect(rawCall.values).toEqual([true]);
    });

    // Regression pin: zero archived lists must exclude every entry (empty
    // IN), not be treated as "no filter".
    it('still pushes an (empty) IN clause when no lists match sprintStatus="completed"', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await callList(prisma, 'completed');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: [] } } });
    });

    it('emits no extra clause and issues no extra query when sprintStatus="all" (backward-compatible)', async () => {
      const prisma = makePrisma();
      await callList(prisma, 'all');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.AND).toBeUndefined();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('emits no extra clause when sprintStatus is undefined (pre-existing callers unaffected)', async () => {
      const prisma = makePrisma();
      await callList(prisma);
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.AND).toBeUndefined();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('combines with an existing listId filter as two separate AND entries (both must hold, not merged)', async () => {
      const prisma = makePrisma();
      // Different list_id than the user's explicit filter so the two clauses
      // are distinguishable — proves both survive as independent AND entries
      // rather than one overwriting the other.
      prisma.$queryRaw.mockResolvedValue([{ list_id: 'L2' }]);
      await callList(prisma, 'completed', 'L1');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1'] } } });
      expect(and).toContainEqual({ task: { listId: { in: ['L2'] } } });
    });
  });

  describe('timeEntriesAggregates (sprintStatus filter)', () => {
    it('adds a task.listId-IN clause when sprintStatus="completed"', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ list_id: 'L9' }]);
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, 'completed',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L9'] } } });
    });

    it('emits no extra clause when sprintStatus="all"', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, 'all',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.AND).toBeUndefined();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('timeEntriesList (userId filter)', () => {
    it('wraps a single userId in an IN clause (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList('u1');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1'] });
    });

    it('splits a comma-separated userId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList('u1,u2');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1', 'u2'] });
    });

    it('omits the userId clause when userId is undefined', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList();
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toBeUndefined();
    });
  });

  describe('timeEntriesList (status filter)', () => {
    it('wraps a single status in an IN clause (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, 'NO_RATE_FOUND',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['NO_RATE_FOUND'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, 'COST_CALCULATED,COST_EXCLUDED',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['COST_CALCULATED', 'COST_EXCLUDED'] });
    });

    it('missingOnly still forces the scalar NO_RATE_FOUND and overrides a multi-value status', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(
        undefined, undefined, undefined, 'COST_CALCULATED,COST_EXCLUDED', 50, 0,
        undefined, undefined, undefined, 'true',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.status).toBe('NO_RATE_FOUND');
    });
  });

  describe('timeEntriesAggregates (client filter)', () => {
    it('wraps a single client in an IN clause via the task relation', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp'] } } });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Acme Corp,Globex',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp', 'Globex'] } } });
    });
  });

  describe('timeEntriesAggregates (list filter)', () => {
    it('splits a comma-separated listId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'L1,L2',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1', 'L2'] } } });
    });
  });

  describe('timeEntriesAggregates (folder filter)', () => {
    it('splits a comma-separated folderId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1,F2',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: { in: ['F1', 'F2'] } } });
    });
  });

  describe('timeEntriesAggregates (userId + status filters)', () => {
    it('splits a comma-separated userId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates('u1,u2');
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1', 'u2'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, 'COST_CALCULATED,COST_EXCLUDED',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['COST_CALCULATED', 'COST_EXCLUDED'] });
    });

    it('missingOnly still forces the scalar NO_RATE_FOUND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, undefined, undefined, 'COST_CALCULATED', undefined, undefined, undefined, 'true',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.status).toBe('NO_RATE_FOUND');
    });
  });
});

describe('TimeEntriesReportService.timeEntriesByTask', () => {
  /** One `groupBy` row: the (task, assignee, billable, status) grain the fold reduces. */
  function group(over: Partial<Record<string, any>> = {}) {
    return {
      taskId: 't1', userId: 'u1', userName: 'Alice', billable: true,
      status: 'COST_CALCULATED', currency: 'USD',
      _count: 1,
      _sum: { durationHours: { toNumber: () => 1 }, costCents: BigInt(0) },
      _max: { startTime: new Date('2026-01-10T09:00:00.000Z') },
      ...over,
    };
  }

  function makePrisma(groups: any[] = [], tasks: any[] = []) {
    return {
      clickupTimeEntry: { groupBy: jest.fn().mockResolvedValue(groups) },
      clickupTask: { findMany: jest.fn().mockResolvedValue(tasks) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as any;
  }

  const svc = (prisma: any) => new TimeEntriesReportService(prisma);

  it('collapses a task\'s entries into a single row carrying their summed hours', async () => {
    const prisma = makePrisma([
      group({ _count: 2, _sum: { durationHours: { toNumber: () => 2.5 }, costCents: BigInt(5000) } }),
      group({ userId: 'u2', userName: 'Bob', _count: 1, _sum: { durationHours: { toNumber: () => 1.25 }, costCents: BigInt(2500) } }),
    ]);
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items).toHaveLength(1);
    expect(items[0].totalHours).toBe(3.75);
    expect(items[0].entryCount).toBe(3);
    expect(items[0].costAud).toBe(75);
  });

  it('reports total as the number of tasks, not the number of entries', async () => {
    const prisma = makePrisma([
      group({ taskId: 't1', _count: 4 }),
      group({ taskId: 't2', _count: 6 }),
    ]);
    const { total } = await svc(prisma).timeEntriesByTask({});
    expect(total).toBe(2);
  });

  it('gathers entries with no task under one bucket instead of dropping them', async () => {
    const prisma = makePrisma([
      group({ taskId: null, _count: 2, _sum: { durationHours: { toNumber: () => 4 }, costCents: BigInt(0) } }),
    ]);
    const { items, total } = await svc(prisma).timeEntriesByTask({});
    expect(total).toBe(1);
    expect(items[0].taskId).toBe('__none__');
    expect(items[0].taskName).toBeNull();
    expect(items[0].totalHours).toBe(4);
  });

  it('never counts a missing-rate entry\'s cost as valid, and flags how many', async () => {
    const prisma = makePrisma([
      group({ status: 'COST_CALCULATED', _count: 1, _sum: { durationHours: { toNumber: () => 1 }, costCents: BigInt(9000) } }),
      group({ status: 'NO_RATE_FOUND', _count: 3, _sum: { durationHours: { toNumber: () => 5 }, costCents: BigInt(123456) } }),
    ]);
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0].costAud).toBe(90);
    expect(items[0].missingRateCount).toBe(3);
    expect(items[0].totalHours).toBe(6);
  });

  it('counts cost-excluded entries so a fully-excluded task can\'t read as costed', async () => {
    const prisma = makePrisma([
      group({ status: 'COST_EXCLUDED', _count: 4, _sum: { durationHours: { toNumber: () => 7 }, costCents: BigInt(0) } }),
    ]);
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0].excludedCount).toBe(4);
    expect(items[0].missingRateCount).toBe(0);
    expect(items[0].entryCount).toBe(4);
  });

  it('splits billable from non-billable hours within the task', async () => {
    const prisma = makePrisma([
      group({ billable: true, _sum: { durationHours: { toNumber: () => 6 }, costCents: BigInt(0) } }),
      group({ billable: false, _sum: { durationHours: { toNumber: () => 2 }, costCents: BigInt(0) } }),
    ]);
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0].billableHours).toBe(6);
    expect(items[0].nonBillableHours).toBe(2);
  });

  it('lists each assignee once however many entries they logged', async () => {
    const prisma = makePrisma([
      group({ userId: 'u1', userName: 'Alice', billable: true }),
      group({ userId: 'u1', userName: 'Alice', billable: false }),
      group({ userId: 'u2', userName: 'Bob' }),
    ]);
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0].assignees).toEqual([
      { userId: 'u1', userName: 'Alice' },
      { userId: 'u2', userName: 'Bob' },
    ]);
  });

  it('keeps the task\'s most recent entry time as its last activity', async () => {
    const prisma = makePrisma([
      group({ _max: { startTime: new Date('2026-01-10T09:00:00.000Z') } }),
      group({ userId: 'u2', _max: { startTime: new Date('2026-02-02T09:00:00.000Z') } }),
    ]);
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0].lastActivity).toEqual(new Date('2026-02-02T09:00:00.000Z'));
  });

  it('orders the heaviest tasks first and paginates over tasks', async () => {
    const prisma = makePrisma([
      group({ taskId: 'small', _sum: { durationHours: { toNumber: () => 1 }, costCents: BigInt(0) } }),
      group({ taskId: 'big', _sum: { durationHours: { toNumber: () => 9 }, costCents: BigInt(0) } }),
      group({ taskId: 'mid', _sum: { durationHours: { toNumber: () => 5 }, costCents: BigInt(0) } }),
    ]);
    const { items, total } = await svc(prisma).timeEntriesByTask({ limit: 1, offset: 1 });
    expect(total).toBe(3);
    expect(items.map((i: any) => i.taskId)).toEqual(['mid']);
  });

  it('resolves task name, client and list for the tasks on this page only', async () => {
    const prisma = makePrisma(
      [
        group({ taskId: 'big', _sum: { durationHours: { toNumber: () => 9 }, costCents: BigInt(0) } }),
        group({ taskId: 'small', _sum: { durationHours: { toNumber: () => 1 }, costCents: BigInt(0) } }),
      ],
      [{ taskId: 'big', taskName: 'Fix webhook dedupe', client: 'Acme', listName: 'Sprint 12' }],
    );
    const { items } = await svc(prisma).timeEntriesByTask({ limit: 1 });
    expect(prisma.clickupTask.findMany.mock.calls[0][0].where).toEqual({ taskId: { in: ['big'] } });
    expect(items[0]).toMatchObject({ taskName: 'Fix webhook dedupe', client: 'Acme', listName: 'Sprint 12' });
  });

  it('groups over exactly the entry set the flat list would return for the same filters', async () => {
    const prisma = makePrisma();
    const listPrisma = {
      clickupTimeEntry: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as any;
    const filters = {
      from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z',
      userId: 'u1,u2', client: 'Acme', billable: 'true', archived: 'exclude', search: 'webhook',
    };
    await svc(prisma).timeEntriesByTask(filters);
    await svc(listPrisma).timeEntriesList(
      filters.userId, filters.from, filters.to, undefined, 50, 0, filters.billable,
      filters.search, undefined, undefined, filters.client, undefined, undefined, filters.archived,
    );
    expect(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where)
      .toEqual(listPrisma.clickupTimeEntry.findMany.mock.calls[0][0].where);
  });
});

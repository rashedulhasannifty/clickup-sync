import { TimeEntriesReportService } from '../src/reports/time-entries-report.service';
import { buildTimeEntryWhere } from '../src/reports/report-filter.util';

describe('TimeEntriesReportService', () => {
  function makePrisma(overrides: Partial<Record<string, any>> = {}) {
    const base = {
      clickupTimeEntry: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: { durationHours: null, costCents: null } }),
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

  describe('timeEntriesChargeableSummary', () => {
    // The non-chargeable half is DERIVED (total - chargeable), never queried as
    // its own partition: two independently-queried halves can disagree with the
    // window's real total whenever a row belongs to neither (e.g. a null task
    // FK), and then this summary contradicts every other surface on the page.
    it('separates chargeable and non-chargeable hours', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.aggregate
        .mockResolvedValueOnce({ _count: 2, _sum: { durationHours: { toNumber: () => 15 }, costCents: BigInt(150000) } })
        .mockResolvedValueOnce({ _count: 1, _sum: { durationHours: { toNumber: () => 10 }, costCents: BigInt(150000) } });
      const result = await new TimeEntriesReportService(prisma).timeEntriesChargeableSummary();
      expect(result).toEqual({ chargeableHours: 10, nonChargeableHours: 5 });
    });

    it('returns zeros when no entries exist', async () => {
      const prisma = makePrisma();
      const result = await new TimeEntriesReportService(prisma).timeEntriesChargeableSummary();
      expect(result).toEqual({ chargeableHours: 0, nonChargeableHours: 0 });
    });

    // Regression: the two aggregate calls are distinguished ONLY by whether the
    // chargeable clause is present. A mutation that swaps them (or drops the
    // window from either one) makes every figure wrong while every other test
    // here — which only tells the calls apart by mockResolvedValueOnce
    // ordering — keeps passing. Call 0 MUST be the bare window: the total has
    // to be the same set every other surface counts, not the sum of two halves.
    it('takes the total from the bare window and narrows only the chargeable half', async () => {
      const prisma = makePrisma();
      const from = '2026-01-01T00:00:00.000Z';
      const to = '2026-02-01T00:00:00.000Z';
      await new TimeEntriesReportService(prisma).timeEntriesChargeableSummary(from, to);
      const window = { startTime: { gte: new Date(from), lte: new Date(to) } };
      const calls = prisma.clickupTimeEntry.aggregate.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0].where).toEqual(window);
      expect(calls[1][0].where).toEqual({ AND: [window, { isChargeable: true }] });
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

  describe('chargeability in reports', () => {
    it('marks a flat entry chargeable from its own column, not the joined task', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 'e1', taskId: 't1', userId: 'u1', userName: 'Alice', userEmail: null,
        startTime: new Date(), endTime: null, durationHours: { toNumber: () => 1 },
        hourlyRateCents: 0n, costCents: 0n, status: 'NOT_CHARGEABLE', billable: true,
        description: null, syncedAt: new Date(), rateId: null, currency: 'USD',
        isChargeable: false,
        // The joined task disagrees on purpose: a per-assignee rule can make an
        // entry non-chargeable on a task whose own flag is still true, and the
        // row must reflect its own column, not the task's.
        task: { taskName: 'T', client: null, listName: null, isChargeable: true },
      }]);
      const { items } = await new TimeEntriesReportService(prisma).timeEntriesList();
      expect(items[0].chargeable).toBe(false);
    });

    it('treats a task-less entry as chargeable', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 'e1', taskId: null, userId: 'u1', userName: 'Alice', userEmail: null,
        startTime: new Date(), endTime: null, durationHours: { toNumber: () => 1 },
        hourlyRateCents: 0n, costCents: 0n, status: 'COST_CALCULATED', billable: false,
        description: null, syncedAt: new Date(), rateId: null, currency: 'USD',
        isChargeable: true, task: null,
      }]);
      const { items } = await new TimeEntriesReportService(prisma).timeEntriesList();
      expect(items[0].chargeable).toBe(true);
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

  describe('timeEntriesAggregates (chargeable partition)', () => {
    // Regression: the status groupBy (asserted everywhere else in this file)
    // reuses the plain `where`, so it can't catch a bug in the chargeable
    // split. This test looks at the two `aggregate` calls directly — a
    // mutation that swaps the plain and chargeable wheres, or that drops the
    // caller's `where` from the chargeable wrapper, must fail this.
    //
    // Call 0 MUST be the caller's `where` verbatim: the metric cards' totals
    // have to come from the same row set the pager (`count({ where })`) and the
    // grouped table (`groupBy({ where })`) see. Deriving them by summing a
    // chargeable and a non-chargeable partition made the cards the only surface
    // that depended on those two halves being exhaustive.
    it('takes the totals from the caller\'s where and narrows only the chargeable half', async () => {
      const prisma = makePrisma();
      const from = '2026-01-01T00:00:00.000Z';
      const to = '2026-02-01T00:00:00.000Z';
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(
        undefined, from, to, undefined, undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const expectedWhere = await buildTimeEntryWhere(prisma, {
        from: new Date(from), to: new Date(to), client: 'Acme Corp',
      });
      const calls = prisma.clickupTimeEntry.aggregate.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0].where).toEqual(expectedWhere);
      expect(calls[1][0].where).toEqual({ AND: [expectedWhere, { isChargeable: true }] });
    });

    it('derives totalEntries/totalHours/totalCostCents/avgRateCents from the unpartitioned total', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.aggregate
        .mockResolvedValueOnce({ _count: 5, _sum: { durationHours: { toNumber: () => 15 }, costCents: BigInt(100000) } })
        .mockResolvedValueOnce({ _count: 3, _sum: { durationHours: { toNumber: () => 10 }, costCents: BigInt(100000) } });
      const result = await new TimeEntriesReportService(prisma).timeEntriesAggregates();
      expect(result.totalEntries).toBe(5);
      expect(result.totalHours).toBe(15);
      expect(result.chargeableHours).toBe(10);
      expect(result.nonChargeableHours).toBe(5);
      expect(result.totalCostCents).toBe(100000);
      expect(result.avgRateCents).toBe(Math.round(100000 / 15));
    });

    // The chargeable where is strictly a subset of the plain where, so this
    // input is unreachable in a single consistent read — it models the one case
    // that isn't: the two aggregates aren't in a transaction, so an entry
    // written between them can make the subset out-count the total. Clamp
    // rather than print a negative figure beside a positive one.
    it('clamps rather than reporting negative non-chargeable hours if the two reads disagree', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.aggregate
        .mockResolvedValueOnce({ _count: 1, _sum: { durationHours: { toNumber: () => 4 }, costCents: BigInt(0) } })
        .mockResolvedValueOnce({ _count: 1, _sum: { durationHours: { toNumber: () => 6 }, costCents: BigInt(0) } });
      const result = await new TimeEntriesReportService(prisma).timeEntriesAggregates();
      expect(result.nonChargeableHours).toBe(0);
    });
  });

  describe('taskAssigneeChargeability', () => {
    it('lists everyone who logged time on the task with their resolved chargeability', async () => {
      const hrs = (n: number) => ({ toNumber: () => n });
      const prisma = makePrisma({
        clickupTask: { findUnique: jest.fn().mockResolvedValue({ isChargeable: true }) },
        taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([{ userId: 'u2', chargeable: false }]) },
      });
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { userId: 'u1', userName: 'Ada', _count: 2, _sum: { durationHours: hrs(3) } },
        { userId: 'u2', userName: 'Grace', _count: 1, _sum: { durationHours: hrs(2) } },
      ]);

      const rows = await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1');

      expect(rows).toEqual([
        { userId: 'u1', userName: 'Ada', entryCount: 2, hours: 3, rule: null, chargeable: true, source: 'task' },
        { userId: 'u2', userName: 'Grace', entryCount: 1, hours: 2, rule: false, chargeable: false, source: 'assignee' },
      ]);
    });

    it('drops entries with no logger, which have no identity to key a rule on', async () => {
      const prisma = makePrisma({
        clickupTask: { findUnique: jest.fn().mockResolvedValue({ isChargeable: true }) },
        taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([]) },
      });
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { userId: null, userName: null, _count: 1, _sum: { durationHours: { toNumber: () => 1 } } },
      ]);

      expect(await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1')).toEqual([]);
    });
  });
});

describe('TimeEntriesReportService.timeEntriesByTask', () => {
  /** One `groupBy` row: the (task, assignee, status, isChargeable) grain the fold reduces. */
  function group(over: Partial<Record<string, any>> = {}) {
    return {
      taskId: 't1', userId: 'u1', userName: 'Alice',
      status: 'COST_CALCULATED', currency: 'USD', isChargeable: true,
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

  it('sums all entries into chargeableHours when every group is chargeable', async () => {
    const prisma = makePrisma(
      [
        // isChargeable: true comes from `group()`'s default — this is the
        // entry-level column now, not the task's own flag.
        group({ _sum: { durationHours: { toNumber: () => 6 }, costCents: BigInt(0) } }),
        group({ userId: 'u2', userName: 'Bob', _sum: { durationHours: { toNumber: () => 2 }, costCents: BigInt(0) } }),
      ],
      [{ taskId: 't1', taskName: 'T', client: null, listName: null }],
    );
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0].chargeable).toBe(true);
    expect(items[0].partiallyChargeable).toBe(false);
    expect(items[0].totalHours).toBe(8);
    expect(items[0].chargeableHours).toBe(8);
  });

  it('reports a task non-chargeable and zeroes its chargeable hours when every group is non-chargeable', async () => {
    const prisma = makePrisma(
      [group({ taskId: 't1', isChargeable: false, _sum: { durationHours: { toNumber: () => 6 }, costCents: BigInt(0) } })],
      [{ taskId: 't1', taskName: 'T', client: null, listName: null }],
    );
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0].chargeable).toBe(false);
    expect(items[0].partiallyChargeable).toBe(false);
    expect(items[0].totalHours).toBe(6);
    expect(items[0].chargeableHours).toBe(0);
  });

  it('sums chargeable hours per task rather than applying the task flag to the whole row', async () => {
    // One task, two assignees, 2h each — only one of them chargeable. This is
    // exactly the case the old task-wide flag couldn't represent.
    const prisma = makePrisma(
      [
        group({
          userId: 'u1', userName: 'A', isChargeable: true,
          _sum: { durationHours: { toNumber: () => 2 }, costCents: BigInt(1000) },
        }),
        group({
          userId: 'u2', userName: 'B', status: 'NOT_CHARGEABLE', isChargeable: false,
          _sum: { durationHours: { toNumber: () => 2 }, costCents: BigInt(0) },
        }),
      ],
      [{ taskId: 't1', taskName: 'T', client: null, listName: null }],
    );
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0]).toMatchObject({
      totalHours: 4, chargeableHours: 2, chargeable: false, partiallyChargeable: true,
    });
  });

  it('does not misreport a bucket of only zero-duration non-chargeable entries as chargeable', async () => {
    // 0 chargeableHours === 0 totalHours would satisfy a hours-only equality
    // check, so `chargeable` must be decided by entry counts, not hours.
    const prisma = makePrisma(
      [group({ isChargeable: false, _sum: { durationHours: { toNumber: () => 0 }, costCents: BigInt(0) } })],
      [{ taskId: 't1', taskName: 'T', client: null, listName: null }],
    );
    const { items } = await svc(prisma).timeEntriesByTask({});
    expect(items[0]).toMatchObject({
      totalHours: 0, chargeableHours: 0, chargeable: false, partiallyChargeable: false,
    });
  });

  it('lists each assignee once however many entries they logged', async () => {
    const prisma = makePrisma([
      group({ userId: 'u1', userName: 'Alice' }),
      group({ userId: 'u1', userName: 'Alice' }),
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
      userId: 'u1,u2', client: 'Acme', chargeable: 'true', archived: 'exclude', search: 'webhook',
    };
    await svc(prisma).timeEntriesByTask(filters);
    await svc(listPrisma).timeEntriesList(
      filters.userId, filters.from, filters.to, undefined, 50, 0, filters.chargeable,
      filters.search, undefined, undefined, filters.client, undefined, undefined, filters.archived,
    );
    expect(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where)
      .toEqual(listPrisma.clickupTimeEntry.findMany.mock.calls[0][0].where);
  });
});

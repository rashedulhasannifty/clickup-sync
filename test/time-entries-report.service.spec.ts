import { Prisma } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { TimeEntriesReportService } from '../src/reports/time-entries-report.service';
import { buildTimeEntryWhere } from '../src/reports/report-filter.util';
import { resolveScope, type AccessScope } from '../src/access/access-scope';

// Shared fixture for the calls in this file that don't care about scope
// behavior — `scope` is a required first arg (Ruling R10), so every call
// needs one. The scope-specific describes below use their own NONE/
// LEAD_A_MEMBER_B scopes.
const UNRESTRICTED: AccessScope = { kind: 'unrestricted', canEdit: true };
// A MEMBER of exactly zero teams: `visibleClientIds` resolves to `[]`, so a
// scoped query must pin to an empty id list (FALSE) rather than "no filter".
const NONE = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [], teamClients: [], teamMembers: [],
});

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
        userId: 'u1', userName: 'Alice', userEmail: 'alice@x.com', _count: 1,
        _sum: { durationHours: { toNumber: () => 8 }, costCents: BigInt(120000) },
      }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser(UNRESTRICTED);
      expect(result[0].totalHours).toBe(8);
      expect(result[0].totalCostAud).toBe(1200);
      expect(result[0].costPartial).toBe(false);
    });

    it('handles null sums gracefully', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([{
        userId: 'u2', userName: null, userEmail: null, _count: 0,
        _sum: { durationHours: null, costCents: null },
      }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser(UNRESTRICTED);
      expect(result[0].totalHours).toBe(0);
      expect(result[0].totalCostAud).toBe(0);
    });
  });

  describe('timeEntriesByUser (access scope)', () => {
    // LEAD of team A (client 'acme'), plain MEMBER of team B (client 'bolt').
    const LEAD_A_MEMBER_B = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [
        { teamId: 'A', role: 'LEAD' },
        { teamId: 'B', role: 'MEMBER' },
      ],
      teamClients: [
        { teamId: 'A', optionId: 'acme' },
        { teamId: 'B', optionId: 'bolt' },
      ],
      teamMembers: [],
    });

    it('applies the scope filter to the groupBy where', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesByUser(NONE);
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.task).toEqual({ scopeClientOptionId: { in: [] } });
    });

    it('gives a user with only led hours their full cost, costPartial false', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy
        .mockResolvedValueOnce([{
          userId: 'u1', userName: 'Alice', userEmail: null, _count: 2,
          _sum: { durationHours: { toNumber: () => 4 }, costCents: BigInt(999999) },
        }])
        // Same `['userId', 'userName', 'userEmail']` grain as the visible-rows
        // query (fix round 1, item 3) — a mismatched grain here is exactly the
        // bug this test guards.
        .mockResolvedValueOnce([{ userId: 'u1', userName: 'Alice', userEmail: null, _count: 2, _sum: { costCents: BigInt(20000) } }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser(LEAD_A_MEMBER_B);
      expect(result[0].totalCostAud).toBe(200);
      expect(result[0].costPartial).toBe(false);
      const costCall = prisma.clickupTimeEntry.groupBy.mock.calls[1][0];
      expect(costCall.by).toEqual(['userId', 'userName', 'userEmail']);
      expect(costCall.where.task).toEqual({ scopeClientOptionId: { in: ['acme'] } });
    });

    it('gives a user with mixed led/non-led hours a partial cost and costPartial true', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy
        .mockResolvedValueOnce([{
          userId: 'u1', userName: 'Alice', userEmail: null, _count: 5,
          _sum: { durationHours: { toNumber: () => 10 }, costCents: BigInt(999999) },
        }])
        .mockResolvedValueOnce([{ userId: 'u1', userName: 'Alice', userEmail: null, _count: 3, _sum: { costCents: BigInt(15000) } }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser(LEAD_A_MEMBER_B);
      expect(result[0].totalCostAud).toBe(150);
      expect(result[0].costPartial).toBe(true);
    });

    it('gives a user with zero led hours a null cost, costPartial true', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy
        .mockResolvedValueOnce([{
          userId: 'u2', userName: 'Bob', userEmail: null, _count: 4,
          _sum: { durationHours: { toNumber: () => 6 }, costCents: BigInt(999999) },
        }])
        .mockResolvedValueOnce([]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser(LEAD_A_MEMBER_B);
      expect(result[0].totalCostAud).toBeNull();
      expect(result[0].costPartial).toBe(true);
    });

    it('a viewer who leads nothing skips the extra cost groupBy entirely', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([{
        userId: 'u1', userName: 'Alice', userEmail: null, _count: 2,
        _sum: { durationHours: { toNumber: () => 4 }, costCents: BigInt(999999) },
      }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser(NONE);
      expect(result[0].totalCostAud).toBeNull();
      expect(result[0].costPartial).toBe(true);
      expect(prisma.clickupTimeEntry.groupBy).toHaveBeenCalledTimes(1);
    });

    // Fix round 1 (item 3) regression: one ClickUp user, two DISTINCT
    // (userId, userName, userEmail) groups this window (a display-name change
    // mid-period) — each group is its own row in BOTH the visible-rows and
    // the lead-cost groupBy. Grouping the cost half by `userId` alone would
    // fold the two lead-cost rows into one and hand that combined cost/count
    // to EVERY name variant, double-counting both the cost and the
    // led-vs-total comparison `costPartial` relies on.
    it('does not double-count cost across two name/email variants of the same userId', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.groupBy
        .mockResolvedValueOnce([
          { userId: 'u1', userName: 'Alice', userEmail: 'a@x.com', _count: 2, _sum: { durationHours: { toNumber: () => 4 }, costCents: BigInt(0) } },
          { userId: 'u1', userName: 'Alice Cooper', userEmail: 'a@x.com', _count: 3, _sum: { durationHours: { toNumber: () => 6 }, costCents: BigInt(0) } },
        ])
        .mockResolvedValueOnce([
          { userId: 'u1', userName: 'Alice', userEmail: 'a@x.com', _count: 2, _sum: { costCents: BigInt(20000) } },
          { userId: 'u1', userName: 'Alice Cooper', userEmail: 'a@x.com', _count: 3, _sum: { costCents: BigInt(30000) } },
        ]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByUser(LEAD_A_MEMBER_B);
      const alice = result.find((r) => r.userName === 'Alice')!;
      const aliceCooper = result.find((r) => r.userName === 'Alice Cooper')!;
      // Each variant keeps ONLY its own lead-cost row — never the other's.
      expect(alice.totalCostAud).toBe(200);
      expect(aliceCooper.totalCostAud).toBe(300);
      expect(alice.costPartial).toBe(false);
      expect(aliceCooper.costPartial).toBe(false);
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesChargeableSummary(UNRESTRICTED);
      expect(result).toEqual({ chargeableHours: 10, nonChargeableHours: 5 });
    });

    it('returns zeros when no entries exist', async () => {
      const prisma = makePrisma();
      const result = await new TimeEntriesReportService(prisma).timeEntriesChargeableSummary(UNRESTRICTED);
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
      await new TimeEntriesReportService(prisma).timeEntriesChargeableSummary(UNRESTRICTED, from, to);
      const window = { startTime: { gte: new Date(from), lte: new Date(to) } };
      const calls = prisma.clickupTimeEntry.aggregate.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0].where).toEqual(window);
      expect(calls[1][0].where).toEqual({ AND: [window, { isChargeable: true }] });
    });

    it('applies the scope filter to the window', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesChargeableSummary(NONE);
      const calls = prisma.clickupTimeEntry.aggregate.mock.calls;
      expect(calls[0][0].where.task).toEqual({ scopeClientOptionId: { in: [] } });
      expect(calls[1][0].where.AND[0].task).toEqual({ scopeClientOptionId: { in: [] } });
    });
  });

  describe('timeEntriesByClient', () => {
    it('maps raw SQL result to client, totalHours, totalCostAud', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ client: 'Acme Corp', total_hours: 5.5, total_cost_cents: 82500, has_led_cost: true, cost_partial: false }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByClient(UNRESTRICTED);
      expect(result[0]).toEqual({ client: 'Acme Corp', totalHours: 5.5, totalCostAud: 825, costPartial: false });
    });

    it('excludes soft-deleted tasks from the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TimeEntriesReportService(prisma).timeEntriesByClient(UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/t\.is_deleted\s*=\s*false/);
    });

    // Step 5: an empty scope must pin the query to FALSE, never "no filter".
    it('an empty scope applies FALSE to the SQL', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesByClient(NONE);
      const call = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      expect(call.sql).toMatch(/FALSE/);
    });

    it('nulls totalCostAud and flags costPartial for a client the viewer does not lead', async () => {
      const prisma = makePrisma();
      const LEAD_A = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }],
        teamClients: [{ teamId: 'A', optionId: 'acme' }],
        teamMembers: [],
      });
      prisma.$queryRaw.mockResolvedValue([
        { client: 'Acme Corp', total_hours: 5, total_cost_cents: 10000, has_led_cost: true, cost_partial: false },
        { client: 'Bolt Inc', total_hours: 3, total_cost_cents: 0, has_led_cost: false, cost_partial: true },
      ]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByClient(LEAD_A);
      const acme = result.find((r) => r.client === 'Acme Corp')!;
      const bolt = result.find((r) => r.client === 'Bolt Inc')!;
      expect(acme.totalCostAud).toBe(100);
      expect(acme.costPartial).toBe(false);
      expect(bolt.totalCostAud).toBeNull();
      expect(bolt.costPartial).toBe(true);
      // Hours are never masked.
      expect(bolt.totalHours).toBe(3);
    });

    // Fix round 1 (item 5): a group is masked/partial from its OWN rows'
    // led-visibility (BOOL_OR), not from a single MAX'd option id — so it
    // stays correct even if one client display NAME happened to straddle a
    // led and a non-led option id.
    it('sums only led-visible cost for a client group with mixed led/non-led rows', async () => {
      const prisma = makePrisma();
      const LEAD_A = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }],
        teamClients: [{ teamId: 'A', optionId: 'acme' }],
        teamMembers: [],
      });
      prisma.$queryRaw.mockResolvedValue([
        { client: 'Acme Corp', total_hours: 8, total_cost_cents: 5000, has_led_cost: true, cost_partial: true },
      ]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByClient(LEAD_A);
      expect(result[0].totalCostAud).toBe(50);
      expect(result[0].costPartial).toBe(true);
    });
  });

  describe('timeEntriesByDepartment', () => {
    it('maps raw SQL result to department, totalHours, totalCostAud', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ department: 'Engineering', total_hours: 20, total_cost_cents: 300000, has_led_cost: true, cost_partial: false }]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesByDepartment(UNRESTRICTED);
      expect(result[0]).toEqual({ department: 'Engineering', totalHours: 20, totalCostAud: 3000, costPartial: false });
    });

    it('nulls the cost for a department with zero led-visible rows, costPartial true', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ department: 'Sales', total_hours: 10, total_cost_cents: 0, has_led_cost: false, cost_partial: true }]);
      const scoped = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }],
        teamClients: [{ teamId: 'A', optionId: 'acme' }],
        teamMembers: [],
      });
      const result = await new TimeEntriesReportService(prisma).timeEntriesByDepartment(scoped);
      expect(result[0].totalCostAud).toBeNull();
      expect(result[0].costPartial).toBe(true);
      expect(result[0].totalHours).toBe(10);
    });

    it('sums only led-visible cost for a department with mixed led/non-led rows', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ department: 'Eng', total_hours: 12, total_cost_cents: 5000, has_led_cost: true, cost_partial: true }]);
      const scoped = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }],
        teamClients: [{ teamId: 'A', optionId: 'acme' }],
        teamMembers: [],
      });
      const result = await new TimeEntriesReportService(prisma).timeEntriesByDepartment(scoped);
      expect(result[0].totalCostAud).toBe(50);
      expect(result[0].costPartial).toBe(true);
    });
  });

  describe('overviewDeltas', () => {
    it('returns current + prior totals mapped to dollars', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([{ total_hours: 124.5, total_cost_cents: BigInt(1843250), entry_count: 9, has_led_cost: true, cost_partial: false }])
        .mockResolvedValueOnce([{ total_hours: 105.0, total_cost_cents: BigInt(1560000), entry_count: 7, has_led_cost: true, cost_partial: false }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas(
        UNRESTRICTED,
        '2026-05-01T00:00:00.000Z',
        '2026-05-31T23:59:59.999Z',
      );
      expect(result).toEqual({
        current: { totalHours: 124.5, totalCostAud: 18432.5, costPartial: false },
        prior:   { totalHours: 105,   totalCostAud: 15600,   costPartial: false },
      });
    });

    it('computes the prior window as [from - (to - from), from)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 0, total_cost_cents: BigInt(0) }]);
      await new TimeEntriesReportService(prisma).overviewDeltas(
        UNRESTRICTED,
        '2026-05-15T00:00:00.000Z',
        '2026-05-20T00:00:00.000Z',
      );
      const priorCall = prisma.$queryRaw.mock.calls[1][0];
      const sqlText: string = priorCall.sql ?? priorCall.text ?? String(priorCall);
      // Wrapped in `CASE WHEN <leadScopeSql> THEN e.cost_cents ELSE 0 END` now
      // (scoped viewers only sum led-visible cost) — check the sum still
      // targets cost_cents, not the exact pre-scoping literal text.
      expect(sqlText).toMatch(/SUM\(CASE WHEN[\s\S]*e\.cost_cents/);
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
      await new TimeEntriesReportService(prisma).overviewDeltas(UNRESTRICTED);
      const call0: string = prisma.$queryRaw.mock.calls[0][0].sql ?? String(prisma.$queryRaw.mock.calls[0][0]);
      const call1: string = prisma.$queryRaw.mock.calls[1][0].sql ?? String(prisma.$queryRaw.mock.calls[1][0]);
      expect(call0).toMatch(/t\.is_deleted\s*=\s*false/);
      expect(call1).toMatch(/t\.is_deleted\s*=\s*false/);
    });

    it('handles null sums (no rows in window)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: null, total_cost_cents: null, entry_count: 0, has_led_cost: null, cost_partial: null }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas(UNRESTRICTED);
      expect(result.current).toEqual({ totalHours: 0, totalCostAud: 0, costPartial: false });
      expect(result.prior).toEqual({ totalHours: 0, totalCostAud: 0, costPartial: false });
    });
  });

  describe('overviewDeltas (access scope)', () => {
    // Fix round 1 (R15): the requireLeadView gate now lives IN this method —
    // a plain scoped viewer who leads no team at all must never reach the
    // query.
    const NONE_SCOPE_PLAIN_MEMBER = NONE; // leads nothing: isLeadAnywhere === false.
    // Leads team A, but team A has no assigned clients — passes the gate
    // (isLeadAnywhere === true) while still resolving `visibleClientIds` to
    // `[]` (FALSE), so it exercises the "empty but a lead" branch the plain
    // `NONE` fixture can no longer reach once the gate runs first.
    const LEAD_NO_CLIENTS = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [], teamMembers: [],
    });
    const LEAD = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [{ teamId: 'A', role: 'LEAD' }],
      teamClients: [{ teamId: 'A', optionId: 'acme' }],
      teamMembers: [],
    });
    // LEAD of team A (client 'acme'), plain MEMBER of team B (client 'bolt')
    // — passes the gate via team A, but a window can still hold only 'bolt'
    // (non-led) rows.
    const LEAD_A_MEMBER_B = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [
        { teamId: 'A', role: 'LEAD' },
        { teamId: 'B', role: 'MEMBER' },
      ],
      teamClients: [
        { teamId: 'A', optionId: 'acme' },
        { teamId: 'B', optionId: 'bolt' },
      ],
      teamMembers: [],
    });

    // Ruling R1 (fix round 1, R15): requireLeadView, not requireLead — a
    // scoped non-lead 403s, but a flag-off MEMBER (unrestricted, canEdit:
    // false) reads it exactly as today. This coverage moved here from
    // test/reports.controller.spec.ts — the controller no longer gates.
    it('scoped viewer who leads no team: throws ForbiddenException, no query issued', async () => {
      const prisma = makePrisma();
      await expect(new TimeEntriesReportService(prisma).overviewDeltas(NONE_SCOPE_PLAIN_MEMBER)).rejects.toThrow(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('flag-off MEMBER (unrestricted, canEdit: false) reproduces today exactly — query runs', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 0, total_cost_cents: BigInt(0), entry_count: 0, has_led_cost: null, cost_partial: null }]);
      const FLAG_OFF_MEMBER: AccessScope = { kind: 'unrestricted', canEdit: false };
      await expect(new TimeEntriesReportService(prisma).overviewDeltas(FLAG_OFF_MEMBER)).resolves.toBeDefined();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    // Step 5: an empty (but leading) scope must pin both window queries to FALSE.
    it('an empty scope applies FALSE to both window queries', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 0, total_cost_cents: BigInt(0), entry_count: 0, has_led_cost: null, cost_partial: null }]);
      await new TimeEntriesReportService(prisma).overviewDeltas(LEAD_NO_CLIENTS);
      const call0 = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      const call1 = prisma.$queryRaw.mock.calls[1][0] as Prisma.Sql;
      expect(call0.sql).toMatch(/FALSE/);
      expect(call1.sql).toMatch(/FALSE/);
    });

    it('an empty window (no entries at all) reports 0 hours, $0 cost, costPartial false — not null/partial', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 0, total_cost_cents: BigInt(0), entry_count: 0, has_led_cost: null, cost_partial: null }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas(LEAD);
      expect(result.current).toEqual({ totalHours: 0, totalCostAud: 0, costPartial: false });
    });

    it('narrows cost to led clients only, via a CASE WHEN over leadScopeSql', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 5, total_cost_cents: BigInt(5000), entry_count: 3, has_led_cost: true, cost_partial: false }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas(LEAD);
      expect(result.current.totalCostAud).toBe(50);
      expect(result.current.costPartial).toBe(false);
      const call0 = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      expect(call0.sql).toMatch(/t\.scope_client_option_id = ANY/);
    });

    // Fix round 1 (item 2): a PARTIAL lead whose window holds in-scope rows
    // but ZERO of them are LEAD-visible must get `totalCostAud: null` (never
    // the old bug's misleading `0`), with `costPartial: true`.
    it('a partial lead whose window has rows but none of them led gets totalCostAud null, costPartial true', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 5, total_cost_cents: BigInt(0), entry_count: 3, has_led_cost: false, cost_partial: true }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas(LEAD_A_MEMBER_B);
      expect(result.current.totalHours).toBe(5);
      expect(result.current.totalCostAud).toBeNull();
      expect(result.current.costPartial).toBe(true);
    });

    it('a partial lead whose window has SOME led rows gets a partial sum, costPartial true', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 8, total_cost_cents: BigInt(3000), entry_count: 5, has_led_cost: true, cost_partial: true }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas(LEAD_A_MEMBER_B);
      expect(result.current.totalCostAud).toBe(30);
      expect(result.current.costPartial).toBe(true);
    });

    // Superseded case from before the gate moved here: a plain MEMBER (not a
    // lead anywhere) can no longer reach this method at all — see "scoped
    // viewer who leads no team" above. `LEAD_NO_CLIENTS` (a lead of a
    // clientless team) is the scope that still exercises "leads no client
    // anywhere" now that a non-lead is rejected earlier.
    it('nulls totalCostAud for a lead who leads no client anywhere', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ total_hours: 5, total_cost_cents: BigInt(0), entry_count: 2, has_led_cost: false, cost_partial: true }]);
      const result = await new TimeEntriesReportService(prisma).overviewDeltas(LEAD_NO_CLIENTS);
      expect(result.current.totalCostAud).toBeNull();
      expect(result.prior.totalCostAud).toBeNull();
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
      await new TimeEntriesReportService(prisma).timesheet('u1', undefined, undefined, UNRESTRICTED);
      const allSql = prisma.$queryRaw.mock.calls.map((c: any[]) => {
        const call = c[0];
        return call.sql ?? call.text ?? String(call);
      }).join('\n---\n');
      expect(allSql).not.toMatch(/start_time\s+AT TIME ZONE 'UTC'/);
      expect(allSql).toMatch(/start_time\s+AT TIME ZONE 'Asia\/Dhaka'/);
    });
  });

  describe('timesheet access', () => {
    const lead = resolveScope({ role: 'MEMBER', scopingEnabled: true, selfClickupId: 'cu-lead',
      memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [{ teamId: 'A', optionId: 'acme' }],
      teamMembers: [{ teamId: 'A', clickupUserId: 'cu-x' }] });
    it('lead may open a member’s timesheet', async () => {
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
      await expect(new TimeEntriesReportService(prisma).timesheet('cu-x', undefined, undefined, lead)).resolves.toBeDefined();
    });
    it('lead may NOT open an outsider’s timesheet, even one who logged on the lead’s clients', async () => {
      const prisma = { $queryRaw: jest.fn() } as any;
      await expect(new TimeEntriesReportService(prisma).timesheet('cu-outsider', undefined, undefined, lead)).rejects.toThrow(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
    it('a lead may always open their own timesheet even with no led members', async () => {
      const selfOnly = resolveScope({ role: 'MEMBER', scopingEnabled: true, selfClickupId: 'cu-self',
        memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [{ teamId: 'A', optionId: 'acme' }], teamMembers: [] });
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
      await expect(new TimeEntriesReportService(prisma).timesheet('cu-self', undefined, undefined, selfOnly)).resolves.toBeDefined();
    });
    it('an unrestricted viewer may open any timesheet', async () => {
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
      await expect(new TimeEntriesReportService(prisma).timesheet('anyone', undefined, undefined, UNRESTRICTED)).resolves.toBeDefined();
    });
    it('the timesheet is NOT client-filtered (decision 10) — other-team rows come back with null cost', async () => {
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([
        { day: '2026-09-14', task_id: 't1', task_name: 'Landing', client_option_id: 'acme', user_name: 'X', hours: 5, valid_cost_cents: 25000n, entry_count: 1, missing_rate_count: 0 },
        { day: '2026-09-14', task_id: 't2', task_name: 'Onboarding', client_option_id: 'zulu', user_name: 'X', hours: 3, valid_cost_cents: 15000n, entry_count: 1, missing_rate_count: 0 },
      ]) } as any;
      const sheet = await new TimeEntriesReportService(prisma).timesheet('cu-x', '2026-09-14', '2026-09-14', lead);
      const sql = (prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql).sql;
      expect(sql).not.toContain('scope_client_option_id = ANY');
      expect(JSON.stringify(sheet)).toContain('Onboarding');
      expect(sheet.costPartial).toBe(true);
    });
  });

  describe('timeEntriesAssignees', () => {
    it('unrestricted: queries with no join, mapped id/name/email', async () => {
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ user_id: 'u1', user_name: 'Alice', user_email: 'a@x.com' }]) } as any;
      const result = await new TimeEntriesReportService(prisma).timeEntriesAssignees(UNRESTRICTED);
      expect(result).toEqual([{ id: 'u1', name: 'Alice', email: 'a@x.com' }]);
      const sql = (prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql).sql;
      expect(sql).not.toMatch(/JOIN clickup_tasks/);
    });

    it('scoped: LEFT JOINs clickup_tasks and ORs in the timesheet-visible user ids', async () => {
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
      const scope = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: 'cu-self',
        memberships: [{ teamId: 'A', role: 'LEAD' }],
        teamClients: [{ teamId: 'A', optionId: 'acme' }],
        teamMembers: [{ teamId: 'A', clickupUserId: 'cu-member' }],
      });
      await new TimeEntriesReportService(prisma).timeEntriesAssignees(scope);
      const call = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      expect(call.sql).toMatch(/LEFT JOIN clickup_tasks/);
      expect(call.sql).toMatch(/= ANY/);
    });

    // Fix round 1 (item 4): a task-less entry (e.g. an expense-style logger)
    // leaves `t` NULL on the LEFT JOIN — `taskScopeSql` reads that as NOT in
    // scope (default deny holds), so ONLY the `OR user_id = ANY(...)` half of
    // the WHERE clause can admit a led member through their task-less rows.
    // An INNER JOIN would have dropped that member from the timesheet picker
    // entirely, contradicting the picker's whole purpose.
    it('a led member with only task-less entries still appears (LEFT JOIN, not INNER)', async () => {
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ user_id: 'cu-member', user_name: 'Expense Bot', user_email: null }]) } as any;
      const scope = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: 'cu-self',
        memberships: [{ teamId: 'A', role: 'LEAD' }],
        teamClients: [{ teamId: 'A', optionId: 'acme' }],
        teamMembers: [{ teamId: 'A', clickupUserId: 'cu-member' }],
      });
      const result = await new TimeEntriesReportService(prisma).timeEntriesAssignees(scope);
      expect(result).toEqual([{ id: 'cu-member', name: 'Expense Bot', email: null }]);
    });

    it('does not error when the viewer leads nobody and has no self id', async () => {
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
      await expect(new TimeEntriesReportService(prisma).timeEntriesAssignees(NONE)).resolves.toEqual([]);
    });
  });

  describe('timeEntriesList (client filter + column)', () => {
    it('wraps a single client in an IN clause inside where.AND (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp'] } } });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED);
      const selectArg = prisma.clickupTimeEntry.findMany.mock.calls[0][0].select;
      expect(selectArg.task.select.client).toBe(true);
      expect(result.items[0].client).toBe('Acme Corp');
    });

    it('passes subProject through to the where-clause and maps the task sub-projects', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([{
        timeEntryId: 't1', taskId: 'k1', userId: 'u1', userName: 'Alice', userEmail: 'a@x.com',
        startTime: new Date('2026-05-01T00:00:00Z'), endTime: null,
        durationHours: { toNumber: () => 2 }, hourlyRateCents: BigInt(15000),
        costCents: BigInt(30000), status: 'COST_CALCULATED', billable: true,
        description: null, syncedAt: new Date('2026-05-01T00:00:00Z'), rateId: null, currency: 'USD',
        task: { taskName: 'Build thing', client: 'Acme Corp', subProjects: ['Mobile App', 'Website'] },
      }]);
      prisma.clickupTimeEntry.count.mockResolvedValue(1);
      const result = await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        'Mobile App',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.AND).toContainEqual({ task: { subProjects: { hasSome: ['Mobile App'] } } });
      expect(arg.select.task.select.subProjects).toBe(true);
      expect(result.items[0].subProjects).toEqual(['Mobile App', 'Website']);
    });

    it('passes subProject through to the aggregates where-clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, 'Website',
      );
      const arg = prisma.clickupTimeEntry.aggregate.mock.calls[0][0];
      expect(arg.where.AND).toContainEqual({ task: { subProjects: { hasSome: ['Website'] } } });
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED);
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
      const { items } = await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED);
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
      const { items } = await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED);
      expect(items[0].chargeable).toBe(true);
    });
  });

  describe('timeEntriesList (list filter + column)', () => {
    it('wraps a single listId in an IN clause inside where.AND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L1'] } } });
    });

    it('splits a comma-separated listId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED);
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED);
      expect(result.items[0].listName).toBeNull();
    });
  });

  describe('timeEntriesList (folder filter)', () => {
    it('wraps a single folderId in an IN clause inside where.AND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { folderId: { in: ['F1'] } } });
    });

    it('splits a comma-separated folderId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
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
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'exclude',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ NOT: { task: { archived: true } } });
    });

    it("pushes an archived-task clause when archived='only'", async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
        undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'only',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { archived: true } });
    });

    it("adds no archived clause when archived='include' or undefined", async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
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
      return new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
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
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, 'completed',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { listId: { in: ['L9'] } } });
    });

    it('emits no extra clause when sprintStatus="all"', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
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
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED, 'u1');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1'] });
    });

    it('splits a comma-separated userId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED, 'u1,u2');
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1', 'u2'] });
    });

    it('omits the userId clause when userId is undefined', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED);
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.userId).toBeUndefined();
    });
  });

  describe('timeEntriesList (status filter)', () => {
    it('wraps a single status in an IN clause (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
        undefined, undefined, undefined, 'NO_RATE_FOUND',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['NO_RATE_FOUND'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
        undefined, undefined, undefined, 'COST_CALCULATED,COST_EXCLUDED',
      );
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['COST_CALCULATED', 'COST_EXCLUDED'] });
    });

    it('missingOnly still forces the scalar NO_RATE_FOUND and overrides a multi-value status', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(UNRESTRICTED,
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
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { client: { in: ['Acme Corp'] } } });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
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
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
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
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
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
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED, 'u1,u2');
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.userId).toEqual({ in: ['u1', 'u2'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
        undefined, undefined, undefined, 'COST_CALCULATED,COST_EXCLUDED',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['COST_CALCULATED', 'COST_EXCLUDED'] });
    });

    it('missingOnly still forces the scalar NO_RATE_FOUND', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
        undefined, undefined, undefined, 'COST_CALCULATED', undefined, undefined, undefined, 'true',
      );
      const arg = prisma.clickupTimeEntry.groupBy.mock.calls[0][0];
      expect(arg.where.status).toBe('NO_RATE_FOUND');
    });
  });

  describe('timeEntriesAggregates (access scope)', () => {
    // LEAD of team A (client 'acme'), plain MEMBER of team B (client 'bolt').
    const LEAD_A_MEMBER_B = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [
        { teamId: 'A', role: 'LEAD' },
        { teamId: 'B', role: 'MEMBER' },
      ],
      teamClients: [
        { teamId: 'A', optionId: 'acme' },
        { teamId: 'B', optionId: 'bolt' },
      ],
      teamMembers: [],
    });
    // Plain MEMBER of team A (client 'acme') — sees 'acme' rows but LEADS
    // nothing (Ruling R12 / fix round 1, item 3).
    const MEMBER_ONLY_A = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [{ teamId: 'A', role: 'MEMBER' }],
      teamClients: [{ teamId: 'A', optionId: 'acme' }],
      teamMembers: [],
    });

    it('narrows every cost total to led clients only, and flags costPartial when visible-but-not-led rows exist', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.aggregate
        // totalAgg: every VISIBLE (member-or-lead) entry — 5 of them, 15h. Its
        // costCents/hours must NEVER surface: that would leak 'bolt' cost, or
        // (fix round 1, item 2) understate the rate by dividing led cost by
        // every visible hour instead of just the LED ones.
        .mockResolvedValueOnce({ _count: 5, _sum: { durationHours: { toNumber: () => 15 }, costCents: BigInt(999999) } })
        .mockResolvedValueOnce({ _sum: { durationHours: { toNumber: () => 10 } } })
        // costAgg: only the 3 LED entries — 4h, not the 15h every visible
        // entry totals. Dividing 50000 by 15h would give 3333; the correct
        // rate divides by the 4 LED hours: 12500.
        .mockResolvedValueOnce({ _count: 3, _sum: { costCents: BigInt(50000), durationHours: { toNumber: () => 4 } } });
      const result = await new TimeEntriesReportService(prisma).timeEntriesAggregates(LEAD_A_MEMBER_B);
      expect(result.totalCostCents).toBe(50000);
      expect(result.avgRateCents).toBe(12500);
      expect(result.costPartial).toBe(true);
      const calls = prisma.clickupTimeEntry.aggregate.mock.calls;
      expect(calls).toHaveLength(3);
      expect((calls[2][0].where as any).AND).toContainEqual({ task: { scopeClientOptionId: { in: ['acme'] } } });
    });

    it('unrestricted scope skips the extra cost aggregate and costPartial is false', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.aggregate
        .mockResolvedValueOnce({ _count: 5, _sum: { durationHours: { toNumber: () => 15 }, costCents: BigInt(100000) } })
        .mockResolvedValueOnce({ _sum: { durationHours: { toNumber: () => 10 } } });
      const result = await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED);
      expect(result.totalCostCents).toBe(100000);
      expect(result.costPartial).toBe(false);
      expect(prisma.clickupTimeEntry.aggregate.mock.calls).toHaveLength(2);
    });

    // Ruling R12 (fix round 1, item 3): leading NO client in scope must read
    // as "can't see it" (null), never as a misleadingly precise $0/avg.
    it('a MEMBER-only scope (leads no client) gets totalCostCents/avgRateCents: null, with costPartial true when visible rows exist', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.aggregate
        .mockResolvedValueOnce({ _count: 5, _sum: { durationHours: { toNumber: () => 15 }, costCents: BigInt(999999) } })
        .mockResolvedValueOnce({ _sum: { durationHours: { toNumber: () => 10 } } })
        // costAgg scoped to `scopeClientOptionId: { in: [] }` — matches nothing.
        .mockResolvedValueOnce({ _count: 0, _sum: { costCents: BigInt(0), durationHours: { toNumber: () => 0 } } });
      const result = await new TimeEntriesReportService(prisma).timeEntriesAggregates(MEMBER_ONLY_A);
      expect(result.totalCostCents).toBeNull();
      expect(result.avgRateCents).toBeNull();
      expect(result.costPartial).toBe(true);
      const calls = prisma.clickupTimeEntry.aggregate.mock.calls;
      expect((calls[2][0].where as any).AND).toContainEqual({ task: { scopeClientOptionId: { in: [] } } });
    });

    it('a MEMBER-only scope with no visible rows gets costPartial: false', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.aggregate
        .mockResolvedValueOnce({ _count: 0, _sum: { durationHours: { toNumber: () => 0 }, costCents: BigInt(0) } })
        .mockResolvedValueOnce({ _sum: { durationHours: { toNumber: () => 0 } } })
        .mockResolvedValueOnce({ _count: 0, _sum: { costCents: BigInt(0), durationHours: { toNumber: () => 0 } } });
      const result = await new TimeEntriesReportService(prisma).timeEntriesAggregates(MEMBER_ONLY_A);
      expect(result.totalCostCents).toBeNull();
      expect(result.costPartial).toBe(false);
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
      await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED,
        undefined, from, to, undefined, undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const expectedWhere = await buildTimeEntryWhere(prisma, {
        from: new Date(from), to: new Date(to), client: 'Acme Corp',
      }, { kind: 'unrestricted', canEdit: true });
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED);
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
      const result = await new TimeEntriesReportService(prisma).timeEntriesAggregates(UNRESTRICTED);
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
        { userId: 'u1', _max: { userName: 'Ada' }, _count: 2, _sum: { durationHours: hrs(3) } },
        { userId: 'u2', _max: { userName: 'Grace' }, _count: 1, _sum: { durationHours: hrs(2) } },
      ]);

      const rows = await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1', UNRESTRICTED);

      expect(rows).toEqual([
        { userId: 'u1', userName: 'Ada', entryCount: 2, hours: 3, rule: null, chargeable: true, source: 'task' },
        { userId: 'u2', userName: 'Grace', entryCount: 1, hours: 2, rule: false, chargeable: false, source: 'assignee' },
      ]);
      // Grouped by userId alone (not `['userId', 'userName']`) so the DB does
      // the merging for us.
      expect(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].by).toEqual(['userId']);
    });

    // Regression: grouping by ['userId', 'userName'] gave one person two rows
    // — and two React keys in the drawer, keyed on userId — whenever their
    // ClickUp display name changed between two entries on the same task.
    // `_max: { userName }` (mirroring `tasksLists`'s `MAX(space_name)` in
    // tasks-report.service.ts for the same reason) lets Prisma's groupBy
    // merge those rows in the database; this simulates the single merged row
    // it returns for a user with two historical names, with combined counts
    // and hours, and checks the service surfaces exactly one row for them.
    it('merges one user\'s historical display names into a single row with combined totals', async () => {
      const prisma = makePrisma({
        clickupTask: { findUnique: jest.fn().mockResolvedValue({ isChargeable: true }) },
        taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([]) },
      });
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        // What the DB returns after merging 'Ada' and 'Ada Lovelace' entries
        // for the same userId: one row, _count and _sum already combined,
        // _max picking one representative name.
        { userId: 'u1', _max: { userName: 'Ada Lovelace' }, _count: 3, _sum: { durationHours: { toNumber: () => 5.5 } } },
      ]);

      const rows = await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1', UNRESTRICTED);

      expect(rows).toEqual([
        { userId: 'u1', userName: 'Ada Lovelace', entryCount: 3, hours: 5.5, rule: null, chargeable: true, source: 'task' },
      ]);
    });

    // The prospective case that standing rules exist for: a rule set before
    // anyone logs time. Building the row set from the time-entry groupBy alone
    // dropped it — so the rule was invisible in the drawer and unclearable
    // there, while the Tasks page pill (which reads the rules directly) said
    // "partial". The two views contradicted each other.
    it('includes an assignee who has a rule but has logged no time', async () => {
      const prisma = makePrisma({
        clickupTask: { findUnique: jest.fn().mockResolvedValue({ isChargeable: true }) },
        taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([{ userId: 'u9', chargeable: false }]) },
      });
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([]);

      const rows = await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1', UNRESTRICTED);

      // No name to show: the rule table keys on the ClickUp user id and there
      // is no entry to borrow a display name from. The drawer falls back to
      // the id rather than inventing one.
      expect(rows).toEqual([
        { userId: 'u9', userName: null, entryCount: 0, hours: 0, rule: false, chargeable: false, source: 'assignee' },
      ]);
    });

    it('does not duplicate an assignee who has both a rule and logged time', async () => {
      const prisma = makePrisma({
        clickupTask: { findUnique: jest.fn().mockResolvedValue({ isChargeable: true }) },
        taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1', chargeable: false }]) },
      });
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { userId: 'u1', _max: { userName: 'Ada' }, _count: 2, _sum: { durationHours: { toNumber: () => 3 } } },
      ]);

      const rows = await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1', UNRESTRICTED);

      expect(rows).toEqual([
        { userId: 'u1', userName: 'Ada', entryCount: 2, hours: 3, rule: false, chargeable: false, source: 'assignee' },
      ]);
    });

    it('drops entries with no logger, which have no identity to key a rule on', async () => {
      const prisma = makePrisma({
        clickupTask: { findUnique: jest.fn().mockResolvedValue({ isChargeable: true }) },
        taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([]) },
      });
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { userId: null, _max: { userName: null }, _count: 1, _sum: { durationHours: { toNumber: () => 1 } } },
      ]);

      expect(await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1', UNRESTRICTED)).toEqual([]);
    });

    it('unrestricted: a missing task does not throw, reproducing today’s behaviour', async () => {
      const prisma = makePrisma({
        clickupTask: { findUnique: jest.fn().mockResolvedValue(null) },
        taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([]) },
      });
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { userId: 'u1', _max: { userName: 'Ada' }, _count: 1, _sum: { durationHours: { toNumber: () => 1 } } },
      ]);
      await expect(new TimeEntriesReportService(prisma).taskAssigneeChargeability('ghost', UNRESTRICTED)).resolves.toEqual([
        { userId: 'u1', userName: 'Ada', entryCount: 1, hours: 1, rule: null, chargeable: true, source: 'default' },
      ]);
      expect(prisma.clickupTask.findUnique).toHaveBeenCalled();
    });

    it('scoped: a missing or out-of-scope task 404s, without reading rules/entries', async () => {
      const prisma = makePrisma({
        clickupTask: { findFirst: jest.fn().mockResolvedValue(null) },
        taskAssigneeChargeability: { findMany: jest.fn() },
      });
      const lead = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }],
        teamClients: [{ teamId: 'A', optionId: 'acme' }],
        teamMembers: [],
      });
      await expect(new TimeEntriesReportService(prisma).taskAssigneeChargeability('ghost', lead)).rejects.toThrow('Task not found');
      expect(prisma.taskAssigneeChargeability.findMany).not.toHaveBeenCalled();
      expect(prisma.clickupTimeEntry.groupBy).not.toHaveBeenCalled();
    });

    it('scoped: an in-scope task masks any cost fields on the rows (defensive — no cost fields today)', async () => {
      const prisma = makePrisma({
        clickupTask: { findFirst: jest.fn().mockResolvedValue({ isChargeable: true, scopeClientOptionId: 'bolt' }) },
        taskAssigneeChargeability: { findMany: jest.fn().mockResolvedValue([]) },
      });
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { userId: 'u1', _max: { userName: 'Ada' }, _count: 1, _sum: { durationHours: { toNumber: () => 1 } } },
      ]);
      const lead = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }],
        teamClients: [{ teamId: 'A', optionId: 'acme' }],
        teamMembers: [],
      });
      const rows = await new TimeEntriesReportService(prisma).taskAssigneeChargeability('t1', lead);
      const call = prisma.clickupTask.findFirst.mock.calls[0][0];
      expect(call.where.scopeClientOptionId).toEqual({ in: ['acme'] });
      expect(rows).toEqual([
        { userId: 'u1', userName: 'Ada', entryCount: 1, hours: 1, rule: null, chargeable: true, source: 'task' },
      ]);
    });
  });

  describe('timeEntriesList (access scope)', () => {
    // A MEMBER of exactly zero teams: `visibleClientIds` resolves to `[]`, so
    // the where-clause must pin to an empty IN list (matches nothing) rather
    // than fall through to "no filter".
    const NONE = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [], teamClients: [], teamMembers: [],
    });
    // LEAD of team A (client 'acme'), plain MEMBER of team B (client 'bolt').
    const LEAD_A_MEMBER_B = resolveScope({
      role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
      memberships: [
        { teamId: 'A', role: 'LEAD' },
        { teamId: 'B', role: 'MEMBER' },
      ],
      teamClients: [
        { teamId: 'A', optionId: 'acme' },
        { teamId: 'B', optionId: 'bolt' },
      ],
      teamMembers: [],
    });

    function entryRow(timeEntryId: string, scopeClientOptionId: string | null) {
      return {
        timeEntryId, taskId: 'k1', userId: 'u1', userName: 'Alice', userEmail: 'a@x.com',
        startTime: new Date('2026-05-01T00:00:00Z'), endTime: null,
        durationHours: { toNumber: () => 2 }, hourlyRateCents: BigInt(15000),
        costCents: BigInt(30000), status: 'COST_CALCULATED', billable: true,
        description: null, syncedAt: new Date('2026-05-01T00:00:00Z'), rateId: 7n, currency: 'USD',
        isChargeable: true, chargeableOverride: null,
        task: { taskName: 'T', client: 'Acme', subProjects: [], listName: null, scopeClientOptionId },
      };
    }

    it('an empty scope pins the query to an empty id list', async () => {
      const prisma = makePrisma();
      await new TimeEntriesReportService(prisma).timeEntriesList(NONE);
      const arg = prisma.clickupTimeEntry.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ task: { scopeClientOptionId: { in: [] } } });
    });

    it('masks cost fields on rows outside the clients the viewer LEADS, keeps them on led rows', async () => {
      const prisma = makePrisma();
      prisma.clickupTimeEntry.findMany.mockResolvedValue([entryRow('e-acme', 'acme'), entryRow('e-bolt', 'bolt')]);
      const result = await new TimeEntriesReportService(prisma).timeEntriesList(LEAD_A_MEMBER_B);
      const acme = result.items.find((i) => i.timeEntryId === 'e-acme')!;
      const bolt = result.items.find((i) => i.timeEntryId === 'e-bolt')!;
      expect(acme.hourlyRateCents).toBe(15000);
      expect(acme.costAud).toBe(300);
      expect(acme.rateId).toBe('7');
      expect(bolt.hourlyRateCents).toBeNull();
      expect(bolt.costAud).toBeNull();
      expect(bolt.rateId).toBeNull();
      // Non-cost fields (hours, currency) survive the mask.
      expect(bolt.durationHours).toBe(2);
      expect(bolt.currency).toBe('USD');
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

  it('filters by sub-project and maps each row\'s task sub-projects (empty for the task-less bucket)', async () => {
    const prisma = makePrisma(
      [group({ taskId: 't1' }), group({ taskId: null })],
      [{ taskId: 't1', taskName: 'Build', client: null, listName: null, subProjects: ['Website'] }],
    );
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED,  subProject: 'Website' });
    expect(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where.AND)
      .toContainEqual({ task: { subProjects: { hasSome: ['Website'] } } });
    expect(prisma.clickupTask.findMany.mock.calls[0][0].select.subProjects).toBe(true);
    expect(items.find((i) => i.taskId === 't1')?.subProjects).toEqual(['Website']);
    expect(items.find((i) => i.taskId === '__none__')?.subProjects).toEqual([]);
  });

  it('collapses a task\'s entries into a single row carrying their summed hours', async () => {
    const prisma = makePrisma([
      group({ _count: 2, _sum: { durationHours: { toNumber: () => 2.5 }, costCents: BigInt(5000) } }),
      group({ userId: 'u2', userName: 'Bob', _count: 1, _sum: { durationHours: { toNumber: () => 1.25 }, costCents: BigInt(2500) } }),
    ]);
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
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
    const { total } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
    expect(total).toBe(2);
  });

  it('gathers entries with no task under one bucket instead of dropping them', async () => {
    const prisma = makePrisma([
      group({ taskId: null, _count: 2, _sum: { durationHours: { toNumber: () => 4 }, costCents: BigInt(0) } }),
    ]);
    const { items, total } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
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
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
    expect(items[0].costAud).toBe(90);
    expect(items[0].missingRateCount).toBe(3);
    expect(items[0].totalHours).toBe(6);
  });

  it('counts cost-excluded entries so a fully-excluded task can\'t read as costed', async () => {
    const prisma = makePrisma([
      group({ status: 'COST_EXCLUDED', _count: 4, _sum: { durationHours: { toNumber: () => 7 }, costCents: BigInt(0) } }),
    ]);
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
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
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
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
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
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
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
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
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
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
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
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
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED, });
    expect(items[0].lastActivity).toEqual(new Date('2026-02-02T09:00:00.000Z'));
  });

  it('orders the heaviest tasks first and paginates over tasks', async () => {
    const prisma = makePrisma([
      group({ taskId: 'small', _sum: { durationHours: { toNumber: () => 1 }, costCents: BigInt(0) } }),
      group({ taskId: 'big', _sum: { durationHours: { toNumber: () => 9 }, costCents: BigInt(0) } }),
      group({ taskId: 'mid', _sum: { durationHours: { toNumber: () => 5 }, costCents: BigInt(0) } }),
    ]);
    const { items, total } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED,  limit: 1, offset: 1 });
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
    const { items } = await svc(prisma).timeEntriesByTask({scope: UNRESTRICTED,  limit: 1 });
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
    await svc(prisma).timeEntriesByTask({ ...filters, scope: UNRESTRICTED });
    await svc(listPrisma).timeEntriesList(UNRESTRICTED,
      filters.userId, filters.from, filters.to, undefined, 50, 0, filters.chargeable,
      filters.search, undefined, undefined, filters.client, undefined, undefined, filters.archived,
    );
    expect(prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where)
      .toEqual(listPrisma.clickupTimeEntry.findMany.mock.calls[0][0].where);
  });
});

describe('TimeEntriesReportService.timeEntriesByTask (access scope)', () => {
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

  // A MEMBER of exactly zero teams: `visibleClientIds` resolves to `[]`, so
  // the where-clause must pin to an empty IN list (matches nothing) rather
  // than fall through to "no filter".
  const NONE = resolveScope({
    role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
    memberships: [], teamClients: [], teamMembers: [],
  });
  // LEAD of team A (client 'acme'), plain MEMBER of team B (client 'bolt').
  const LEAD_A_MEMBER_B = resolveScope({
    role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
    memberships: [
      { teamId: 'A', role: 'LEAD' },
      { teamId: 'B', role: 'MEMBER' },
    ],
    teamClients: [
      { teamId: 'A', optionId: 'acme' },
      { teamId: 'B', optionId: 'bolt' },
    ],
    teamMembers: [],
  });

  it('an empty scope pins the query to an empty id list', async () => {
    const prisma = makePrisma([]);
    await svc(prisma).timeEntriesByTask({ scope: NONE });
    const where = prisma.clickupTimeEntry.groupBy.mock.calls[0][0].where;
    expect((where.AND ?? [])).toContainEqual({ task: { scopeClientOptionId: { in: [] } } });
  });

  it('masks costAud on tasks outside the clients the viewer LEADS, keeps it on led tasks', async () => {
    const prisma = makePrisma(
      [
        group({ taskId: 't-acme', _sum: { durationHours: { toNumber: () => 1 }, costCents: BigInt(500) } }),
        group({ taskId: 't-bolt', userId: 'u2', userName: 'B', _sum: { durationHours: { toNumber: () => 1 }, costCents: BigInt(700) } }),
      ],
      [
        { taskId: 't-acme', taskName: 'A', client: null, listName: null, scopeClientOptionId: 'acme' },
        { taskId: 't-bolt', taskName: 'B', client: null, listName: null, scopeClientOptionId: 'bolt' },
      ],
    );
    const { items } = await svc(prisma).timeEntriesByTask({ scope: LEAD_A_MEMBER_B });
    const acme = items.find((i) => i.taskId === 't-acme')!;
    const bolt = items.find((i) => i.taskId === 't-bolt')!;
    expect(acme.costAud).toBe(5);
    expect(bolt.costAud).toBeNull();
  });
});

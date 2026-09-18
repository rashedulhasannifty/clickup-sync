import { ForbiddenException } from '@nestjs/common';
import { SprintsReportService } from '../src/reports/sprints-report.service';
import { resolveScope, type AccessScope } from '../src/access/access-scope';

function makePrisma() {
  return { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
}

function sqlOf(call: any): string {
  return call.sql ?? call.text ?? String(call);
}

function valuesOf(call: any): unknown[] {
  return call.values ?? [];
}

// Shared fixture for calls in this file that don't care about scope behavior
// — `scope` is a required trailing param (Ruling R10), so every call needs
// one. The scope-specific describes below use their own NONE/LEAD scopes.
const UNRESTRICTED: AccessScope = { kind: 'unrestricted', canEdit: true };
// Flag-off MEMBER: scoping disabled entirely, unrestricted with canEdit:false.
// Ruling R1: requireLeadView must let this through unchanged (reads sprints
// exactly as today).
const FLAG_OFF_MEMBER: AccessScope = { kind: 'unrestricted', canEdit: false };
// A MEMBER of exactly zero teams: `isLeadAnywhere` is false, so requireLeadView
// must 403 before any query runs. Stands in for "scoped plain member".
const NONE = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [], teamClients: [], teamMembers: [],
});
// LEAD of team A (client 'acme'), plain MEMBER of team B (client 'bolt') —
// visible clients are {acme, bolt}, LEAD clients are {acme} only.
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
// LEAD of team A, but team A has no assigned clients — passes requireLeadView
// (isLeadAnywhere true) while visibleClientIds/leadClientIds resolve to [].
const LEAD_NO_CLIENTS = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [], teamMembers: [],
});

describe('SprintsReportService', () => {
  describe('sprints', () => {
    it('maps rows and status=completed filters archived=true', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: 'X Sprint', space_name: 'X',
            archived: true, start_date: null, due_date: null,
            task_total: 10n, task_done: 7n, hours: 12.5, cost_cents: 45000n,
            has_led_cost: true, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([{ total: 1n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprints({ status: 'completed' }, UNRESTRICTED);
      expect(res.items[0]).toMatchObject({
        listId: 'l1', taskTotal: 10, taskDone: 7, pctDone: 70, hours: 12.5, costAud: 450, archived: true,
        costPartial: false,
      });
      expect(res.total).toBe(1);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/l\.archived\s*=\s*true/);
    });

    it('defaults to status=active -> archived=false', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({}, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/l\.archived\s*=\s*false/);
    });

    it('status=all applies no archived filter', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({ status: 'all' }, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/l\.archived\s*=/);
    });

    it('uses COUNT(DISTINCT t.task_id) so a fan-out time-entry join does not inflate task counts', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({}, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/COUNT\(DISTINCT t\.task_id\)/);
    });

    it('applies spaceId, folderId, and search filters', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({ spaceId: 'sp1', folderId: 'f1', search: 'Alpha' }, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/l\.space_id\s*=/);
      expect(sql).toMatch(/l\.folder_id\s*=/);
      expect(sql).toMatch(/l\.name ILIKE/);
    });

    it('binds limit/offset as normal query parameters, clamped to range', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({ limit: 999, offset: -5 }, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      // Prisma.Sql's `.sql` uses `?` placeholders (driver-specific `$n`/`?`
      // conversion happens later) — a bound param, not a spliced literal.
      expect(sql).toMatch(/LIMIT \? OFFSET \?/);
      const values = valuesOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(values).toContain(500); // clamped to the 1-500 cap
      expect(values).toContain(0); // clamped to >= 0
    });

    it('falls back to the default limit/offset for non-finite input instead of splicing NaN', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({ limit: NaN, offset: Infinity }, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/NaN|Infinity/);
      const values = valuesOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(values.every((v) => typeof v !== 'number' || Number.isFinite(v))).toBe(true);
      expect(values).toContain(50); // default limit fallback
      expect(values).toContain(0); // default offset fallback
    });

    it('keeps a pathologically large offset a finite clamped integer', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({ offset: 1e21 }, UNRESTRICTED);
      const values = valuesOf(prisma.$queryRaw.mock.calls[0][0]);
      const offsetValue = values.find((v) => typeof v === 'number' && v > 1000);
      expect(offsetValue).toBe(1_000_000_000);
      expect(Number.isFinite(offsetValue)).toBe(true);
    });

    it('pctDone is 0 when taskTotal is 0', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l2', name: 'Empty Sprint', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 0n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([{ total: 1n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprints({}, UNRESTRICTED);
      expect(res.items[0].pctDone).toBe(0);
    });
  });

  describe('sprints (access scope)', () => {
    it('403s a scoped plain member, no query issued', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprints({}, NONE)).rejects.toThrow(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('flag-off MEMBER (unrestricted, canEdit: false) reads sprints exactly as today', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprints({}, FLAG_OFF_MEMBER)).resolves.toBeDefined();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('unrestricted: join is unscoped (TRUE) and no HAVING clause is added', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({}, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/HAVING/);
      const totalSql = sqlOf(prisma.$queryRaw.mock.calls[1][0]);
      expect(totalSql).not.toMatch(/EXISTS/);
    });

    it('a LEAD scope scopes the join, adds HAVING, and scopes the total count via EXISTS', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({}, LEAD_A_MEMBER_B);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/scope_client_option_id = ANY\(/);
      expect(sql).toMatch(/HAVING COUNT\(t\.task_id\) > 0/);
      const totalSql = sqlOf(prisma.$queryRaw.mock.calls[1][0]);
      expect(totalSql).toMatch(/EXISTS/);
      expect(totalSql).toMatch(/scope_client_option_id = ANY\(/);
    });

    it('sums cost only over LEAD clients; a mixed row is costPartial with a partial sum', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Mixed Sprint', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 3n, task_done: 1n, hours: 10, cost_cents: 4000n,
            has_led_cost: true, cost_partial: true,
          },
        ])
        .mockResolvedValueOnce([{ total: 1n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprints({}, LEAD_A_MEMBER_B);
      expect(res.items[0].costAud).toBe(40);
      expect(res.items[0].costPartial).toBe(true);
    });

    it('nulls costAud (not $0) when the lead has in-scope rows but no LEAD-visible cost', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Bolt-only Sprint', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 2n, task_done: 0n, hours: 5, cost_cents: 0n,
            has_led_cost: false, cost_partial: true,
          },
        ])
        .mockResolvedValueOnce([{ total: 1n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprints({}, LEAD_A_MEMBER_B);
      expect(res.items[0].hours).toBe(5);
      expect(res.items[0].costAud).toBeNull();
      expect(res.items[0].costPartial).toBe(true);
    });

    it('leads no client at all: costAud null, costPartial false when no cost was excluded', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Empty Lead Sprint', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 0n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([{ total: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprints({}, LEAD_NO_CLIENTS);
      expect(res.items[0].costAud).toBeNull();
    });
  });

  describe('sprintFolders', () => {
    it('maps folder rollup rows and filters by spaceId when given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([
        { folder_id: 'f1', folder_name: 'X Sprints', space_name: 'X', active_count: 2n, completed_count: 5n },
      ]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprintFolders('sp1', UNRESTRICTED);
      expect(res[0]).toMatchObject({ folderId: 'f1', folderName: 'X Sprints', spaceName: 'X', activeCount: 2, completedCount: 5 });
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/space_id\s*=/);
      expect(sql).toMatch(/folder_id IS NOT NULL/);
    });

    it('omits the spaceId filter when not given', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprintFolders(undefined, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/space_id\s*=/);
    });
  });

  describe('sprintFolders (access scope)', () => {
    it('403s a scoped plain member, no query issued', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintFolders(undefined, NONE)).rejects.toThrow(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('flag-off MEMBER reads sprintFolders exactly as today', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintFolders(undefined, FLAG_OFF_MEMBER)).resolves.toBeDefined();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('unrestricted: no EXISTS filter is added', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprintFolders(undefined, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/EXISTS/);
    });

    it('a LEAD scope counts only lists with an in-scope task via EXISTS', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprintFolders(undefined, LEAD_A_MEMBER_B);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/EXISTS/);
      expect(sql).toMatch(/scope_client_option_id = ANY\(/);
    });
  });

  describe('sprintDetail', () => {
    it('assembles list + byStatus + byAssignee + assigneeCount + cycleTimeHours', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: 'X Sprint', space_name: 'X',
            archived: false, start_date: null, due_date: new Date('2026-07-07'),
            task_total: 4n, task_done: 2n, hours: 20, cost_cents: 10000n,
            has_led_cost: true, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([{ status: 'done', color: '#00ff00', count: 2n }])
        .mockResolvedValueOnce([{ user_name: 'Alice', hours: 15, cost_cents: 7500n, has_led_cost: true, cost_partial: false }])
        .mockResolvedValueOnce([{ mean_hours: 36.5, task_count: 2n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprintDetail('l1', UNRESTRICTED);
      expect(res.list).toMatchObject({ listId: 'l1', taskTotal: 4, taskDone: 2, pctDone: 50 });
      expect(res.byStatus).toEqual([{ status: 'done', color: '#00ff00', count: 2 }]);
      expect(res.byAssignee).toEqual([{ userName: 'Alice', hours: 15, costAud: 75, costPartial: false }]);
      expect(res.assigneeCount).toBe(1);
      expect(res.cycleTimeHours).toBe(36.5);
    });

    it('returns cycleTimeHours=null when no task has both endpoints', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 1n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprintDetail('l1', UNRESTRICTED);
      expect(res.cycleTimeHours).toBeNull();
    });

    it('throws NotFoundException when the list row does not exist (unrestricted)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintDetail('missing', UNRESTRICTED)).rejects.toThrow();
    });

    it('unrestricted: a real, existing but genuinely empty list is NOT 404d (today\'s behaviour)', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Empty', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 0n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintDetail('l1', UNRESTRICTED)).resolves.toBeDefined();
    });

    it('scopes the cycle-time CTE to non-deleted tasks in the sprint', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 1n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprintDetail('l1', UNRESTRICTED);
      const cycleSql = sqlOf(prisma.$queryRaw.mock.calls[3][0]);
      expect(cycleSql).toMatch(/is_deleted = false/);
      expect(cycleSql).toMatch(/taskStatusUpdated/);
    });
  });

  describe('sprintDetail (access scope)', () => {
    it('403s a scoped plain member, no query issued', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintDetail('l1', NONE)).rejects.toThrow(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('flag-off MEMBER reads sprintDetail exactly as today', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 1n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintDetail('l1', FLAG_OFF_MEMBER)).resolves.toBeDefined();
    });

    it('every sub-query is scoped with scope_client_option_id = ANY( for a LEAD scope', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 2n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprintDetail('l1', LEAD_A_MEMBER_B);
      const [listSql, statusSql, assigneeSql, cycleSql] = prisma.$queryRaw.mock.calls.map((c: any) => sqlOf(c[0]));
      expect(listSql).toMatch(/scope_client_option_id = ANY\(/);
      expect(statusSql).toMatch(/scope_client_option_id = ANY\(/);
      expect(assigneeSql).toMatch(/scope_client_option_id = ANY\(/);
      expect(cycleSql).toMatch(/scope_client_option_id = ANY\(/);
    });

    it('scoped viewer with zero in-scope tasks in an existing list: 404s', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 0n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintDetail('l1', LEAD_A_MEMBER_B)).rejects.toThrow('Sprint (list) l1 not found');
    });

    it('scoped viewer with at least one in-scope task: not 404d', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 2n, task_done: 0n, hours: 0, cost_cents: 0n,
            has_led_cost: false, cost_partial: false,
          },
        ])
        .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintDetail('l1', LEAD_A_MEMBER_B)).resolves.toBeDefined();
    });

    it('byAssignee nulls costAud when the row has no LEAD-visible cost, keeps hours and marks costPartial', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 2n, task_done: 0n, hours: 8, cost_cents: 0n,
            has_led_cost: false, cost_partial: true,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ user_name: 'Bob', hours: 8, cost_cents: 0n, has_led_cost: false, cost_partial: true }])
        .mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprintDetail('l1', LEAD_A_MEMBER_B);
      expect(res.byAssignee).toEqual([{ userName: 'Bob', hours: 8, costAud: null, costPartial: true }]);
      expect(res.list.costAud).toBeNull();
      expect(res.list.costPartial).toBe(true);
    });
  });

  describe('velocity', () => {
    it('orders by due_date and caps to limit', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { list_id: 'l1', name: 'Sprint 1', due_date: new Date('2026-07-07'), task_done: 7n, hours: 12 },
      ]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.velocity('f1', 5, UNRESTRICTED);
      expect(res[0]).toMatchObject({ listId: 'l1', taskDone: 7, hours: 12 });
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/ORDER BY l\.due_date DESC NULLS LAST/);
      // Bound parameter (mirrors ops-report.service.ts), so the SQL text only
      // shows the `?` placeholder — assert the actual clamped value via `.values`.
      expect(sql).toMatch(/LIMIT \?/);
      expect(valuesOf(prisma.$queryRaw.mock.calls[0][0])).toContain(5);
    });

    it('clamps an out-of-range limit to the 1-100 cap', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.velocity('f1', 999, UNRESTRICTED);
      expect(valuesOf(prisma.$queryRaw.mock.calls[0][0])).toContain(100);
    });

    it('falls back to the default limit for non-finite input instead of splicing NaN', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.velocity('f1', NaN, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/NaN/);
      expect(valuesOf(prisma.$queryRaw.mock.calls[0][0])).toContain(12); // default
    });

    it('uses COUNT(DISTINCT t.task_id) so the time-entry join does not inflate taskDone', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.velocity('f1', undefined, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/COUNT\(DISTINCT t\.task_id\)/);
    });
  });

  describe('velocity (access scope)', () => {
    it('403s a scoped plain member, no query issued', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.velocity('f1', 12, NONE)).rejects.toThrow(ForbiddenException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('flag-off MEMBER reads velocity exactly as today', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.velocity('f1', 12, FLAG_OFF_MEMBER)).resolves.toBeDefined();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('unrestricted: no HAVING clause is added', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.velocity('f1', 12, UNRESTRICTED);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/HAVING/);
    });

    it('a LEAD scope scopes the join and skips sprints with zero in-scope tasks via HAVING', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.velocity('f1', 12, LEAD_A_MEMBER_B);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/scope_client_option_id = ANY\(/);
      expect(sql).toMatch(/HAVING COUNT\(t\.task_id\) > 0/);
    });
  });
});

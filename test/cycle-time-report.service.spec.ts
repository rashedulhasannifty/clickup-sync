import { CycleTimeReportService } from '../src/reports/cycle-time-report.service';
import { resolveScope, type AccessScope } from '../src/access/access-scope';

// Shared fixture for calls that don't care about scope behavior — `scope` is
// a required trailing param (Ruling R10), so every call needs one.
const UNRESTRICTED: AccessScope = { kind: 'unrestricted', canEdit: true };
// A MEMBER of exactly zero teams: `visibleClientIds` resolves to `[]`, so a
// scoped query must pin `taskIdInScopeSql` to FALSE rather than "no filter".
// cycle-time/time-in-status are NOT lead-gated (unlike the sprint routes) —
// any scoped viewer, including a plain member, gets an in-scope-tasks filter.
const NONE = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [], teamClients: [], teamMembers: [],
});
const MEMBER_A = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [{ teamId: 'A', role: 'MEMBER' }],
  teamClients: [{ teamId: 'A', optionId: 'acme' }],
  teamMembers: [],
});

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
      }, UNRESTRICTED);
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
      }, UNRESTRICTED);
      expect(result.items).toEqual([]);
      expect(result.meta.minOccurredAt).toBeNull();
    });

    it('an empty scope (NONE) pins both the items and meta queries to FALSE', async () => {
      const prisma = makePrisma();
      await new CycleTimeReportService(prisma).cycleTime({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'), groupBy: 'week',
      }, NONE);
      const itemsSql = prisma.$queryRaw.mock.calls[0][0].sql;
      const metaSql = prisma.$queryRaw.mock.calls[1][0].sql;
      expect(itemsSql).toMatch(/FALSE/);
      expect(metaSql).toMatch(/FALSE/);
    });

    it('a scoped viewer with visible clients scopes both queries via a task-id subselect', async () => {
      const prisma = makePrisma();
      await new CycleTimeReportService(prisma).cycleTime({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'), groupBy: 'week',
      }, MEMBER_A);
      const itemsSql = prisma.$queryRaw.mock.calls[0][0].sql;
      const metaSql = prisma.$queryRaw.mock.calls[1][0].sql;
      expect(itemsSql).toMatch(/e\.task_id IN \(SELECT task_id FROM clickup_tasks WHERE scope_client_option_id = ANY\(/);
      expect(metaSql).toMatch(/e\.task_id IN \(SELECT task_id FROM clickup_tasks WHERE scope_client_option_id = ANY\(/);
      // meta query wasn't aliased before — must alias `e` to attach the filter.
      expect(metaSql).toMatch(/FROM clickup_task_events e/);
    });

    it('unrestricted: neither query carries a scope filter', async () => {
      const prisma = makePrisma();
      await new CycleTimeReportService(prisma).cycleTime({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'), groupBy: 'week',
      }, UNRESTRICTED);
      const itemsSql = prisma.$queryRaw.mock.calls[0][0].sql;
      const metaSql = prisma.$queryRaw.mock.calls[1][0].sql;
      expect(itemsSql).not.toMatch(/FALSE/);
      expect(itemsSql).not.toMatch(/scope_client_option_id/);
      expect(metaSql).not.toMatch(/FALSE/);
      expect(metaSql).not.toMatch(/scope_client_option_id/);
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
      }, UNRESTRICTED);
      expect(result.items[0]).toEqual({
        status: 'in progress', color: '#3b82f6', totalHours: 124.5, taskCount: 12,
      });
    });

    it('an empty scope (NONE) pins both the items and meta queries to FALSE', async () => {
      const prisma = makePrisma();
      await new CycleTimeReportService(prisma).timeInStatus({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'),
      }, NONE);
      const itemsSql = prisma.$queryRaw.mock.calls[0][0].sql;
      const metaSql = prisma.$queryRaw.mock.calls[1][0].sql;
      expect(itemsSql).toMatch(/FALSE/);
      expect(metaSql).toMatch(/FALSE/);
    });

    it('a scoped viewer with visible clients scopes both queries via a task-id subselect', async () => {
      const prisma = makePrisma();
      await new CycleTimeReportService(prisma).timeInStatus({
        from: new Date('2026-05-01'), to: new Date('2026-05-31'),
      }, MEMBER_A);
      const itemsSql = prisma.$queryRaw.mock.calls[0][0].sql;
      const metaSql = prisma.$queryRaw.mock.calls[1][0].sql;
      expect(itemsSql).toMatch(/e\.task_id IN \(SELECT task_id FROM clickup_tasks WHERE scope_client_option_id = ANY\(/);
      expect(metaSql).toMatch(/e\.task_id IN \(SELECT task_id FROM clickup_tasks WHERE scope_client_option_id = ANY\(/);
      expect(metaSql).toMatch(/FROM clickup_task_events e/);
    });
  });
});

import { SprintsReportService } from '../src/reports/sprints-report.service';

function makePrisma() {
  return { $queryRaw: jest.fn().mockResolvedValue([]) } as any;
}

function sqlOf(call: any): string {
  return call.sql ?? call.text ?? String(call);
}

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
          },
        ])
        .mockResolvedValueOnce([{ total: 1n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprints({ status: 'completed' });
      expect(res.items[0]).toMatchObject({
        listId: 'l1', taskTotal: 10, taskDone: 7, pctDone: 70, hours: 12.5, costAud: 450, archived: true,
      });
      expect(res.total).toBe(1);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/l\.archived\s*=\s*true/);
    });

    it('defaults to status=active -> archived=false', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({});
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/l\.archived\s*=\s*false/);
    });

    it('status=all applies no archived filter', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({ status: 'all' });
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/l\.archived\s*=/);
    });

    it('uses COUNT(DISTINCT t.task_id) so a fan-out time-entry join does not inflate task counts', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({});
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/COUNT\(DISTINCT t\.task_id\)/);
    });

    it('applies spaceId, folderId, and search filters', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({ spaceId: 'sp1', folderId: 'f1', search: 'Alpha' });
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/l\.space_id\s*=/);
      expect(sql).toMatch(/l\.folder_id\s*=/);
      expect(sql).toMatch(/l\.name ILIKE/);
    });

    it('splices limit/offset as clamped literal integers, not bound params', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprints({ limit: 999, offset: -5 });
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/LIMIT 500\b/);
      expect(sql).toMatch(/OFFSET 0\b/);
    });

    it('pctDone is 0 when taskTotal is 0', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l2', name: 'Empty Sprint', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 0n, task_done: 0n, hours: 0, cost_cents: 0n,
          },
        ])
        .mockResolvedValueOnce([{ total: 1n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprints({});
      expect(res.items[0].pctDone).toBe(0);
    });
  });

  describe('sprintFolders', () => {
    it('maps folder rollup rows and filters by spaceId when given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValueOnce([
        { folder_id: 'f1', folder_name: 'X Sprints', space_name: 'X', active_count: 2n, completed_count: 5n },
      ]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprintFolders('sp1');
      expect(res[0]).toMatchObject({ folderId: 'f1', folderName: 'X Sprints', spaceName: 'X', activeCount: 2, completedCount: 5 });
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/space_id\s*=/);
      expect(sql).toMatch(/folder_id IS NOT NULL/);
    });

    it('omits the spaceId filter when not given', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprintFolders();
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).not.toMatch(/space_id\s*=/);
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
          },
        ])
        .mockResolvedValueOnce([{ status: 'done', color: '#00ff00', count: 2n }])
        .mockResolvedValueOnce([{ user_name: 'Alice', hours: 15, cost_cents: 7500n }])
        .mockResolvedValueOnce([{ mean_hours: 36.5, task_count: 2n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprintDetail('l1');
      expect(res.list).toMatchObject({ listId: 'l1', taskTotal: 4, taskDone: 2, pctDone: 50 });
      expect(res.byStatus).toEqual([{ status: 'done', color: '#00ff00', count: 2 }]);
      expect(res.byAssignee).toEqual([{ userName: 'Alice', hours: 15, costAud: 75 }]);
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
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.sprintDetail('l1');
      expect(res.cycleTimeHours).toBeNull();
    });

    it('throws NotFoundException when the list row does not exist', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const svc = new SprintsReportService(prisma, {} as any);
      await expect(svc.sprintDetail('missing')).rejects.toThrow();
    });

    it('scopes the cycle-time CTE to non-deleted tasks in the sprint', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            list_id: 'l1', name: 'Sprint 1', folder_name: null, space_name: null,
            archived: false, start_date: null, due_date: null,
            task_total: 1n, task_done: 0n, hours: 0, cost_cents: 0n,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ mean_hours: null, task_count: 0n }]);
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.sprintDetail('l1');
      const cycleSql = sqlOf(prisma.$queryRaw.mock.calls[3][0]);
      expect(cycleSql).toMatch(/is_deleted = false/);
      expect(cycleSql).toMatch(/taskStatusUpdated/);
    });
  });

  describe('velocity', () => {
    it('orders by due_date and caps to limit', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { list_id: 'l1', name: 'Sprint 1', due_date: new Date('2026-07-07'), task_done: 7n, hours: 12 },
      ]);
      const svc = new SprintsReportService(prisma, {} as any);
      const res = await svc.velocity('f1', 5);
      expect(res[0]).toMatchObject({ listId: 'l1', taskDone: 7, hours: 12 });
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/ORDER BY l\.due_date DESC NULLS LAST/);
      // Literal (pre-clamped) integer, not a bound parameter — asserting the
      // actual number, not just the LIMIT keyword, so this fails if the
      // clamp/interpolation regresses.
      expect(sql).toMatch(/LIMIT 5\b/);
    });

    it('clamps an out-of-range limit to the 1-100 cap', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.velocity('f1', 999);
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/LIMIT 100\b/);
    });

    it('uses COUNT(DISTINCT t.task_id) so the time-entry join does not inflate taskDone', async () => {
      const prisma = makePrisma();
      const svc = new SprintsReportService(prisma, {} as any);
      await svc.velocity('f1');
      const sql = sqlOf(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toMatch(/COUNT\(DISTINCT t\.task_id\)/);
    });
  });
});

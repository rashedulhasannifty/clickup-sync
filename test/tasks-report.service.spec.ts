import { TasksReportService } from '../src/reports/tasks-report.service';

describe('TasksReportService', () => {
  function makePrisma(overrides: Partial<Record<string, any>> = {}) {
    const base = {
      clickupTask: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
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
      const result = await new TasksReportService(prisma).tasksSummary();
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
      const result = await new TasksReportService(prisma).tasksBySpaceStatus();
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
      const result = await new TasksReportService(prisma).tasksClients();
      expect(result).toEqual([
        { client: 'Acme Corp', taskCount: 12 },
        { client: 'Globex', taskCount: 3 },
      ]);
    });

    it('excludes soft-deleted tasks and empty clients in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksClients();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/client\s*<>\s*''/);
    });
  });

  describe('tasksLists', () => {
    it('maps distinct list rows to { listId, listName, spaceName, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { list_id: 'L1', list_name: 'Backlog', space_name: 'Projects', task_count: BigInt(7) },
        { list_id: 'L2', list_name: 'Sprint 12', space_name: 'R&D Apps', task_count: BigInt(3) },
      ]);
      const result = await new TasksReportService(prisma).tasksLists();
      expect(result).toEqual([
        { listId: 'L1', listName: 'Backlog', spaceName: 'Projects', taskCount: 7 },
        { listId: 'L2', listName: 'Sprint 12', spaceName: 'R&D Apps', taskCount: 3 },
      ]);
    });

    it('scopes by space_id when spaceId is given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksLists('3577824');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/space_id\s*=/);
    });

    it('excludes soft-deleted tasks and empty lists in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksLists();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/list_name\s*<>\s*''/);
    });
  });

  describe('tasksFolders', () => {
    it('maps distinct folder rows to { folderId, folderName, spaceName, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { folder_id: 'F1', folder_name: 'Q3 Campaigns', space_name: 'Digital Marketing', task_count: BigInt(9) },
        { folder_id: 'F2', folder_name: 'Internal', space_name: 'R&D Apps', task_count: BigInt(4) },
      ]);
      const result = await new TasksReportService(prisma).tasksFolders();
      expect(result).toEqual([
        { folderId: 'F1', folderName: 'Q3 Campaigns', spaceName: 'Digital Marketing', taskCount: 9 },
        { folderId: 'F2', folderName: 'Internal', spaceName: 'R&D Apps', taskCount: 4 },
      ]);
    });

    it('scopes by space_id when spaceId is given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksFolders('3577824');
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/space_id\s*=/);
    });

    it('excludes soft-deleted tasks, null folders, and empty folder names in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksFolders();
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/folder_id\s+IS\s+NOT\s+NULL/i);
      expect(sqlText).toMatch(/folder_name\s*<>\s*''/);
    });
  });

  describe('tasks (client filter)', () => {
    it('adds an exact client equality to the where clause when client is given', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBe('Acme Corp');
    });

    it('omits the client clause when client is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBeUndefined();
    });
  });

  describe('tasks (list filter)', () => {
    it('adds an exact listId equality to the where clause when listId is given', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toBe('L1');
    });

    it('omits the listId clause when listId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toBeUndefined();
    });
  });

  describe('tasks (folder filter)', () => {
    it('adds an exact folderId equality to the where clause when folderId is given', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toBe('F1');
    });

    it('omits the folderId clause when folderId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toBeUndefined();
    });
  });

  describe('tasks (taskIds filter)', () => {
    it('parses comma-separated taskIds into where.taskId.in', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, 't1,t2 , ,t3',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.taskId).toEqual({ in: ['t1', 't2', 't3'] });
    });

    it('omits the taskId clause when taskIds resolves to an empty list', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, ' , , ',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.taskId).toBeUndefined();
    });
  });

  describe('sprintPoints', () => {
    it('maps groupBy to spaceName, status, totalPoints', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.groupBy.mockResolvedValue([
        { spaceName: 'R&D Apps', status: 'complete', _sum: { sprintPoints: 21 } },
      ]);
      const result = await new TasksReportService(prisma).sprintPoints();
      expect(result[0]).toEqual({ spaceName: 'R&D Apps', status: 'complete', totalPoints: 21 });
    });

    it('defaults totalPoints to 0 when sum is null', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.groupBy.mockResolvedValue([{ spaceName: 'X', status: 'open', _sum: { sprintPoints: null } }]);
      const result = await new TasksReportService(prisma).sprintPoints();
      expect(result[0].totalPoints).toBe(0);
    });
  });

  describe('spaces', () => {
    it('returns per-space aggregated stats', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { space_id: '3577824', space_name: 'Digital Marketing', task_count: BigInt(10), open_count: BigInt(5), hours_logged: 20.5, cost_cents: 5000 },
      ]);
      const result = await new TasksReportService(prisma).spaces();
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
      const result = await new TasksReportService(prisma).spaces();
      expect(result).toEqual([]);
    });
  });
});

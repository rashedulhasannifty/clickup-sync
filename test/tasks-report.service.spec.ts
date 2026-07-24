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
    it('wraps a single client in an IN clause (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toEqual({ in: ['Acme Corp'] });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp,Globex',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toEqual({ in: ['Acme Corp', 'Globex'] });
    });

    it('omits the client clause when client is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBeUndefined();
    });

    it('omits the client clause when client is commas only', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, ' , ',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBeUndefined();
    });
  });

  describe('tasks (list filter)', () => {
    it('wraps a single listId in an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toEqual({ in: ['L1'] });
    });

    it('splits a comma-separated listId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'L1,L2',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toEqual({ in: ['L1', 'L2'] });
    });

    it('omits the listId clause when listId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toBeUndefined();
    });
  });

  describe('tasks (folder filter)', () => {
    it('wraps a single folderId in an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toEqual({ in: ['F1'] });
    });

    it('splits a comma-separated folderId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1,F2',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toEqual({ in: ['F1', 'F2'] });
    });

    it('omits the folderId clause when folderId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toBeUndefined();
    });
  });

  describe('tasks (status filter)', () => {
    it('wraps a single status in an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(undefined, 'in progress');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['in progress'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(undefined, 'in progress,in review');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['in progress', 'in review'] });
    });

    it('omits the status clause when status is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toBeUndefined();
    });
  });

  describe('tasks (priority filter)', () => {
    it('splits a comma-separated priority list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0, 'urgent,high',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.priority).toEqual({ in: ['urgent', 'high'] });
    });

    it('omits the priority clause when priority is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.priority).toBeUndefined();
    });
  });

  describe('tasks (assignee filter)', () => {
    it('pushes a single-name OR group onto where.AND', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, 'Alice',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({
        OR: [{ assigneesNames: { contains: 'Alice', mode: 'insensitive' } }],
      });
      // The bare key must be gone — it would collide with the search OR below.
      expect(arg.where.assigneesNames).toBeUndefined();
    });

    it('ORs every selected assignee name inside one AND entry', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, 'Alice,Bob',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({
        OR: [
          { assigneesNames: { contains: 'Alice', mode: 'insensitive' } },
          { assigneesNames: { contains: 'Bob', mode: 'insensitive' } },
        ],
      });
    });

    it('keeps the assignee OR and the search OR as separate AND entries', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(
        undefined, undefined, 'launch', undefined, undefined, 50, 0,
        undefined, 'Alice,Bob',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toHaveLength(2);
      expect(and).toContainEqual({
        OR: [
          { assigneesNames: { contains: 'Alice', mode: 'insensitive' } },
          { assigneesNames: { contains: 'Bob', mode: 'insensitive' } },
        ],
      });
      // The search group is the other entry — identified by a field only it uses.
      const searchGroup = and.find((g) =>
        g.OR?.some((c: any) => c.taskName?.contains === 'launch'),
      );
      expect(searchGroup).toBeDefined();
    });

    it('omits the assignee clause when assigneeId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks();
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.AND).toBeUndefined();
      expect(arg.where.assigneesNames).toBeUndefined();
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

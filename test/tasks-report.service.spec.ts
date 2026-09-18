import { Prisma } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TasksReportService } from '../src/reports/tasks-report.service';
import { resolveScope, type AccessScope } from '../src/access/access-scope';

// Shared fixture for the calls in this file that don't care about scope
// behavior — `scope` is a required param (Ruling R10), so every call needs
// one. The scope-specific tests below (`tasks (access scope)`, `access scope
// (FALSE on empty scope)`, `taskDescription`, `sprintPoints`, `spaces`,
// `chargeablePreview`) use their own NONE/LEAD/LEAD_A_MEMBER_B scopes.
const UNRESTRICTED: AccessScope = { kind: 'unrestricted', canEdit: true };
// A MEMBER of exactly zero teams: `visibleClientIds` resolves to `[]`, so a
// scoped query must pin to an empty IN list (matches nothing / FALSE) rather
// than fall through to "no filter".
const NONE = resolveScope({
  role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [], teamClients: [], teamMembers: [],
});

describe('TasksReportService', () => {
  function makePrisma(overrides: Partial<Record<string, any>> = {}) {
    const base = {
      clickupTask: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // `tasks()` reads the chargeability rules for the rows on the page to
      // derive the tri-state pill, so this belongs in the base mock — every
      // tasks() test goes through that path.
      taskAssigneeChargeability: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // The pill also consults the entries now (a per-entry override can split
      // a task with no rule on it at all), so every tasks() test goes through
      // this too.
      clickupTimeEntry: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    return { ...base, ...overrides } as any;
  }

  describe('access scope (FALSE on empty scope)', () => {
    const sqlOf = (call: any[]) => (call[0] as Prisma.Sql).sql;
    it.each([
      ['tasksSummary', []], ['tasksBySpaceStatus', []], ['tasksAssignees', []],
      ['tasksClients', [{}]], ['tasksSubProjects', [{}]], ['tasksLists', [undefined]],
      ['tasksFolders', [undefined]], ['spaces', []],
    ])('%s applies an empty scope as FALSE', async (method, args) => {
      const prisma = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        clickupTask: {
          groupBy: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as any;
      await (new TasksReportService(prisma) as any)[method](...args, NONE);
      const calls = prisma.$queryRaw.mock.calls;
      if (calls.length) expect(calls.every((c: any[]) => sqlOf(c).includes('FALSE'))).toBe(true);
      else expect(JSON.stringify(prisma.clickupTask.groupBy.mock.calls.concat(prisma.clickupTask.count.mock.calls))).toContain('"in":[]');
    });
  });

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
      const result = await new TasksReportService(prisma).tasksSummary(UNRESTRICTED);
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
      const result = await new TasksReportService(prisma).tasksBySpaceStatus(UNRESTRICTED);
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
      const result = await new TasksReportService(prisma).tasksClients(undefined, UNRESTRICTED);
      expect(result).toEqual([
        { client: 'Acme Corp', taskCount: 12 },
        { client: 'Globex', taskCount: 3 },
      ]);
    });

    it('excludes soft-deleted tasks and empty clients in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksClients(undefined, UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/client\s*<>\s*''/);
    });

    // The dropdown label carries a per-client task count, so the count has to be
    // built with the same filters the Tasks table applies. When it wasn't, the
    // chip read "Byron Central (30)" while the table under it said "No tasks
    // match your filters" — the count was workspace-wide, the table was not.
    it('scopes by space_id when spaceId is given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksClients({ spaceId: '3589129' }, UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/space_id\s*=/);
    });

    it('applies the updated_date window when from/to are given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksClients({ from: '2025-12-01', to: '2026-08-27' }, UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/updated_date\s*>=/);
      expect(sqlText).toMatch(/updated_date\s*<=/);
    });

    it('honours the archived filter', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      const svc = new TasksReportService(prisma);
      await svc.tasksClients({ archived: 'exclude' }, UNRESTRICTED);
      await svc.tasksClients({ archived: 'only' }, UNRESTRICTED);
      const text = (i: number) => {
        const call = prisma.$queryRaw.mock.calls[i][0];
        return (call.sql ?? call.text ?? String(call)) as string;
      };
      expect(text(0)).toMatch(/archived\s*=\s*false/);
      expect(text(1)).toMatch(/archived\s*=\s*true/);
    });

    // Budgets asks for every client the workspace has ever had, so a bare call
    // must stay workspace-wide.
    it('emits no space/date/archived clause when called with no options', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksClients(undefined, UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).not.toMatch(/space_id/);
      expect(sqlText).not.toMatch(/updated_date/);
      expect(sqlText).not.toMatch(/archived/);
    });
  });

  describe('tasksLists', () => {
    it('maps distinct list rows to { listId, listName, spaceName, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { list_id: 'L1', list_name: 'Backlog', space_name: 'Projects', task_count: BigInt(7) },
        { list_id: 'L2', list_name: 'Sprint 12', space_name: 'R&D Apps', task_count: BigInt(3) },
      ]);
      const result = await new TasksReportService(prisma).tasksLists(undefined, UNRESTRICTED);
      expect(result).toEqual([
        { listId: 'L1', listName: 'Backlog', spaceName: 'Projects', taskCount: 7 },
        { listId: 'L2', listName: 'Sprint 12', spaceName: 'R&D Apps', taskCount: 3 },
      ]);
    });

    it('scopes by space_id when spaceId is given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksLists('3577824', UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/space_id\s*=/);
    });

    it('excludes soft-deleted tasks and empty lists in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksLists(undefined, UNRESTRICTED);
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
      const result = await new TasksReportService(prisma).tasksFolders(undefined, UNRESTRICTED);
      expect(result).toEqual([
        { folderId: 'F1', folderName: 'Q3 Campaigns', spaceName: 'Digital Marketing', taskCount: 9 },
        { folderId: 'F2', folderName: 'Internal', spaceName: 'R&D Apps', taskCount: 4 },
      ]);
    });

    it('scopes by space_id when spaceId is given', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksFolders('3577824', UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/space_id\s*=/);
    });

    it('excludes soft-deleted tasks, null folders, and empty folder names in the SQL', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await new TasksReportService(prisma).tasksFolders(undefined, UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
      expect(sqlText).toMatch(/folder_id\s+IS\s+NOT\s+NULL/i);
      expect(sqlText).toMatch(/folder_name\s*<>\s*''/);
    });
  });

  describe('tasksSubProjects', () => {
    it('maps distinct sub-project rows to { subProject, taskCount }', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { sub_project: 'Mobile App', task_count: BigInt(4) },
        { sub_project: 'Website', task_count: BigInt(2) },
      ]);
      const result = await new TasksReportService(prisma).tasksSubProjects(undefined, UNRESTRICTED);
      expect(result).toEqual([
        { subProject: 'Mobile App', taskCount: 4 },
        { subProject: 'Website', taskCount: 2 },
      ]);
    });

    it('unnests the array and counts distinct non-deleted tasks', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasksSubProjects(undefined, UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/unnest\(\s*sub_projects\s*\)/i);
      expect(sqlText).toMatch(/COUNT\(DISTINCT task_id\)/i);
      expect(sqlText).toMatch(/is_deleted\s*=\s*false/);
    });

    it('scopes by space, archived and the updated_date window like tasksClients', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasksSubProjects({
        spaceId: '3525433', from: '2026-01-01', to: '2026-02-01', archived: 'exclude',
      }, UNRESTRICTED);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/space_id\s*=/);
      expect(sqlText).toMatch(/archived\s*=\s*false/);
      expect(sqlText).toMatch(/updated_date\s*>=/);
      expect(call.values).toContain('3525433');
    });
  });

  describe('tasks (sub-project filter)', () => {
    const withSubProject = (prisma: any, subProject?: string) =>
      new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        subProject,
      );

    it('matches tasks carrying ANY selected sub-project, exactly', async () => {
      const prisma = makePrisma();
      await withSubProject(prisma, 'Mobile App, Website');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.subProjects).toEqual({ hasSome: ['Mobile App', 'Website'] });
    });

    it('omits the clause when no sub-project is selected', async () => {
      const prisma = makePrisma();
      await withSubProject(prisma, ' , ');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.subProjects).toBeUndefined();
    });

    it('selects subProjects for the table column', async () => {
      const prisma = makePrisma();
      await withSubProject(prisma);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.select.subProjects).toBe(true);
    });
  });

  describe('tasks (client filter)', () => {
    it('wraps a single client in an IN clause (the deep-link path)', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toEqual({ in: ['Acme Corp'] });
    });

    it('splits a comma-separated client list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, 'Acme Corp,Globex',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toEqual({ in: ['Acme Corp', 'Globex'] });
    });

    it('omits the client clause when client is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.client).toBeUndefined();
    });

    it('omits the client clause when client is commas only', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
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
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'L1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toEqual({ in: ['L1'] });
    });

    it('splits a comma-separated listId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, 'L1,L2',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toEqual({ in: ['L1', 'L2'] });
    });

    it('omits the listId clause when listId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.listId).toBeUndefined();
    });
  });

  describe('tasks (folder filter)', () => {
    it('wraps a single folderId in an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toEqual({ in: ['F1'] });
    });

    it('splits a comma-separated folderId list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'F1,F2',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toEqual({ in: ['F1', 'F2'] });
    });

    it('omits the folderId clause when folderId is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.folderId).toBeUndefined();
    });
  });

  describe('tasks (status filter)', () => {
    it('wraps a single status in an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED, undefined, 'in progress');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['in progress'] });
    });

    it('splits a comma-separated status list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED, undefined, 'in progress,in review');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ['in progress', 'in review'] });
    });

    it('omits the status clause when status is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.status).toBeUndefined();
    });
  });

  describe('tasks (priority filter)', () => {
    it('splits a comma-separated priority list into an IN clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0, 'urgent,high',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.priority).toEqual({ in: ['urgent', 'high'] });
    });

    it('omits the priority clause when priority is undefined', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.priority).toBeUndefined();
    });
  });

  describe('tasks (assignee filter)', () => {
    it('pushes a single-name OR group onto where.AND', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
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
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
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
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
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
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.AND).toBeUndefined();
      expect(arg.where.assigneesNames).toBeUndefined();
    });
  });

  describe('tasks (taskIds filter)', () => {
    it('parses comma-separated taskIds into where.taskId.in', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, 't1,t2 , ,t3',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.taskId).toEqual({ in: ['t1', 't2', 't3'] });
    });

    it('omits the taskId clause when taskIds resolves to an empty list', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, ' , , ',
      );
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.taskId).toBeUndefined();
    });
  });

  describe('tasks (sprintStatus filter)', () => {
    function callTasks(prisma: any, sprintStatus?: string, listId?: string) {
      return new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined, listId, undefined,
        sprintStatus,
      );
    }

    it('adds a listId-IN clause scoped to non-archived lists when sprintStatus="active"', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ list_id: 'L1' }, { list_id: 'L2' }]);
      await callTasks(prisma, 'active');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ listId: { in: ['L1', 'L2'] } });
      // Bound value, not string-concatenated: archived=false for 'active'.
      const rawCall = prisma.$queryRaw.mock.calls[0][0];
      expect(rawCall.values).toEqual([false]);
    });

    it('adds a listId-IN clause scoped to archived lists when sprintStatus="completed"', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([{ list_id: 'L3' }]);
      await callTasks(prisma, 'completed');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ listId: { in: ['L3'] } });
      const rawCall = prisma.$queryRaw.mock.calls[0][0];
      expect(rawCall.values).toEqual([true]);
    });

    // Regression pin: zero archived lists must exclude every task (empty IN),
    // not be treated as "no filter" and fall through to unfiltered.
    it('still pushes an (empty) IN clause when no lists match sprintStatus="completed"', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      await callTasks(prisma, 'completed');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ listId: { in: [] } });
    });

    it('emits no extra clause and issues no extra query when sprintStatus="all" (backward-compatible)', async () => {
      const prisma = makePrisma();
      await callTasks(prisma, 'all');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.AND).toBeUndefined();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('emits no extra clause when sprintStatus is undefined (pre-existing callers unaffected)', async () => {
      const prisma = makePrisma();
      await callTasks(prisma);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.AND).toBeUndefined();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('combines with an existing listId filter as two separate constraints (both must hold, not merged)', async () => {
      const prisma = makePrisma();
      // Different list_id than the user's explicit filter so the two clauses
      // are distinguishable — proves both survive as independent constraints
      // rather than one overwriting the other.
      prisma.$queryRaw.mockResolvedValue([{ list_id: 'L2' }]);
      await callTasks(prisma, 'completed', 'L1');
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      // The user's explicit listId filter stays on the bare key...
      expect(arg.where.listId).toEqual({ in: ['L1'] });
      // ...and the sprintStatus scope is a separate AND entry, not merged in.
      const and = (arg.where.AND ?? []) as any[];
      expect(and).toContainEqual({ listId: { in: ['L2'] } });
    });
  });

  describe('taskDescription', () => {
    function makeDescPrisma(row: { description: string | null; markdownDescription: string | null } | null) {
      return { clickupTask: { findFirst: jest.fn().mockResolvedValue(row) } } as any;
    }

    it('returns description + markdownDescription for an in-scope task', async () => {
      const prisma = makeDescPrisma({ description: 'plain', markdownDescription: '**md**' });
      const result = await new TasksReportService(prisma).taskDescription('t1', UNRESTRICTED);
      expect(result).toEqual({ description: 'plain', markdownDescription: '**md**' });
    });

    it('scopes the lookup with taskScopeWhere(scope)', async () => {
      const prisma = makeDescPrisma({ description: null, markdownDescription: null });
      const LEAD = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [{ teamId: 'A', optionId: 'acme' }], teamMembers: [],
      });
      await new TasksReportService(prisma).taskDescription('t1', LEAD);
      expect(prisma.clickupTask.findFirst).toHaveBeenCalledWith({
        where: { taskId: 't1', scopeClientOptionId: { in: ['acme'] } },
        select: { description: true, markdownDescription: true },
      });
    });

    // Never 403: a 403 here would confirm the task exists but is out of
    // scope, which is exactly the existence oracle scoping must not create.
    it('throws NotFoundException when the task is out of scope or missing', async () => {
      const prisma = makeDescPrisma(null);
      await expect(new TasksReportService(prisma).taskDescription('ghost', UNRESTRICTED)).rejects.toThrow(NotFoundException);
    });
  });

  describe('sprintPoints', () => {
    it('maps groupBy to spaceName, status, totalPoints', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.groupBy.mockResolvedValue([
        { spaceName: 'R&D Apps', status: 'complete', _sum: { sprintPoints: 21 } },
      ]);
      const result = await new TasksReportService(prisma).sprintPoints(undefined, UNRESTRICTED);
      expect(result[0]).toEqual({ spaceName: 'R&D Apps', status: 'complete', totalPoints: 21 });
    });

    it('defaults totalPoints to 0 when sum is null', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.groupBy.mockResolvedValue([{ spaceName: 'X', status: 'open', _sum: { sprintPoints: null } }]);
      const result = await new TasksReportService(prisma).sprintPoints(undefined, UNRESTRICTED);
      expect(result[0].totalPoints).toBe(0);
    });

    // Ruling R1: requireLeadView, not requireLead — a flag-off MEMBER's scope
    // is 'unrestricted' (canEdit: false) and must keep reading sprint points
    // exactly as today.
    it('lets an unrestricted flag-off MEMBER through unchanged', async () => {
      const prisma = makePrisma();
      const FLAG_OFF_MEMBER: AccessScope = { kind: 'unrestricted', canEdit: false };
      await expect(new TasksReportService(prisma).sprintPoints(undefined, FLAG_OFF_MEMBER)).resolves.toEqual([]);
    });

    it('403s a scoped viewer who leads no team', async () => {
      const prisma = makePrisma();
      await expect(new TasksReportService(prisma).sprintPoints(undefined, NONE)).rejects.toThrow(ForbiddenException);
      expect(prisma.clickupTask.groupBy).not.toHaveBeenCalled();
    });

    it('lets a scoped LEAD through and scopes the query', async () => {
      const prisma = makePrisma();
      const LEAD = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [{ teamId: 'A', optionId: 'acme' }], teamMembers: [],
      });
      await new TasksReportService(prisma).sprintPoints(undefined, LEAD);
      const arg = prisma.clickupTask.groupBy.mock.calls[0][0];
      expect(arg.where.scopeClientOptionId).toEqual({ in: ['acme'] });
    });
  });

  describe('spaces (cost masking)', () => {
    it('returns per-space aggregated stats', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { space_id: '3577824', space_name: 'Digital Marketing', task_count: BigInt(10), open_count: BigInt(5), hours_logged: 20.5, cost_cents: 5000, cost_partial: false },
      ]);
      const result = await new TasksReportService(prisma).spaces(UNRESTRICTED);
      expect(result).toHaveLength(1);
      expect(result[0].spaceId).toBe('3577824');
      expect(result[0].spaceName).toBe('Digital Marketing');
      expect(result[0].taskCount).toBe(10);
      expect(result[0].openCount).toBe(5);
      expect(result[0].hoursLogged).toBe(20.5);
      expect(result[0].costAud).toBe(50);
      expect(result[0].costPartial).toBe(false);
    });

    it('returns empty array when no spaces exist', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await new TasksReportService(prisma).spaces(UNRESTRICTED);
      expect(result).toEqual([]);
    });

    // Ruling R12: a viewer who leads no client in scope sees costPartial: true
    // wherever an in-scope-but-not-led row exists, and the sum itself is
    // already narrowed to LEAD-only cost by the CASE WHEN in the SQL.
    it('surfaces costPartial for a scoped viewer with unled rows', async () => {
      const prisma = makePrisma();
      prisma.$queryRaw.mockResolvedValue([
        { space_id: '3577824', space_name: 'Digital Marketing', task_count: BigInt(2), open_count: BigInt(1), hours_logged: 5, cost_cents: 0, cost_partial: true },
      ]);
      const NONE_LEAD = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'MEMBER' }], teamClients: [{ teamId: 'A', optionId: 'acme' }], teamMembers: [],
      });
      const result = await new TasksReportService(prisma).spaces(NONE_LEAD);
      expect(result[0].costPartial).toBe(true);
    });

    it('wraps the cost sum in a CASE WHEN and scopes the WHERE clause', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).spaces(NONE);
      const call = prisma.$queryRaw.mock.calls[0][0];
      const sqlText: string = call.sql ?? call.text ?? String(call);
      expect(sqlText).toMatch(/CASE WHEN/i);
      expect(sqlText).toMatch(/BOOL_OR/i);
      expect(sqlText).toContain('FALSE');
    });
  });

  describe('chargeablePreview', () => {
    /** Two distinct `count` results, told apart by the `where` each call got —
     *  not by call order, so swapping the two queries fails this. */
    function makePreviewPrisma(existing: number, changing: number) {
      const count = jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve('isChargeable' in where ? changing : existing));
      return {
        prisma: {
          clickupTask: { count },
          clickupTimeEntry: { aggregate: jest.fn().mockResolvedValue({ _count: 84, _sum: { durationHours: { toNumber: () => 156.5 } } }) },
        } as never,
        count,
      };
    }

    it('reports how many of the given tasks would actually change', async () => {
      const { prisma } = makePreviewPrisma(3, 2);

      const res = await new TasksReportService(prisma).chargeablePreview(['t1', 't2', 't3'], false, UNRESTRICTED);

      expect(res).toEqual({ tasks: 3, changing: 2, timeEntries: 84, hours: 156.5 });
    });

    // Ruling R13: the global "flag off must reproduce today exactly"
    // constraint outranks the no-existence-oracle uniformity. Restored
    // verbatim (with the UNRESTRICTED fixture): ids that don't exist inflate
    // no denominator and throw nothing — an Owner/Admin or flag-off MEMBER
    // caller keeps pre-scoping behavior exactly.
    //
    // Regression: `tasks` used to be `taskIds.length`, so ids that don't exist
    // in the database inflated the "of N tasks" denominator in the confirmation
    // dialog — and `changing` could exceed it, since `changing` only ever counts
    // rows that exist.
    it('counts only the tasks that actually exist, not every id given (unrestricted)', async () => {
      const { prisma, count } = makePreviewPrisma(2, 1);

      const res = await new TasksReportService(prisma).chargeablePreview(['t1', 't2', 'ghost'], false, UNRESTRICTED);

      expect(res.tasks).toBe(2);
      expect(res.changing).toBe(1);
      // `tasks` must be a superset of what `changing` counts, so neither query
      // may carry a filter the other lacks beyond the flag itself.
      expect(count).toHaveBeenCalledWith({ where: { taskId: { in: ['t1', 't2', 'ghost'] } } });
      expect(count).toHaveBeenCalledWith({ where: { taskId: { in: ['t1', 't2', 'ghost'] }, isChargeable: true } });
    });

    // No existence oracle, scoped viewers only (R13): an id that doesn't
    // exist and an id that exists but is out of scope get the identical 404,
    // so a scoped caller can't tell them apart by probing.
    it('throws NotFoundException for a scoped viewer when not every given id resolves in scope', async () => {
      const { prisma } = makePreviewPrisma(2, 1);
      const LEAD = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [{ teamId: 'A', optionId: 'acme' }], teamMembers: [],
      });

      await expect(
        new TasksReportService(prisma).chargeablePreview(['t1', 't2', 'ghost'], false, LEAD),
      ).rejects.toThrow(NotFoundException);
    });

    it('a scoped viewer with every id in scope gets the normal response, no throw', async () => {
      const { prisma, count } = makePreviewPrisma(3, 1);
      const LEAD = resolveScope({
        role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
        memberships: [{ teamId: 'A', role: 'LEAD' }], teamClients: [{ teamId: 'A', optionId: 'acme' }], teamMembers: [],
      });

      const res = await new TasksReportService(prisma).chargeablePreview(['t1', 't2', 't3'], false, LEAD);

      expect(res.tasks).toBe(3);
      expect(res.changing).toBe(1);
      expect(count).toHaveBeenCalledWith({
        where: { taskId: { in: ['t1', 't2', 't3'] }, scopeClientOptionId: { in: ['acme'] } },
      });
      expect(count).toHaveBeenCalledWith({
        where: { taskId: { in: ['t1', 't2', 't3'] }, scopeClientOptionId: { in: ['acme'] }, isChargeable: true },
      });
    });

    it('an empty scope 404s any non-empty request', async () => {
      const { prisma } = makePreviewPrisma(0, 0);

      await expect(
        new TasksReportService(prisma).chargeablePreview(['t1'], false, NONE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('tasks (tri-state chargeability pill)', () => {
    // The service only calls `.toNumber()` on these columns, so a stub is
    // enough — no need to drag in Prisma's Decimal for a mocked row.
    const dec = (n: number) => ({ toNumber: () => n }) as any;

    // Rows carry the raw task flag AND whether that flag actually describes
    // every hour on the task. A rule that disagrees with the flag splits it.
    function taskRow(taskId: string, isChargeable: boolean) {
      return {
        taskId, taskName: 'T', url: null, spaceId: '1', spaceName: 'S', status: 'open',
        statusType: 'open', statusColor: null, priority: null, parentTaskId: null,
        assigneesNames: null, assigneesEmails: null, updatedDate: new Date(), syncedAt: new Date(),
        sprintPoints: null, sprintName: null, cost: dec(0), client: null, department: null,
        isDeleted: false, archived: false, listName: null, dueDate: null, timeEstimate: null,
        timeSpent: null, createdDate: null, closedDate: null, startDate: null, syncCount: 1,
        estimation: dec(0), folderName: null, creatorName: null, executiveName: null,
        isChargeable,
      };
    }

    it('marks a chargeable task partial when a rule excludes one assignee', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', true)]);
      prisma.taskAssigneeChargeability.findMany.mockResolvedValue([
        { taskId: 't1', chargeable: false },
      ]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items[0].isChargeable).toBe(true);
      expect(result.items[0].partiallyChargeable).toBe(true);
    });

    it('marks a non-chargeable task partial when a rule includes one assignee', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', false)]);
      prisma.taskAssigneeChargeability.findMany.mockResolvedValue([
        { taskId: 't1', chargeable: true },
      ]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items[0].partiallyChargeable).toBe(true);
    });

    it('leaves a task with no rules alone', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', true), taskRow('t2', false)]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items.map((i: any) => i.partiallyChargeable)).toEqual([false, false]);
    });

    it('does not mark a task partial when its rules agree with its flag', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', true)]);
      prisma.taskAssigneeChargeability.findMany.mockResolvedValue([
        { taskId: 't1', chargeable: true },
      ]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items[0].partiallyChargeable).toBe(false);
    });

    it('keeps each task\'s rules to itself', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', true), taskRow('t2', true)]);
      prisma.taskAssigneeChargeability.findMany.mockResolvedValue([
        { taskId: 't2', chargeable: false },
      ]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items.map((i: any) => i.partiallyChargeable)).toEqual([false, true]);
    });

    // The rule lookup is scoped to the ids actually on the page, not the whole
    // filtered set — the pill is only rendered for rows that exist.
    it('scopes the rule lookup to the page\'s task ids', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', true), taskRow('t2', true)]);
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(prisma.taskAssigneeChargeability.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { taskId: { in: ['t1', 't2'] } } }),
      );
    });

    // An empty `in` list would scan the rule table for nothing on every empty
    // page — same guard as TaskAssigneeChargeabilityRepository.findForTasks.
    it('skips the rule query entirely when the page is empty', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([]);
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(prisma.taskAssigneeChargeability.findMany).not.toHaveBeenCalled();
    });
  });


  describe('tasks (chargeability filter)', () => {
    // Three mutually exclusive buckets, defined on the rules exactly as the
    // tri-state pill is: a task a rule has split is `partial` only, never
    // `true` or `false`. (Both sides are rules-only today; see the phase 2
    // note in the service for what has to change together later.)
    const call = (chargeable?: string) => {
      const prisma = makePrisma();
      return new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, chargeable,
      ).then(() => prisma.clickupTask.findMany.mock.calls[0][0].where);
    };

    // These assert the RULE half only — `objectContaining` so the entries arm
    // added in phase 2 (asserted separately below) doesn't break them. Pinning
    // the whole clause made a deliberate extension read as a regression.
    it('wholly chargeable excludes tasks a rule has split', async () => {
      expect((await call('true')).AND).toContainEqual(expect.objectContaining({
        isChargeable: true,
        chargeabilityRules: { none: { chargeable: false } },
      }));
    });

    it('wholly non-chargeable excludes tasks a rule has split', async () => {
      expect((await call('false')).AND).toContainEqual(expect.objectContaining({
        isChargeable: false,
        chargeabilityRules: { none: { chargeable: true } },
      }));
    });

    // A disagreeing rule is caught by the complement rather than by its own
    // arm: it fails whichever "wholly" clause its flag points at, via the
    // `chargeabilityRules: { none: ... }` half.
    it('a task with a rule disagreeing with its flag is excluded from both wholly buckets', async () => {
      const wholly = (await call('true')).AND.find((c: any) => c.isChargeable === true);
      expect(wholly.chargeabilityRules).toEqual({ none: { chargeable: false } });
      const whollyNot = (await call('false')).AND.find((c: any) => c.isChargeable === false);
      expect(whollyNot.chargeabilityRules).toEqual({ none: { chargeable: true } });
    });

    it.each([undefined, '', 'all', 'nonsense'])('emits no clause for %p', async (value) => {
      const where = await call(value);
      const clauses = JSON.stringify(where.AND ?? []);
      expect(clauses).not.toContain('chargeabilityRules');
      expect(clauses).not.toContain('isChargeable');
    });
  });


  describe('tasks (pill: entries disagreeing)', () => {
    const dec = (n: number) => ({ toNumber: () => n }) as any;
    function taskRow(taskId: string, isChargeable: boolean) {
      return {
        taskId, taskName: 'T', url: null, spaceId: '1', spaceName: 'S', status: 'open',
        statusType: 'open', statusColor: null, priority: null, parentTaskId: null,
        assigneesNames: null, assigneesEmails: null, updatedDate: new Date(), syncedAt: new Date(),
        sprintPoints: null, sprintName: null, cost: dec(0), client: null, department: null,
        isDeleted: false, archived: false, listName: null, dueDate: null, timeEstimate: null,
        timeSpent: null, createdDate: null, closedDate: null, startDate: null, syncCount: 1,
        estimation: dec(0), folderName: null, creatorName: null, executiveName: null,
        isChargeable,
      };
    }

    // A per-entry override can split a task that has NO rule on it, which the
    // rules-only pill could not see. This is the phase 2 half of the coupling.
    it('is partial when the entries disagree, with no rule involved', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', true)]);
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { taskId: 't1', isChargeable: true, _count: 4 },
        { taskId: 't1', isChargeable: false, _count: 1 },
      ]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items[0].partiallyChargeable).toBe(true);
    });

    it('is NOT partial when every entry agrees', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', true)]);
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { taskId: 't1', isChargeable: true, _count: 5 },
      ]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items[0].partiallyChargeable).toBe(false);
    });

    it('is NOT partial when every entry is non-chargeable', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', false)]);
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { taskId: 't1', isChargeable: false, _count: 5 },
      ]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items[0].partiallyChargeable).toBe(false);
    });

    it('keeps each task\'s entries to itself', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t1', true), taskRow('t2', true)]);
      prisma.clickupTimeEntry.groupBy.mockResolvedValue([
        { taskId: 't1', isChargeable: true, _count: 2 },
        { taskId: 't2', isChargeable: true, _count: 2 },
        { taskId: 't2', isChargeable: false, _count: 1 },
      ]);
      const result = await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(result.items.map((i: any) => i.partiallyChargeable)).toEqual([false, true]);
    });

    it('skips the entry aggregate entirely when the page is empty', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([]);
      await new TasksReportService(prisma).tasks(UNRESTRICTED);
      expect(prisma.clickupTimeEntry.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('tasks (chargeability filter: entries arm)', () => {
    const call = (chargeable?: string) => {
      const prisma = makePrisma();
      return new TasksReportService(prisma).tasks(UNRESTRICTED,
        undefined, undefined, undefined, undefined, undefined, 50, 0,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, chargeable,
      ).then(() => prisma.clickupTask.findMany.mock.calls[0][0].where);
    };

    // `partial` is the COMPLEMENT of the other two, not a list of the ways a
    // task can be split. Enumerating them left a hole: a task whose every
    // entry was overridden away is not "mixed" and has no disagreeing rule, so
    // it matched no bucket at all. Defining it structurally makes the three
    // buckets exhaustive by construction rather than by the arms happening to
    // cover every case.
    it('partial is everything that is neither wholly chargeable nor wholly non-chargeable', async () => {
      const and = (await call('partial')).AND;
      expect(and).toContainEqual({
        NOT: {
          isChargeable: true,
          chargeabilityRules: { none: { chargeable: false } },
          timeEntries: { none: { isChargeable: false } },
        },
      });
      expect(and).toContainEqual({
        NOT: {
          isChargeable: false,
          chargeabilityRules: { none: { chargeable: true } },
          timeEntries: { none: { isChargeable: true } },
        },
      });
    });

    it('wholly chargeable excludes a task with any non-chargeable entry', async () => {
      expect((await call('true')).AND).toContainEqual({
        isChargeable: true,
        chargeabilityRules: { none: { chargeable: false } },
        timeEntries: { none: { isChargeable: false } },
      });
    });

    it('wholly non-chargeable excludes a task with any chargeable entry', async () => {
      expect((await call('false')).AND).toContainEqual({
        isChargeable: false,
        chargeabilityRules: { none: { chargeable: true } },
        timeEntries: { none: { isChargeable: true } },
      });
    });
  });

  describe('tasks (access scope)', () => {
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

    const dec = (n: number) => ({ toNumber: () => n }) as any;
    function taskRow(taskId: string, scopeClientOptionId: string | null) {
      return {
        taskId, taskName: 'T', url: null, spaceId: '1', spaceName: 'S', status: 'open',
        statusType: 'open', statusColor: null, priority: null, parentTaskId: null,
        assigneesNames: null, assigneesEmails: null, updatedDate: new Date(), syncedAt: new Date(),
        sprintPoints: null, sprintName: null, cost: dec(500), client: null, department: null,
        isDeleted: false, archived: false, listName: null, dueDate: null, timeEstimate: null,
        timeSpent: null, createdDate: null, closedDate: null, startDate: null, syncCount: 1,
        estimation: dec(10), folderName: null, creatorName: null, executiveName: null,
        isChargeable: true, scopeClientOptionId,
      };
    }

    it('an empty scope pins the query to an empty id list', async () => {
      const prisma = makePrisma();
      await new TasksReportService(prisma).tasks(NONE);
      const arg = prisma.clickupTask.findMany.mock.calls[0][0];
      expect(arg.where.AND).toContainEqual({ scopeClientOptionId: { in: [] } });
    });

    it('masks cost/estimation on rows outside the clients the viewer LEADS, keeps them on led rows', async () => {
      const prisma = makePrisma();
      prisma.clickupTask.findMany.mockResolvedValue([taskRow('t-acme', 'acme'), taskRow('t-bolt', 'bolt')]);
      const result = await new TasksReportService(prisma).tasks(LEAD_A_MEMBER_B);
      const acme = result.items.find((i: any) => i.taskId === 't-acme')!;
      const bolt = result.items.find((i: any) => i.taskId === 't-bolt')!;
      expect(acme.cost).toBe(500);
      expect(acme.estimation).toBe(10);
      expect(bolt.cost).toBeNull();
      expect(bolt.estimation).toBeNull();
    });
  });

});

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { parseDate } from './report-date.util';
import { csvList, sprintStatusListIds } from './report-filter.util';

/** Task-centric report queries (counts, filters, per-space aggregates). */
@Injectable()
export class TasksReportService {
  constructor(private readonly prisma: PrismaService) {}

  async tasksSummary() {
    // `byStatusType` is added so the Overview KPIs can derive open/closed
    // counts reliably. The per-list `status` strings are unstable across
    // workspaces ('Closed' vs 'closed', 'done' vs 'complete'), but ClickUp's
    // `status_type` is a coarse classification (open/custom/done/closed) that
    // survives any per-list status renaming.
    //
    // `bySpace` uses raw SQL instead of Prisma groupBy because some tasks were
    // synced before space.name was populated by the upstream parser, leaving
    // rows with the same space_id but different space_name (one NULL, one
    // populated). Grouping by both columns split a single space into two
    // buckets in the chart. Resolving via `MAX(space_name)` collapses them
    // back into one row per space.
    type SpaceRow = { space_id: string | null; space_name: string | null; count: bigint };
    const [bySpaceRows, byStatusRows, byStatusTypeRows, total] = await Promise.all([
      this.prisma.$queryRaw<SpaceRow[]>(Prisma.sql`
        SELECT space_id,
               MAX(space_name) AS space_name,
               COUNT(*)::bigint AS count
        FROM clickup_tasks
        WHERE is_deleted = false
        GROUP BY space_id
        ORDER BY count DESC
      `),
      this.prisma.clickupTask.groupBy({ by: ['status'], where: { isDeleted: false }, _count: { taskId: true } }),
      this.prisma.clickupTask.groupBy({ by: ['statusType'], where: { isDeleted: false }, _count: { taskId: true } }),
      this.prisma.clickupTask.count({ where: { isDeleted: false } }),
    ]);
    return {
      bySpace: bySpaceRows.map(r => ({ spaceId: r.space_id, spaceName: r.space_name, count: Number(r.count) })),
      byStatus: byStatusRows.map(r => ({ status: r.status, count: r._count.taskId })),
      byStatusType: byStatusTypeRows.map(r => ({ statusType: r.statusType, count: r._count.taskId })),
      total,
    };
  }

  async tasksBySpaceStatus() {
    const rows = await this.prisma.clickupTask.groupBy({
      by: ['spaceName', 'status'],
      where: { isDeleted: false },
      _count: { taskId: true },
      orderBy: { spaceName: 'asc' },
    });
    return rows.map(r => ({ spaceName: r.spaceName, status: r.status, count: r._count.taskId }));
  }

  /**
   * Distinct task assignees. The Tasks-page filter previously read from
   * `timeEntriesByUser`, which silently omitted anyone with zero logged
   * hours (e.g. assignees of expense-only tasks like the Hello Ahmad case).
   *
   * Pairs name + email by ordinal position. `clickup_normalizer.ts` joins
   * both fields from the same `t.assignees` array with `joinNames`, so the
   * i-th comma-separated chunk in `assignees_names` lines up with the i-th
   * in `assignees_emails`. Postgres' multi-array UNNEST does exactly that
   * pairing in a single pass; SQL beats Prisma here because Prisma can't
   * express ordinal-paired array unpacking.
   */
  async tasksAssignees() {
    type Row = { name: string; email: string | null; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT name, email, COUNT(*)::bigint AS task_count
      FROM (
        SELECT
          TRIM(BOTH FROM n) AS name,
          NULLIF(TRIM(BOTH FROM e), '') AS email
        FROM clickup_tasks
        CROSS JOIN LATERAL UNNEST(
          string_to_array(COALESCE(assignees_names, ''), ','),
          string_to_array(COALESCE(assignees_emails, ''), ',')
        ) AS u(n, e)
        WHERE is_deleted = false
      ) AS s
      WHERE name <> ''
      GROUP BY name, email
      ORDER BY name ASC
    `);
    return rows.map((r) => ({ name: r.name, email: r.email, taskCount: Number(r.task_count) }));
  }

  async tasksClients() {
    type Row = { client: string; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT client, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND client IS NOT NULL
        AND client <> ''
      GROUP BY client
      ORDER BY client ASC
    `);
    return rows.map((r) => ({ client: r.client, taskCount: Number(r.task_count) }));
  }

  async tasksLists(spaceId?: string) {
    type Row = { list_id: string; list_name: string; space_name: string | null; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT list_id, list_name, MAX(space_name) AS space_name, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND list_id IS NOT NULL
        AND list_name <> ''
        ${spaceId ? Prisma.sql`AND space_id = ${spaceId}` : Prisma.empty}
      GROUP BY list_id, list_name
      ORDER BY MAX(space_name) ASC, list_name ASC
    `);
    return rows.map((r) => ({
      listId: r.list_id,
      listName: r.list_name,
      spaceName: r.space_name,
      taskCount: Number(r.task_count),
    }));
  }

  async tasksFolders(spaceId?: string) {
    type Row = { folder_id: string; folder_name: string; space_name: string | null; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT folder_id, folder_name, MAX(space_name) AS space_name, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND folder_id IS NOT NULL
        AND folder_name <> ''
        ${spaceId ? Prisma.sql`AND space_id = ${spaceId}` : Prisma.empty}
      GROUP BY folder_id, folder_name
      ORDER BY MAX(space_name) ASC, folder_name ASC
    `);
    return rows.map((r) => ({
      folderId: r.folder_id,
      folderName: r.folder_name,
      spaceName: r.space_name,
      taskCount: Number(r.task_count),
    }));
  }

  async tasks(
    spaceId?: string,
    status?: string,
    search?: string,
    fromParam?: string,
    toParam?: string,
    limit = 50,
    offset = 0,
    priority?: string,
    assigneeId?: string,
    type?: string,
    archived?: string,
    client?: string,
    taskIds?: string,
    listId?: string,
    folderId?: string,
    sprintStatus?: string,
  ) {
    // Cap kept generous so the dashboard's "Export CSV" can pull a complete
    // filtered set in one shot. The page UI never offers > 100 rows/page, so
    // this only matters for export requests.
    const safeLimit = Math.min(limit, 5000);
    const where: Prisma.ClickupTaskWhereInput = {};
    // Clauses that would otherwise collide on a single `where` key accumulate
    // here and land on `where.AND` at the end. The assignee filter and the
    // free-text search each need their own OR group, so neither can own a bare
    // top-level key. Same pattern as `timeEntriesList`.
    const and: Prisma.ClickupTaskWhereInput[] = [];
    // ClickUp `archived` flag (exclude / include / only). Always hide soft-deleted rows unless we add a separate flag later.
    where.isDeleted = false;
    if (archived === 'only') {
      where.archived = true;
    } else if (archived === 'include') {
      // show archived and non-archived
    } else {
      // exclude, hide, undefined, '' — default: hide archived tasks
      where.archived = false;
    }
    // The categorical filters are multi-select in the dashboard and arrive as a
    // comma-separated list. A single value parses as a one-element list, so
    // pre-existing deep-links (e.g. `?client=Acme`) behave exactly as before.
    const statuses = csvList(status);
    const priorities = csvList(priority);
    const clients = csvList(client);
    const listIds = csvList(listId);
    const folderIds = csvList(folderId);
    const assigneeNames = csvList(assigneeId);
    if (spaceId) where.spaceId = spaceId;
    if (statuses) where.status = { in: statuses };
    if (priorities) where.priority = { in: priorities };
    if (clients) where.client = { in: clients };
    if (listIds) where.listId = { in: listIds };
    if (folderIds) where.folderId = { in: folderIds };
    if (type === 'parent') where.parentTaskId = null;
    if (type === 'subtask') where.parentTaskId = { not: null };
    // `assignees_names` is a single comma-joined string, so each selected name
    // is a substring match and multiple names OR together. Substring matching
    // means "Sam" also matches "Sameer" — pre-existing behavior, unchanged.
    if (assigneeNames) {
      and.push({
        OR: assigneeNames.map((n) => ({
          assigneesNames: { contains: n, mode: 'insensitive' as const },
        })),
      });
    }
    if (taskIds) {
      const ids = taskIds.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) where.taskId = { in: ids };
    }
    if (fromParam || toParam) {
      where.updatedDate = { gte: parseDate(fromParam, new Date(0)), lte: parseDate(toParam, new Date()) };
    }
    // Free-text search across short, indexed-friendly fields. Avoid description / raw
    // JSON — ILIKE on those gets expensive fast. Pushed onto the AND accumulator so
    // search stacks with the other filters above (mirrors `timeEntriesList`).
    if (search?.trim()) {
      const q = search.trim();
      and.push({
        OR: [
          { taskName: { contains: q, mode: 'insensitive' } },
          { taskId: { contains: q, mode: 'insensitive' } },
          { assigneesNames: { contains: q, mode: 'insensitive' } },
          { assigneesEmails: { contains: q, mode: 'insensitive' } },
          { client: { contains: q, mode: 'insensitive' } },
          { listName: { contains: q, mode: 'insensitive' } },
          { spaceName: { contains: q, mode: 'insensitive' } },
          { sprintName: { contains: q, mode: 'insensitive' } },
          { department: { contains: q, mode: 'insensitive' } },
          { executiveName: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    // Sprint (== clickup_lists row) status filter: 'active'/'completed' scopes
    // to tasks whose list isn't/is archived; 'all'/absent/unrecognized emits
    // no clause at all (backward-compatible with every pre-existing caller).
    // No Prisma relation from ClickupTask to ClickupList exists, so this is a
    // fetch-ids-then-IN join rather than a nested where — see
    // `sprintStatusListIds` for why, and why an empty array must still push a
    // (never-matching) clause instead of being treated as "no filter".
    const sprintListIds = await sprintStatusListIds(this.prisma, sprintStatus);
    if (sprintListIds) and.push({ listId: { in: sprintListIds } });
    if (and.length) where.AND = and;
    const [items, total] = await Promise.all([
      this.prisma.clickupTask.findMany({
        where,
        orderBy: { updatedDate: 'desc' },
        take: safeLimit,
        skip: offset,
        select: {
          taskId: true, taskName: true, url: true, spaceId: true, spaceName: true, status: true, statusType: true, statusColor: true,
          priority: true, parentTaskId: true, assigneesNames: true, assigneesEmails: true,
          updatedDate: true, syncedAt: true, sprintPoints: true, sprintName: true, cost: true,
          client: true, department: true, isDeleted: true, archived: true,
          listName: true, dueDate: true, timeEstimate: true, timeSpent: true,
          createdDate: true, closedDate: true, startDate: true, syncCount: true,
          estimation: true, folderName: true, creatorName: true, executiveName: true,
        },
      }),
      this.prisma.clickupTask.count({ where }),
    ]);
    const MS_PER_H = 3600000;
    return {
      items: items.map((t) => {
        const { timeEstimate, timeSpent, cost, estimation, ...rest } = t;
        return {
          ...rest,
          cost: cost.toNumber(),
          estimation: estimation.toNumber(),
          timeEstimateHours: timeEstimate != null ? Number(timeEstimate) / MS_PER_H : null,
          timeSpentHours: timeSpent != null ? Number(timeSpent) / MS_PER_H : null,
        };
      }),
      total,
      limit: safeLimit,
      offset,
    };
  }

  async sprintPoints(spaceId?: string) {
    const where: Prisma.ClickupTaskWhereInput = { isDeleted: false };
    if (spaceId) where.spaceId = spaceId;
    const rows = await this.prisma.clickupTask.groupBy({
      by: ['spaceName', 'status'],
      where,
      _sum: { sprintPoints: true },
      orderBy: { spaceName: 'asc' },
    });
    return rows.map(r => ({ spaceName: r.spaceName, status: r.status, totalPoints: r._sum.sprintPoints ?? 0 }));
  }

  async spaces() {
    type Row = {
      space_id: string;
      space_name: string;
      task_count: bigint;
      open_count: bigint;
      member_count: bigint;
      hours_logged: number;
      cost_cents: number;
    };
    // Open count uses `status_type`, ClickUp's coarse-grained classification
    // (open / custom / done / closed), not the per-list `status` string. The
    // prior `status NOT IN ('complete','closed')` check missed real data —
    // ClickUp returns `'Closed'` (capitalized) and `'done'` (not 'complete'),
    // so every task qualified as "open".
    //
    // Member count is approximated as the distinct set of users who have logged
    // time against any task in the space. We have no direct space-membership
    // table, but "people doing the work" is the question the metric answers.
    // Group by space_id (the real key), not (space_id, space_name). space_name
    // is denormalized and can be NULL on tasks synced via the single-task/webhook
    // path (GET /task/{id} omits space.name). Grouping by name too would split one
    // space into a named row + a NULL row, and the frontend's per-id merge would
    // let the tiny NULL bucket clobber the real count. MAX() picks a non-NULL name
    // for the space (NULL only if every row is NULL, which the UI falls back on).
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        t.space_id,
        MAX(t.space_name) AS space_name,
        COUNT(DISTINCT t.task_id)::bigint AS task_count,
        COUNT(DISTINCT t.task_id) FILTER (WHERE t.status_type NOT IN ('closed', 'done'))::bigint AS open_count,
        COUNT(DISTINCT e.user_id) FILTER (WHERE e.user_id IS NOT NULL)::bigint AS member_count,
        COALESCE(SUM(e.duration_hours), 0)::float AS hours_logged,
        COALESCE(SUM(e.cost_cents), 0)::float AS cost_cents
      FROM clickup_tasks t
      LEFT JOIN clickup_time_entries e ON e.task_id = t.task_id
      WHERE t.is_deleted = false
      GROUP BY t.space_id
      ORDER BY task_count DESC
    `);
    return rows.map(r => ({
      spaceId: r.space_id,
      spaceName: r.space_name,
      taskCount: Number(r.task_count),
      openCount: Number(r.open_count),
      memberCount: Number(r.member_count),
      hoursLogged: Number(r.hours_logged),
      costAud: Number(r.cost_cents) / 100,
    }));
  }
}

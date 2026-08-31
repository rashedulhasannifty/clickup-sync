import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { parseDate } from './report-date.util';
import { csvList, sprintStatusListIds, taskSearchOr } from './report-filter.util';
import { isPartiallyChargeable } from '../time-entries/chargeability';

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

  /**
   * Distinct clients with a task count, for the Tasks/Time Entries/Budgets
   * client dropdowns.
   *
   * The count is rendered inside the dropdown label, so it has to be built with
   * the same filters the Tasks table applies — otherwise the chip reads
   * "Byron Central (30)" over a table that says "No tasks match your filters",
   * because the count spans every space and every date while the table doesn't.
   * The clauses below mirror `tasksList` exactly (same `updated_date` window,
   * same archived semantics).
   *
   * Every option is optional and omitting them all reproduces the original
   * workspace-wide query: Budgets wants the full client list regardless of the
   * dashboard's space/date pickers, and calls this bare.
   */
  async tasksClients(opts?: { spaceId?: string; from?: string; to?: string; archived?: string }) {
    const { spaceId, from, to, archived } = opts ?? {};
    // Same shape as `tasksList`: 'only' → archived only, 'exclude' → hide
    // archived, anything else (including the default 'include') → no clause.
    const archivedSql =
      archived === 'only' ? Prisma.sql`AND archived = true`
      : archived === 'exclude' ? Prisma.sql`AND archived = false`
      : Prisma.empty;
    // Matches `tasksList`: one bound present is enough to apply the window, and
    // the missing bound falls back to epoch / now.
    const dateSql = (from || to)
      ? Prisma.sql`AND updated_date >= ${parseDate(from, new Date(0))} AND updated_date <= ${parseDate(to, new Date())}`
      : Prisma.empty;
    type Row = { client: string; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT client, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND client IS NOT NULL
        AND client <> ''
        ${spaceId ? Prisma.sql`AND space_id = ${spaceId}` : Prisma.empty}
        ${archivedSql}
        ${dateSql}
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
    chargeable?: string,
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
    // Free-text search across short, indexed-friendly fields (see `taskSearchOr`
    // for the field list and why it is shared with the Time Entries page).
    // Pushed onto the AND accumulator so search stacks with the other filters
    // above (mirrors `timeEntriesList`).
    if (search?.trim()) {
      and.push({ OR: taskSearchOr(search.trim()) });
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

    // Chargeability filter. Defined on the RULES, exactly like the tri-state
    // pill this list emits above: 'partial' means a (task, assignee) rule
    // disagrees with the task flag, and 'true'/'false' mean the flag with no
    // such rule — so the three are mutually exclusive. Anything else (absent,
    // 'all', unrecognized) emits no clause, leaving every pre-existing caller
    // unchanged.
    //
    // Phase 2 note: `isPartiallyChargeable` also splits on entries disagreeing
    // with each other, which this cannot express as a `where`. That arm is
    // inert today (nothing writes `chargeable_override`, so entries can only
    // disagree because a rule made them), and the pill this list emits passes
    // no entry counts for the same reason. When phase 2 gives the pill its
    // entry signal, this filter has to gain the matching arm in the same
    // change or the two stop agreeing.
    if (chargeable === 'true') {
      and.push({ isChargeable: true, chargeabilityRules: { none: { chargeable: false } } });
    } else if (chargeable === 'false') {
      and.push({ isChargeable: false, chargeabilityRules: { none: { chargeable: true } } });
    } else if (chargeable === 'partial') {
      // "Disagrees with the flag" depends on the row's own flag, so it cannot
      // be a single relation filter — one OR arm per direction.
      and.push({
        OR: [
          { isChargeable: true, chargeabilityRules: { some: { chargeable: false } } },
          { isChargeable: false, chargeabilityRules: { some: { chargeable: true } } },
        ],
      });
    }
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
          isChargeable: true,
        },
      }),
      this.prisma.clickupTask.count({ where }),
    ]);

    // Tri-state pill input. `is_chargeable` on the task is only half the
    // answer once a (task, assignee) rule can disagree with it, so the rules
    // for the rows ON THIS PAGE are read alongside them. Scoped to the page,
    // not the filtered set — the pill only renders for rows that exist.
    //
    // Entry-level counts are deliberately NOT consulted here. Nothing writes
    // `chargeable_override` yet, so an entry's `is_chargeable` is a lagged
    // function of the same rule this already reads; folding it in would add a
    // per-page aggregate that can only agree, or agree late. Phase 2 makes it
    // load-bearing — `isPartiallyChargeable` already takes the counts.
    const pageTaskIds = items.map((t) => t.taskId);
    const ruleRows = pageTaskIds.length
      ? await this.prisma.taskAssigneeChargeability.findMany({
          where: { taskId: { in: pageTaskIds } },
          select: { taskId: true, chargeable: true },
        })
      : [];
    const rulesByTask = new Map<string, boolean[]>();
    for (const r of ruleRows) {
      const list = rulesByTask.get(r.taskId);
      if (list) list.push(r.chargeable);
      else rulesByTask.set(r.taskId, [r.chargeable]);
    }

    const MS_PER_H = 3600000;
    return {
      items: items.map((t) => {
        const { timeEstimate, timeSpent, cost, estimation, ...rest } = t;
        return {
          ...rest,
          partiallyChargeable: isPartiallyChargeable({
            taskChargeable: t.isChargeable,
            rules: rulesByTask.get(t.taskId) ?? [],
          }),
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

  /**
   * Lean per-task description lookup for the task drawer. Kept off the paged
   * `tasks()` list select on purpose: descriptions (especially the markdown
   * source) are large-ish text and are only ever shown one task at a time in
   * the drawer, while the list endpoint is also the CSV/Excel export source
   * (limit up to 5000 rows) on a memory-tight host. Fetch on drawer open.
   */
  async taskDescription(taskId: string) {
    const row = await this.prisma.clickupTask.findUnique({
      where: { taskId },
      select: { description: true, markdownDescription: true },
    });
    if (!row) return null;
    return { description: row.description, markdownDescription: row.markdownDescription };
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

  /**
   * Numbers behind the chargeability confirmation dialog.
   *
   * `changing` counts only the tasks whose flag would actually flip — marking
   * twelve tasks non-chargeable when three already are should say nine, or the
   * dialog overstates what is about to happen. The entry count and hours cover
   * every given task, since that is the time whose cost is being re-evaluated.
   */
  async chargeablePreview(taskIds: string[], chargeable: boolean) {
    const [tasks, changing, entries] = await Promise.all([
      // The tasks that actually EXIST among the given ids, not `taskIds.length`:
      // an id with no row inflates the "of N tasks" denominator the dialog
      // shows, and could even make `changing` exceed it — `changing` only ever
      // counts rows that exist. Same filter as `changing` apart from the flag,
      // so `tasks` is always a superset of it. Duplicates are already collapsed
      // upstream by `csvList`.
      this.prisma.clickupTask.count({ where: { taskId: { in: taskIds } } }),
      this.prisma.clickupTask.count({ where: { taskId: { in: taskIds }, isChargeable: !chargeable } }),
      this.prisma.clickupTimeEntry.aggregate({
        where: { taskId: { in: taskIds } },
        _count: true,
        _sum: { durationHours: true },
      }),
    ]);
    return {
      tasks,
      changing,
      timeEntries: entries._count,
      hours: entries._sum.durationHours?.toNumber() ?? 0,
    };
  }
}

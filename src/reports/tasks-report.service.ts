import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { parseDate } from './report-date.util';
import { buildTaskWhere, TASK_LIST_SELECT } from './task-filter.util';
import { isPartiallyChargeable } from '../time-entries/chargeability';
import { AccessScope, isUnrestricted, leadClientIds } from '../access/access-scope';
import { maskCost } from '../access/cost-mask';
import { leadScopeSql, taskScopeSql, taskScopeWhere } from '../access/scope-query';
import { requireLeadView } from '../access/scope.decorator';

/** Task-centric report queries (counts, filters, per-space aggregates). */
@Injectable()
export class TasksReportService {
  constructor(private readonly prisma: PrismaService) {}

  async tasksSummary(scope: AccessScope) {
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
          AND ${taskScopeSql(scope, 'clickup_tasks')}
        GROUP BY space_id
        ORDER BY count DESC
      `),
      this.prisma.clickupTask.groupBy({
        by: ['status'],
        where: { isDeleted: false, ...taskScopeWhere(scope) },
        _count: { taskId: true },
      }),
      this.prisma.clickupTask.groupBy({
        by: ['statusType'],
        where: { isDeleted: false, ...taskScopeWhere(scope) },
        _count: { taskId: true },
      }),
      this.prisma.clickupTask.count({ where: { isDeleted: false, ...taskScopeWhere(scope) } }),
    ]);
    return {
      bySpace: bySpaceRows.map(r => ({ spaceId: r.space_id, spaceName: r.space_name, count: Number(r.count) })),
      byStatus: byStatusRows.map(r => ({ status: r.status, count: r._count.taskId })),
      byStatusType: byStatusTypeRows.map(r => ({ statusType: r.statusType, count: r._count.taskId })),
      total,
    };
  }

  async tasksBySpaceStatus(scope: AccessScope) {
    const rows = await this.prisma.clickupTask.groupBy({
      by: ['spaceName', 'status'],
      where: { isDeleted: false, ...taskScopeWhere(scope) },
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
  async tasksAssignees(scope: AccessScope) {
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
          AND ${taskScopeSql(scope, 'clickup_tasks')}
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
  async tasksClients(
    opts: { spaceId?: string; from?: string; to?: string; archived?: string } = {},
    scope: AccessScope,
  ) {
    const { spaceId, from, to, archived } = opts;
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
        AND ${taskScopeSql(scope, 'clickup_tasks')}
        ${spaceId ? Prisma.sql`AND space_id = ${spaceId}` : Prisma.empty}
        ${archivedSql}
        ${dateSql}
      GROUP BY client
      ORDER BY client ASC
    `);
    return rows.map((r) => ({ client: r.client, taskCount: Number(r.task_count) }));
  }

  /**
   * Distinct sub-projects with a task count, for the Tasks/Time Entries
   * sub-project dropdowns. Same scoping as `tasksClients` so the count in the
   * label matches the table.
   *
   * A task can carry several sub-projects, so the per-option counts can sum to
   * MORE than the task total. That's correct — each count is "tasks you'd see
   * if you picked only this option" — don't "fix" it into a partition.
   */
  async tasksSubProjects(
    opts: { spaceId?: string; from?: string; to?: string; archived?: string } = {},
    scope: AccessScope,
  ) {
    const { spaceId, from, to, archived } = opts;
    const archivedSql =
      archived === 'only' ? Prisma.sql`AND archived = true`
      : archived === 'exclude' ? Prisma.sql`AND archived = false`
      : Prisma.empty;
    const dateSql = (from || to)
      ? Prisma.sql`AND updated_date >= ${parseDate(from, new Date(0))} AND updated_date <= ${parseDate(to, new Date())}`
      : Prisma.empty;
    type Row = { sub_project: string; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT sp AS sub_project, COUNT(DISTINCT task_id)::bigint AS task_count
      FROM clickup_tasks, unnest(sub_projects) AS sp
      WHERE is_deleted = false
        AND sp <> ''
        AND ${taskScopeSql(scope, 'clickup_tasks')}
        ${spaceId ? Prisma.sql`AND space_id = ${spaceId}` : Prisma.empty}
        ${archivedSql}
        ${dateSql}
      GROUP BY sp
      ORDER BY sp ASC
    `);
    return rows.map((r) => ({ subProject: r.sub_project, taskCount: Number(r.task_count) }));
  }

  async tasksLists(spaceId: string | undefined = undefined, scope: AccessScope) {
    type Row = { list_id: string; list_name: string; space_name: string | null; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT list_id, list_name, MAX(space_name) AS space_name, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND list_id IS NOT NULL
        AND list_name <> ''
        AND ${taskScopeSql(scope, 'clickup_tasks')}
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

  async tasksFolders(spaceId: string | undefined = undefined, scope: AccessScope) {
    type Row = { folder_id: string; folder_name: string; space_name: string | null; task_count: bigint };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT folder_id, folder_name, MAX(space_name) AS space_name, COUNT(*)::bigint AS task_count
      FROM clickup_tasks
      WHERE is_deleted = false
        AND folder_id IS NOT NULL
        AND folder_name <> ''
        AND ${taskScopeSql(scope, 'clickup_tasks')}
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
    // Required, no default, and FIRST (Ruling R10): TS disallows a required
    // param after optional ones, and a default here would be fail-open — a
    // future caller that forgets it would silently see every client's cost.
    // Every HTTP path supplies a real one via the controller's `@Scope()`.
    scope: AccessScope,
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
    subProject?: string,
  ) {
    // Cap kept generous so the dashboard's "Export CSV" can pull a complete
    // filtered set in one shot. The page UI never offers > 100 rows/page, so
    // this only matters for export requests.
    const safeLimit = Math.min(limit, 5000);
    const where = await buildTaskWhere(this.prisma, {
      spaceId, status, search, from: fromParam, to: toParam, priority,
      assigneeNames: assigneeId, type, archived, client, taskIds, listId,
      folderId, sprintStatus, chargeable, subProject,
    }, scope);
    const [items, total] = await Promise.all([
      this.prisma.clickupTask.findMany({
        where,
        orderBy: { updatedDate: 'desc' },
        take: safeLimit,
        skip: offset,
        select: TASK_LIST_SELECT,
      }),
      this.prisma.clickupTask.count({ where }),
    ]);

    // Tri-state pill input. `is_chargeable` on the task is only half the
    // answer once a (task, assignee) rule can disagree with it, so the rules
    // for the rows ON THIS PAGE are read alongside them. Scoped to the page,
    // not the filtered set — the pill only renders for rows that exist.
    //
    // Entry counts are consulted alongside the rules from phase 2 onwards: a
    // per-entry override can split a task that has no rule on it at all, which
    // the rules alone cannot see. The `chargeable` filter above carries the
    // matching arm — the two must move together or a split task shows
    // "partial" here and lands in no filter bucket.
    const pageTaskIds = items.map((t) => t.taskId);
    const [ruleRows, entryRows] = pageTaskIds.length
      ? await Promise.all([
          this.prisma.taskAssigneeChargeability.findMany({
            where: { taskId: { in: pageTaskIds } },
            select: { taskId: true, chargeable: true },
          }),
          this.prisma.clickupTimeEntry.groupBy({
            by: ['taskId', 'isChargeable'],
            where: { taskId: { in: pageTaskIds } },
            _count: true,
          }),
        ])
      : [[], []];
    const rulesByTask = new Map<string, boolean[]>();
    for (const r of ruleRows) {
      const list = rulesByTask.get(r.taskId);
      if (list) list.push(r.chargeable);
      else rulesByTask.set(r.taskId, [r.chargeable]);
    }

    // Counts, never an hours sum — a task split only by 0-duration entries is
    // still split. See `isPartiallyChargeable`.
    const countsByTask = new Map<string, { entryCount: number; nonChargeableCount: number }>();
    for (const g of entryRows) {
      if (g.taskId == null) continue;
      const b = countsByTask.get(g.taskId) ?? { entryCount: 0, nonChargeableCount: 0 };
      const n = typeof g._count === 'number' ? g._count : 0;
      b.entryCount += n;
      if (!g.isChargeable) b.nonChargeableCount += n;
      countsByTask.set(g.taskId, b);
    }

    const MS_PER_H = 3600000;
    return {
      items: items.map((t) => {
        const { timeEstimate, timeSpent, cost, estimation, scopeClientOptionId, ...rest } = t;
        return maskCost(
          {
            ...rest,
            partiallyChargeable: isPartiallyChargeable({
              taskChargeable: t.isChargeable,
              rules: rulesByTask.get(t.taskId) ?? [],
              ...(countsByTask.get(t.taskId) ?? {}),
            }),
            cost: cost.toNumber(),
            estimation: estimation.toNumber(),
            timeEstimateHours: timeEstimate != null ? Number(timeEstimate) / MS_PER_H : null,
            timeSpentHours: timeSpent != null ? Number(timeSpent) / MS_PER_H : null,
          },
          scope,
          scopeClientOptionId,
        );
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
  async taskDescription(taskId: string, scope: AccessScope) {
    // `findFirst`, not `findUnique`: the latter can't be combined with the
    // scope filter. A row outside scope must 404 exactly like a row that
    // doesn't exist at all — never 403, which would confirm the task exists.
    const row = await this.prisma.clickupTask.findFirst({
      where: { taskId, ...taskScopeWhere(scope) },
      select: { description: true, markdownDescription: true },
    });
    if (!row) {
      // Ruling R14: unrestricted (Owner/Admin, or a flag-off MEMBER) keeps
      // today's exact pre-scoping behaviour for a missing id — `null`, not a
      // 404. Only a scoped viewer gets the no-existence-oracle 404.
      if (!isUnrestricted(scope)) throw new NotFoundException('Task not found');
      return null;
    }
    return { description: row.description, markdownDescription: row.markdownDescription };
  }

  async sprintPoints(spaceId: string | undefined = undefined, scope: AccessScope) {
    // Sprints are hidden for plain members (Endpoint classification table);
    // requireLeadView lets an unrestricted viewer (incl. a flag-off MEMBER)
    // through unchanged and 403s a scoped non-lead.
    requireLeadView(scope);
    const where: Prisma.ClickupTaskWhereInput = { isDeleted: false, ...taskScopeWhere(scope) };
    if (spaceId) where.spaceId = spaceId;
    const rows = await this.prisma.clickupTask.groupBy({
      by: ['spaceName', 'status'],
      where,
      _sum: { sprintPoints: true },
      orderBy: { spaceName: 'asc' },
    });
    return rows.map(r => ({ spaceName: r.spaceName, status: r.status, totalPoints: r._sum.sprintPoints ?? 0 }));
  }

  async spaces(scope: AccessScope) {
    type Row = {
      space_id: string;
      space_name: string;
      task_count: bigint;
      open_count: bigint;
      member_count: bigint;
      hours_logged: number;
      cost_cents: number;
      cost_partial: boolean;
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
        COALESCE(SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN e.cost_cents ELSE 0 END), 0)::float AS cost_cents,
        -- Only an entry that actually exists AND is outside the viewer's LEAD
        -- clients hides cost. Without the e.task_id IS NOT NULL guard, a
        -- non-lead task with zero time entries still flips this true via the
        -- LEFT JOIN's single NULL-entry row, even though nothing was hidden.
        BOOL_OR(e.task_id IS NOT NULL AND NOT ${leadScopeSql(scope, 't')}) AS cost_partial
      FROM clickup_tasks t
      LEFT JOIN clickup_time_entries e ON e.task_id = t.task_id
      WHERE t.is_deleted = false
        AND ${taskScopeSql(scope, 't')}
      GROUP BY t.space_id
      ORDER BY task_count DESC
    `);
    // Ruling R12: a viewer who leads NO client in scope gets `null`, not a
    // misleadingly precise 0 — 0 reads as "this space genuinely costs
    // nothing", not "you can't see it". `leadIds === null` is unrestricted
    // (incl. a flag-off MEMBER), unchanged from before.
    const leadIds = leadClientIds(scope);
    const leadsNothing = leadIds !== null && leadIds.length === 0;
    return rows.map(r => ({
      spaceId: r.space_id,
      spaceName: r.space_name,
      taskCount: Number(r.task_count),
      openCount: Number(r.open_count),
      memberCount: Number(r.member_count),
      hoursLogged: Number(r.hours_logged),
      costAud: leadsNothing ? null : Number(r.cost_cents) / 100,
      // Only meaningful for a scoped viewer: `leadScopeSql` is always TRUE
      // when unrestricted, so `BOOL_OR(... AND NOT TRUE)` is always false there.
      costPartial: !!r.cost_partial,
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
  async chargeablePreview(taskIds: string[], chargeable: boolean, scope: AccessScope) {
    const scopeWhere = taskScopeWhere(scope);
    const [tasks, changing, entries] = await Promise.all([
      // The tasks that actually EXIST *and are in scope* among the given ids,
      // not `taskIds.length`: an id with no row (or one outside scope) would
      // otherwise inflate the "of N tasks" denominator the dialog shows, and
      // could even make `changing` exceed it — `changing` only ever counts
      // rows that exist. Same filter as `changing` apart from the flag, so
      // `tasks` is always a superset of it. Duplicates are already collapsed
      // upstream by `csvList`.
      this.prisma.clickupTask.count({ where: { taskId: { in: taskIds }, ...scopeWhere } }),
      this.prisma.clickupTask.count({
        where: { taskId: { in: taskIds }, ...scopeWhere, isChargeable: !chargeable },
      }),
      this.prisma.clickupTimeEntry.aggregate({
        where: { taskId: { in: taskIds } },
        _count: true,
        _sum: { durationHours: true },
      }),
    ]);
    // Below `ids.length` means at least one id doesn't exist OR is out of
    // scope. The two cases get the same error deliberately — telling them
    // apart would let a scoped caller probe for a task's existence.
    //
    // Ruling R13: only enforced for a scoped viewer. Unrestricted (Owner/Admin,
    // or a flag-off MEMBER) must reproduce today's behaviour exactly — a stray
    // id that doesn't exist degrades gracefully rather than 404ing the whole
    // request, same as before scoping existed.
    if (!isUnrestricted(scope) && tasks !== taskIds.length) {
      throw new NotFoundException('Some tasks were not found');
    }
    return {
      tasks,
      changing,
      timeEntries: entries._count,
      hours: entries._sum.durationHours?.toNumber() ?? 0,
    };
  }
}

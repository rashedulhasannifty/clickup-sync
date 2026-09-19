import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CycleTimeReportService } from './cycle-time-report.service';
import { AccessScope, isUnrestricted } from '../access/access-scope';
import { leadScopeSql, taskScopeSql } from '../access/scope-query';
import { requireLeadView } from '../access/scope.decorator';

export interface SprintRow {
  listId: string;
  name: string;
  folderName: string | null;
  spaceName: string | null;
  archived: boolean;
  startDate: Date | null;
  dueDate: Date | null;
  taskTotal: number;
  taskDone: number;
  pctDone: number;
  hours: number;
  costAud: number | null;
  costPartial: boolean;
}

type SprintStatus = 'active' | 'completed' | 'all';

type SprintQueryRow = {
  list_id: string;
  name: string;
  folder_name: string | null;
  space_name: string | null;
  archived: boolean;
  start_date: Date | null;
  due_date: Date | null;
  task_total: bigint;
  task_done: bigint;
  hours: number;
  cost_cents: bigint;
  has_led_cost: boolean;
  cost_partial: boolean;
};

/**
 * Sprint (== `clickup_lists` row) aggregate reports: list/filter, folder
 * roll-ups, single-sprint detail, and velocity (recent-sprint throughput).
 *
 * `clickup_tasks` and `clickup_time_entries` fan out independently under the
 * same `list_id`/`task_id` join (one task can have many time entries), so
 * task counts always use `COUNT(DISTINCT t.task_id)` — a plain `COUNT` would
 * be inflated by the time-entry join (mirrors `tasks-report.service.ts`'s
 * `spaces()`). `SUM(te.duration_hours)` / `SUM(te.cost_cents)` are safe as
 * plain sums because each time-entry row appears exactly once regardless of
 * how many task rows it's joined against.
 *
 * Team scoping (Task 12): all four sprint methods are lead-only views
 * (Ruling R1) — gated by `requireLeadView` as the first statement, which lets
 * an unrestricted viewer (incl. a flag-off MEMBER) through unchanged and 403s
 * a scoped non-lead. The `clickup_tasks` join is scoped with `taskScopeSql`
 * so a lead's totals cover only in-scope tasks; cost is narrowed further to
 * LEAD clients only (`leadScopeSql`, Ruling R12) since a lead of one team can
 * also be a plain member of another and must not see that team's cost.
 */
@Injectable()
export class SprintsReportService {
  constructor(
    private readonly prisma: PrismaService,
    // Not called directly: CycleTimeReportService.cycleTime() only supports
    // {from,to,groupBy} bucketed aggregates, not a single-list scope. Kept as
    // a constructor dependency because Task 7/8 wire this service up assuming
    // the 2-arg shape, and a future list-scoped cycleTime() belongs here.
    private readonly cycleTime: CycleTimeReportService,
  ) {}

  /**
   * Coerce to a finite integer, falling back to `fallback` when the input is
   * undefined/NaN/±Infinity (e.g. an unvalidated `limit`/`offset` reaching this
   * layer before Task 7's DTO validation exists — `Math.max(NaN, 1)` is `NaN`,
   * which would otherwise splice a literal `NaN` into the query), then clamps
   * to `[min, max]`. Always returns a finite integer in range.
   */
  private clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
    const n = Number(value);
    const v = Number.isFinite(n) ? Math.trunc(n) : fallback;
    return Math.min(Math.max(v, min), max);
  }

  private statusFilter(status?: SprintStatus): Prisma.Sql {
    if (status === 'completed') return Prisma.sql`l.archived = true`;
    if (status === 'all') return Prisma.sql`TRUE`;
    // default 'active'
    return Prisma.sql`l.archived = false`;
  }

  /**
   * Ruling R12: unrestricted (incl. a flag-off MEMBER) keeps the exact prior
   * computation — the full cost sum, never null, `costPartial: false`. A
   * scoped viewer's cost was already summed over LEAD clients only (via
   * `leadScopeSql` in the query); this nulls it when NONE of the row's cost
   * was LEAD-visible (`has_led_cost`), rather than a misleadingly precise $0.
   */
  private maskAggregateCost(
    costCents: bigint | number,
    hasLedCost: boolean,
    costPartial: boolean,
    scope: AccessScope,
  ): { costAud: number | null; costPartial: boolean } {
    if (isUnrestricted(scope)) {
      return { costAud: Number(costCents) / 100, costPartial: false };
    }
    return { costAud: hasLedCost ? Number(costCents) / 100 : null, costPartial: !!costPartial };
  }

  private toSprintRow(r: SprintQueryRow, scope: AccessScope): SprintRow {
    const taskTotal = Number(r.task_total);
    const taskDone = Number(r.task_done);
    const { costAud, costPartial } = this.maskAggregateCost(r.cost_cents, r.has_led_cost, r.cost_partial, scope);
    return {
      listId: r.list_id,
      name: r.name,
      folderName: r.folder_name,
      spaceName: r.space_name,
      archived: r.archived,
      startDate: r.start_date,
      dueDate: r.due_date,
      taskTotal,
      taskDone,
      pctDone: taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0,
      hours: Number(r.hours),
      costAud,
      costPartial,
    };
  }

  async sprints(
    p: {
      spaceId?: string;
      folderId?: string;
      status?: SprintStatus;
      search?: string;
      limit?: number;
      offset?: number;
    },
    scope: AccessScope,
  ): Promise<{ items: SprintRow[]; total: number }> {
    // Lead-only view (Ruling R1): an unrestricted viewer (incl. a flag-off
    // MEMBER) reads sprints exactly as today; a scoped non-lead 403s.
    requireLeadView(scope);
    const { spaceId, folderId, status } = p;
    const search = p.search?.trim();
    // Bound query parameters (mirrors ops-report.service.ts's
    // `LIMIT ${safeLimit} OFFSET ${offset}` — Prisma binds these as real
    // query params, which Postgres accepts fine for LIMIT/OFFSET). Clamped
    // to a finite integer first so an unvalidated caller (Task 7's DTO
    // validation doesn't exist yet) can't send NaN/±Infinity through.
    const safeLimit = this.clampInt(p.limit, 50, 1, 500);
    const safeOffset = this.clampInt(p.offset, 0, 0, 1_000_000_000);
    const statusClause = this.statusFilter(status);
    const spaceClause = spaceId ? Prisma.sql`AND l.space_id = ${spaceId}` : Prisma.empty;
    const folderClause = folderId ? Prisma.sql`AND l.folder_id = ${folderId}` : Prisma.empty;
    const searchClause = search ? Prisma.sql`AND l.name ILIKE ${'%' + search + '%'}` : Prisma.empty;
    const scoped = !isUnrestricted(scope);
    // Scoping the join must not change unrestricted results: `taskScopeSql`
    // is TRUE when unrestricted, so the join and counts are identical to
    // before. Only a scoped viewer gets the HAVING (a lead's list must
    // contain at least one in-scope task) and the matching EXISTS on the
    // total-count query below.
    const havingClause = scoped ? Prisma.sql`HAVING COUNT(t.task_id) > 0` : Prisma.empty;
    const totalExistsClause = scoped
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM clickup_tasks t WHERE t.list_id = l.list_id AND t.is_deleted = false AND ${taskScopeSql(scope, 't')})`
      : Prisma.empty;

    const [items, totalRows] = await Promise.all([
      this.prisma.$queryRaw<SprintQueryRow[]>(Prisma.sql`
        SELECT l.list_id, l.name, l.folder_name, l.space_name, l.archived, l.start_date, l.due_date,
               COUNT(DISTINCT t.task_id)::bigint AS task_total,
               COUNT(DISTINCT t.task_id) FILTER (WHERE t.status_type IN ('closed', 'done'))::bigint AS task_done,
               COALESCE(SUM(te.duration_hours), 0)::float AS hours,
               COALESCE(SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN te.cost_cents ELSE 0 END), 0)::bigint AS cost_cents,
               BOOL_OR(te.task_id IS NOT NULL AND ${leadScopeSql(scope, 't')}) AS has_led_cost,
               BOOL_OR(te.task_id IS NOT NULL AND NOT ${leadScopeSql(scope, 't')}) AS cost_partial
        FROM clickup_lists l
        LEFT JOIN clickup_tasks t ON t.list_id = l.list_id AND t.is_deleted = false AND ${taskScopeSql(scope, 't')}
        LEFT JOIN clickup_time_entries te ON te.task_id = t.task_id
        WHERE ${statusClause}
          ${spaceClause}
          ${folderClause}
          ${searchClause}
        GROUP BY l.list_id, l.name, l.folder_name, l.space_name, l.archived, l.start_date, l.due_date
        ${havingClause}
        ORDER BY l.due_date DESC NULLS LAST, l.name ASC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `),
      this.prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        FROM clickup_lists l
        WHERE ${statusClause}
          ${spaceClause}
          ${folderClause}
          ${searchClause}
          ${totalExistsClause}
      `),
    ]);

    return {
      items: items.map((r) => this.toSprintRow(r, scope)),
      total: Number(totalRows[0]?.total ?? 0n),
    };
  }

  async sprintFolders(
    spaceId: string | undefined = undefined,
    scope: AccessScope,
  ): Promise<{ folderId: string; folderName: string | null; spaceName: string | null; activeCount: number; completedCount: number }[]> {
    requireLeadView(scope);
    type Row = { folder_id: string; folder_name: string | null; space_name: string | null; active_count: bigint; completed_count: bigint };
    const scopedClause = !isUnrestricted(scope)
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM clickup_tasks t WHERE t.list_id = clickup_lists.list_id AND t.is_deleted = false AND ${taskScopeSql(scope, 't')})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT folder_id,
             MAX(folder_name) AS folder_name,
             MAX(space_name) AS space_name,
             COUNT(*) FILTER (WHERE archived = false)::bigint AS active_count,
             COUNT(*) FILTER (WHERE archived = true)::bigint AS completed_count
      FROM clickup_lists
      WHERE folder_id IS NOT NULL
        ${spaceId ? Prisma.sql`AND space_id = ${spaceId}` : Prisma.empty}
        ${scopedClause}
      GROUP BY folder_id
      ORDER BY MAX(space_name) ASC, MAX(folder_name) ASC
    `);
    return rows.map((r) => ({
      folderId: r.folder_id,
      folderName: r.folder_name,
      spaceName: r.space_name,
      activeCount: Number(r.active_count),
      completedCount: Number(r.completed_count),
    }));
  }

  async sprintDetail(
    listId: string,
    scope: AccessScope,
  ): Promise<{
    list: SprintRow;
    byStatus: { status: string; color: string | null; count: number }[];
    byAssignee: { userName: string; hours: number; costAud: number | null; costPartial: boolean }[];
    assigneeCount: number;
    cycleTimeHours: number | null;
  }> {
    requireLeadView(scope);
    type StatusRow = { status: string; color: string | null; count: bigint };
    type AssigneeRow = { user_name: string; hours: number; cost_cents: bigint; has_led_cost: boolean; cost_partial: boolean };
    type CycleRow = { mean_hours: number | null; task_count: bigint };

    const [listRows, statusRows, assigneeRows, cycleRows] = await Promise.all([
      this.prisma.$queryRaw<SprintQueryRow[]>(Prisma.sql`
        SELECT l.list_id, l.name, l.folder_name, l.space_name, l.archived, l.start_date, l.due_date,
               COUNT(DISTINCT t.task_id)::bigint AS task_total,
               COUNT(DISTINCT t.task_id) FILTER (WHERE t.status_type IN ('closed', 'done'))::bigint AS task_done,
               COALESCE(SUM(te.duration_hours), 0)::float AS hours,
               COALESCE(SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN te.cost_cents ELSE 0 END), 0)::bigint AS cost_cents,
               BOOL_OR(te.task_id IS NOT NULL AND ${leadScopeSql(scope, 't')}) AS has_led_cost,
               BOOL_OR(te.task_id IS NOT NULL AND NOT ${leadScopeSql(scope, 't')}) AS cost_partial
        FROM clickup_lists l
        LEFT JOIN clickup_tasks t ON t.list_id = l.list_id AND t.is_deleted = false AND ${taskScopeSql(scope, 't')}
        LEFT JOIN clickup_time_entries te ON te.task_id = t.task_id
        WHERE l.list_id = ${listId}
        GROUP BY l.list_id, l.name, l.folder_name, l.space_name, l.archived, l.start_date, l.due_date
      `),
      this.prisma.$queryRaw<StatusRow[]>(Prisma.sql`
        SELECT t.status AS status, MAX(t.status_color) AS color, COUNT(*)::bigint AS count
        FROM clickup_tasks t
        WHERE t.list_id = ${listId} AND t.is_deleted = false AND t.status IS NOT NULL AND ${taskScopeSql(scope, 't')}
        GROUP BY t.status
        ORDER BY count DESC
      `),
      this.prisma.$queryRaw<AssigneeRow[]>(Prisma.sql`
        SELECT COALESCE(NULLIF(te.user_name, ''), te.user_id, 'Unknown') AS user_name,
               COALESCE(SUM(te.duration_hours), 0)::float AS hours,
               COALESCE(SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN te.cost_cents ELSE 0 END), 0)::bigint AS cost_cents,
               BOOL_OR(${leadScopeSql(scope, 't')}) AS has_led_cost,
               BOOL_OR(NOT ${leadScopeSql(scope, 't')}) AS cost_partial
        FROM clickup_time_entries te
        JOIN clickup_tasks t ON t.task_id = te.task_id AND t.is_deleted = false
        WHERE t.list_id = ${listId} AND ${taskScopeSql(scope, 't')}
        GROUP BY 1
        ORDER BY hours DESC
      `),
      // Inline cycle-time computation: CycleTimeReportService.cycleTime() only
      // accepts {from,to,groupBy} bucketed aggregates, no per-list scope, so it
      // can't be reused here (see constructor comment). Mean open->done hours
      // over this sprint's tasks; null when no task has both endpoints.
      this.prisma.$queryRaw<CycleRow[]>(Prisma.sql`
        WITH sprint_tasks AS (
          SELECT task_id FROM clickup_tasks t WHERE t.list_id = ${listId} AND t.is_deleted = false AND ${taskScopeSql(scope, 't')}
        ),
        task_endpoints AS (
          SELECT e.task_id,
                 MIN(e.occurred_at) FILTER (WHERE (e.after->>'type') = 'open') AS first_open,
                 MAX(e.occurred_at) FILTER (WHERE (e.after->>'type') = 'done') AS last_done
          FROM clickup_task_events e
          JOIN sprint_tasks st ON st.task_id = e.task_id
          WHERE e.event_type = 'taskStatusUpdated'
          GROUP BY e.task_id
        )
        SELECT AVG(EXTRACT(EPOCH FROM (last_done - first_open)) / 3600.0)::float AS mean_hours,
               COUNT(*)::bigint AS task_count
        FROM task_endpoints
        WHERE first_open IS NOT NULL AND last_done IS NOT NULL
      `),
    ]);

    const listRow = listRows[0];
    // R13/R14: 404 for a list with no in-scope task applies only when scoped
    // — an unrestricted viewer keeps today's behaviour for a missing OR a
    // genuinely empty list (task_total === 0 is not itself a 404 there).
    if (!listRow || (!isUnrestricted(scope) && Number(listRow.task_total) === 0)) {
      throw new NotFoundException(`Sprint (list) ${listId} not found`);
    }

    const byAssignee = assigneeRows.map((r) => {
      const { costAud, costPartial } = this.maskAggregateCost(r.cost_cents, r.has_led_cost, r.cost_partial, scope);
      return { userName: r.user_name, hours: Number(r.hours), costAud, costPartial };
    });

    const cycle = cycleRows[0];
    const cycleTimeHours = cycle && Number(cycle.task_count) > 0 && cycle.mean_hours != null ? Number(cycle.mean_hours) : null;

    return {
      list: this.toSprintRow(listRow, scope),
      byStatus: statusRows.map((r) => ({ status: r.status, color: r.color, count: Number(r.count) })),
      byAssignee,
      assigneeCount: byAssignee.length,
      cycleTimeHours,
    };
  }

  async velocity(
    folderId: string,
    limit = 12,
    scope: AccessScope,
  ): Promise<{ listId: string; name: string; dueDate: Date | null; taskDone: number; hours: number }[]> {
    requireLeadView(scope);
    type Row = { list_id: string; name: string; due_date: Date | null; task_done: bigint; hours: number };
    // See sprints()'s comment: clamp to a finite integer first, then bind it
    // as a normal query parameter (mirrors ops-report.service.ts).
    const safeLimit = this.clampInt(limit, 12, 1, 100);
    const havingClause = !isUnrestricted(scope) ? Prisma.sql`HAVING COUNT(t.task_id) > 0` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT l.list_id, l.name, l.due_date,
             COUNT(DISTINCT t.task_id) FILTER (WHERE t.status_type IN ('closed', 'done'))::bigint AS task_done,
             COALESCE(SUM(te.duration_hours), 0)::float AS hours
      FROM clickup_lists l
      LEFT JOIN clickup_tasks t ON t.list_id = l.list_id AND t.is_deleted = false AND ${taskScopeSql(scope, 't')}
      LEFT JOIN clickup_time_entries te ON te.task_id = t.task_id
      WHERE l.folder_id = ${folderId}
      GROUP BY l.list_id, l.name, l.due_date
      ${havingClause}
      ORDER BY l.due_date DESC NULLS LAST
      LIMIT ${safeLimit}
    `);
    return rows.map((r) => ({
      listId: r.list_id,
      name: r.name,
      dueDate: r.due_date,
      taskDone: Number(r.task_done),
      hours: Number(r.hours),
    }));
  }
}

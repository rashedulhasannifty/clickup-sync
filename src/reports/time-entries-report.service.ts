import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { assembleTimesheet, dhakaDate, type TimesheetAggRow } from './timesheet.assemble';
import { defaultFrom, parseDate } from './report-date.util';
import { csvList } from './report-filter.util';

/** Time-entry report queries (timesheets, per-user/client/department rollups, list + aggregates). */
@Injectable()
export class TimeEntriesReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Distinct assignees that have at least one time entry. Feeds the
   *  "Exclude assignee" picker (all assignees with tracked time, so an admin
   *  can pre-emptively exclude someone who currently has a rate). */
  async timeEntriesAssignees() {
    type Row = { user_id: string; user_name: string | null; user_email: string | null };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT user_id,
             MAX(user_name)  AS user_name,
             MAX(user_email) AS user_email
      FROM clickup_time_entries
      WHERE user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY MAX(user_name) NULLS LAST
    `);
    return rows.map((r) => ({ id: r.user_id, name: r.user_name, email: r.user_email }));
  }

  /**
   * Single-assignee timesheet: per-Dhaka-day, per-task hours + cost for one user
   * over [from, to]. The SQL buckets by Dhaka day (start_time is UTC-naive — label
   * UTC first, exactly like costTrend) and aggregates per (day, task). The pure
   * `assembleTimesheet` then builds the weekday skeleton, unions worked days, and
   * applies the missing-rate cost rule. cost_cents for NO_RATE_FOUND entries is
   * never summed as valid (see data-model rule).
   */
  async timesheet(userId: string, fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const TZ = Prisma.raw(`'Asia/Dhaka'`);

    type Row = {
      day: string;
      task_id: string;
      task_name: string | null;
      user_name: string | null;
      hours: number;
      valid_cost_cents: bigint;
      entry_count: number;
      missing_rate_count: number;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT to_char((e.start_time AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
             e.task_id                                                         AS task_id,
             MAX(t.task_name)                                                  AS task_name,
             MAX(e.user_name)                                                  AS user_name,
             COALESCE(SUM(e.duration_hours), 0)::float                         AS hours,
             COALESCE(SUM(CASE WHEN e.status <> 'NO_RATE_FOUND' THEN e.cost_cents ELSE 0 END), 0)::bigint AS valid_cost_cents,
             COUNT(*)::int                                                     AS entry_count,
             SUM(CASE WHEN e.status = 'NO_RATE_FOUND' THEN 1 ELSE 0 END)::int  AS missing_rate_count
      FROM clickup_time_entries e
      LEFT JOIN clickup_tasks t ON t.task_id = e.task_id
      WHERE e.user_id = ${userId}
        AND e.start_time IS NOT NULL
        AND e.start_time >= ${from}
        AND e.start_time <= ${to}
      GROUP BY day, e.task_id
      ORDER BY day, task_name
    `);

    const aggRows: TimesheetAggRow[] = rows.map((r) => ({
      day: r.day,
      taskId: r.task_id,
      taskName: r.task_name,
      hours: Number(r.hours),
      validCostCents: Number(r.valid_cost_cents),
      entryCount: Number(r.entry_count),
      missingRateCount: Number(r.missing_rate_count),
    }));

    const sheet = assembleTimesheet(aggRows, dhakaDate(from), dhakaDate(to));
    const userName = rows.find((r) => r.user_name)?.user_name ?? null;

    return {
      userId,
      userName,
      from: from.toISOString(),
      to: to.toISOString(),
      ...sheet,
    };
  }

  async timeEntriesByUser(fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const rows = await this.prisma.clickupTimeEntry.groupBy({
      by: ['userId', 'userName', 'userEmail'],
      where: { startTime: { gte: from, lte: to } },
      _sum: { durationHours: true, costCents: true },
    });
    return rows
      .map(r => ({
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        totalHours: r._sum.durationHours?.toNumber() ?? 0,
        totalCostAud: Number(r._sum.costCents ?? 0n) / 100,
      }))
      .sort((a, b) => b.totalCostAud - a.totalCostAud);
  }

  /**
   * Current-period totals and the equal-length prior-period totals, used by
   * the Overview page's KPI cards to render period-over-period deltas. The
   * prior window is `[from - (to - from), from)` — exclusive on the upper
   * bound so it doesn't overlap with the current window.
   *
   * Soft-deleted tasks are excluded from both windows.
   */
  async overviewDeltas(fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const spanMs = to.getTime() - from.getTime();
    const priorFrom = new Date(from.getTime() - spanMs);
    const priorTo = from;

    type Row = { total_hours: number | null; total_cost_cents: bigint | null };
    const sumWindow = (winFrom: Date, winTo: Date, upperOp: 'lte' | 'lt') => {
      const upper = upperOp === 'lte'
        ? Prisma.sql`e.start_time <= ${winTo}`
        : Prisma.sql`e.start_time <  ${winTo}`;
      return this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
               COALESCE(SUM(e.cost_cents), 0)::bigint   AS total_cost_cents
        FROM clickup_time_entries e
        JOIN clickup_tasks t ON e.task_id = t.task_id
        WHERE e.start_time IS NOT NULL
          AND e.start_time >= ${winFrom}
          AND ${upper}
          AND t.is_deleted = false
      `);
    };

    const [currentRows, priorRows] = await Promise.all([
      // 'lte': current window is closed-right on `to` (matches other endpoints).
      sumWindow(from, to, 'lte'),
      // 'lt': prior window is open-right on `from` so a row at exactly `from`
      // is counted only in the current window, not both.
      sumWindow(priorFrom, priorTo, 'lt'),
    ]);

    const mapRow = (r: Row) => ({
      totalHours: Number(r.total_hours ?? 0),
      totalCostAud: Number(r.total_cost_cents ?? 0n) / 100,
    });

    return {
      current: mapRow(currentRows[0] ?? { total_hours: 0, total_cost_cents: 0n }),
      prior:   mapRow(priorRows[0]   ?? { total_hours: 0, total_cost_cents: 0n }),
    };
  }

  async timeEntriesByClient(fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    type Row = { client: string; total_hours: number; total_cost_cents: number };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT t.client,
        COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
        COALESCE(SUM(e.cost_cents), 0)::float AS total_cost_cents
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time >= ${from} AND e.start_time <= ${to}
        AND t.is_deleted = false
        AND t.client IS NOT NULL AND t.client <> ''
      GROUP BY t.client
      ORDER BY total_cost_cents DESC
    `);
    return rows.map(r => ({ client: r.client, totalHours: Number(r.total_hours), totalCostAud: Number(r.total_cost_cents) / 100 }));
  }

  async timeEntriesByDepartment(fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    type Row = { department: string; total_hours: number; total_cost_cents: number };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT t.department,
        COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
        COALESCE(SUM(e.cost_cents), 0)::float AS total_cost_cents
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time >= ${from} AND e.start_time <= ${to}
        AND t.department IS NOT NULL AND t.department <> ''
      GROUP BY t.department
      ORDER BY total_cost_cents DESC
    `);
    return rows.map(r => ({ department: r.department, totalHours: Number(r.total_hours), totalCostAud: Number(r.total_cost_cents) / 100 }));
  }

  async timeEntriesBillableSummary(fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const rows = await this.prisma.clickupTimeEntry.groupBy({
      by: ['billable'],
      where: { startTime: { gte: from, lte: to } },
      _sum: { durationHours: true, costCents: true },
    });
    const b = rows.find(r => r.billable);
    const nb = rows.find(r => !r.billable);
    return {
      billableHours: b?._sum.durationHours?.toNumber() ?? 0,
      nonBillableHours: nb?._sum.durationHours?.toNumber() ?? 0,
      billableCostAud: Number(b?._sum.costCents ?? 0n) / 100,
      nonBillableCostAud: Number(nb?._sum.costCents ?? 0n) / 100,
    };
  }

  /**
   * Server-side aggregates for the Time Entries page metric cards.
   * Must accept the *same* filter set as `timeEntriesList` so the cards
   * reflect the user's filters, not just the current page of 50.
   *
   * Where-clause is inlined (not shared with `timeEntriesList`) on purpose —
   * one local copy is easier to reason about than a shared helper, and lets
   * either endpoint diverge without breaking the other.
   */
  async timeEntriesAggregates(
    userId?: string,
    fromParam?: string,
    toParam?: string,
    status?: string,
    billable?: string,
    search?: string,
    spaceId?: string,
    missingOnly?: string,
    client?: string,
    listId?: string,
    folderId?: string,
    archived?: string,
  ) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const where: Prisma.ClickupTimeEntryWhereInput = { startTime: { gte: from, lte: to } };
    const and: Prisma.ClickupTimeEntryWhereInput[] = [];
    if (spaceId) and.push({ task: { spaceId, isDeleted: false } });
    // The categorical filters are multi-select in the dashboard and arrive as a
    // comma-separated list. A single value parses as a one-element list, so
    // pre-existing deep-links (e.g. `?userId=u1&status=NO_RATE_FOUND`) behave
    // exactly as before.
    const clients = csvList(client);
    const listIds = csvList(listId);
    const folderIds = csvList(folderId);
    const userIds = csvList(userId);
    const statuses = csvList(status);
    // Intentionally no `isDeleted: false` here (unlike the spaceId clause):
    // the base list shows entries regardless of task soft-deletion, so the
    // client filter stays consistent with that. Don't "fix" this to exclude
    // deleted tasks — it would make client-only vs client+space disagree.
    if (clients) and.push({ task: { client: { in: clients } } });
    if (listIds) and.push({ task: { listId: { in: listIds } } });
    if (folderIds) and.push({ task: { folderId: { in: folderIds } } });
    // ClickUp `archived` flag. Archived status lives only on the joined task
    // (time entries have no archived column of their own). 'exclude' keeps
    // entries whose task isn't archived AND entries with no task at all — hence
    // `NOT { task archived:true }`, not `task { archived:false }`, which would
    // also drop null-task rows. 'only' keeps just archived-task entries.
    // 'include'/undefined applies no constraint.
    if (archived === 'only') and.push({ task: { archived: true } });
    else if (archived === 'exclude') and.push({ NOT: { task: { archived: true } } });
    if (userIds) where.userId = { in: userIds };
    if (missingOnly === 'true') {
      where.status = 'NO_RATE_FOUND';
    } else if (statuses) {
      where.status = { in: statuses };
    }
    if (billable === 'true') where.billable = true;
    else if (billable === 'false') where.billable = false;
    if (search?.trim()) {
      const q = search.trim();
      and.push({
        OR: [
          { task: { taskName: { contains: q, mode: 'insensitive' } } },
          { userName: { contains: q, mode: 'insensitive' } },
          { userEmail: { contains: q, mode: 'insensitive' } },
          { taskId: { contains: q, mode: 'insensitive' } },
          { timeEntryId: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;

    // Two parallel groupBys are enough:
    //   • by billable → gives total count, total hours, total cost, and the
    //     billable/non-billable split in a single query.
    //   • by status → gives counts for COST_CALCULATED / NO_RATE_FOUND /
    //     SYNCED (we only surface the first two).
    const [byBillable, byStatus] = await Promise.all([
      this.prisma.clickupTimeEntry.groupBy({
        by: ['billable'],
        where,
        _count: true,
        _sum: { durationHours: true, costCents: true },
      }),
      this.prisma.clickupTimeEntry.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
    ]);

    const b = byBillable.find(r => r.billable);
    const nb = byBillable.find(r => !r.billable);
    const totalEntries = byBillable.reduce((s, r) => s + r._count, 0);
    const billableHours = b?._sum.durationHours?.toNumber() ?? 0;
    const nonBillableHours = nb?._sum.durationHours?.toNumber() ?? 0;
    const totalHours = billableHours + nonBillableHours;
    const totalCostCents =
      Number(b?._sum.costCents ?? 0n) + Number(nb?._sum.costCents ?? 0n);
    // Weighted-by-hours average rate — matches what users expect from
    // "avg $X/h": effective rate across all logged time in the period.
    const avgRateCents = totalHours > 0 ? Math.round(totalCostCents / totalHours) : 0;
    const costCalculatedCount = byStatus.find(s => s.status === 'COST_CALCULATED')?._count ?? 0;
    const noRateFoundCount = byStatus.find(s => s.status === 'NO_RATE_FOUND')?._count ?? 0;

    return {
      totalEntries,
      totalHours,
      billableHours,
      nonBillableHours,
      totalCostCents,
      avgRateCents,
      costCalculatedCount,
      noRateFoundCount,
    };
  }

  async timeEntriesList(
    userId?: string,
    fromParam?: string,
    toParam?: string,
    status?: string,
    limit = 50,
    offset = 0,
    billable?: string,
    search?: string,
    spaceId?: string,
    missingOnly?: string,
    client?: string,
    listId?: string,
    folderId?: string,
    archived?: string,
  ) {
    // Same rationale as `tasks()`: cap allows CSV export to fetch the entire
    // filtered set; normal pagination tops out at 100 rows/page.
    const safeLimit = Math.min(limit, 5000);
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const where: Prisma.ClickupTimeEntryWhereInput = { startTime: { gte: from, lte: to } };
    const and: Prisma.ClickupTimeEntryWhereInput[] = [];
    if (spaceId) and.push({ task: { spaceId, isDeleted: false } });
    // The categorical filters are multi-select in the dashboard and arrive as a
    // comma-separated list. A single value parses as a one-element list, so
    // pre-existing deep-links (e.g. `?userId=u1&status=NO_RATE_FOUND`) behave
    // exactly as before.
    const clients = csvList(client);
    const listIds = csvList(listId);
    const folderIds = csvList(folderId);
    const userIds = csvList(userId);
    const statuses = csvList(status);
    // Intentionally no `isDeleted: false` here (unlike the spaceId clause):
    // the base list shows entries regardless of task soft-deletion, so the
    // client filter stays consistent with that. Don't "fix" this to exclude
    // deleted tasks — it would make client-only vs client+space disagree.
    if (clients) and.push({ task: { client: { in: clients } } });
    if (listIds) and.push({ task: { listId: { in: listIds } } });
    if (folderIds) and.push({ task: { folderId: { in: folderIds } } });
    // ClickUp `archived` flag. Archived status lives only on the joined task
    // (time entries have no archived column of their own). 'exclude' keeps
    // entries whose task isn't archived AND entries with no task at all — hence
    // `NOT { task archived:true }`, not `task { archived:false }`, which would
    // also drop null-task rows. 'only' keeps just archived-task entries.
    // 'include'/undefined applies no constraint.
    if (archived === 'only') and.push({ task: { archived: true } });
    else if (archived === 'exclude') and.push({ NOT: { task: { archived: true } } });
    if (userIds) where.userId = { in: userIds };
    if (missingOnly === 'true') {
      where.status = 'NO_RATE_FOUND';
    } else if (statuses) {
      where.status = { in: statuses };
    }
    if (billable === 'true') where.billable = true;
    else if (billable === 'false') where.billable = false;
    if (search?.trim()) {
      const q = search.trim();
      and.push({
        OR: [
          { task: { taskName: { contains: q, mode: 'insensitive' } } },
          { userName: { contains: q, mode: 'insensitive' } },
          { userEmail: { contains: q, mode: 'insensitive' } },
          { taskId: { contains: q, mode: 'insensitive' } },
          { timeEntryId: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;
    const [items, total] = await Promise.all([
      this.prisma.clickupTimeEntry.findMany({
        where,
        orderBy: { startTime: 'desc' },
        take: safeLimit,
        skip: offset,
        select: {
          timeEntryId: true, taskId: true, userId: true, userName: true, userEmail: true,
          startTime: true, endTime: true, durationHours: true, hourlyRateCents: true,
          costCents: true, status: true, billable: true, description: true, syncedAt: true,
          rateId: true, currency: true,
          task: { select: { taskName: true, client: true, listName: true } },
        },
      }),
      this.prisma.clickupTimeEntry.count({ where }),
    ]);
    return {
      items: items.map(e => ({
        timeEntryId: e.timeEntryId,
        taskId: e.taskId ?? '',
        taskName: e.task?.taskName ?? null,
        client: e.task?.client ?? null,
        listName: e.task?.listName ?? null,
        userId: e.userId ?? '',
        userName: e.userName,
        userEmail: e.userEmail,
        startTime: e.startTime,
        endTime: e.endTime,
        durationHours: e.durationHours.toNumber(),
        hourlyRateCents: Number(e.hourlyRateCents),
        costAud: Number(e.costCents) / 100,
        status: e.status,
        billable: e.billable,
        description: e.description,
        syncedAt: e.syncedAt,
        rateId: e.rateId != null ? e.rateId.toString() : null,
        currency: e.currency ?? 'USD',
      })),
      total,
      limit: safeLimit,
      offset,
    };
  }
}

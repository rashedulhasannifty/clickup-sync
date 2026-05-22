import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

function defaultFrom(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}

function defaultFromForBucket(bucket: 'day' | 'week' | 'month'): Date {
  const d = new Date();
  if (bucket === 'day')   { d.setDate(d.getDate() - 30); return d; }
  if (bucket === 'week')  { d.setDate(d.getDate() - 7 * 12); return d; }
  // month: 12 months back
  d.setMonth(d.getMonth() - 12);
  return d;
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

@Injectable()
export class ReportsService {
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
  ) {
    // Cap kept generous so the dashboard's "Export CSV" can pull a complete
    // filtered set in one shot. The page UI never offers > 100 rows/page, so
    // this only matters for export requests.
    const safeLimit = Math.min(limit, 5000);
    const where: Prisma.ClickupTaskWhereInput = {};
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
    if (spaceId) where.spaceId = spaceId;
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (type === 'parent') where.parentTaskId = null;
    if (type === 'subtask') where.parentTaskId = { not: null };
    if (assigneeId) where.assigneesNames = { contains: assigneeId, mode: 'insensitive' };
    if (fromParam || toParam) {
      where.updatedDate = { gte: parseDate(fromParam, new Date(0)), lte: parseDate(toParam, new Date()) };
    }
    // Free-text search across short, indexed-friendly fields. Avoid description / raw
    // JSON — ILIKE on those gets expensive fast. Compose via AND so search stacks
    // with the other filters above (mirrors `timeEntriesList`).
    if (search?.trim()) {
      const q = search.trim();
      where.AND = [
        {
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
        },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.clickupTask.findMany({
        where,
        orderBy: { updatedDate: 'desc' },
        take: safeLimit,
        skip: offset,
        select: {
          taskId: true, taskName: true, spaceId: true, spaceName: true, status: true, statusType: true, statusColor: true,
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
  ) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const where: Prisma.ClickupTimeEntryWhereInput = { startTime: { gte: from, lte: to } };
    const and: Prisma.ClickupTimeEntryWhereInput[] = [];
    if (spaceId) and.push({ task: { spaceId, isDeleted: false } });
    if (userId) where.userId = userId;
    if (missingOnly === 'true') {
      where.status = 'NO_RATE_FOUND';
    } else if (status) {
      where.status = status;
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
  ) {
    // Same rationale as `tasks()`: cap allows CSV export to fetch the entire
    // filtered set; normal pagination tops out at 100 rows/page.
    const safeLimit = Math.min(limit, 5000);
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const where: Prisma.ClickupTimeEntryWhereInput = { startTime: { gte: from, lte: to } };
    const and: Prisma.ClickupTimeEntryWhereInput[] = [];
    if (spaceId) and.push({ task: { spaceId, isDeleted: false } });
    if (userId) where.userId = userId;
    if (missingOnly === 'true') {
      where.status = 'NO_RATE_FOUND';
    } else if (status) {
      where.status = status;
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
          task: { select: { taskName: true } },
        },
      }),
      this.prisma.clickupTimeEntry.count({ where }),
    ]);
    return {
      items: items.map(e => ({
        timeEntryId: e.timeEntryId,
        taskId: e.taskId ?? '',
        taskName: e.task?.taskName ?? null,
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
        currency: e.currency ?? 'AUD',
      })),
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

  async syncHealth() {
    const checkpoints = await this.prisma.syncCheckpoint.findMany({ orderBy: { scopeId: 'asc' } });
    const now = Date.now();
    return checkpoints.map(cp => {
      const space = CLICKUP_SPACES.find(s => s.id === cp.scopeId);
      const ageMs = cp.lastSuccessfulSyncAt ? now - cp.lastSuccessfulSyncAt.getTime() : null;
      const ageMinutes = ageMs !== null ? Math.round(ageMs / 60000) : null;
      const status = ageMinutes === null ? 'Unknown' : ageMinutes > 60 ? 'Stale' : 'Fresh';
      return { scopeId: cp.scopeId, spaceName: space?.name ?? cp.scopeId, lastSuccessfulSyncAt: cp.lastSuccessfulSyncAt, ageMinutes, status };
    });
  }

  async webhookEvents(limit = 50, offset = 0) {
    const safeLimit = Math.min(limit, 200);
    const [items, total] = await Promise.all([
      this.prisma.clickupWebhookEvent.findMany({
        orderBy: { receivedAt: 'desc' },
        take: safeLimit,
        skip: offset,
        select: { id: true, eventType: true, taskId: true, status: true, receivedAt: true, processedAt: true },
      }),
      this.prisma.clickupWebhookEvent.count(),
    ]);
    return { items: items.map(i => ({ ...i, id: i.id.toString() })), total };
  }

  async jobLogs(queueName?: string, status?: string, limit = 50, offset = 0) {
    const safeLimit = Math.min(limit, 200);
    // Raw SQL because we need a per-row `recovered` flag for failed jobs:
    // a failure is considered "recovered" if a later successful run for the
    // same (queue_name, entity_id) exists. This lets the dashboard answer
    // "was this work eventually processed?" without operators having to
    // hunt manually. The EXISTS subquery is cheap thanks to the existing
    // (entity_type, entity_id) and (status) indexes.
    type Row = {
      id: bigint;
      queue_name: string;
      job_name: string;
      status: string;
      entity_id: string | null;
      error_message: string | null;
      started_at: Date | null;
      finished_at: Date | null;
      tasks_synced: number | null;
      time_entries_synced: number | null;
      recovered: boolean | null;
    };
    const filters: Prisma.Sql[] = [];
    if (queueName) filters.push(Prisma.sql`queue_name = ${queueName}`);
    if (status) filters.push(Prisma.sql`status = ${status}`);
    const whereClause = filters.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;
    const [items, totalRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT
          j.id, j.queue_name, j.job_name, j.status, j.entity_id, j.error_message,
          j.started_at, j.finished_at, j.tasks_synced, j.time_entries_synced,
          CASE
            WHEN j.status <> 'failed' THEN NULL
            WHEN j.entity_id IS NULL OR j.finished_at IS NULL THEN false
            ELSE EXISTS (
              SELECT 1 FROM sync_job_logs s
              WHERE s.queue_name = j.queue_name
                AND s.entity_id = j.entity_id
                AND s.status = 'completed'
                AND s.finished_at > j.finished_at
            )
          END AS recovered
        FROM sync_job_logs j
        ${whereClause}
        ORDER BY j.started_at DESC NULLS LAST
        LIMIT ${safeLimit}
        OFFSET ${offset}
      `),
      this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM sync_job_logs ${whereClause}
      `),
    ]);
    const total = Number(totalRows[0]?.count ?? 0);
    return {
      items: items.map((i) => ({
        id: i.id.toString(),
        queueName: i.queue_name,
        jobName: i.job_name,
        status: i.status,
        entityId: i.entity_id,
        errorMessage: i.error_message,
        startedAt: i.started_at,
        finishedAt: i.finished_at,
        tasksSynced: i.tasks_synced,
        timeEntriesSynced: i.time_entries_synced,
        recovered: i.recovered,
        durationMs: i.started_at && i.finished_at
          ? new Date(i.finished_at).getTime() - new Date(i.started_at).getTime()
          : null,
      })),
      total,
    };
  }

  async deadLetters(limit = 50, offset = 0) {
    const safeLimit = Math.min(limit, 200);
    const [items, total] = await Promise.all([
      this.prisma.deadLetterJob.findMany({
        where: { retriedAt: null, resolvedAt: null },
        orderBy: { failedAt: 'desc' },
        take: safeLimit,
        skip: offset,
        select: { id: true, queueName: true, jobName: true, entityId: true, errorMessage: true, failedAt: true },
      }),
      this.prisma.deadLetterJob.count({ where: { retriedAt: null, resolvedAt: null } }),
    ]);
    return { items: items.map(i => ({ ...i, id: i.id.toString() })), total };
  }

  async stats() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [failedJobsLast24h, deadLetterPending, webhooksLast24h, missingRateEntries] = await Promise.all([
      this.prisma.syncJobLog.count({ where: { status: 'failed', finishedAt: { gte: since24h } } }),
      this.prisma.deadLetterJob.count({ where: { retriedAt: null, resolvedAt: null } }),
      this.prisma.clickupWebhookEvent.count({ where: { receivedAt: { gte: since24h } } }),
      this.prisma.clickupTimeEntry.count({ where: { status: { not: 'COST_CALCULATED' } } }),
    ]);
    return { failedJobsLast24h, deadLetterPending, webhooksLast24h, missingRateEntries };
  }

  async missingRates() {
    type Row = {
      user_id: string;
      user_name: string;
      user_email: string;
      missing_count: bigint;
      affected_hours: number;
      first_date: Date;
      latest_date: Date;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        e.user_id,
        MAX(e.user_name) AS user_name,
        MAX(e.user_email) AS user_email,
        COUNT(*)::bigint AS missing_count,
        COALESCE(SUM(e.duration_hours), 0)::float AS affected_hours,
        MIN(e.start_time) AS first_date,
        MAX(e.start_time) AS latest_date
      FROM clickup_time_entries e
      WHERE e.user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM assignee_rates r
          WHERE r.assignee_id = e.user_id
            AND r.valid_from <= e.start_time::date
            AND (r.valid_to IS NULL OR r.valid_to > e.start_time::date)
        )
      GROUP BY e.user_id
      ORDER BY COUNT(*) DESC
    `);
    return rows.map(r => ({
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      missingCount: Number(r.missing_count),
      affectedHours: Number(r.affected_hours),
      firstDate: r.first_date,
      latestDate: r.latest_date,
    }));
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
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        t.space_id,
        t.space_name,
        COUNT(DISTINCT t.task_id)::bigint AS task_count,
        COUNT(DISTINCT t.task_id) FILTER (WHERE t.status_type NOT IN ('closed', 'done'))::bigint AS open_count,
        COUNT(DISTINCT e.user_id) FILTER (WHERE e.user_id IS NOT NULL)::bigint AS member_count,
        COALESCE(SUM(e.duration_hours), 0)::float AS hours_logged,
        COALESCE(SUM(e.cost_cents), 0)::float AS cost_cents
      FROM clickup_tasks t
      LEFT JOIN clickup_time_entries e ON e.task_id = t.task_id
      WHERE t.is_deleted = false
      GROUP BY t.space_id, t.space_name
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
   * Time-bucketed cost trend for the Overview page.
   *
   * Buckets in Asia/Dhaka local time (no DST, UTC+6). Week buckets are
   * Sunday-start: Postgres's date_trunc('week', ...) is Monday-based, so we
   * shift +1 day before truncating and shift back -1 day after, which moves
   * the week boundary from Mon→Sun→Mon to Sun→Sat→Sun.
   *
   * Empty buckets are returned with zeros (via generate_series LEFT JOIN)
   * so the chart shows a continuous timeline instead of gaps.
   */
  async costTrend(
    bucket: 'day' | 'week' | 'month',
    fromParam?: string,
    toParam?: string,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new Error(`Invalid bucket "${bucket}" (expected day|week|month)`);
    }

    const from = parseDate(fromParam, defaultFromForBucket(bucket));
    const to = parseDate(toParam, new Date());

    // Build the bucket expression. Applied to `e.start_time AT TIME ZONE 'Asia/Dhaka'`
    // for the aggregate, and to the input range for generate_series.
    // Use Prisma.raw() for the timezone string so it is emitted as a literal SQL
    // identifier rather than a parameterized placeholder. This keeps the timezone
    // visible in the compiled SQL text (required by tests) and avoids Postgres
    // rejecting a parameter where a constant string is expected in AT TIME ZONE.
    const TZ = Prisma.raw(`'Asia/Dhaka'`);
    const bucketExpr = (tsLocal: Prisma.Sql): Prisma.Sql => {
      if (bucket === 'day')   return Prisma.sql`date_trunc('day', ${tsLocal})`;
      if (bucket === 'month') return Prisma.sql`date_trunc('month', ${tsLocal})`;
      // Sunday-start week: shift +1d, truncate Mon-based week, shift -1d.
      return Prisma.sql`(date_trunc('week', ${tsLocal} + interval '1 day') - interval '1 day')`;
    };
    const interval =
      bucket === 'day'   ? Prisma.sql`interval '1 day'`   :
      bucket === 'week'  ? Prisma.sql`interval '1 week'`  :
                           Prisma.sql`interval '1 month'`;

    const aggBucket    = bucketExpr(Prisma.sql`(e.start_time AT TIME ZONE ${TZ})`);
    const seriesStart  = bucketExpr(Prisma.sql`(${from}::timestamptz AT TIME ZONE ${TZ})`);
    const seriesEnd    = bucketExpr(Prisma.sql`(${to  }::timestamptz AT TIME ZONE ${TZ})`);

    type Row = {
      bucket: string;
      total_cost_cents: bigint;
      total_hours: number;
      entry_count: number;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH series AS (
        SELECT generate_series(${seriesStart}, ${seriesEnd}, ${interval}) AS bucket_local
      ),
      agg AS (
        SELECT ${aggBucket}                                    AS bucket_local,
               COALESCE(SUM(e.cost_cents), 0)::bigint          AS total_cost_cents,
               COALESCE(SUM(e.duration_hours), 0)::float       AS total_hours,
               COUNT(*)::int                                   AS entry_count
        FROM clickup_time_entries e
        JOIN clickup_tasks t ON e.task_id = t.task_id
        WHERE e.start_time IS NOT NULL
          AND e.start_time >= ${from}
          AND e.start_time <= ${to}
          AND t.is_deleted = false
        GROUP BY 1
      )
      SELECT to_char(s.bucket_local, 'YYYY-MM-DD')             AS bucket,
             COALESCE(a.total_cost_cents, 0)::bigint           AS total_cost_cents,
             COALESCE(a.total_hours, 0)::float                 AS total_hours,
             COALESCE(a.entry_count, 0)::int                   AS entry_count
      FROM series s
      LEFT JOIN agg a ON a.bucket_local = s.bucket_local
      ORDER BY s.bucket_local ASC
    `);

    return rows.map((r) => ({
      bucket: r.bucket,
      totalCostAud: Number(r.total_cost_cents) / 100,
      totalHours: Number(r.total_hours),
      entryCount: Number(r.entry_count),
    }));
  }
}

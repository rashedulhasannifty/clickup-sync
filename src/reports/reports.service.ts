import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

function defaultFrom(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
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
    const [bySpaceRows, byStatusRows, total] = await this.prisma.$transaction([
      this.prisma.clickupTask.groupBy({ by: ['spaceId', 'spaceName'], where: { isDeleted: false }, _count: { taskId: true } }),
      this.prisma.clickupTask.groupBy({ by: ['status'], where: { isDeleted: false }, _count: { taskId: true } }),
      this.prisma.clickupTask.count({ where: { isDeleted: false } }),
    ]);
    return {
      bySpace: bySpaceRows.map(r => ({ spaceId: r.spaceId, spaceName: r.spaceName, count: r._count.taskId })),
      byStatus: byStatusRows.map(r => ({ status: r.status, count: r._count.taskId })),
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

  async tasks(spaceId?: string, status?: string, search?: string, fromParam?: string, toParam?: string, limit = 50, offset = 0) {
    const safeLimit = Math.min(limit, 200);
    const where: Prisma.ClickupTaskWhereInput = { isDeleted: false };
    if (spaceId) where.spaceId = spaceId;
    if (status) where.status = status;
    if (search) where.taskName = { contains: search, mode: 'insensitive' };
    if (fromParam || toParam) {
      where.updatedDate = { gte: parseDate(fromParam, new Date(0)), lte: parseDate(toParam, new Date()) };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.clickupTask.findMany({
        where,
        orderBy: { updatedDate: 'desc' },
        take: safeLimit,
        skip: offset,
        select: { taskId: true, taskName: true, spaceId: true, spaceName: true, status: true, assigneesNames: true, updatedDate: true, sprintPoints: true, cost: true, client: true, department: true },
      }),
      this.prisma.clickupTask.count({ where }),
    ]);
    return { items: items.map(t => ({ ...t, cost: t.cost.toNumber() })), total, limit: safeLimit, offset };
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

  async timeEntriesList(userId?: string, fromParam?: string, toParam?: string, status?: string, limit = 50, offset = 0) {
    const safeLimit = Math.min(limit, 200);
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const where: Prisma.ClickupTimeEntryWhereInput = { startTime: { gte: from, lte: to } };
    if (userId) where.userId = userId;
    if (status) where.status = status;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.clickupTimeEntry.findMany({
        where,
        orderBy: { startTime: 'desc' },
        take: safeLimit,
        skip: offset,
        select: { timeEntryId: true, taskId: true, userId: true, userName: true, userEmail: true, startTime: true, durationHours: true, hourlyRateCents: true, costCents: true, status: true, billable: true, task: { select: { taskName: true } } },
      }),
      this.prisma.clickupTimeEntry.count({ where }),
    ]);
    return {
      items: items.map(e => ({
        timeEntryId: e.timeEntryId,
        taskId: e.taskId,
        taskName: e.task?.taskName ?? null,
        userId: e.userId,
        userName: e.userName,
        userEmail: e.userEmail,
        startTime: e.startTime,
        durationHours: e.durationHours.toNumber(),
        hourlyRateCents: Number(e.hourlyRateCents),
        costAud: Number(e.costCents) / 100,
        status: e.status,
        billable: e.billable,
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
    const [items, total] = await this.prisma.$transaction([
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
    const where: Prisma.SyncJobLogWhereInput = {};
    if (queueName) where.queueName = queueName;
    if (status) where.status = status;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.syncJobLog.findMany({
        where,
        orderBy: { finishedAt: 'desc' },
        take: safeLimit,
        skip: offset,
        select: { id: true, queueName: true, jobName: true, status: true, entityId: true, errorMessage: true, finishedAt: true },
      }),
      this.prisma.syncJobLog.count({ where }),
    ]);
    return { items: items.map(i => ({ ...i, id: i.id.toString() })), total };
  }

  async deadLetters(limit = 50, offset = 0) {
    const safeLimit = Math.min(limit, 200);
    const [items, total] = await this.prisma.$transaction([
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
    const [failedJobsLast24h, deadLetterPending, webhooksLast24h, missingRateEntries] = await this.prisma.$transaction([
      this.prisma.syncJobLog.count({ where: { status: 'failed', finishedAt: { gte: since24h } } }),
      this.prisma.deadLetterJob.count({ where: { retriedAt: null, resolvedAt: null } }),
      this.prisma.clickupWebhookEvent.count({ where: { receivedAt: { gte: since24h } } }),
      this.prisma.clickupTimeEntry.count({ where: { status: 'NO_RATE_FOUND' } }),
    ]);
    return { failedJobsLast24h, deadLetterPending, webhooksLast24h, missingRateEntries };
  }
}

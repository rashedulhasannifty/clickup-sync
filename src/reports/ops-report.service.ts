import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

/** Operational report queries: sync freshness, webhook/job logs, dead-letters, stats, missing rates. */
@Injectable()
export class OpsReportService {
  constructor(private readonly prisma: PrismaService) {}

  async syncHealth() {
    const checkpoints = await this.prisma.syncCheckpoint.findMany({ orderBy: { scopeId: 'asc' } });
    // Longest backfill lookback (in days) actually run for each space, taken from
    // the `lookbackDays` recorded on each backfill job log. Lets the Spaces page
    // show "synced … · up to Nd" so an already-synced space communicates how far
    // back its data reaches. Only backfills logged with a payload count — rows
    // predating that logging report null (no history to draw from).
    type LookbackRow = { space_id: string; max_lookback: number };
    const lookbackRows = await this.prisma.$queryRaw<LookbackRow[]>(Prisma.sql`
      SELECT entity_id AS space_id, MAX((payload->>'lookbackDays')::int) AS max_lookback
      FROM sync_job_logs
      WHERE queue_name = 'clickup-backfills'
        AND entity_type = 'space'
        AND payload->>'lookbackDays' ~ '^[0-9]+$'
      GROUP BY entity_id
    `);
    const maxLookbackByScope = new Map(lookbackRows.map(r => [r.space_id, Number(r.max_lookback)]));
    const now = Date.now();
    // A space is "Stale" once its last successful sync is older than this. Set
    // comfortably above the reconcile/safety-net interval so a normal quiet gap
    // between syncs doesn't read as Stale (was 60m, which flagged Degraded on
    // essentially every idle hour).
    const STALE_AFTER_MINUTES = 12 * 60;
    return checkpoints.map(cp => {
      const space = CLICKUP_SPACES.find(s => s.id === cp.scopeId);
      const ageMs = cp.lastSuccessfulSyncAt ? now - cp.lastSuccessfulSyncAt.getTime() : null;
      const ageMinutes = ageMs !== null ? Math.round(ageMs / 60000) : null;
      const status = ageMinutes === null ? 'Unknown' : ageMinutes > STALE_AFTER_MINUTES ? 'Stale' : 'Fresh';
      return {
        scopeId: cp.scopeId,
        spaceName: space?.name ?? cp.scopeId,
        lastSuccessfulSyncAt: cp.lastSuccessfulSyncAt,
        ageMinutes,
        status,
        maxLookbackDays: maxLookbackByScope.get(cp.scopeId) ?? null,
      };
    });
  }

  async webhookEvents(limit = 50, offset = 0, status?: string, eventType?: string, search?: string) {
    const safeLimit = Math.min(limit, 200);
    const where: Prisma.ClickupWebhookEventWhereInput = {};
    if (status && status !== 'all') where.status = status;
    if (eventType && eventType !== 'all') where.eventType = eventType;
    const q = search?.trim();
    if (q) {
      where.OR = [
        { taskId: { contains: q, mode: 'insensitive' } },
        { eventType: { contains: q, mode: 'insensitive' } },
        // The numeric primary key is shown in the UI, so allow an exact match
        // when the search term is all digits (contains isn't valid on BigInt).
        ...(/^\d+$/.test(q) ? [{ id: BigInt(q) }] : []),
      ];
    }
    const [items, total, eventTypeRows] = await Promise.all([
      this.prisma.clickupWebhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: safeLimit,
        skip: offset,
        select: { id: true, eventType: true, taskId: true, status: true, receivedAt: true, processedAt: true },
      }),
      this.prisma.clickupWebhookEvent.count({ where }),
      // Distinct event types across ALL events (not the filtered set) so the
      // filter dropdown stays stable regardless of the active filter.
      this.prisma.clickupWebhookEvent.findMany({
        where: { eventType: { not: null } },
        distinct: ['eventType'],
        select: { eventType: true },
        orderBy: { eventType: 'asc' },
      }),
    ]);
    return {
      items: items.map(i => ({ ...i, id: i.id.toString() })),
      total,
      eventTypes: eventTypeRows.map(r => r.eventType).filter((e): e is string => !!e),
    };
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

  async stats(excludedIds: string[] = []) {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [failedJobsLast24h, deadLetterPending, webhooksLast24h, missingRateEntries, lastWebhookEvent] = await Promise.all([
      this.prisma.syncJobLog.count({ where: { status: 'failed', finishedAt: { gte: since24h } } }),
      this.prisma.deadLetterJob.count({ where: { retriedAt: null, resolvedAt: null } }),
      this.prisma.clickupWebhookEvent.count({ where: { receivedAt: { gte: since24h } } }),
      this.prisma.clickupTimeEntry.count({
        where: {
          status: { notIn: ['COST_CALCULATED', 'COST_EXCLUDED'] },
          ...(excludedIds.length ? { OR: [{ userId: null }, { userId: { notIn: excludedIds } }] } : {}),
        },
      }),
      // Most recent webhook actually received — lets the UI report real webhook
      // delivery health (last event + whether any arrived in the last 24h)
      // instead of inferring it from sync-checkpoint freshness.
      this.prisma.clickupWebhookEvent.findFirst({
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true },
      }),
    ]);
    return {
      failedJobsLast24h,
      deadLetterPending,
      webhooksLast24h,
      missingRateEntries,
      lastWebhookEventAt: lastWebhookEvent?.receivedAt ?? null,
    };
  }

  async missingRates(excludedIds: string[] = []) {
    type Row = {
      user_id: string;
      user_name: string;
      user_email: string;
      missing_count: bigint;
      affected_hours: number;
      first_date: Date;
      latest_date: Date;
      affected_task_count: bigint;
      affected_tasks: Array<{ taskId: string; taskName: string }>;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH missing AS (
        SELECT
          e.user_id,
          e.task_id,
          e.user_name,
          e.user_email,
          e.duration_hours,
          e.start_time
        FROM clickup_time_entries e
        WHERE e.user_id IS NOT NULL
          ${excludedIds.length ? Prisma.sql`AND e.user_id <> ALL(array[${Prisma.join(excludedIds)}]::text[])` : Prisma.empty}
          AND NOT EXISTS (
            -- Inclusive closed-closed interval [valid_from, valid_to], matching
            -- cost-calculator.service.ts. The earlier exclusive upper bound
            -- over-counted entries on the exact valid_to boundary (e.g. an
            -- entry on Dec 31 against a rate ending Dec 31): cost-calculator
            -- costs them as COST_CALCULATED, but the card still listed them
            -- as missing. Card and page-aggregate counts then diverged by
            -- exactly the boundary count.
            SELECT 1 FROM assignee_rates r
            WHERE r.assignee_id = e.user_id
              AND r.valid_from <= e.start_time::date
              AND (r.valid_to IS NULL OR r.valid_to >= e.start_time::date)
          )
      ),
      per_user AS (
        SELECT
          user_id,
          MAX(user_name) AS user_name,
          MAX(user_email) AS user_email,
          COUNT(*)::bigint AS missing_count,
          COALESCE(SUM(duration_hours), 0)::float AS affected_hours,
          MIN(start_time) AS first_date,
          MAX(start_time) AS latest_date
        FROM missing
        GROUP BY user_id
      ),
      tasks_per_user AS (
        -- INNER JOIN + is_deleted = false: the Tasks page hard-filters
        -- soft-deleted rows (TasksReportService.tasks() sets is_deleted=false), so we must
        -- not list/count tasks here that the "Show more" deep link can't show.
        -- Otherwise the card's count would exceed what the Tasks page renders.
        SELECT
          m.user_id,
          m.task_id,
          MAX(t.task_name) AS task_name,
          MAX(m.start_time) AS task_latest
        FROM missing m
        JOIN clickup_tasks t ON t.task_id = m.task_id AND t.is_deleted = false
        WHERE m.task_id IS NOT NULL
        GROUP BY m.user_id, m.task_id
      ),
      ranked AS (
        SELECT
          user_id,
          task_id,
          task_name,
          task_latest,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY task_latest DESC) AS rn
        FROM tasks_per_user
      ),
      agg_tasks AS (
        SELECT
          user_id,
          COUNT(*)::bigint AS affected_task_count,
          COALESCE(
            jsonb_agg(jsonb_build_object('taskId', task_id, 'taskName', task_name) ORDER BY task_latest DESC)
              FILTER (WHERE rn <= 500),
            '[]'::jsonb
          ) AS affected_tasks
        FROM ranked
        GROUP BY user_id
      )
      SELECT
        pu.user_id,
        pu.user_name,
        pu.user_email,
        pu.missing_count,
        pu.affected_hours,
        pu.first_date,
        pu.latest_date,
        COALESCE(at.affected_task_count, 0)::bigint AS affected_task_count,
        COALESCE(at.affected_tasks, '[]'::jsonb) AS affected_tasks
      FROM per_user pu
      LEFT JOIN agg_tasks at USING (user_id)
      ORDER BY pu.missing_count DESC
    `);
    return rows.map(r => ({
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      missingCount: Number(r.missing_count),
      affectedHours: Number(r.affected_hours),
      firstDate: r.first_date,
      latestDate: r.latest_date,
      affectedTaskCount: Number(r.affected_task_count),
      affectedTasks: r.affected_tasks ?? [],
    }));
  }
}

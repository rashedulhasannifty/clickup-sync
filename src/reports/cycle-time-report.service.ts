import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/** Status-history report queries: cycle time (open→done) and time-in-status. */
@Injectable()
export class CycleTimeReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cycle time = hours between the first event whose after.type === 'open' and
   * the last event whose after.type === 'done', per task. Tasks that "bounce"
   * (done → in-progress → done) use first-open to last-done, i.e. end-to-end
   * calendar time. Window filters by the task's *last done* occurredAt.
   */
  async cycleTime(args: { from: Date; to: Date; groupBy: 'week' | 'client' | 'department' }) {
    const { from, to, groupBy } = args;
    const bucketExpr =
      groupBy === 'week'
        // `last_done` derives from `clickup_task_events.occurred_at`, a naive
        // `timestamp` holding a UTC instant — so label it UTC first, THEN convert
        // to Dhaka. This double conversion is correct here precisely because the
        // column is naive (unlike the `timestamptz` start_time in other reports).
        ? Prisma.sql`to_char(date_trunc('week', (last_done AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka') + interval '1 day') - interval '1 day', 'YYYY-MM-DD')`
        : groupBy === 'client'
          ? Prisma.sql`COALESCE(NULLIF(t.client, ''), 'Unattributed')`
          : Prisma.sql`COALESCE(NULLIF(t.department, ''), 'Unattributed')`;

    type Row = { bucket: string; mean_hours: number; median_hours: number; p90_hours: number; task_count: bigint };
    type MetaRow = { min_occurred_at: Date | null };

    const [items, metaRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        WITH task_endpoints AS (
          SELECT
            e.task_id,
            MIN(e.occurred_at) FILTER (WHERE (e.after->>'type') = 'open') AS first_open,
            MAX(e.occurred_at) FILTER (WHERE (e.after->>'type') = 'done') AS last_done
          FROM clickup_task_events e
          WHERE e.event_type = 'taskStatusUpdated'
          GROUP BY e.task_id
        )
        SELECT
          ${bucketExpr} AS bucket,
          AVG(EXTRACT(EPOCH FROM (last_done - first_open)) / 3600.0)::float        AS mean_hours,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (last_done - first_open)) / 3600.0
          )::float                                                                  AS median_hours,
          percentile_cont(0.9) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (last_done - first_open)) / 3600.0
          )::float                                                                  AS p90_hours,
          COUNT(*)::bigint                                                          AS task_count
        FROM task_endpoints te
        LEFT JOIN clickup_tasks t ON t.task_id = te.task_id
        WHERE first_open IS NOT NULL
          AND last_done IS NOT NULL
          AND last_done >= ${from}
          AND last_done <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      this.prisma.$queryRaw<MetaRow[]>(Prisma.sql`
        SELECT MIN(occurred_at) AS min_occurred_at
        FROM clickup_task_events
        WHERE event_type = 'taskStatusUpdated'
      `),
    ]);

    return {
      items: items.map((r) => ({
        bucket: r.bucket,
        meanHours: Number(r.mean_hours ?? 0),
        medianHours: Number(r.median_hours ?? 0),
        p90Hours: Number(r.p90_hours ?? 0),
        taskCount: Number(r.task_count ?? 0n),
      })),
      meta: {
        minOccurredAt: metaRows[0]?.min_occurred_at ? metaRows[0].min_occurred_at.toISOString() : null,
      },
    };
  }

  /**
   * Time-in-status: for each task, walk events in order; for each consecutive
   * pair, attribute (next - prev) hours to prev.after.status. The currently-
   * active status (last event without a successor) attributes hours up to `to`.
   * Bar by status with its captured `color`.
   */
  async timeInStatus(args: { from: Date; to: Date }) {
    const { from, to } = args;
    type Row = { status: string; color: string | null; total_hours: number; task_count: bigint };
    type MetaRow = { min_occurred_at: Date | null };

    const [items, metaRows] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`
        WITH ordered AS (
          SELECT
            e.task_id,
            e.occurred_at,
            e.after,
            LEAD(e.occurred_at) OVER (PARTITION BY e.task_id ORDER BY e.occurred_at) AS next_at
          FROM clickup_task_events e
          WHERE e.event_type = 'taskStatusUpdated'
            AND e.occurred_at <= ${to}
        ),
        intervals AS (
          SELECT
            (after->>'status')                                                AS status,
            (after->>'color')                                                 AS color,
            task_id,
            GREATEST(occurred_at, ${from})                                    AS interval_start,
            LEAST(COALESCE(next_at, ${to}), ${to})                            AS interval_end
          FROM ordered
          WHERE COALESCE(next_at, ${to}) >= ${from}
        )
        SELECT
          status,
          MAX(color)                                                          AS color,
          SUM(EXTRACT(EPOCH FROM (interval_end - interval_start)) / 3600.0)::float AS total_hours,
          COUNT(DISTINCT task_id)::bigint                                     AS task_count
        FROM intervals
        WHERE interval_end > interval_start
          AND status IS NOT NULL
        GROUP BY status
        ORDER BY total_hours DESC
      `),
      this.prisma.$queryRaw<MetaRow[]>(Prisma.sql`
        SELECT MIN(occurred_at) AS min_occurred_at
        FROM clickup_task_events
        WHERE event_type = 'taskStatusUpdated'
      `),
    ]);

    return {
      items: items.map((r) => ({
        status: r.status,
        color: r.color,
        totalHours: Number(r.total_hours ?? 0),
        taskCount: Number(r.task_count ?? 0n),
      })),
      meta: {
        minOccurredAt: metaRows[0]?.min_occurred_at ? metaRows[0].min_occurred_at.toISOString() : null,
      },
    };
  }
}

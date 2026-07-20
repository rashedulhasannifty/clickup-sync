import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { defaultFromForBucket, parseDate } from './report-date.util';

/** Time-bucketed cost-trend queries (overall + stacked by assignee/client). */
@Injectable()
export class CostTrendReportService {
  constructor(private readonly prisma: PrismaService) {}

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

    // Build the bucket expression. Applied to start_time converted to Dhaka local
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

    // `start_time` is a `timestamptz` (an absolute instant), so a single
    // `AT TIME ZONE 'Asia/Dhaka'` yields the Dhaka wall-clock (a naive timestamp)
    // whose `date`/`date_trunc` is the Dhaka calendar day. This matches the
    // series-boundary expressions below (which also convert once). The old double
    // form `AT TIME ZONE 'UTC' AT TIME ZONE ${...}` collapsed a timestamptz to the
    // UTC date, mis-bucketing early-Dhaka-morning entries to the previous day.
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

  /**
   * Shared engine for the stacked cost-trend charts: labor cost per time bucket,
   * broken down by an arbitrary segment expression (assignee, client, …).
   * Mirrors `costTrend`'s bucketing/timezone logic so all three charts line up.
   * By default every segment is returned on its own (highest total cost first),
   * never collapsed; an explicit `topN` caps the segments and folds the
   * remainder into a single "Other" bucket (opt-in only).
   *
   * `segmentExpr` is a raw SQL expression evaluated over the
   * `clickup_time_entries e JOIN clickup_tasks t` rows; it must already coalesce
   * NULL/empty to a stable label. Returns continuous `buckets` (including
   * zero-cost periods via the same generate_series the line chart uses), the
   * ordered `segments`, and a per-bucket cost map in dollars.
   */
  private async costTrendBySegment(
    bucket: 'day' | 'week' | 'month',
    fromParam: string | undefined,
    toParam: string | undefined,
    topN: number | undefined,
    segmentExpr: Prisma.Sql,
  ) {
    if (bucket !== 'day' && bucket !== 'week' && bucket !== 'month') {
      throw new Error(`Invalid bucket "${bucket}" (expected day|week|month)`);
    }

    const from = parseDate(fromParam, defaultFromForBucket(bucket));
    const to = parseDate(toParam, new Date());

    const TZ = Prisma.raw(`'Asia/Dhaka'`);
    const bucketExpr = (tsLocal: Prisma.Sql): Prisma.Sql => {
      if (bucket === 'day')   return Prisma.sql`date_trunc('day', ${tsLocal})`;
      if (bucket === 'month') return Prisma.sql`date_trunc('month', ${tsLocal})`;
      return Prisma.sql`(date_trunc('week', ${tsLocal} + interval '1 day') - interval '1 day')`;
    };
    const interval =
      bucket === 'day'   ? Prisma.sql`interval '1 day'`   :
      bucket === 'week'  ? Prisma.sql`interval '1 week'`  :
                           Prisma.sql`interval '1 month'`;

    const aggBucket   = bucketExpr(Prisma.sql`(e.start_time AT TIME ZONE ${TZ})`);
    const seriesStart = bucketExpr(Prisma.sql`(${from}::timestamptz AT TIME ZONE ${TZ})`);
    const seriesEnd   = bucketExpr(Prisma.sql`(${to  }::timestamptz AT TIME ZONE ${TZ})`);

    // Continuous bucket axis (same shape as costTrend's `series`), so periods
    // with no logged time still render as gaps in the trend.
    type BucketRow = { bucket: string };
    const bucketRows = await this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT to_char(generate_series(${seriesStart}, ${seriesEnd}, ${interval}), 'YYYY-MM-DD') AS bucket
      ORDER BY 1 ASC
    `);
    const buckets = bucketRows.map((r) => r.bucket);

    // Cost per (bucket, segment). The bucket string uses the identical
    // to_char(bucketExpr) form as the axis above so the keys line up exactly.
    type AggRow = { bucket: string; segment: string; cost_cents: bigint };
    const aggRows = await this.prisma.$queryRaw<AggRow[]>(Prisma.sql`
      SELECT to_char(${aggBucket}, 'YYYY-MM-DD')      AS bucket,
             ${segmentExpr}                           AS segment,
             COALESCE(SUM(e.cost_cents), 0)::bigint   AS cost_cents
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time IS NOT NULL
        AND e.start_time >= ${from}
        AND e.start_time <= ${to}
        AND t.is_deleted = false
      GROUP BY 1, 2
    `);

    // Rank segments by total cost across the whole range to choose the top N.
    const totals = new Map<string, number>();
    for (const r of aggRows) {
      totals.set(r.segment, (totals.get(r.segment) ?? 0) + Number(r.cost_cents));
    }
    // No `topN` → every segment gets its own bar slice (highest cost first),
    // never collapsed into "Other". An explicit cap opts into the collapse.
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const capped = typeof topN === 'number';
    const topSegments = (capped ? sorted.slice(0, topN) : sorted).map(([name]) => name);
    const topSet = new Set(topSegments);
    const hasOther = capped && totals.size > topSet.size;

    // bucket -> (segment/"Other") -> dollars
    const matrix = new Map<string, Map<string, number>>();
    for (const r of aggRows) {
      const key = topSet.has(r.segment) ? r.segment : 'Other';
      const row = matrix.get(r.bucket) ?? new Map<string, number>();
      row.set(key, (row.get(key) ?? 0) + Number(r.cost_cents) / 100);
      matrix.set(r.bucket, row);
    }

    const segments = [...topSegments, ...(hasOther ? ['Other'] : [])];
    const points = buckets.map((b) => {
      const row = matrix.get(b);
      const values: Record<string, number> = {};
      for (const s of segments) values[s] = row?.get(s) ?? 0;
      return { bucket: b, values };
    });

    return { buckets, segments, points };
  }

  /**
   * Labor cost per time bucket, broken down by assignee — feeds the stacked
   * "Assignee cost trend" chart. See {@link costTrendBySegment}; the segment is
   * the entry's logger name (falling back to user id, then "Unknown").
   */
  async costTrendByAssignee(
    bucket: 'day' | 'week' | 'month',
    fromParam?: string,
    toParam?: string,
    topN?: number,
  ) {
    const { buckets, segments, points } = await this.costTrendBySegment(
      bucket, fromParam, toParam, topN,
      Prisma.sql`COALESCE(NULLIF(e.user_name, ''), e.user_id, 'Unknown')`,
    );
    return { buckets, assignees: segments, points };
  }

  /**
   * Labor cost per time bucket, broken down by the task's client — feeds the
   * stacked bar view of the "Client cost trend" chart. See
   * {@link costTrendBySegment}; tasks with no client are grouped under
   * "No client".
   */
  async costTrendByClient(
    bucket: 'day' | 'week' | 'month',
    fromParam?: string,
    toParam?: string,
    topN?: number,
  ) {
    const { buckets, segments, points } = await this.costTrendBySegment(
      bucket, fromParam, toParam, topN,
      Prisma.sql`COALESCE(NULLIF(t.client, ''), 'No client')`,
    );
    return { buckets, clients: segments, points };
  }
}

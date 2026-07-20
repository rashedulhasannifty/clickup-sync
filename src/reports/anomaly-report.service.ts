import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { parseDate } from './report-date.util';

/** Spend/hour anomaly detection: per-user daily-hour spikes and cost spikes. */
@Injectable()
export class AnomalyReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-user daily-hour spikes. SQL only aggregates hours per (user, local day);
   * detection, classification, ranking and zero-fill happen here in TS so the
   * rule logic is unit-testable. The relative-rule median derives from the
   * selected window, floored to a 14-day minimum so a short pick does not
   * produce a noisy median that flags nearly every day.
   */
  async hourSpikes(cap: number, fromParam?: string, toParam?: string, limit = 20, includeResolved = false, medianEnabled = true) {
    const TZ = Prisma.raw(`'Asia/Dhaka'`);
    // `start_time` is a `timestamptz` (an absolute instant); a single
    // `AT TIME ZONE 'Asia/Dhaka'` converts it to the Dhaka wall-clock, whose
    // `date_trunc('day', ...)` is the Dhaka calendar day. The old double form
    // (`AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka'`) collapsed the timestamptz
    // to the UTC date and mis-assigned early-Dhaka-morning entries to the
    // previous day. (Contrast `cycleTime`, which buckets `occurred_at` — a naive
    // `timestamp` — and legitimately keeps both conversions.)
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const from = parseDate(fromParam, defaultFrom);
    const to = parseDate(toParam, new Date());

    // Median baseline derives from the selected window, floored to 14 days so a
    // short pick doesn't produce a noisy median that flags nearly every day.
    const BASELINE_FLOOR_MS = 14 * 24 * 60 * 60 * 1000;
    const baselineFrom = new Date(Math.min(from.getTime(), to.getTime() - BASELINE_FLOOR_MS));

    type DayRow = { user_id: string | null; user_name: string | null; day: string; hours: number };
    type BucketRow = { bucket: string };

    const [baselineRows, displayRows, axisRows] = await Promise.all([
      this.prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT COALESCE(e.user_id, 'unknown')                        AS user_id,
             COALESCE(NULLIF(e.user_name, ''), e.user_id, 'Unknown') AS user_name,
             to_char(date_trunc('day', e.start_time AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(e.duration_hours), 0)::float             AS hours
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time IS NOT NULL
        AND e.start_time >= ${baselineFrom}
        AND e.start_time <= ${to}
        AND t.is_deleted = false
      GROUP BY 1, 2, 3
    `),
      this.prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT COALESCE(e.user_id, 'unknown')                        AS user_id,
             COALESCE(NULLIF(e.user_name, ''), e.user_id, 'Unknown') AS user_name,
             to_char(date_trunc('day', e.start_time AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(e.duration_hours), 0)::float             AS hours
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time IS NOT NULL
        AND e.start_time >= ${from}
        AND e.start_time <= ${to}
        AND t.is_deleted = false
      GROUP BY 1, 2, 3
    `),
      this.prisma.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT to_char(generate_series(
               date_trunc('day', (${from}::timestamptz AT TIME ZONE ${TZ})),
               date_trunc('day', (${to  }::timestamptz AT TIME ZONE ${TZ})),
               interval '1 day'), 'YYYY-MM-DD') AS bucket
      ORDER BY 1 ASC
    `),
    ]);
    const buckets = axisRows.map((r) => r.bucket);

    // Median daily hours per user, from the fixed baseline (days with hours > 0).
    const baselineByUser = new Map<string, { name: string; hours: number[] }>();
    for (const r of baselineRows) {
      const id = r.user_id ?? 'unknown';
      const e = baselineByUser.get(id) ?? { name: r.user_name ?? 'Unknown', hours: [] };
      if (r.user_name) e.name = r.user_name;
      if (r.hours > 0) e.hours.push(r.hours);
      baselineByUser.set(id, e);
    }
    const median = (xs: number[]): number => {
      if (!xs.length) return 0;
      const s = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const medians = new Map<string, number>();
    for (const [id, e] of baselineByUser) medians.set(id, median(e.hours));

    // Display hours per user/day.
    const displayByUser = new Map<string, { name: string; days: Map<string, number> }>();
    for (const r of displayRows) {
      const id = r.user_id ?? 'unknown';
      const e = displayByUser.get(id) ?? { name: r.user_name ?? 'Unknown', days: new Map<string, number>() };
      if (r.user_name) e.name = r.user_name;
      // A single user_id can yield multiple rows for one day if user_name drifted
      // across entries (the SQL groups by the resolved name too); re-sum them here.
      e.days.set(r.day, (e.days.get(r.day) ?? 0) + r.hours);
      displayByUser.set(id, e);
    }

    type Rule = 'absolute' | 'relative' | 'both';
    // When the median rule is disabled, only the absolute cap flags a day; a
    // day flagged purely by 2× median (under the cap) drops out of detection
    // entirely — out of the watchlist, the chart, and the notifications.
    const classify = (hours: number, med: number): Rule | null => {
      const abs = hours > cap;
      const rel = medianEnabled && med > 0 && hours > 2 * med && hours >= 4;
      if (abs && rel) return 'both';
      if (abs) return 'absolute';
      if (rel) return 'relative';
      return null;
    };

    // Per-user zero-filled series.
    const users = [...displayByUser.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, e]) => {
        const med = medians.get(id) ?? 0;
        const points = buckets.map((b) => {
          const hours = e.days.get(b) ?? 0;
          return { date: b, hours, isSpike: classify(hours, med) !== null };
        });
        return { userId: id, userName: e.name, points };
      });

    // Watchlist: every flagged display day, ranked by raw hours desc, top 20.
    type WatchRow = {
      userId: string; userName: string; date: string; hours: number;
      median: number; multiplier: number | null; rule: Rule;
    };
    const watchlist: WatchRow[] = [];
    for (const [id, e] of displayByUser) {
      const med = medians.get(id) ?? 0;
      for (const [day, hours] of e.days) {
        const rule = classify(hours, med);
        if (!rule) continue;
        watchlist.push({
          userId: id, userName: e.name, date: day, hours,
          median: medianEnabled ? med : 0,
          multiplier: medianEnabled && med > 0 ? hours / med : null,
          rule,
        });
      }
    }
    watchlist.sort((a, b) => b.hours - a.hours);

    // Resolved user-days drop out of the watchlist unless explicitly requested.
    // One range query (not a big OR); recover YYYY-MM-DD from the @db.Date the
    // same way the notified-enrichment below does.
    const resolutions = await this.prisma.spikeResolution.findMany({
      where: { spikeDate: { gte: new Date(`${buckets[0] ?? '1970-01-01'}T00:00:00.000Z`), lte: new Date(`${buckets[buckets.length - 1] ?? '1970-01-01'}T00:00:00.000Z`) } },
      select: { clickupUserId: true, spikeDate: true },
    });
    const resolvedSet = new Set(
      resolutions.map((r) => `${r.clickupUserId}|${r.spikeDate.toISOString().slice(0, 10)}`),
    );
    const withResolved = watchlist.map((w) => ({ ...w, resolved: resolvedSet.has(`${w.userId}|${w.date}`) }));
    const filtered = includeResolved ? withResolved : withResolved.filter((w) => !w.resolved);
    const watchlistTotal = filtered.length;
    const top = filtered.slice(0, limit);

    // Flag rows the admin has already emailed about (one notice per user-day).
    // Guard the empty case: an empty `OR` would match every row.
    let notifiedSet = new Set<string>();
    if (top.length > 0) {
      const notifs = await this.prisma.spikeNotification.findMany({
        where: {
          OR: top.map((w) => ({
            clickupUserId: w.userId,
            spikeDate: new Date(`${w.date}T00:00:00.000Z`),
          })),
        },
        select: { clickupUserId: true, spikeDate: true },
      });
      // spike_notifications.spike_date is @db.Date; @prisma/adapter-pg returns it
      // as UTC midnight, so toISOString().slice(0,10) recovers the same YYYY-MM-DD
      // the watchlist uses (written via `${date}T00:00:00.000Z` on the write path).
      notifiedSet = new Set(
        notifs.map((n) => `${n.clickupUserId}|${n.spikeDate.toISOString().slice(0, 10)}`),
      );
    }
    // `enriched` is WatchRow & { notified }; WatchRow itself stays the pre-enrichment
    // shape used by the watchlist.push above (which has no `notified` yet).
    const enriched = top.map((w) => ({ ...w, notified: notifiedSet.has(`${w.userId}|${w.date}`) }));

    return { cap, watchlist: enriched, watchlistTotal, byUser: { buckets, users } };
  }

  async anomalies() {
    const TZ = Prisma.raw("'Asia/Dhaka'");
    type DailyRow = {
      date: string;
      total_cost_cents: bigint;
      median_cost_cents: number;
      multiplier: number;
    };
    type ClientRow = {
      client: string;
      week_cost_cents: bigint;
      baseline_median_cents: number;
      multiplier: number;
    };

    const [dailyRows, clientRows] = await Promise.all([
      this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
        WITH daily_costs AS (
          -- start_time is a timestamptz: single Dhaka conversion → Dhaka day (see hourSpikes).
          SELECT date_trunc('day', e.start_time AT TIME ZONE ${TZ}) AS day_local,
                 SUM(e.cost_cents)::bigint AS day_cents
          FROM clickup_time_entries e
          JOIN clickup_tasks t ON e.task_id = t.task_id
          WHERE e.start_time IS NOT NULL
            AND e.start_time >= now() - interval '30 days'
            AND t.is_deleted = false
          GROUP BY 1
        ),
        median AS (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY day_cents) AS median_cents
          FROM daily_costs
          WHERE day_cents > 0
        )
        SELECT to_char(d.day_local, 'YYYY-MM-DD')                AS date,
               d.day_cents                                        AS total_cost_cents,
               m.median_cents::float                              AS median_cost_cents,
               (d.day_cents::float / NULLIF(m.median_cents, 0))::float AS multiplier
        FROM daily_costs d, median m
        WHERE d.day_cents > 5000
          AND m.median_cents > 0
          AND d.day_cents > 2 * m.median_cents
        ORDER BY d.day_local DESC
        LIMIT 10
      `),

      this.prisma.$queryRaw<ClientRow[]>(Prisma.sql`
        WITH last_7 AS (
          SELECT t.client, SUM(e.cost_cents)::bigint AS week_cents
          FROM clickup_time_entries e
          JOIN clickup_tasks t ON e.task_id = t.task_id
          WHERE e.start_time IS NOT NULL
            AND e.start_time >= now() - interval '7 days'
            AND t.client IS NOT NULL AND t.client <> ''
            AND t.is_deleted = false
          GROUP BY t.client
        ),
        baseline_weeks AS (
          SELECT t.client,
                 (date_trunc('week', (e.start_time AT TIME ZONE ${TZ}) + interval '1 day') - interval '1 day') AS week_local,
                 SUM(e.cost_cents)::bigint AS week_cents
          FROM clickup_time_entries e
          JOIN clickup_tasks t ON e.task_id = t.task_id
          WHERE e.start_time IS NOT NULL
            AND e.start_time >= now() - interval '90 days'
            AND e.start_time <  now() - interval '7 days'
            AND t.client IS NOT NULL AND t.client <> ''
            AND t.is_deleted = false
          GROUP BY t.client, 2
        ),
        baseline AS (
          SELECT client,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY week_cents) AS median_week_cents
          FROM baseline_weeks
          WHERE week_cents > 0
          GROUP BY client
        )
        SELECT l.client                                                     AS client,
               l.week_cents                                                  AS week_cost_cents,
               b.median_week_cents::float                                    AS baseline_median_cents,
               (l.week_cents::float / NULLIF(b.median_week_cents, 0))::float AS multiplier
        FROM last_7 l
        JOIN baseline b ON b.client = l.client
        WHERE l.week_cents > 5000
          AND b.median_week_cents > 0
          AND l.week_cents > 2 * b.median_week_cents
        ORDER BY multiplier DESC
        LIMIT 10
      `),
    ]);

    return {
      dailySpikes: dailyRows.map(r => ({
        date: r.date,
        totalCostAud: Number(r.total_cost_cents) / 100,
        medianAud: Number(r.median_cost_cents) / 100,
        multiplier: Number(r.multiplier),
      })),
      clientSpikes: clientRows.map(r => ({
        client: r.client,
        lastWeekCostAud: Number(r.week_cost_cents) / 100,
        baselineMedianAud: Number(r.baseline_median_cents) / 100,
        multiplier: Number(r.multiplier),
      })),
    };
  }
}

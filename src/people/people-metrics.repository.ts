import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { addDays, dhakaInstant } from "./people-dates";

export interface HoursRow {
  clickupUserId: string;
  /** Dhaka calendar date of `start_time`. */
  date: string;
  hours: number;
  chargeableHours: number;
}

export interface DeliveryRow {
  clickupUserId: string;
  /** Dhaka calendar dates of `closed_date` / `due_date`. */
  closedOn: string;
  dueOn: string;
}

/**
 * Read-only ClickUp-derived metrics for the KPI tab. Every method takes a LIST
 * of ClickUp user ids and returns rows tagged with the id, so the directory
 * computes all employees in one query per metric instead of one per employee.
 * Aggregation happens in SQL; day bucketing is by the Dhaka calendar date.
 */
@Injectable()
export class PeopleMetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tracked hours per user per Dhaka day in [from, to]. `is_chargeable` is the
   * derived per-entry column (see "Chargeability" in CLAUDE.md), so this reads
   * the resolved answer rather than re-deriving it.
   */
  async hoursByDay(
    clickupUserIds: string[],
    from: string,
    to: string,
  ): Promise<HoursRow[]> {
    if (clickupUserIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      { user_id: string; date: string; hours: string; chargeable: string }[]
    >(Prisma.sql`
      SELECT user_id,
             to_char((start_time AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS date,
             COALESCE(SUM(duration_hours), 0)::text AS hours,
             COALESCE(SUM(duration_hours) FILTER (WHERE is_chargeable), 0)::text AS chargeable
      FROM clickup_time_entries
      WHERE user_id IN (${Prisma.join(clickupUserIds)})
        AND start_time >= ${dhakaInstant(from, 0)}
        AND start_time <  ${dhakaInstant(addDays(to, 1), 0)}
      GROUP BY 1, 2
    `);
    return rows.map((r) => ({
      clickupUserId: r.user_id,
      date: r.date,
      hours: Number(r.hours),
      chargeableHours: Number(r.chargeable),
    }));
  }

  /**
   * Tasks each user is assigned to that were closed in [from, to] and have a due
   * date. Assignment is matched on the ClickUp USER ID inside the stored task
   * payload (`raw.assignees[].id`), compared as text because ClickUp sends it as
   * a number. The id is the one identifier shared with `clickup_time_entries.user_id`
   * and `employees.clickup_user_id`; `assignees_emails` is a comma-joined string
   * (see `joinNames`) and ClickUp omits emails for some members, so email would
   * be both slower and lossier. `ClickupNormalizer` always stores `raw`.
   * Deleted tasks are excluded; subtasks count (they carry their own assignees).
   */
  async deliveries(
    clickupUserIds: string[],
    from: string,
    to: string,
  ): Promise<DeliveryRow[]> {
    if (clickupUserIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      { user_id: string; closed_on: string; due_on: string }[]
    >(Prisma.sql`
      SELECT a.id AS user_id,
             to_char((t.closed_date AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS closed_on,
             to_char((t.due_date    AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS due_on
      FROM clickup_tasks t
      CROSS JOIN LATERAL (
        SELECT elem->>'id' AS id
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(t.raw->'assignees') = 'array' THEN t.raw->'assignees' ELSE '[]'::jsonb END
        ) AS elem
      ) a
      WHERE t.closed_date >= ${dhakaInstant(from, 0)}
        AND t.closed_date <  ${dhakaInstant(addDays(to, 1), 0)}
        AND t.due_date IS NOT NULL
        AND NOT t.is_deleted
        AND a.id IN (${Prisma.join(clickupUserIds)})
    `);
    return rows.map((r) => ({
      clickupUserId: r.user_id,
      closedOn: r.closed_on,
      dueOn: r.due_on,
    }));
  }
}

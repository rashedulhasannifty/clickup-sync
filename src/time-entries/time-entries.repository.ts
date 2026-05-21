import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NormalizedTimeEntry } from '../clickup/clickup-normalizer';

@Injectable()
export class TimeEntriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(entry: NormalizedTimeEntry, cost: { rateId: bigint | null; currency: string; hourlyRateCents: bigint; costCents: bigint; status: string }) {
    // taskName exists on NormalizedTimeEntry for normalizer convenience but is not a column —
    // it comes from the task relation.  Exclude it so Prisma resolves to the Unchecked variant
    // which accepts taskId and rateId as plain scalars.
    const { taskName: _taskName, ...scalarFields } = entry;
    const payload = { ...scalarFields, raw: entry.raw as Prisma.InputJsonValue, ...cost };
    return this.prisma.clickupTimeEntry.upsert({
      where: { timeEntryId: entry.timeEntryId },
      create: payload,
      update: payload,
    });
  }

  async findUnreplacedAgencyEntries(agencyUserId: string, limit = 500) {
    const replaced = await this.prisma.timeEntryReplacement.findMany({
      select: { originalEntryId: true },
    });
    const replacedIds = new Set(replaced.map((r) => r.originalEntryId));

    return this.prisma.clickupTimeEntry.findMany({
      where: {
        userId: agencyUserId,
        timeEntryId: { notIn: replacedIds.size > 0 ? [...replacedIds] : ['__never__'] },
      },
      take: limit,
      orderBy: { startTime: 'asc' },
      select: {
        timeEntryId: true,
        taskId: true,
        startTime: true,
        endTime: true,
        durationHours: true,
        billable: true,
        description: true,
      },
    });
  }

  /**
   * Time entries that carry a non-empty `tags` array in their raw ClickUp
   * payload AND haven't been replaced yet. Used by the
   * /admin/time-entries/backfill-replacement endpoint to retroactively route
   * historical tagged entries through the assignee-replacement worker.
   *
   * `tag_names` is materialised in SQL (`raw->'tags'[].name` lowercased) so the
   * caller receives a plain `string[]` per row.
   */
  async findUnreplacedTaggedEntries(limit = 500) {
    type Row = {
      time_entry_id: string;
      task_id: string | null;
      user_id: string | null;
      start_time: Date | null;
      end_time: Date | null;
      duration_hours: Prisma.Decimal;
      billable: boolean;
      description: string | null;
      tag_names: string[];
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        te.time_entry_id,
        te.task_id,
        te.user_id,
        te.start_time,
        te.end_time,
        te.duration_hours,
        te.billable,
        te.description,
        ARRAY(
          SELECT LOWER(t->>'name')
          FROM jsonb_array_elements(te.raw->'tags') AS t
          WHERE t->>'name' IS NOT NULL
        ) AS tag_names
      FROM clickup_time_entries te
      WHERE jsonb_array_length(COALESCE(te.raw->'tags', '[]'::jsonb)) > 0
        AND NOT EXISTS (
          SELECT 1 FROM time_entry_replacements r WHERE r.original_entry_id = te.time_entry_id
        )
      ORDER BY te.start_time ASC NULLS LAST
      LIMIT ${limit}
    `);
    return rows;
  }
}

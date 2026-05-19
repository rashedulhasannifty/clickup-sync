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
}

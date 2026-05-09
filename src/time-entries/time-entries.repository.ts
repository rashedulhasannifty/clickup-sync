import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NormalizedTimeEntry } from '../clickup/clickup-normalizer';

@Injectable()
export class TimeEntriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(entry: NormalizedTimeEntry, cost: { rateId: bigint | null; currency: string; hourlyRateCents: bigint; costCents: bigint; status: string }) {
    return this.prisma.clickupTimeEntry.upsert({
      where: { timeEntryId: entry.timeEntryId },
      create: { ...entry, ...cost },
      update: { ...entry, ...cost },
    });
  }
}

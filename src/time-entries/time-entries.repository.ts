import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NormalizedTimeEntry } from '../clickup/clickup-normalizer';

@Injectable()
export class TimeEntriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(entry: NormalizedTimeEntry, cost: { rateId: bigint | null; currency: string; hourlyRateCents: bigint; costCents: bigint; status: string }) {
    return this.prisma.clickupTimeEntry.upsert({
      where: { timeEntryId: entry.timeEntryId },
      create: { ...entry, raw: entry.raw as Prisma.InputJsonValue, ...cost },
      update: { ...entry, raw: entry.raw as Prisma.InputJsonValue, ...cost },
    });
  }
}

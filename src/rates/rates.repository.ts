import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface RateRow { assigneeId: string; assigneeName?: string; assigneeEmail?: string; currency: string; hourlyRateCents: bigint; validFrom: Date; validTo: Date | null; }

@Injectable()
export class RatesRepository {
  constructor(private readonly prisma: PrismaService) {}
  upsert(row: RateRow) {
    return this.prisma.assigneeRate.upsert({
      where: { assigneeId_validFrom: { assigneeId: row.assigneeId, validFrom: row.validFrom } },
      create: row,
      update: { assigneeName: row.assigneeName, assigneeEmail: row.assigneeEmail, currency: row.currency, hourlyRateCents: row.hourlyRateCents, validTo: row.validTo },
    });
  }
}

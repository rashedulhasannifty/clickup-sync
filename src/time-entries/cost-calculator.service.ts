import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CostCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(userId: string | null, startTime: Date | null, durationHours: number) {
    if (!userId || !startTime) return { rateId: null, currency: 'AUD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND' };
    const entryDate = new Date(Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate()));
    // Closed-closed interval `[validFrom, validTo]`: both endpoints are
    // inclusive. A rate with validTo=Dec 31 covers a Dec 31 time entry. The
    // human convention is "this rate runs Oct 1 through Dec 31, then the next
    // one starts Jan 1" — closed-closed matches that. On overlap (e.g.
    // adjacent rates both end / start on Dec 31) the rate with the later
    // validFrom wins, since `orderBy: { validFrom: 'desc' }` + `findFirst`.
    const rate = await this.prisma.assigneeRate.findFirst({
      where: { assigneeId: userId, validFrom: { lte: entryDate }, OR: [{ validTo: null }, { validTo: { gte: entryDate } }] },
      orderBy: { validFrom: 'desc' },
    });
    if (!rate) return { rateId: null, currency: 'AUD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND' };
    return { rateId: rate.rateId, currency: rate.currency, hourlyRateCents: rate.hourlyRateCents, costCents: BigInt(Math.round(Number(rate.hourlyRateCents) * durationHours)), status: 'COST_CALCULATED' };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Resolved effective rate for a (user, calendar-day) pair, or null when none
 * applies. Callers that recompute many entries (per-task sync, recalc-all) can
 * pass a shared `RateCache` so the same (user, day) lookup hits the DB once
 * instead of once per entry. The cache is per-run and short-lived — never reuse
 * one across runs, or rate edits won't take effect.
 */
export type ResolvedRate = { rateId: bigint; currency: string; hourlyRateCents: bigint } | null;
export type RateCache = Map<string, ResolvedRate>;

@Injectable()
export class CostCalculatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async calculate(
    userId: string | null,
    startTime: Date | null,
    durationHours: number,
    cache?: RateCache,
    opts?: { billable?: boolean; dueDate?: Date | null },
  ) {
    if (!userId || !startTime) return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND' };
    const cost = this.settings.getPreferences().cost;
    if (cost.nonBillableZero && opts?.billable === false) {
      return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'COST_CALCULATED' };
    }
    const basis = cost.rateMatching === 'due' && opts?.dueDate ? opts.dueDate : startTime;
    const entryDate = new Date(Date.UTC(basis.getUTCFullYear(), basis.getUTCMonth(), basis.getUTCDate()));
    const rate = await this.resolveRate(userId, entryDate, cache);
    if (!rate) return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND' };
    return { rateId: rate.rateId, currency: rate.currency, hourlyRateCents: rate.hourlyRateCents, costCents: BigInt(Math.round(Number(rate.hourlyRateCents) * durationHours)), status: 'COST_CALCULATED' };
  }

  private async resolveRate(userId: string, entryDate: Date, cache?: RateCache): Promise<ResolvedRate> {
    const key = `${userId}|${entryDate.getTime()}`;
    if (cache?.has(key)) return cache.get(key)!;

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
    const resolved: ResolvedRate = rate
      ? { rateId: rate.rateId, currency: rate.currency, hourlyRateCents: rate.hourlyRateCents }
      : null;
    cache?.set(key, resolved);
    return resolved;
  }
}

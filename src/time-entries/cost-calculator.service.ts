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
    opts?: { chargeable?: boolean; dueDate?: Date | null },
  ) {
    // Resolved once and returned on EVERY branch. Callers spread this object
    // into the time-entry upsert, so this is what writes `is_chargeable` — and
    // keeping it out of the branches below is what stops the calculator from
    // disagreeing with the migration's backfill about the same row.
    //
    // Deliberately independent of the COST_EXCLUDED branch: excluding an
    // identity from COSTING says nothing about whether the work is BILLABLE.
    const isChargeable = opts?.chargeable !== false;
    if (!userId || !startTime) return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND', isChargeable };
    if (this.settings.getExcludedAssigneeIds().has(userId)) {
      return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'COST_EXCLUDED', isChargeable };
    }
    const cost = this.settings.getPreferences().cost;
    const basis = cost.rateMatching === 'due' && opts?.dueDate ? opts.dueDate : startTime;
    const entryDate = new Date(Date.UTC(basis.getUTCFullYear(), basis.getUTCMonth(), basis.getUTCDate()));
    const rate = await this.resolveRate(userId, entryDate, cache);
    // Non-chargeable work costs nothing — but the rate is still resolved and
    // stored, so "what would this unbilled work have cost us" stays answerable
    // as hours x rate. A missing rate is not a problem to fix here either, so
    // NOT_CHARGEABLE wins over NO_RATE_FOUND and keeps this work out of the
    // Missing Rates report.
    if (opts?.chargeable === false) {
      return {
        rateId: rate?.rateId ?? null,
        currency: rate?.currency ?? 'USD',
        hourlyRateCents: rate?.hourlyRateCents ?? 0n,
        costCents: 0n,
        status: 'NOT_CHARGEABLE',
        isChargeable,
      };
    }
    if (!rate) return { rateId: null, currency: 'USD', hourlyRateCents: 0n, costCents: 0n, status: 'NO_RATE_FOUND', isChargeable };
    return { rateId: rate.rateId, currency: rate.currency, hourlyRateCents: rate.hourlyRateCents, costCents: BigInt(Math.round(Number(rate.hourlyRateCents) * durationHours)), status: 'COST_CALCULATED', isChargeable };
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

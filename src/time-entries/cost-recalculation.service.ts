import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CostCalculatorService, RateCache } from './cost-calculator.service';
import { SettingsService } from '../settings/settings.service';

const BATCH_SIZE = 1000;

@Injectable()
export class CostRecalculationService {
  private readonly logger = new Logger(CostRecalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: CostCalculatorService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Recompute cost_cents/rate_id/status for existing time entries using the
   * current assignee rates. Scoped to one assignee when assigneeId is given,
   * otherwise every entry. Idempotent.
   *
   * Streams the table in id-ordered cursor batches instead of loading every
   * row into memory, and threads one short-lived RateCache through the whole
   * run so the same (user, day) rate is looked up once rather than once per
   * entry (the recalc-all path could otherwise issue 2N serial DB round-trips
   * on a growing table).
   */
  async recalculate(opts: { assigneeId?: string }): Promise<{ scanned: number; updated: number }> {
    const where = opts.assigneeId ? { userId: opts.assigneeId } : {};
    const cache: RateCache = new Map();

    let scanned = 0;
    let updated = 0;
    let noRate = 0;
    let cursor: string | undefined;

    for (;;) {
      const entries = await this.prisma.clickupTimeEntry.findMany({
        where,
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { timeEntryId: cursor } } : {}),
        orderBy: { timeEntryId: 'asc' },
        select: { timeEntryId: true, userId: true, startTime: true, durationHours: true, billable: true, task: { select: { dueDate: true } } },
      });
      if (entries.length === 0) break;

      for (const e of entries) {
        const cost = await this.costs.calculate(e.userId, e.startTime, e.durationHours.toNumber(), cache, { billable: e.billable, dueDate: e.task?.dueDate ?? null });
        await this.prisma.clickupTimeEntry.update({
          where: { timeEntryId: e.timeEntryId },
          data: {
            rateId: cost.rateId,
            currency: cost.currency,
            hourlyRateCents: cost.hourlyRateCents,
            costCents: cost.costCents,
            status: cost.status,
          },
        });
        updated += 1;
        if (cost.status === 'NO_RATE_FOUND') noRate += 1;
      }

      scanned += entries.length;
      cursor = entries[entries.length - 1].timeEntryId;
      if (entries.length < BATCH_SIZE) break;
    }

    this.logger.log(`Recalculated ${updated}/${scanned} time entries (assignee=${opts.assigneeId ?? 'all'}, noRate=${noRate})`);
    return { scanned, updated };
  }
}

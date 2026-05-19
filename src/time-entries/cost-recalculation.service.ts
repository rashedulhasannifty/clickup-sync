import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CostCalculatorService } from './cost-calculator.service';

@Injectable()
export class CostRecalculationService {
  private readonly logger = new Logger(CostRecalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: CostCalculatorService,
  ) {}

  /**
   * Recompute cost_cents/rate_id/status for existing time entries using the
   * current assignee rates. Scoped to one assignee when assigneeId is given,
   * otherwise every entry. Idempotent.
   */
  async recalculate(opts: { assigneeId?: string }): Promise<{ scanned: number; updated: number }> {
    const where = opts.assigneeId ? { userId: opts.assigneeId } : {};
    const entries = await this.prisma.clickupTimeEntry.findMany({
      where,
      select: { timeEntryId: true, userId: true, startTime: true, durationHours: true },
    });

    let updated = 0;
    for (const e of entries) {
      const cost = await this.costs.calculate(e.userId, e.startTime, Number(e.durationHours));
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
    }

    this.logger.log(`Recalculated ${updated}/${entries.length} time entries (assignee=${opts.assigneeId ?? 'all'})`);
    return { scanned: entries.length, updated };
  }
}

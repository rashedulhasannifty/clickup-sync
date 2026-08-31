import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CostCalculatorService, RateCache } from './cost-calculator.service';
import { SettingsService } from '../settings/settings.service';
import { TaskAssigneeChargeabilityRepository } from '../tasks/task-assignee-chargeability.repository';
import { resolveChargeability, ruleKey } from './chargeability';

const BATCH_SIZE = 1000;

@Injectable()
export class CostRecalculationService {
  private readonly logger = new Logger(CostRecalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: CostCalculatorService,
    private readonly settings: SettingsService,
    private readonly rules: TaskAssigneeChargeabilityRepository,
  ) {}

  /**
   * Recompute cost_cents/rate_id/status for existing time entries using the
   * current assignee rates. Scoped to one assignee when assigneeId is given,
   * to a set of tasks when taskIds is given (what a chargeability toggle
   * enqueues), or every entry when neither is given. Idempotent.
   *
   * Streams the table in id-ordered cursor batches instead of loading every
   * row into memory, and threads one short-lived RateCache through the whole
   * run so the same (user, day) rate is looked up once rather than once per
   * entry (the recalc-all path could otherwise issue 2N serial DB round-trips
   * on a growing table).
   */
  async recalculate(opts: { assigneeId?: string; taskIds?: string[]; timeEntryIds?: string[] }): Promise<{ scanned: number; updated: number }> {
    // Scopes are independent: an assignee, a set of tasks (what a chargeability
    // toggle enqueues), or everything.
    const where = {
      ...(opts.assigneeId ? { userId: opts.assigneeId } : {}),
      ...(opts.taskIds?.length ? { taskId: { in: opts.taskIds } } : {}),
      // A per-entry override scopes to the exact entries that were written —
      // the narrowest scope there is, and the only one that doesn't re-cost a
      // colleague's time as a side effect of editing one row.
      ...(opts.timeEntryIds?.length ? { timeEntryId: { in: opts.timeEntryIds } } : {}),
    };
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
        select: {
          timeEntryId: true,
          userId: true,
          taskId: true,
          startTime: true,
          durationHours: true,
          chargeableOverride: true,
          task: { select: { dueDate: true, isChargeable: true } },
        },
      });
      if (entries.length === 0) break;

      // One rules lookup per batch, not per entry — same reasoning as the
      // shared RateCache above.
      const batchTaskIds = [...new Set(entries.map((e) => e.taskId).filter((id): id is string => id != null))];
      const ruleMap = await this.rules.findForTasks(batchTaskIds);

      for (const e of entries) {
        const { chargeable } = resolveChargeability({
          entryOverride: e.chargeableOverride,
          rule: e.taskId && e.userId ? ruleMap.get(ruleKey(e.taskId, e.userId)) : undefined,
          taskChargeable: e.task?.isChargeable,
        });
        const cost = await this.costs.calculate(e.userId, e.startTime, e.durationHours.toNumber(), cache, { chargeable, dueDate: e.task?.dueDate ?? null });
        await this.prisma.clickupTimeEntry.update({
          where: { timeEntryId: e.timeEntryId },
          data: {
            rateId: cost.rateId,
            currency: cost.currency,
            hourlyRateCents: cost.hourlyRateCents,
            costCents: cost.costCents,
            status: cost.status,
            isChargeable: cost.isChargeable,
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

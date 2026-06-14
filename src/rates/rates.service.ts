import { Injectable, Logger } from '@nestjs/common';
import { RatesRepository } from './rates.repository';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);

  constructor(
    private readonly repo: RatesRepository,
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
  ) {}

  private async enqueueRecalc(assigneeId: string) {
    if (!this.settings.getPreferences().cost.autoRecalcOnRateChange) {
      this.logger.log(`Auto-recalc disabled in settings; skipping recalc enqueue for ${assigneeId}`);
      return;
    }
    try {
      await this.queues
        .get(QUEUES.MAINTENANCE)
        .add(JOBS.RECALCULATE_COSTS, { assigneeId }, this.queues.defaultJobOptions());
    } catch (e) {
      // Rate write already committed; recalculation can be retried via the
      // manual "Recalculate costs" button. Never fail the mutation here.
      this.logger.error(`Failed to enqueue cost recalculation for ${assigneeId}: ${(e as Error).message}`);
    }
  }

  async create(data: Parameters<RatesRepository['create']>[0]) {
    const rate = await this.repo.create(data);
    await this.enqueueRecalc(rate.assigneeId);
    return rate;
  }

  async update(id: bigint, data: Parameters<RatesRepository['update']>[1]) {
    const rate = await this.repo.update(id, data);
    await this.enqueueRecalc(rate.assigneeId);
    return rate;
  }

  async remove(id: bigint) {
    const existing = await this.repo.findById(id);
    await this.repo.remove(id);
    if (existing) await this.enqueueRecalc(existing.assigneeId);
  }
}

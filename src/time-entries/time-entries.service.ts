import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from '../clickup/clickup.client';
import { ClickupNormalizer } from '../clickup/clickup-normalizer';
import { TimeEntriesRepository } from './time-entries.repository';
import { CostCalculatorService } from './cost-calculator.service';

@Injectable()
export class TimeEntriesService {
  private readonly logger = new Logger(TimeEntriesService.name);
  constructor(private readonly clickup: ClickupClient, private readonly normalizer: ClickupNormalizer, private readonly repo: TimeEntriesRepository, private readonly costs: CostCalculatorService) {}

  async syncTaskTimeEntries(taskId: string, assigneeId?: string) {
    const teamId = process.env.CLICKUP_TEAM_ID || '3450636';
    const entries = await this.clickup.getTimeEntries(teamId, taskId, assigneeId);
    let count = 0;
    for (const entry of entries) {
      const normalized = this.normalizer.normalizeTimeEntry(entry);
      const cost = await this.costs.calculate(normalized.userId, normalized.startTime, normalized.durationHours);
      await this.repo.upsert(normalized, cost);
      if (cost.status === 'NO_RATE_FOUND') this.logger.warn(`Missing rate for user ${normalized.userId} on time entry ${normalized.timeEntryId}`);
      count += 1;
    }
    return count;
  }
}

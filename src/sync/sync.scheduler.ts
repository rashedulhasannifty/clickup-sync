import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';

@Injectable()
export class SyncScheduler {
  constructor(private readonly queues: QueueService) {}

  @Cron('0 */15 * * * *')
  async reconcileRecentUpdates() {
    for (const space of CLICKUP_SPACES) {
      await this.queues.get(QUEUES.CLICKUP_BACKFILLS).add(JOBS.BACKFILL_CLICKUP_SPACE, { spaceId: space.id, lookbackDays: 1 }, this.queues.defaultJobOptions());
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async syncRates() { await this.queues.get(QUEUES.ASSIGNEE_RATES).add(JOBS.SYNC_ASSIGNEE_RATES, {}, this.queues.defaultJobOptions()); }
}

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from './queue.constants';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUES.CLICKUP_WEBHOOKS) private readonly webhooks: Queue,
    @InjectQueue(QUEUES.CLICKUP_TASKS) private readonly tasks: Queue,
    @InjectQueue(QUEUES.CLICKUP_TIME_ENTRIES) private readonly timeEntries: Queue,
    @InjectQueue(QUEUES.CLICKUP_BACKFILLS) private readonly backfills: Queue,
    @InjectQueue(QUEUES.ASSIGNEE_RATES) private readonly rates: Queue,
    @InjectQueue(QUEUES.MAINTENANCE) private readonly maintenance: Queue,
  ) {}

  get(name: string): Queue {
    const map: Record<string, Queue> = {
      [QUEUES.CLICKUP_WEBHOOKS]: this.webhooks,
      [QUEUES.CLICKUP_TASKS]: this.tasks,
      [QUEUES.CLICKUP_TIME_ENTRIES]: this.timeEntries,
      [QUEUES.CLICKUP_BACKFILLS]: this.backfills,
      [QUEUES.ASSIGNEE_RATES]: this.rates,
      [QUEUES.MAINTENANCE]: this.maintenance,
    };
    const queue = map[name];
    if (!queue) throw new Error(`Unknown queue: ${name}`);
    return queue;
  }

  defaultJobOptions() {
    return {
      attempts: Number(process.env.JOB_ATTEMPTS || 5),
      backoff: { type: 'exponential' as const, delay: Number(process.env.JOB_BACKOFF_DELAY_MS || 30000) },
      removeOnComplete: 1000,
      removeOnFail: false,
    };
  }
}

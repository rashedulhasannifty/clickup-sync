import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { WebhookEventsRepository } from '../webhooks/webhook-events.repository';

@Injectable()
@Processor(QUEUES.CLICKUP_WEBHOOKS)
export class ClickupEventProcessor extends WorkerHost {
  private readonly logger = new Logger(ClickupEventProcessor.name);
  constructor(private readonly queues: QueueService, private readonly events: WebhookEventsRepository) { super(); }

  async process(job: Job<any>) {
    const { eventType, taskId, fingerprint, loggedUserId } = job.data;
    if (!taskId && eventType !== 'taskDeleted') return;
    if (eventType === 'taskDeleted') await this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.DELETE_CLICKUP_TASK, { taskId }, this.queues.defaultJobOptions());
    else if (eventType === 'taskTimeTrackedUpdated') await this.queues.get(QUEUES.CLICKUP_TIME_ENTRIES).add(JOBS.SYNC_TASK_TIME_ENTRIES, { taskId, assigneeIds: loggedUserId ? [loggedUserId] : undefined }, this.queues.defaultJobOptions());
    else await this.queues.get(QUEUES.CLICKUP_TASKS).add(JOBS.SYNC_CLICKUP_TASK, { taskId }, this.queues.defaultJobOptions());
    await this.events.markProcessed(fingerprint).catch((e) => this.logger.warn(e.message));
  }
}

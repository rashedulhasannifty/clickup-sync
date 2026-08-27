import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES, clickupWorkerOptions, clickupBulkWorkerOptions } from '../queues/queue.constants';
import { DeadLetterService } from '../jobs/dead-letter.service';
import { TimeEntrySyncHandler, TimeEntryJobData } from './time-entry-sync.handler';

/**
 * LIVE time-entry work: webhook-driven syncs and single-task admin syncs.
 *
 * Kept on its own queue so a bulk sweep can never consume its rate-limit
 * budget. BullMQ's limiter is per-worker and is checked in `moveToActive`
 * BEFORE the wait list is inspected, so priority alone does not protect a live
 * job from a saturated sweep — only a separate queue does.
 */
@Injectable()
@Processor(QUEUES.CLICKUP_TIME_ENTRIES, clickupWorkerOptions())
export class TimeEntrySyncProcessor extends WorkerHost {
  constructor(
    private readonly handler: TimeEntrySyncHandler,
    private readonly deadLetters: DeadLetterService,
  ) { super(); }

  // NB: @OnWorkerEvent is not reliably inherited, so each processor declares
  // its own. Without it `recordIfExhausted` never runs and failures stop being
  // dead-lettered — silently, since nothing else calls it.
  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<TimeEntryJobData>) {
    return this.handler.handle(job, QUEUES.CLICKUP_TIME_ENTRIES);
  }
}

/**
 * BULK time-entry work: sweeps, backfill fan-out, reconciles.
 *
 * Identical behaviour to the live processor — same handler — but bound to a
 * different queue with its own, smaller limiter. See
 * QUEUES.CLICKUP_TIME_ENTRIES_BULK.
 */
@Injectable()
@Processor(QUEUES.CLICKUP_TIME_ENTRIES_BULK, clickupBulkWorkerOptions())
export class TimeEntrySyncBulkProcessor extends WorkerHost {
  constructor(
    private readonly handler: TimeEntrySyncHandler,
    private readonly deadLetters: DeadLetterService,
  ) { super(); }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<TimeEntryJobData>) {
    return this.handler.handle(job, QUEUES.CLICKUP_TIME_ENTRIES_BULK);
  }
}

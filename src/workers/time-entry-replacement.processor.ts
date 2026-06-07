import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { AssigneeReplacementService, ReplacementJobData } from '../time-entries/assignee-replacement.service';
import { DeadLetterService } from '../jobs/dead-letter.service';

@Injectable()
@Processor(QUEUES.CLICKUP_ASSIGNEE_REPLACEMENT)
export class TimeEntryReplacementProcessor extends WorkerHost {
  constructor(
    private readonly replacement: AssigneeReplacementService,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    await this.deadLetters.recordIfExhausted(job, err);
  }

  async process(job: Job<ReplacementJobData>) {
    return this.replacement.replaceEntry(job.data);
  }
}

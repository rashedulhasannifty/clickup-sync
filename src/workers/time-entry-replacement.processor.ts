import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { AssigneeReplacementService, ReplacementJobData } from '../time-entries/assignee-replacement.service';

@Injectable()
@Processor(QUEUES.CLICKUP_ASSIGNEE_REPLACEMENT)
export class TimeEntryReplacementProcessor extends WorkerHost {
  constructor(private readonly replacement: AssigneeReplacementService) {
    super();
  }

  async process(job: Job<ReplacementJobData>) {
    return this.replacement.replaceEntry(job.data);
  }
}

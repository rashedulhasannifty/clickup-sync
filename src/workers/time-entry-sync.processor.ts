import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { TimeEntriesService } from '../time-entries/time-entries.service';

@Injectable()
@Processor(QUEUES.CLICKUP_TIME_ENTRIES)
export class TimeEntrySyncProcessor extends WorkerHost {
  constructor(private readonly timeEntries: TimeEntriesService) { super(); }
  async process(job: Job<{ taskId: string; assigneeId?: string }>) { return this.timeEntries.syncTaskTimeEntries(job.data.taskId, job.data.assigneeId); }
}

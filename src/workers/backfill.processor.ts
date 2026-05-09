import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queues/queue.constants';
import { BackfillService } from '../sync/backfill.service';

@Injectable()
@Processor(QUEUES.CLICKUP_BACKFILLS)
export class BackfillProcessor extends WorkerHost {
  constructor(private readonly backfills: BackfillService) { super(); }
  async process(job: Job<{ spaceId: string; lookbackDays?: number }>) { return this.backfills.backfillSpace(job.data.spaceId, job.data.lookbackDays); }
}

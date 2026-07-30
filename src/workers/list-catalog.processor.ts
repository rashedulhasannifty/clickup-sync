import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ListCatalogService } from '../lists/list-catalog.service';

/**
 * Handles `JOBS.SYNC_LIST_CATALOG` jobs.
 *
 * Deliberately NOT decorated with `@Processor` / `WorkerHost`: that job runs
 * on the shared `CLICKUP_BACKFILLS` queue, which `BackfillProcessor` already
 * owns. In this codebase every queue has exactly one `@Processor` class
 * (verified: CLICKUP_BACKFILLS → BackfillProcessor, MAINTENANCE →
 * CostRecalcProcessor, etc.) — BullMQ workers bind to the *queue*, not the job
 * name, so a second `@Processor` on the same queue would create a competing
 * consumer that pulls jobs indiscriminately. A `sync-list-catalog` job landing
 * on `BackfillProcessor` would fall through to a full space backfill (risking
 * an OOM on the 1.9GB prod host); a real backfill job landing here would
 * silently only sync the catalog. So `BackfillProcessor.process` switches on
 * `job.name` and delegates to this class's `process` for the catalog case,
 * exactly like every other job type on a shared queue in this repo.
 */
@Injectable()
export class ListCatalogProcessor {
  constructor(private readonly catalog: ListCatalogService) {}

  async process(job: Job<{ spaceId: string }>) {
    return this.catalog.syncSpace(job.data.spaceId);
  }
}

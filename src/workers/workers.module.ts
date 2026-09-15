import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { TasksModule } from '../tasks/tasks.module';
import { TimeEntriesModule } from '../time-entries/time-entries.module';
import { SyncModule } from '../sync/sync.module';
import { RatesModule } from '../rates/rates.module';
import { JobsModule } from '../jobs/jobs.module';
import { ListsModule } from '../lists/lists.module';
import { XeroModule } from '../xero/xero.module';
import { ClickupEventProcessor } from './clickup-event.processor';
import { TaskSyncProcessor } from './task-sync.processor';
import { TimeEntrySyncProcessor, TimeEntrySyncBulkProcessor } from './time-entry-sync.processor';
import { TimeEntrySyncHandler } from './time-entry-sync.handler';
import { BackfillProcessor } from './backfill.processor';
import { TimeEntryReplacementProcessor } from './time-entry-replacement.processor';
import { CostRecalcProcessor } from './cost-recalc.processor';
import { ListCatalogProcessor } from './list-catalog.processor';
import { XeroSyncProcessor } from './xero-sync.processor';

@Module({ imports: [QueuesModule, WebhooksModule, TasksModule, TimeEntriesModule, SyncModule, RatesModule, JobsModule, ListsModule, XeroModule], providers: [ClickupEventProcessor, TaskSyncProcessor, TimeEntrySyncProcessor,
    TimeEntrySyncBulkProcessor,
    TimeEntrySyncHandler, BackfillProcessor, TimeEntryReplacementProcessor, CostRecalcProcessor, ListCatalogProcessor, XeroSyncProcessor] })
export class WorkersModule {}

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { QueuesModule } from '../queues/queues.module';
import { ClickupModule } from '../clickup/clickup.module';
import { TasksModule } from '../tasks/tasks.module';
import { ListsModule } from '../lists/lists.module';
import { SyncCheckpointsRepository } from './sync-checkpoints.repository';
import { BackfillService } from './backfill.service';
import { SyncScheduler } from './sync.scheduler';

@Module({ imports: [ScheduleModule, QueuesModule, ClickupModule, TasksModule, ListsModule], providers: [SyncCheckpointsRepository, BackfillService, SyncScheduler], exports: [SyncCheckpointsRepository, BackfillService] })
export class SyncModule {}

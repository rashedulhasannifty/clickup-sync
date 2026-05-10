import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { JobsModule } from '../jobs/jobs.module';
import { ClickupModule } from '../clickup/clickup.module';
import { TimeEntriesModule } from '../time-entries/time-entries.module';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { AdminController } from './admin.controller';

@Module({
  imports: [QueuesModule, JobsModule, ClickupModule, TimeEntriesModule],
  providers: [AdminApiKeyGuard],
  controllers: [AdminController],
})
export class AdminModule {}

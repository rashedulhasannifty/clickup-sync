import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { JobsModule } from '../jobs/jobs.module';
import { ClickupModule } from '../clickup/clickup.module';
import { TimeEntriesModule } from '../time-entries/time-entries.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { RatesModule } from '../rates/rates.module';
import { TasksModule } from '../tasks/tasks.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { MailerModule } from '../auth/mailer.module';
import { AdminController } from './admin.controller';
import { AdminSyncController } from './admin-sync.controller';
import { AdminWebhooksController } from './admin-webhooks.controller';
import { AdminDeadLettersController } from './admin-dead-letters.controller';
import { AdminSpikesController } from './admin-spikes.controller';
import { AdminRatesController } from './admin-rates.controller';
import { AdminBudgetsController } from './admin-budgets.controller';
import { AdminTagsController } from './admin-tags.controller';
import { AdminTasksController } from './admin-tasks.controller';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { SpikeNotificationService } from './spike-notification.service';
import { SpikeResolutionService } from './spike-resolution.service';
import { SearchRepository } from './search.repository';
import { TaskHistoryRepository } from './task-history.repository';

@Module({
  imports: [QueuesModule, JobsModule, ClickupModule, TimeEntriesModule, RatesModule, BudgetsModule, TasksModule, WebhooksModule, MailerModule],
  providers: [AuditLogRepository, AuditLogInterceptor, SpikeNotificationService, SpikeResolutionService, SearchRepository, TaskHistoryRepository],
  controllers: [
    AdminController,
    AdminSyncController,
    AdminWebhooksController,
    AdminDeadLettersController,
    AdminSpikesController,
    AdminRatesController,
    AdminBudgetsController,
    AdminTagsController,
    AdminTasksController,
  ],
  exports: [AuditLogRepository, AuditLogInterceptor],
})
export class AdminModule {}

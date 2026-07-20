import { Module } from '@nestjs/common';
import { ClickupModule } from './clickup.module';
import { AdminModule } from '../admin/admin.module';
import { WebhookHealthService } from './webhook-health.service';
import { EndpointProbe } from './endpoint-probe';

// Separate module (not folded into ClickupModule) because it needs AuditLogRepository
// from AdminModule, and AdminModule already imports ClickupModule — importing it back
// would be a circular dependency. ScheduleModule.forRoot() is global in AppModule, so
// the @Cron in WebhookHealthService is picked up without importing ScheduleModule here.
@Module({
  imports: [ClickupModule, AdminModule],
  providers: [WebhookHealthService, EndpointProbe],
})
export class WebhookHealthModule {}

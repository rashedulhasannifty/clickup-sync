import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { QueuesModule } from '../queues/queues.module';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { isWorker } from '../config/role';
import { XeroConnectionRepository } from './xero-connection.repository';
import { XeroIdentityClient } from './xero-identity.client';
import { XeroTokenService } from './xero-token.service';
import { XeroClient } from './xero.client';
import { XeroAuthService } from './xero-auth.service';
import { XeroAuthController } from './xero-auth.controller';
import { XeroRepository } from './xero.repository';
import { XeroSyncService } from './xero-sync.service';
import { XeroScheduler } from './xero.scheduler';
import { FinanceReportsController } from './finance-reports.controller';
import { FinanceReportsService } from './finance-reports.service';

@Module({
  imports: [
    HttpModule.register({ httpAgent: new HttpAgent({ keepAlive: true }), httpsAgent: new HttpsAgent({ keepAlive: true }) }),
    QueuesModule,
  ],
  controllers: [XeroAuthController, FinanceReportsController],
  providers: [
    XeroConnectionRepository, XeroIdentityClient, XeroTokenService, XeroClient, XeroAuthService,
    XeroRepository, XeroSyncService,
    // Provided locally rather than importing AdminModule and its whole graph.
    AuditLogRepository, AuditLogInterceptor,
    // Worker-gated, like SyncScheduler in sync.module.ts: the crons must fire only
    // in the single worker container, never in the web blue/green colors.
    ...(isWorker() ? [XeroScheduler] : []),
    FinanceReportsService,
  ],
  exports: [XeroConnectionRepository, XeroTokenService, XeroClient, XeroAuthService, XeroRepository, XeroSyncService],
})
export class XeroModule {}

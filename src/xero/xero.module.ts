import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { QueuesModule } from '../queues/queues.module';
import { AuditLogRepository } from '../admin/audit-log.repository';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { XeroConnectionRepository } from './xero-connection.repository';
import { XeroIdentityClient } from './xero-identity.client';
import { XeroTokenService } from './xero-token.service';
import { XeroClient } from './xero.client';
import { XeroAuthService } from './xero-auth.service';
import { XeroAuthController } from './xero-auth.controller';

@Module({
  imports: [
    HttpModule.register({ httpAgent: new HttpAgent({ keepAlive: true }), httpsAgent: new HttpsAgent({ keepAlive: true }) }),
    QueuesModule,
  ],
  controllers: [XeroAuthController],
  providers: [
    XeroConnectionRepository, XeroIdentityClient, XeroTokenService, XeroClient, XeroAuthService,
    // Provided locally rather than importing AdminModule and its whole graph.
    AuditLogRepository, AuditLogInterceptor,
  ],
  exports: [XeroConnectionRepository, XeroTokenService, XeroClient, XeroAuthService],
})
export class XeroModule {}

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { ClickupClient } from './clickup.client';
import { ClickupNormalizer } from './clickup-normalizer';
import { CustomFieldExtractor } from './custom-field-extractor';
import { ClickupWebhooksService } from './clickup-webhooks.service';
import { WorkspaceMembersService } from './workspace-members.service';
import { ClickupMembersController } from './clickup-members.controller';

@Module({
  // Reuse TLS connections to the ClickUp API rather than a fresh handshake per
  // request — meaningful once worker concurrency / request volume rises.
  imports: [
    HttpModule.register({
      httpAgent: new HttpAgent({ keepAlive: true }),
      httpsAgent: new HttpsAgent({ keepAlive: true }),
    }),
  ],
  controllers: [ClickupMembersController],
  providers: [ClickupClient, ClickupNormalizer, CustomFieldExtractor, ClickupWebhooksService, WorkspaceMembersService],
  exports: [ClickupClient, ClickupNormalizer, CustomFieldExtractor, ClickupWebhooksService, WorkspaceMembersService],
})
export class ClickupModule {}

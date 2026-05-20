import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ClickupClient } from './clickup.client';
import { ClickupNormalizer } from './clickup-normalizer';
import { CustomFieldExtractor } from './custom-field-extractor';
import { ClickupWebhooksService } from './clickup-webhooks.service';
import { WorkspaceMembersService } from './workspace-members.service';

@Module({
  imports: [HttpModule],
  providers: [ClickupClient, ClickupNormalizer, CustomFieldExtractor, ClickupWebhooksService, WorkspaceMembersService],
  exports: [ClickupClient, ClickupNormalizer, CustomFieldExtractor, ClickupWebhooksService, WorkspaceMembersService],
})
export class ClickupModule {}

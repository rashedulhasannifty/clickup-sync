import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { WebhookParserService } from './webhook-parser.service';
import { WebhookEventsRepository } from './webhook-events.repository';
import { ClickupWebhookController } from './clickup-webhook.controller';

@Module({ imports: [QueuesModule], providers: [WebhookParserService, WebhookEventsRepository], controllers: [ClickupWebhookController], exports: [WebhookParserService, WebhookEventsRepository] })
export class WebhooksModule {}

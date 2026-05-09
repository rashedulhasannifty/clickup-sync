import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { WebhookParserService } from './webhook-parser.service';
import { WebhookEventsRepository } from './webhook-events.repository';
import { WebhookSignatureGuard } from './webhook-signature.guard';

@ApiTags('webhooks')
@Controller('webhooks')
@UseGuards(WebhookSignatureGuard)
export class ClickupWebhookController {
  private readonly logger = new Logger(ClickupWebhookController.name);
  constructor(
    private readonly parser: WebhookParserService,
    private readonly repo: WebhookEventsRepository,
    private readonly queues: QueueService,
  ) {}

  @Post('clickup')
  @HttpCode(200)
  async receive(@Body() payload: unknown) {
    const parsed = this.parser.parse(payload);
    const saved = await this.repo.saveReceived(parsed);
    if (saved.duplicate) return { success: true, duplicate: true };
    await this.queues.get(QUEUES.CLICKUP_WEBHOOKS).add(JOBS.PROCESS_CLICKUP_EVENT, parsed, this.queues.defaultJobOptions());
    this.logger.log(`Queued ClickUp webhook ${parsed.eventType || 'unknown'} ${parsed.taskId || ''}`);
    return { success: true, queued: true };
  }
}

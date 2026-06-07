import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { WebhookParserService } from './webhook-parser.service';
import { WebhookEventsRepository } from './webhook-events.repository';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { Public } from '../auth/decorators';

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

  @Public()
  @Post('clickup')
  @HttpCode(200)
  async receive(@Body() payload: unknown) {
    const parsed = this.parser.parse(payload);
    const saved = await this.repo.saveReceived(parsed);
    if (saved.duplicate) return { success: true, duplicate: true };

    // The event row + dedupe row are now committed. If enqueue fails here
    // (e.g. Redis blip), ClickUp's retry would be deduped → the event is lost
    // and never processed. Mark it `failed` instead so the admin
    // "retry failed webhooks" path can re-enqueue it from the stored payload.
    // We still return 200 to avoid a ClickUp retry storm that can't succeed.
    try {
      await this.queues
        .get(QUEUES.CLICKUP_WEBHOOKS)
        .add(JOBS.PROCESS_CLICKUP_EVENT, parsed, this.queues.defaultJobOptions());
    } catch (err: any) {
      const message = err?.message ?? String(err);
      this.logger.error(`Failed to enqueue ClickUp webhook ${parsed.fingerprint}: ${message}`);
      await this.repo
        .markFailed(parsed.fingerprint, `enqueue failed: ${message}`)
        .catch((e) => this.logger.error(`markFailed(${parsed.fingerprint}) also failed: ${e.message}`));
      return { success: true, queued: false };
    }

    this.logger.log(`Queued ClickUp webhook ${parsed.eventType || 'unknown'} ${parsed.taskId || ''}`);
    return { success: true, queued: true };
  }
}

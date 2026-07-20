import { Controller, Delete, Get, HttpCode, Logger, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles, CurrentUser } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { SettingsService } from '../settings/settings.service';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { CLICKUP_SPACES } from '../config/clickup-spaces.config';
import { ClickupWebhooksService } from '../clickup/clickup-webhooks.service';
import { WebhookEventsRepository } from '../webhooks/webhook-events.repository';
import { WebhookParserService } from '../webhooks/webhook-parser.service';
import { actorLabel } from './admin.util';

/** ClickUp webhook registration + delivery-recovery actions under `/admin`. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminWebhooksController {
  private readonly logger = new Logger(AdminWebhooksController.name);

  constructor(
    private readonly queues: QueueService,
    private readonly webhooks: ClickupWebhooksService,
    private readonly webhookEvents: WebhookEventsRepository,
    private readonly webhookParser: WebhookParserService,
    private readonly settings: SettingsService,
  ) {}

  @Post('webhooks/register')
  @Roles(Role.OWNER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Register NestJS webhook with ClickUp — idempotent; stores the signing secret encrypted on first creation' })
  async registerWebhook(@CurrentUser() user: AuthPrincipal) {
    const result = await this.webhooks.register(actorLabel(user));
    if (this.settings.getPreferences().sync.backfillOnConnect) {
      try {
        const backfills = this.queues.get(QUEUES.CLICKUP_BACKFILLS);
        for (const space of CLICKUP_SPACES) {
          if (!this.settings.isSpaceEnabled(space.id)) continue;
          await backfills.add(
            JOBS.BACKFILL_CLICKUP_SPACE,
            { spaceId: space.id, lookbackDays: space.backfillLookbackDays },
            this.queues.defaultJobOptions(),
          );
        }
      } catch (err) {
        this.logger.error(`backfill-on-connect enqueue failed (webhook still registered): ${(err as Error).message}`);
      }
    }
    return result;
  }

  @Get('webhooks')
  @ApiOperation({ summary: 'List ClickUp webhooks actually registered for this team, with drift vs the configured event list.' })
  listWebhooks() {
    return this.webhooks.listRegistered();
  }

  @Post('webhooks/prune-stale')
  @Roles(Role.OWNER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete every registered webhook whose endpoint differs from the configured one (stale/duplicate leftovers).' })
  pruneStaleWebhooks() {
    return this.webhooks.pruneStale();
  }

  @Delete('webhooks/:id')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Delete a single ClickUp webhook by id.' })
  deleteWebhook(@Param('id') id: string) {
    return this.webhooks.deleteById(id);
  }

  @Post('webhooks/retry-failed')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-enqueue every webhook event with status=failed back onto the clickup-webhooks queue.' })
  async retryFailedWebhooks(@Query('limit') limitParam?: string) {
    const limit = Math.min(Number(limitParam) || 500, 2000);
    const failed = await this.webhookEvents.findFailed(limit);
    let requeued = 0;
    const queue = this.queues.get(QUEUES.CLICKUP_WEBHOOKS);
    for (const row of failed) {
      // Re-parse the raw payload so we pick up any parser improvements made
      // since the event was first received — and so we don't have to
      // shape-match what the worker expects in two places.
      const parsed = this.webhookParser.parse(row.rawPayload);
      await queue.add(JOBS.PROCESS_CLICKUP_EVENT, parsed, this.queues.webhookJobOptions());
      // Clear the failed marker so this attempt can be observed.
      await this.webhookEvents.markRequeued(row.fingerprint).catch(() => undefined);
      requeued += 1;
    }
    return { requeued, scanned: failed.length, limit };
  }
}

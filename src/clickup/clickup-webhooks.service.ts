import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickupClient } from './clickup.client';

export type RegisterWebhookResult =
  | { action: 'existing'; webhookId: string; endpoint: string }
  | { action: 'created'; webhookId: string; secret: string; endpoint: string };

@Injectable()
export class ClickupWebhooksService {
  private readonly logger = new Logger(ClickupWebhooksService.name);

  constructor(
    private readonly client: ClickupClient,
    private readonly config: ConfigService,
  ) {}

  async register(): Promise<RegisterWebhookResult> {
    const teamId = this.config.get<string>('CLICKUP_TEAM_ID', '3450636');
    const endpoint = this.config.get<string>('CLICKUP_WEBHOOK_ENDPOINT', '');
    const eventsRaw = this.config.get<string>('CLICKUP_WEBHOOK_EVENTS', 'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated');
    const events = eventsRaw.split(',').map((e) => e.trim()).filter(Boolean);

    const existing = await this.client.getWebhooks(teamId);
    const active = existing.find((w) => w.endpoint === endpoint && w.health?.status === 'active');

    if (active) {
      this.logger.log(`Webhook already registered: ${active.id}`);
      return { action: 'existing', webhookId: active.id, endpoint: active.endpoint ?? endpoint };
    }

    const created = await this.client.createWebhook(teamId, endpoint, events);
    this.logger.log(`New webhook registered: ${created.id}. Save the returned secret to CLICKUP_WEBHOOK_SECRET in .env and restart.`);
    return { action: 'created', webhookId: created.id, secret: created.secret, endpoint };
  }
}

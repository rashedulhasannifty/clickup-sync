import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from './clickup.client';
import { SettingsService } from '../settings/settings.service';

export type RegisterWebhookResult =
  | { action: 'existing'; webhookId: string; endpoint: string }
  | { action: 'created'; webhookId: string; endpoint: string; secretStored: boolean };

@Injectable()
export class ClickupWebhooksService {
  private readonly logger = new Logger(ClickupWebhooksService.name);

  constructor(
    private readonly client: ClickupClient,
    private readonly settings: SettingsService,
  ) {}

  async register(actor?: string): Promise<RegisterWebhookResult> {
    const teamId = this.settings.getTeamId();
    const endpoint = this.settings.getWebhookEndpoint();
    const events = this.settings
      .getWebhookEvents()
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    const existing = await this.client.getWebhooks(teamId);
    const active = existing.find((w) => w.endpoint === endpoint && w.health?.status === 'active');

    if (active) {
      this.logger.log(`Webhook already registered: ${active.id}`);
      return { action: 'existing', webhookId: active.id, endpoint: active.endpoint ?? endpoint };
    }

    const created = await this.client.createWebhook(teamId, endpoint, events);

    // Persist the secret ClickUp returned so signature verification works
    // immediately — no copy-paste into .env, no restart.
    let secretStored = false;
    if (created.secret) {
      try {
        await this.settings.setWebhookSecret(created.secret, actor);
        secretStored = true;
      } catch (err) {
        this.logger.error(
          `Webhook ${created.id} created but the secret could not be stored (${(err as Error).message}). ` +
            'Set APP_ENCRYPTION_KEY so the secret can be saved.',
        );
      }
    }

    this.logger.log(`New webhook registered: ${created.id}. Secret stored: ${secretStored}.`);
    return { action: 'created', webhookId: created.id, endpoint, secretStored };
  }
}

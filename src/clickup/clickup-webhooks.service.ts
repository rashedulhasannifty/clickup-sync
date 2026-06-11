import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from './clickup.client';
import { SettingsService } from '../settings/settings.service';

export type RegisterWebhookResult =
  | { action: 'existing'; webhookId: string; endpoint: string }
  | { action: 'updated'; webhookId: string; endpoint: string; events: string[]; addedEvents: string[] }
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
    // Match by endpoint regardless of health: a stale/failing webhook still
    // needs its events corrected and reactivating, not a duplicate alongside it.
    const match = existing.find((w) => w.endpoint === endpoint);

    if (match) {
      const current = [...(match.events ?? [])].sort();
      const desired = [...events].sort();
      const sameEvents = current.length === desired.length && current.every((e, i) => e === desired[i]);
      const healthy = match.health?.status === 'active';
      if (sameEvents && healthy) {
        this.logger.log(`Webhook already registered and up to date: ${match.id}`);
        return { action: 'existing', webhookId: match.id, endpoint: match.endpoint ?? endpoint };
      }
      // Re-subscribe in place. ClickUp's PUT keeps the existing signing secret,
      // so verification is unaffected and there's no delivery gap.
      await this.client.updateWebhook(match.id, { endpoint, events, status: 'active' });
      const addedEvents = desired.filter((e) => !current.includes(e));
      this.logger.log(
        `Webhook ${match.id} updated. Events: [${events.join(', ')}]` +
          (addedEvents.length ? ` (added: ${addedEvents.join(', ')})` : ''),
      );
      return { action: 'updated', webhookId: match.id, endpoint, events, addedEvents };
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

import { Injectable, Logger } from '@nestjs/common';
import { ClickupClient } from './clickup.client';
import { SettingsService } from '../settings/settings.service';

export type RegisterWebhookResult =
  | { action: 'existing'; webhookId: string; endpoint: string }
  | { action: 'updated'; webhookId: string; endpoint: string; events: string[]; addedEvents: string[] }
  | { action: 'created'; webhookId: string; endpoint: string; secretStored: boolean };

export interface RegisteredWebhook {
  id: string;
  endpoint: string | null;
  events: string[];
  health: { status: string; failCount: number } | null;
  missingEvents: string[];
  extraEvents: string[];
}

export interface ListRegisteredResult {
  desiredEvents: string[];
  configuredEndpoint: string;
  webhooks: RegisteredWebhook[];
}

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

  /**
   * Read-only view of the webhooks ClickUp actually has registered for this
   * team, plus drift against the configured (desired) event list. The Settings
   * "desired events" checkboxes only take effect once `register()` pushes them
   * to ClickUp, so this surfaces the gap between intent and live registration.
   */
  async listRegistered(): Promise<ListRegisteredResult> {
    const teamId = this.settings.getTeamId();
    const configuredEndpoint = this.settings.getWebhookEndpoint();
    const desiredEvents = this.settings
      .getWebhookEvents()
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    const desiredSet = new Set(desiredEvents);

    const webhooks = await this.client.getWebhooks(teamId);
    return {
      desiredEvents,
      configuredEndpoint,
      webhooks: webhooks.map((w) => {
        const events = w.events ?? [];
        const eventSet = new Set(events);
        return {
          id: w.id,
          endpoint: w.endpoint ?? null,
          events,
          health: w.health ? { status: w.health.status, failCount: w.health.fail_count } : null,
          missingEvents: desiredEvents.filter((e) => !eventSet.has(e)),
          extraEvents: events.filter((e) => !desiredSet.has(e)),
        };
      }),
    };
  }

  /**
   * Force a fresh signing secret by deleting the webhook currently at the
   * configured endpoint (if any) and registering anew. `register()` alone only
   * PUT-reactivates an existing match and KEEPS its secret — useless against a
   * 401 signature mismatch that keeps a webhook suspended. This is the one-call
   * manual equivalent of the auto-heal's delete+recreate escalation
   * (`webhook-health.service.ts`). Surfaces `rotated: false` when register comes
   * back non-`created` (the delete hadn't propagated / a match reappeared), so
   * the caller isn't told a rotation happened when the old secret was kept.
   */
  async rotate(actor?: string): Promise<{ deletedId: string | null; rotated: boolean; result: RegisterWebhookResult }> {
    const teamId = this.settings.getTeamId();
    const endpoint = this.settings.getWebhookEndpoint();
    const existing = await this.client.getWebhooks(teamId);
    const match = existing.find((w) => w.endpoint === endpoint);
    let deletedId: string | null = null;
    if (match) {
      await this.client.deleteWebhook(match.id);
      deletedId = match.id;
      this.logger.log(`Rotate: deleted webhook ${match.id} at ${endpoint}`);
    }
    const result = await this.register(actor);
    const rotated = result.action === 'created';
    if (!rotated) {
      this.logger.warn(
        `Rotate did not issue a fresh secret: register returned '${result.action}' ` +
          '(a webhook still matched the endpoint after delete). Old secret retained.',
      );
    }
    return { deletedId, rotated, result };
  }

  /** Delete a single ClickUp webhook by id. */
  async deleteById(id: string): Promise<{ deleted: true; id: string }> {
    await this.client.deleteWebhook(id);
    this.logger.log(`Deleted ClickUp webhook ${id}`);
    return { deleted: true, id };
  }

  /**
   * Delete every registered webhook whose endpoint does NOT match the
   * configured one — i.e. stale/duplicate leftovers (dead tunnels, old
   * subdomains) that ClickUp still fan-outs every event to. Leaves the
   * configured webhook untouched. Returns the deleted webhooks.
   */
  async pruneStale(): Promise<{ deleted: { id: string; endpoint: string | null }[] }> {
    const teamId = this.settings.getTeamId();
    const configuredEndpoint = this.settings.getWebhookEndpoint();
    const webhooks = await this.client.getWebhooks(teamId);
    const stale = webhooks.filter((w) => (w.endpoint ?? null) !== configuredEndpoint);
    for (const w of stale) {
      await this.client.deleteWebhook(w.id);
    }
    if (stale.length) {
      this.logger.log(`Pruned ${stale.length} stale webhook(s): ${stale.map((w) => w.id).join(', ')}`);
    }
    return { deleted: stale.map((w) => ({ id: w.id, endpoint: w.endpoint ?? null })) };
  }
}

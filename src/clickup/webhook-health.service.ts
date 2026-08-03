import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ClickupWebhooksService } from './clickup-webhooks.service';
import { EndpointProbe } from './endpoint-probe';
import { AuditLogRepository } from '../admin/audit-log.repository';

@Injectable()
export class WebhookHealthService {
  private readonly logger = new Logger(WebhookHealthService.name);
  private static readonly MAX_HEALS_PER_HOUR = 3;
  // Once in-place reactivation has failed to stick MAX_HEALS_PER_HOUR times, we
  // escalate to a secret-rotating delete+recreate — but bound THAT to a couple
  // per day per endpoint. If a recreate also fails to stick (e.g. the new secret
  // can't be persisted), this cap stops the loop from churning webhooks all day.
  private static readonly MAX_RECREATES_PER_DAY = 2;
  private static readonly HOUR_MS = 60 * 60 * 1000;
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;
  // In-memory heal timestamps — a best-effort anti-flap valve. Resets on restart
  // / is per-instance; acceptable because register() is idempotent. Reactivations
  // are keyed by webhook id; recreates by the stable endpoint (a recreate mints a
  // new id, so an id key would reset the recreate cap and defeat its purpose).
  private readonly healAttempts = new Map<string, number[]>();
  private readonly recreateAttempts = new Map<string, number[]>();
  // Endpoints for which we've already logged the "exhausted, needs a human"
  // error, so the 15-min cron doesn't repeat it ~96×/day. Cleared on any
  // successful heal action for that endpoint.
  private readonly exhaustedLogged = new Set<string>();

  constructor(
    private readonly webhooks: ClickupWebhooksService,
    private readonly auditLog: AuditLogRepository,
    private readonly config: ConfigService,
    private readonly probe: EndpointProbe,
  ) {}

  // 6-field, seconds-first: sec=0, min=*/15 → fires at :00 :15 :30 :45.
  @Cron('0 */15 * * * *')
  async checkAndHeal(): Promise<void> {
    try {
      // ConfigService may hand back the raw env string ("false" is truthy), so
      // normalize both representations rather than trusting a boolean.
      const raw = this.config.get('WEBHOOK_AUTOHEAL_ENABLED', true);
      const enabled = raw === true || raw === 'true';
      if (!enabled) return;

      const { configuredEndpoint, webhooks } = await this.webhooks.listRegistered();
      const target = webhooks.find((w) => w.endpoint === configuredEndpoint);
      // Only 'suspended' needs us: ClickUp stops delivering to a suspended webhook
      // and it will NOT self-recover (reactivation requires PUT status:active). A
      // 'failing' webhook still receives events and auto-returns to 'active' once a
      // delivery succeeds, so leave it alone.
      // https://developer.clickup.com/docs/webhookhealth
      if (!target || target.health?.status !== 'suspended') {
        this.logger.debug('Configured webhook is not suspended; nothing to heal');
        return;
      }

      const failCount = target.health.failCount;

      // Path 1 — in-place reactivation (PUT status:active). Cheap, no delivery
      // gap, keeps the existing signing secret. The first choice while it works.
      // Probe only ahead of an actual write so the give-up paths below stay
      // side-effect-free (no outbound GET on every tick once we've given up).
      if (this.countInWindow(this.healAttempts, target.id, WebhookHealthService.HOUR_MS) < WebhookHealthService.MAX_HEALS_PER_HOUR) {
        if (!(await this.reachable(configuredEndpoint, target.id))) return;
        const result = await this.webhooks.register();
        if (result.action === 'existing') {
          this.logger.debug(`Webhook ${target.id} self-recovered before heal; skipping audit`);
          return;
        }
        this.record(this.healAttempts, target.id);
        this.exhaustedLogged.delete(configuredEndpoint);
        this.logger.log(`Auto-healed suspended webhook ${target.id} (failCount ${failCount})`);
        await this.writeAudit({ webhookId: target.id, previousStatus: 'suspended', failCount });
        return;
      }

      // Path 2 — reactivation isn't sticking: ClickUp keeps re-suspending after a
      // PUT (typically a 401 signing-secret mismatch, which PUT can't fix because
      // it never rotates the secret). Escalate to delete+recreate to issue a fresh
      // secret. Bounded per endpoint so a recreate that ALSO fails to stick (e.g.
      // the new secret can't be persisted) can't churn webhooks indefinitely.
      if (this.countInWindow(this.recreateAttempts, configuredEndpoint, WebhookHealthService.DAY_MS) >= WebhookHealthService.MAX_RECREATES_PER_DAY) {
        // Log the exhausted state once per endpoint, not every 15 minutes for a
        // day. Cleared when any heal action succeeds (Path 1 or a real recreate).
        if (!this.exhaustedLogged.has(configuredEndpoint)) {
          this.exhaustedLogged.add(configuredEndpoint);
          this.logger.error(
            `Auto-heal exhausted for ${configuredEndpoint}: reactivation didn't stick and the daily recreate cap ` +
              `(${WebhookHealthService.MAX_RECREATES_PER_DAY}) is reached. The freshly-issued secret likely isn't ` +
              'persisting (check APP_ENCRYPTION_KEY) or the endpoint returns a persistent 5xx/410. Manual intervention required.',
          );
        }
        return;
      }

      if (!(await this.reachable(configuredEndpoint, target.id))) return;
      // Delete first, then register — with no endpoint match remaining, register()
      // creates a brand-new webhook and stores the fresh secret it returns.
      this.record(this.recreateAttempts, configuredEndpoint);
      await this.webhooks.deleteById(target.id);
      const created = await this.webhooks.register();
      if (created.action !== 'created') {
        // The delete didn't take (ClickUp list eventual-consistency, or a
        // concurrent instance re-registered), so register() found a match and
        // PUT-reactivated with the OLD secret. No rotation happened — do NOT
        // claim one. The recreate slot is spent; we retry on a later tick.
        this.logger.warn(
          `Recreate for ${configuredEndpoint} did not rotate: register returned '${created.action}' ` +
            '(a webhook still matched after delete). Old secret retained; will retry.',
        );
        await this.writeAudit({ webhookId: created.webhookId, previousStatus: 'suspended', failCount, action: 'recreate-noop' });
        return;
      }
      this.exhaustedLogged.delete(configuredEndpoint);
      if (!created.secretStored) {
        this.logger.error(
          `Recreated webhook ${created.webhookId} but its secret could NOT be stored — ClickUp will 401 and re-suspend. ` +
            'Set a valid APP_ENCRYPTION_KEY so the signing secret persists.',
        );
      } else {
        this.logger.log(`Rotated suspended webhook ${target.id} → ${created.webhookId} (deleted + recreated, fresh secret)`);
      }
      await this.writeAudit({ webhookId: created.webhookId, previousStatus: 'suspended', failCount, action: 'recreated', secretStored: created.secretStored });
    } catch (err) {
      this.logger.error(`Webhook auto-heal run failed: ${(err as Error).message}`);
    }
  }

  private async reachable(endpoint: string, id: string): Promise<boolean> {
    const up = await this.probe.probe(endpoint);
    if (!up) this.logger.warn(`Skipping heal for webhook ${id}; endpoint still unreachable`);
    return up;
  }

  private async writeAudit(requestBody: Record<string, unknown>): Promise<void> {
    await this.auditLog.create({
      actor: 'system:webhook-autoheal',
      method: 'CRON',
      path: '/system/webhook-autoheal',
      routePattern: '/system/webhook-autoheal',
      statusCode: 200,
      durationMs: null,
      ip: null,
      userAgent: null,
      requestBody,
      errorMessage: null,
    });
  }

  private countInWindow(map: Map<string, number[]>, key: string, windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    const recent = (map.get(key) ?? []).filter((t) => t >= cutoff);
    map.set(key, recent);
    return recent.length;
  }

  private record(map: Map<string, number[]>, key: string): void {
    const recent = map.get(key) ?? [];
    recent.push(Date.now());
    map.set(key, recent);
  }
}

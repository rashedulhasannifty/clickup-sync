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
  private static readonly HOUR_MS = 60 * 60 * 1000;
  // In-memory, per-webhook heal timestamps — a best-effort anti-flap valve.
  // Resets on restart / is per-instance; acceptable because register() is idempotent.
  private readonly healAttempts = new Map<string, number[]>();

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

      if (this.attemptsInLastHour(target.id) >= WebhookHealthService.MAX_HEALS_PER_HOUR) {
        this.logger.error(
          `Auto-heal not sticking for webhook ${target.id}: it keeps re-suspending after reactivation — ` +
            'ClickUp is rejecting our deliveries (likely a 401 signing-secret mismatch, or a persistent 5xx/410). ' +
            'Reactivation keeps the existing secret (PUT never rotates it), so a stale secret cannot be fixed this way: ' +
            'delete + re-create the webhook (prune-stale, then register) to issue a fresh secret.',
        );
        return;
      }

      const reachable = await this.probe.probe(configuredEndpoint);
      if (!reachable) {
        this.logger.warn(`Skipping heal for webhook ${target.id}; endpoint still unreachable`);
        return;
      }

      const result = await this.webhooks.register();
      if (result.action === 'existing') {
        this.logger.debug(`Webhook ${target.id} self-recovered before heal; skipping audit`);
        return;
      }

      this.recordAttempt(target.id);
      this.logger.log(`Auto-healed suspended webhook ${target.id} (failCount ${failCount})`);
      await this.auditLog.create({
        actor: 'system:webhook-autoheal',
        method: 'CRON',
        path: '/system/webhook-autoheal',
        routePattern: '/system/webhook-autoheal',
        statusCode: 200,
        durationMs: null,
        ip: null,
        userAgent: null,
        requestBody: { webhookId: target.id, previousStatus: 'suspended', failCount },
        errorMessage: null,
      });
    } catch (err) {
      this.logger.error(`Webhook auto-heal run failed: ${(err as Error).message}`);
    }
  }

  private attemptsInLastHour(id: string): number {
    const cutoff = Date.now() - WebhookHealthService.HOUR_MS;
    const recent = (this.healAttempts.get(id) ?? []).filter((t) => t >= cutoff);
    this.healAttempts.set(id, recent);
    return recent.length;
  }

  private recordAttempt(id: string): void {
    const recent = this.healAttempts.get(id) ?? [];
    recent.push(Date.now());
    this.healAttempts.set(id, recent);
  }
}

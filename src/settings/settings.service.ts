import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { SettingsRepository } from './settings.repository';

const DEFAULT_TEAM_ID = '3450636';
const DEFAULT_SPIKE_HOURS_CAP = 12;
const DEFAULT_EVENTS = 'taskCreated,taskUpdated,taskDeleted,taskTimeTrackedUpdated,taskStatusUpdated';

export interface SettingsPatch {
  apiToken?: string;
  teamId?: string;
  webhookEndpoint?: string;
  webhookEvents?: string;
  webhookSecret?: string;
  spikeHoursCap?: number;
}

export interface MaskedSettings {
  apiTokenSet: boolean;
  apiTokenLast4: string | null;
  teamId: string;
  webhookEndpoint: string;
  webhookEvents: string;
  webhookSecretSet: boolean;
  spikeHoursCap: number;
  encryptionEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

interface Cache {
  apiToken: string | null;
  webhookSecret: string | null;
  teamId: string | null;
  webhookEndpoint: string | null;
  webhookEvents: string | null;
  spikeHoursCap: number | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

const EMPTY: Cache = {
  apiToken: null,
  webhookSecret: null,
  teamId: null,
  webhookEndpoint: null,
  webhookEvents: null,
  spikeHoursCap: null,
  updatedAt: null,
  updatedBy: null,
};

/**
 * Source of truth for ClickUp connection settings. Reads the single
 * `app_settings` row into an in-memory cache at boot (and after every write),
 * exposing SYNCHRONOUS getters so per-request consumers (the ClickUp client
 * headers, the webhook signature guard) stay sync.
 *
 * Resolution per field: DB value (if set) → env fallback. Existing deployments
 * keep working from env until an admin saves a value in the UI.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache: Cache = { ...EMPTY };

  constructor(
    private readonly repo: SettingsRepository,
    private readonly crypto: CryptoService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const row = await this.repo.get();
    this.cache = {
      apiToken: this.tryDecrypt(row?.clickupApiTokenEnc),
      webhookSecret: this.tryDecrypt(row?.webhookSecretEnc),
      teamId: row?.clickupTeamId ?? null,
      webhookEndpoint: row?.webhookEndpoint ?? null,
      webhookEvents: row?.webhookEvents ?? null,
      spikeHoursCap: row?.spikeHoursCap ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  private tryDecrypt(blob: string | null | undefined): string | null {
    if (!blob) return null;
    try {
      return this.crypto.decrypt(blob);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt a stored settings secret — check APP_ENCRYPTION_KEY matches the key used to encrypt it. ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ── Synchronous getters (DB → env fallback) ────────────────────────────────

  getApiToken(): string {
    return this.cache.apiToken ?? process.env.CLICKUP_API_TOKEN ?? '';
  }

  getTeamId(): string {
    return this.cache.teamId ?? process.env.CLICKUP_TEAM_ID ?? DEFAULT_TEAM_ID;
  }

  getWebhookSecret(): string {
    return this.cache.webhookSecret ?? process.env.CLICKUP_WEBHOOK_SECRET ?? '';
  }

  getWebhookEndpoint(): string {
    return this.cache.webhookEndpoint ?? process.env.CLICKUP_WEBHOOK_ENDPOINT ?? '';
  }

  getWebhookEvents(): string {
    return this.cache.webhookEvents ?? process.env.CLICKUP_WEBHOOK_EVENTS ?? DEFAULT_EVENTS;
  }

  getSpikeHoursCap(): number {
    return this.cache.spikeHoursCap ?? DEFAULT_SPIKE_HOURS_CAP;
  }

  // ── Read for the admin UI (secrets masked) ─────────────────────────────────

  getMasked(): MaskedSettings {
    const token = this.getApiToken();
    const secret = this.getWebhookSecret();
    return {
      apiTokenSet: token.length > 0,
      apiTokenLast4: token.length >= 4 ? token.slice(-4) : null,
      teamId: this.getTeamId(),
      webhookEndpoint: this.getWebhookEndpoint(),
      webhookEvents: this.getWebhookEvents(),
      webhookSecretSet: secret.length > 0,
      spikeHoursCap: this.getSpikeHoursCap(),
      encryptionEnabled: this.crypto.isEnabled,
      updatedAt: this.cache.updatedAt,
      updatedBy: this.cache.updatedBy,
    };
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  /** Update supplied fields. Secrets are only written when a non-empty value is provided. */
  async update(patch: SettingsPatch, actor?: string): Promise<MaskedSettings> {
    const data: Parameters<SettingsRepository['upsert']>[0] = { updatedBy: actor ?? null };
    if (patch.teamId !== undefined) data.clickupTeamId = patch.teamId.trim() || null;
    if (patch.webhookEndpoint !== undefined) data.webhookEndpoint = patch.webhookEndpoint.trim() || null;
    if (patch.webhookEvents !== undefined) data.webhookEvents = patch.webhookEvents.trim() || null;
    if (patch.spikeHoursCap !== undefined) data.spikeHoursCap = patch.spikeHoursCap;
    if (patch.apiToken) data.clickupApiTokenEnc = this.crypto.encrypt(patch.apiToken);
    if (patch.webhookSecret) data.webhookSecretEnc = this.crypto.encrypt(patch.webhookSecret);
    await this.repo.upsert(data);
    await this.refresh();
    return this.getMasked();
  }

  /** Persist the webhook signing secret (used by the register-webhook flow). */
  async setWebhookSecret(secret: string, actor?: string): Promise<void> {
    await this.repo.upsert({ webhookSecretEnc: this.crypto.encrypt(secret), updatedBy: actor ?? null });
    await this.refresh();
  }
}

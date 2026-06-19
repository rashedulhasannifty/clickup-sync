import { apiClient } from './client';

export interface SettingsPreferences {
  notifications: {
    alerts: { syncFail: boolean; webhookSpike: boolean; missingRate: boolean; tokenExpiring: boolean };
    channels: { email: boolean; slack: boolean; pagerduty: boolean };
  };
  sync: { reconcileLookbackDays: number; realtimeWebhooks: boolean; backfillOnConnect: boolean };
  cost: { autoRecalcOnRateChange: boolean; rateMatching: 'start' | 'due'; nonBillableZero: boolean; excludedAssignees: { id: string; name: string | null; email: string | null }[] };
  failure: { webhookRetryAttempts: number };
  spaces: Record<string, { enabled: boolean }>;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface AppSettings {
  apiTokenSet: boolean;
  apiTokenLast4: string | null;
  teamId: string;
  webhookEndpoint: string;
  webhookEvents: string;
  webhookSecretSet: boolean;
  spikeHoursCap: number;
  encryptionEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  preferences: SettingsPreferences;
  configuredSpaces: { id: string; name: string }[];
}

export interface SettingsPatch {
  apiToken?: string;
  teamId?: string;
  webhookEndpoint?: string;
  webhookEvents?: string;
  webhookSecret?: string;
  spikeHoursCap?: number;
  preferences?: DeepPartial<SettingsPreferences>;
}

export const settingsApi = {
  get: (): Promise<AppSettings> => apiClient.get('/admin/settings').then((r) => r.data),
  update: (patch: SettingsPatch): Promise<AppSettings> =>
    apiClient.patch('/admin/settings', patch).then((r) => r.data),
};

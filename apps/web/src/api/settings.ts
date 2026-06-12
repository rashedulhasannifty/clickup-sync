import { apiClient } from './client';

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
}

export interface SettingsPatch {
  apiToken?: string;
  teamId?: string;
  webhookEndpoint?: string;
  webhookEvents?: string;
  webhookSecret?: string;
  spikeHoursCap?: number;
}

export const settingsApi = {
  get: (): Promise<AppSettings> => apiClient.get('/admin/settings').then((r) => r.data),
  update: (patch: SettingsPatch): Promise<AppSettings> =>
    apiClient.patch('/admin/settings', patch).then((r) => r.data),
};

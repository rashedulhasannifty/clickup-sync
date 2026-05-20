import axios from 'axios';
import { apiClient } from './client';

export async function validateAdminKey(key: string): Promise<boolean> {
  try {
    await axios.get('/api/admin/ping', { headers: { 'x-admin-key': key } });
    return true;
  } catch {
    return false;
  }
}

export type WorkspaceMember = {
  id: string;
  name: string | null;
  email: string | null;
};

export const adminApi = {
  syncTask: (taskId: string) => apiClient.post('/admin/tasks/sync', { taskId }).then(r => r.data),
  backfill: (spaceId: string, lookbackDays?: number) =>
    apiClient.post('/admin/backfill', { spaceId, lookbackDays }).then(r => r.data),
  syncAllTimeEntries: (lookbackDays?: number) =>
    apiClient.post('/admin/time-entries/sync-all', undefined, {
      params: lookbackDays ? { lookbackDays } : undefined,
    }).then(r => r.data as { queued: number }),
  registerWebhook: () => apiClient.post('/admin/webhooks/register').then(r => r.data),
  retryDeadLetter: (id: string) => apiClient.post(`/admin/dead-letters/${id}/retry`).then(r => r.data),
  workspaceMembers: (): Promise<WorkspaceMember[]> => apiClient.get('/admin/workspace-members').then(r => r.data),
};

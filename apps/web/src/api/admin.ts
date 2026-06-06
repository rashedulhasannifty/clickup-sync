import { apiClient } from './client';

export type WorkspaceMember = {
  id: string;
  name: string | null;
  email: string | null;
};

export type ActiveBackfill = {
  spaceId: string;
  phase: 'fetching' | 'time-entries';
  total: number | null;
  done: number | null;
  remaining: number;
};

export const adminApi = {
  syncTask: (taskId: string) => apiClient.post('/admin/tasks/sync', { taskId }).then(r => r.data),
  backfill: (spaceId: string, lookbackDays?: number) =>
    apiClient.post('/admin/backfill', { spaceId, lookbackDays }).then(r => r.data),
  backfillActive: (): Promise<ActiveBackfill[]> =>
    apiClient.get('/admin/backfill/active').then((r) => (Array.isArray(r.data?.spaces) ? r.data.spaces : [])),
  syncAllTimeEntries: (lookbackDays?: number) =>
    apiClient.post('/admin/time-entries/sync-all', undefined, {
      params: lookbackDays ? { lookbackDays } : undefined,
    }).then(r => r.data as { queued: number }),
  registerWebhook: () => apiClient.post('/admin/webhooks/register').then(r => r.data),
  retryFailedWebhooks: () =>
    apiClient
      .post('/admin/webhooks/retry-failed')
      .then((r) => r.data as { requeued: number; scanned: number; limit: number }),
  retryDeadLetter: (id: string) => apiClient.post(`/admin/dead-letters/${id}/retry`).then(r => r.data),
  workspaceMembers: (): Promise<WorkspaceMember[]> => apiClient.get('/admin/workspace-members').then(r => r.data),
};

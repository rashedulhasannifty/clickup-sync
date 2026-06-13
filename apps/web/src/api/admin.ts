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

export type ReconcileProgress = {
  active: boolean;
  total: number;
  done: number;
  remaining: number;
};

export type DeadLetterJob = {
  id: string;
  queueName: string;
  jobName: string;
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
  failedAt: string;
  retriedAt: string | null;
  attemptsMade: number | null;
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
  reconcileTasks: (lookbackDays?: number) =>
    apiClient.post('/admin/tasks/reconcile', undefined, {
      params: lookbackDays ? { lookbackDays } : undefined,
    }).then(r => r.data as { queued: number }),
  reconcileActive: (): Promise<ReconcileProgress> =>
    apiClient.get('/admin/tasks/reconcile/active').then(r => r.data as ReconcileProgress),
  registerWebhook: () => apiClient.post('/admin/webhooks/register').then(r => r.data),
  retryFailedWebhooks: () =>
    apiClient
      .post('/admin/webhooks/retry-failed')
      .then((r) => r.data as { requeued: number; scanned: number; limit: number }),
  deadLetters: (limit = 50, offset = 0): Promise<{ items: DeadLetterJob[]; total: number }> =>
    apiClient
      .get('/admin/dead-letters', { params: { limit, offset } })
      .then((r) => ({ items: Array.isArray(r.data?.items) ? r.data.items : [], total: r.data?.total ?? 0 })),
  retryDeadLetter: (id: string) =>
    apiClient.post(`/admin/dead-letters/${id}/retry`).then((r) => r.data as { requeued: boolean; id: string }),
  resolveDeadLetter: (id: string) =>
    apiClient.post(`/admin/dead-letters/${id}/resolve`).then((r) => r.data as { resolved: boolean; id: string }),
  workspaceMembers: (): Promise<WorkspaceMember[]> => apiClient.get('/admin/workspace-members').then(r => r.data),
};

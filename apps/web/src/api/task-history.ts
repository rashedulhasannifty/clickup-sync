import { apiClient } from './client';

export type HistoryItem =
  | { kind: 'job'; id: string; at: string | null; queueName: string; jobName: string; status: string; error: string | null }
  | { kind: 'event'; id: string; at: string; eventType: string; changedByUserName: string | null; before: unknown; after: unknown };

export const taskHistoryApi = {
  get: (taskId: string): Promise<HistoryItem[]> =>
    apiClient.get(`/admin/tasks/${encodeURIComponent(taskId)}/history`).then((r) => r.data),
};

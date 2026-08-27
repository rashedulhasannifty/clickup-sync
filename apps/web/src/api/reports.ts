import { apiClient } from './client';
import type { CostTrendBucket } from '../hooks/useReports';

export const reportsApi = {
  tasksSummary: () => apiClient.get('/reports/tasks/summary').then(r => r.data),
  tasksBySpaceStatus: () => apiClient.get('/reports/tasks/by-space-status').then(r => r.data),
  tasksAssignees: () => apiClient.get('/reports/tasks/assignees').then(r => r.data),
  timeEntriesAssignees: () => apiClient.get('/reports/time-entries/assignees').then(r => r.data),
  clients: () => apiClient.get('/reports/clients').then(r => r.data),
  lists: (params?: { spaceId?: string }) =>
    apiClient.get('/reports/lists', { params }).then(r => r.data),
  folders: (params?: { spaceId?: string }) =>
    apiClient.get('/reports/folders', { params }).then(r => r.data),
  tasks: (params: Record<string, string | number | undefined>) =>
    apiClient.get('/reports/tasks', { params }).then(r => r.data),
  taskDescription: (taskId: string): Promise<{ description: string | null; markdownDescription: string | null } | null> =>
    apiClient.get(`/reports/tasks/${encodeURIComponent(taskId)}/description`).then(r => r.data),
  timeEntriesByUser: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/by-user', { params }).then(r => r.data),
  overviewDeltas: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/overview-deltas', { params }).then(r => r.data),
  timeEntriesByClient: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/by-client', { params }).then(r => r.data),
  costTrend: (params: { bucket: CostTrendBucket; from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/cost-trend', { params }).then(r => r.data),
  costTrendByAssignee: (params: { bucket: CostTrendBucket; from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/cost-trend-by-assignee', { params }).then(r => r.data),
  costTrendByClient: (params: { bucket: CostTrendBucket; from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/cost-trend-by-client', { params }).then(r => r.data),
  timeEntriesByDepartment: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/by-department', { params }).then(r => r.data),
  timeEntriesList: (params: Record<string, string | number | undefined>) =>
    apiClient.get('/reports/time-entries', { params }).then(r => r.data),
  timeEntriesAggregates: (params: Record<string, string | number | undefined>) =>
    apiClient.get('/reports/time-entries/aggregates', { params }).then(r => r.data),
  timeEntriesByTask: (params: Record<string, string | number | undefined>) =>
    apiClient.get('/reports/time-entries/by-task', { params }).then(r => r.data),
  sprintPoints: (params?: { spaceId?: string }) =>
    apiClient.get('/reports/sprint-points', { params }).then(r => r.data),
  syncHealth: () => apiClient.get('/reports/ops/sync-health').then(r => r.data),
  webhookEvents: (params?: { limit?: number; offset?: number; status?: string; eventType?: string; search?: string }) =>
    apiClient.get('/reports/ops/webhook-events', { params }).then(r => r.data),
  jobLogs: (params?: { queueName?: string; status?: string; limit?: number; offset?: number }) =>
    apiClient.get('/reports/ops/job-logs', { params }).then(r => r.data),
  stats: () => apiClient.get('/reports/ops/stats').then(r => r.data),
  missingRates: () => apiClient.get('/reports/ops/missing-rates').then(r => r.data),
  anomalies: () => apiClient.get('/reports/anomalies').then(r => r.data),
  hourSpikes: (params?: { from?: string; to?: string; limit?: number; includeResolved?: boolean }) =>
    apiClient.get('/reports/time-entries/hour-spikes', { params }).then(r => r.data),
  spaces: () => apiClient.get('/reports/spaces').then(r => r.data),
  timesheet: (params: { userId: string; from?: string; to?: string }) =>
    apiClient.get('/reports/timesheet', { params }).then(r => r.data),
  sprints: (params: Record<string, string | number | undefined>) =>
    apiClient.get('/reports/sprints', { params }).then((r) => r.data),
  sprintFolders: (params?: { spaceId?: string }) =>
    apiClient.get('/reports/sprints/folders', { params }).then((r) => r.data),
  sprintVelocity: (params: { folderId: string; limit?: number }) =>
    apiClient.get('/reports/sprints/velocity', { params }).then((r) => r.data),
  sprintDetail: (listId: string) =>
    apiClient.get(`/reports/sprints/${listId}`).then((r) => r.data),
};

export interface CycleTimeItem { bucket: string; meanHours: number; medianHours: number; p90Hours: number; taskCount: number; }
export interface TimeInStatusItem { status: string; color: string | null; totalHours: number; taskCount: number; }
export interface ReportMeta { minOccurredAt: string | null; }

export const cycleTimeApi = {
  cycleTime: (params: { from?: string; to?: string; groupBy?: 'week' | 'client' | 'department' } = {}): Promise<{ items: CycleTimeItem[]; meta: ReportMeta }> =>
    apiClient.get('/reports/cycle-time', { params }).then(r => r.data),
  timeInStatus: (params: { from?: string; to?: string } = {}): Promise<{ items: TimeInStatusItem[]; meta: ReportMeta }> =>
    apiClient.get('/reports/time-in-status', { params }).then(r => r.data),
};

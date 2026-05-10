import { apiClient } from './client';

export const reportsApi = {
  tasksSummary: () => apiClient.get('/reports/tasks/summary').then(r => r.data),
  tasksBySpaceStatus: () => apiClient.get('/reports/tasks/by-space-status').then(r => r.data),
  tasks: (params: Record<string, string | number | undefined>) =>
    apiClient.get('/reports/tasks', { params }).then(r => r.data),
  timeEntriesByUser: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/by-user', { params }).then(r => r.data),
  timeEntriesByClient: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/by-client', { params }).then(r => r.data),
  timeEntriesByDepartment: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/by-department', { params }).then(r => r.data),
  timeEntriesBillableSummary: (params?: { from?: string; to?: string }) =>
    apiClient.get('/reports/time-entries/billable-summary', { params }).then(r => r.data),
  timeEntriesList: (params: Record<string, string | number | undefined>) =>
    apiClient.get('/reports/time-entries', { params }).then(r => r.data),
  sprintPoints: (params?: { spaceId?: string }) =>
    apiClient.get('/reports/sprint-points', { params }).then(r => r.data),
  syncHealth: () => apiClient.get('/reports/ops/sync-health').then(r => r.data),
  webhookEvents: (params?: { limit?: number; offset?: number }) =>
    apiClient.get('/reports/ops/webhook-events', { params }).then(r => r.data),
  jobLogs: (params?: { queueName?: string; status?: string; limit?: number; offset?: number }) =>
    apiClient.get('/reports/ops/job-logs', { params }).then(r => r.data),
  deadLetters: (params?: { limit?: number; offset?: number }) =>
    apiClient.get('/reports/ops/dead-letters', { params }).then(r => r.data),
  stats: () => apiClient.get('/reports/ops/stats').then(r => r.data),
  missingRates: () => apiClient.get('/reports/ops/missing-rates').then(r => r.data),
  spaces: () => apiClient.get('/reports/spaces').then(r => r.data),
  assigneeRates: (params?: { page?: number; limit?: number }) =>
    apiClient.get('/admin/rates', { params }).then(r => r.data),
};

import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api/reports';
import { useGlobalFilters } from './useGlobalFilters';

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: reportsApi.stats });
}

export function useTasksSummary() {
  return useQuery({ queryKey: ['tasks-summary'], queryFn: reportsApi.tasksSummary });
}

export function useTasksBySpaceStatus() {
  return useQuery({ queryKey: ['tasks-by-space-status'], queryFn: reportsApi.tasksBySpaceStatus });
}

export function useTasks(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => reportsApi.tasks(params),
  });
}

export function useTimeEntriesByUser() {
  const { fromDate, toDate } = useGlobalFilters();
  return useQuery({
    queryKey: ['time-entries-by-user', fromDate, toDate],
    queryFn: () => reportsApi.timeEntriesByUser({ from: fromDate, to: toDate }),
  });
}

export function useTimeEntriesByClient() {
  const { fromDate, toDate } = useGlobalFilters();
  return useQuery({
    queryKey: ['time-entries-by-client', fromDate, toDate],
    queryFn: () => reportsApi.timeEntriesByClient({ from: fromDate, to: toDate }),
  });
}

export function useTimeEntriesByDepartment() {
  const { fromDate, toDate } = useGlobalFilters();
  return useQuery({
    queryKey: ['time-entries-by-dept', fromDate, toDate],
    queryFn: () => reportsApi.timeEntriesByDepartment({ from: fromDate, to: toDate }),
  });
}

export function useTimeEntriesBillableSummary() {
  const { fromDate, toDate } = useGlobalFilters();
  return useQuery({
    queryKey: ['billable-summary', fromDate, toDate],
    queryFn: () => reportsApi.timeEntriesBillableSummary({ from: fromDate, to: toDate }),
  });
}

export function useTimeEntriesList(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['time-entries-list', params],
    queryFn: () => reportsApi.timeEntriesList(params),
  });
}

export function useSprintPoints(spaceId?: string) {
  return useQuery({
    queryKey: ['sprint-points', spaceId],
    queryFn: () => reportsApi.sprintPoints({ spaceId }),
  });
}

export function useSyncHealth() {
  return useQuery({
    queryKey: ['sync-health'],
    queryFn: reportsApi.syncHealth,
    refetchInterval: 60_000,
  });
}

export function useWebhookEvents(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['webhook-events', params],
    queryFn: () => reportsApi.webhookEvents(params),
  });
}

export function useJobLogs(params?: { queueName?: string; status?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['job-logs', params],
    queryFn: () => reportsApi.jobLogs(params),
  });
}

export function useDeadLetters(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['dead-letters', params],
    queryFn: () => reportsApi.deadLetters(params),
  });
}

export function useMissingRates() {
  return useQuery({ queryKey: ['missing-rates'], queryFn: reportsApi.missingRates });
}

export function useSpaces() {
  return useQuery({ queryKey: ['spaces'], queryFn: reportsApi.spaces });
}

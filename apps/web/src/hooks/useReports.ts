import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { adminApi, type SpikeNoticePreview } from '../api/admin';
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

export function useTasksAssignees() {
  return useQuery({ queryKey: ['tasks-assignees'], queryFn: reportsApi.tasksAssignees });
}

export interface TimeEntryAssignee { id: string; name: string | null; email: string | null; }

export function useTimeEntriesAssignees() {
  return useQuery<TimeEntryAssignee[]>({
    queryKey: ['time-entries-assignees'],
    queryFn: reportsApi.timeEntriesAssignees,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClients() {
  return useQuery({ queryKey: ['clients'], queryFn: reportsApi.clients });
}

export function useLists(spaceId?: string) {
  return useQuery({
    queryKey: ['lists', spaceId ?? 'all'],
    queryFn: () => reportsApi.lists(spaceId ? { spaceId } : undefined),
  });
}

export function useFolders(spaceId?: string) {
  return useQuery({
    queryKey: ['folders', spaceId ?? 'all'],
    queryFn: () => reportsApi.folders(spaceId ? { spaceId } : undefined),
  });
}

export function useTasks(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => reportsApi.tasks(params),
    // Show the previous page while the next page/filter loads instead of
    // collapsing the table back to "Loading…". `isFetching` is still true so
    // callers that want a subtle dim/spinner can opt in.
    placeholderData: keepPreviousData,
  });
}

export function useTimeEntriesByUser() {
  const { fromDate, toDate } = useGlobalFilters();
  return useQuery({
    queryKey: ['time-entries-by-user', fromDate, toDate],
    queryFn: () => reportsApi.timeEntriesByUser({ from: fromDate, to: toDate }),
  });
}

export type CostTrendBucket = 'day' | 'week' | 'month';

export interface CostTrendPoint {
  bucket: string;        // 'YYYY-MM-DD'
  totalCostAud: number;  // dollars
  totalHours: number;
  entryCount: number;
}

export function useCostTrend(
  bucket: CostTrendBucket,
  from?: string,
  to?: string,
) {
  return useQuery<CostTrendPoint[]>({
    queryKey: ['cost-trend', bucket, from || null, to || null],
    queryFn: () => reportsApi.costTrend({ bucket, from, to }),
    placeholderData: keepPreviousData,
  });
}

export interface AssigneeCostTrendPoint {
  bucket: string;
  values: Record<string, number>;
}

export interface AssigneeCostTrendData {
  buckets: string[];
  assignees: string[];
  points: AssigneeCostTrendPoint[];
}

export function useAssigneeCostTrend(
  bucket: CostTrendBucket,
  from?: string,
  to?: string,
) {
  return useQuery<AssigneeCostTrendData>({
    queryKey: ['cost-trend-by-assignee', bucket, from || null, to || null],
    queryFn: () => reportsApi.costTrendByAssignee({ bucket, from, to }),
    placeholderData: keepPreviousData,
  });
}

export interface ClientCostTrendData {
  buckets: string[];
  clients: string[];
  points: AssigneeCostTrendPoint[];
}

export function useClientCostTrend(
  bucket: CostTrendBucket,
  from?: string,
  to?: string,
  enabled = true,
) {
  return useQuery<ClientCostTrendData>({
    queryKey: ['cost-trend-by-client', bucket, from || null, to || null],
    queryFn: () => reportsApi.costTrendByClient({ bucket, from, to }),
    placeholderData: keepPreviousData,
    enabled,
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

export function useTimeEntriesList(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: ['time-entries-list', params],
    queryFn: () => reportsApi.timeEntriesList(params),
    placeholderData: keepPreviousData,
  });
}

export interface TimeEntriesAggregates {
  totalEntries: number;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  totalCostCents: number;
  avgRateCents: number;
  costCalculatedCount: number;
  noRateFoundCount: number;
}

/**
 * Aggregates across the *entire* filtered set, not just the current page.
 * The Time Entries page's metric cards (Total hours, Billable, cost, etc.)
 * should use this — computing them from the 50-row page produced misleading
 * numbers that didn't react to the date filter.
 */
export function useTimeEntriesAggregates(params: Record<string, string | number | undefined>) {
  return useQuery<TimeEntriesAggregates>({
    queryKey: ['time-entries-aggregates', params],
    queryFn: () => reportsApi.timeEntriesAggregates(params),
    placeholderData: keepPreviousData,
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

export function useWebhookEvents(params?: { limit?: number; offset?: number; status?: string; eventType?: string; search?: string }) {
  return useQuery({
    queryKey: ['webhook-events', params],
    queryFn: () => reportsApi.webhookEvents(params),
    placeholderData: keepPreviousData,
  });
}

export function useJobLogs(params?: { queueName?: string; status?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['job-logs', params],
    queryFn: () => reportsApi.jobLogs(params),
    placeholderData: keepPreviousData,
  });
}

export function useMissingRates() {
  return useQuery({ queryKey: ['missing-rates'], queryFn: reportsApi.missingRates });
}

export function useSpaces() {
  return useQuery({ queryKey: ['spaces'], queryFn: reportsApi.spaces });
}

export interface DailySpike {
  date: string;
  totalCostAud: number;
  medianAud: number;
  multiplier: number;
}

export interface ClientSpike {
  client: string;
  lastWeekCostAud: number;
  baselineMedianAud: number;
  multiplier: number;
}

export interface Anomalies {
  dailySpikes: DailySpike[];
  clientSpikes: ClientSpike[];
}

export function useAnomalies() {
  return useQuery<Anomalies>({
    queryKey: ['anomalies'],
    queryFn: () => reportsApi.anomalies(),
    // Anomalies are computed off rolling windows that don't shift often; a
    // 60s stale time keeps the panel responsive without hammering the DB.
    staleTime: 60_000,
  });
}

export interface HourSpikeWatchRow {
  userId: string;
  userName: string;
  date: string;
  hours: number;
  median: number;
  multiplier: number | null;
  rule: 'absolute' | 'relative' | 'both';
  notified: boolean;
  resolved: boolean;
}

export interface HourSpikeUserPoint { date: string; hours: number; isSpike: boolean; }
export interface HourSpikeUser { userId: string; userName: string; points: HourSpikeUserPoint[]; }

export interface HourSpikes {
  cap: number;
  watchlist: HourSpikeWatchRow[];
  watchlistTotal: number;
  byUser: { buckets: string[]; users: HourSpikeUser[] };
}

export function useHourSpikes(limit: number, includeResolved: boolean) {
  const { fromDate, toDate } = useGlobalFilters();
  return useQuery<HourSpikes>({
    queryKey: ['hour-spikes', fromDate, toDate, limit, includeResolved],
    queryFn: () => reportsApi.hourSpikes({ from: fromDate, to: toDate, limit, includeResolved }),
    placeholderData: keepPreviousData,
  });
}

/**
 * Hour-spike watchlist over a fixed trailing 7-day window, independent of the
 * topbar date filter. Used by the notification center so the spike feed is
 * stable regardless of what range the user is currently viewing. Keyed by the
 * day (not the exact timestamp) so it doesn't refetch on every render.
 */
export function useHourSpikeWatch() {
  const now = Date.now();
  const to = new Date(now).toISOString();
  const from = new Date(now - 7 * 86_400_000).toISOString();
  return useQuery<HourSpikes>({
    queryKey: ['hour-spikes-watch', from.slice(0, 10), to.slice(0, 10)],
    queryFn: () => reportsApi.hourSpikes({ from, to }),
    staleTime: 60_000,
  });
}

export function useSpikeNoticePreview(userId: string | null, date: string | null) {
  return useQuery<SpikeNoticePreview>({
    queryKey: ['spike-notice-preview', userId, date],
    queryFn: () => adminApi.spikeNoticePreview(userId as string, date as string),
    enabled: !!userId && !!date,
  });
}

export function useNotifySpike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; date: string; rule?: 'absolute' | 'relative' | 'both'; median?: number; note?: string }) =>
      adminApi.notifySpike(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hour-spikes'] }),
  });
}

export function useResolveSpike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; date: string; userName?: string; note?: string }) => adminApi.resolveSpike(body),
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (query) => {
          const k = query.queryKey[0];
          return k === 'hour-spikes' || k === 'hour-spikes-watch';
        },
      }),
  });
}

export function useUnresolveSpike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; date: string }) => adminApi.unresolveSpike(body),
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (query) => {
          const k = query.queryKey[0];
          return k === 'hour-spikes' || k === 'hour-spikes-watch';
        },
      }),
  });
}

export interface OverviewDeltas {
  current: { totalHours: number; totalCostAud: number };
  prior:   { totalHours: number; totalCostAud: number };
}

/**
 * `from`/`to` default to the global filter's range (topbar). Callers like
 * CostTrendCard pass their own range when the trend chart's window differs
 * from the topbar (e.g. weekly view with the default 12-week window).
 */
export function useOverviewDeltas(from?: string, to?: string) {
  const filters = useGlobalFilters();
  const effFrom = from ?? filters.fromDate;
  const effTo = to ?? filters.toDate;
  return useQuery<OverviewDeltas>({
    queryKey: ['overview-deltas', effFrom, effTo],
    queryFn: () => reportsApi.overviewDeltas({ from: effFrom, to: effTo }),
    placeholderData: keepPreviousData,
  });
}

import { cycleTimeApi } from '../api/reports';

export function useCycleTime(params: { from?: string; to?: string; groupBy?: 'week' | 'client' | 'department' } = {}) {
  return useQuery({
    queryKey: ['cycle-time', params],
    queryFn: () => cycleTimeApi.cycleTime(params),
    refetchInterval: 60_000,
  });
}

export function useTimeInStatus(params: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['time-in-status', params],
    queryFn: () => cycleTimeApi.timeInStatus(params),
    refetchInterval: 60_000,
  });
}

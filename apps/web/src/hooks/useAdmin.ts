import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../api/admin';

/**
 * Live per-space sync progress, driven by `GET /admin/backfill/active`.
 * Polls every 3s while *any* sync is in flight, falls back to 30s when idle so
 * we still pick up an admin starting a sync from another tab without
 * hammering the API in the steady state.
 */
export function useActiveBackfills(enabled = true) {
  return useQuery({
    queryKey: ['backfill-active'],
    queryFn: adminApi.backfillActive,
    // GET /admin/backfill/active is OWNER/ADMIN-only. Members must not poll it,
    // or every interval tick 403s forever. Callers pass enabled=hasRole('ADMIN').
    enabled,
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 3000 : 30_000),
    refetchIntervalInBackground: false,
  });
}

export function useSyncTask() {
  return useMutation({ mutationFn: (taskId: string) => adminApi.syncTask(taskId) });
}

export function useBackfill() {
  return useMutation({
    mutationFn: ({ spaceId, lookbackDays }: { spaceId: string; lookbackDays?: number }) =>
      adminApi.backfill(spaceId, lookbackDays),
  });
}

export function useSyncAllTimeEntries() {
  return useMutation({ mutationFn: (lookbackDays?: number) => adminApi.syncAllTimeEntries(lookbackDays) });
}

/**
 * Full reconciliation: sweeps every stored task, soft-deleting ones removed in
 * ClickUp (and their time entries) and re-syncing the rest's time entries so
 * deletions made directly in ClickUp are reflected locally.
 */
export function useReconcileTasks() {
  return useMutation({ mutationFn: (lookbackDays?: number) => adminApi.reconcileTasks(lookbackDays) });
}

export function useRegisterWebhook() {
  return useMutation({ mutationFn: adminApi.registerWebhook });
}

export function useRetryFailedWebhooks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.retryFailedWebhooks,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-events'] }),
  });
}

/**
 * Probes the ClickUp API by fetching workspace members through our backend.
 * If the call succeeds with at least one member, the API token + connectivity
 * are healthy. Used by Settings → Connection → Test connection.
 */
export function useTestClickupConnection() {
  return useMutation({
    mutationFn: async () => {
      const members = await adminApi.workspaceMembers();
      return { ok: members.length > 0, memberCount: members.length };
    },
  });
}

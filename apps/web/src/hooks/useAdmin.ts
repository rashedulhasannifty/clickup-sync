import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../api/admin';

export function useSyncTask() {
  return useMutation({ mutationFn: (taskId: string) => adminApi.syncTask(taskId) });
}

export function useBackfill() {
  return useMutation({
    mutationFn: ({ spaceId, lookbackDays }: { spaceId: string; lookbackDays?: number }) =>
      adminApi.backfill(spaceId, lookbackDays),
  });
}

export function useSyncRates() {
  return useMutation({ mutationFn: adminApi.syncRates });
}

export function useSyncAllTimeEntries() {
  return useMutation({ mutationFn: (lookbackDays?: number) => adminApi.syncAllTimeEntries(lookbackDays) });
}

export function useRegisterWebhook() {
  return useMutation({ mutationFn: adminApi.registerWebhook });
}

export function useRetryDeadLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.retryDeadLetter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dead-letters'] }),
  });
}

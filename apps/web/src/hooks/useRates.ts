import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ratesApi } from '../api/rates';
import type { Rate } from '../api/rates';
import { adminApi } from '../api/admin';
import type { ExcludedAssignee } from '../api/admin';

export function useRates() {
  return useQuery({ queryKey: ['rates'], queryFn: ratesApi.list });
}

export function useCreateRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Rate, 'id' | 'createdAt' | 'updatedAt'>) => ratesApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });
}

export function useUpdateRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<Rate, 'id' | 'createdAt' | 'updatedAt'>> }) =>
      ratesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });
}

export function useDeleteRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ratesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });
}

export function useWorkspaceMembers() {
  return useQuery({
    queryKey: ['workspace-members'],
    queryFn: adminApi.workspaceMembers,
    staleTime: 5 * 60 * 1000,
  });
}

export function useExcludedAssignees() {
  return useQuery<ExcludedAssignee[]>({ queryKey: ['excluded-assignees'], queryFn: adminApi.excludedAssignees.get });
}

export function useUpdateExcludedAssignees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignees: ExcludedAssignee[]) => adminApi.excludedAssignees.put(assignees),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['excluded-assignees'] });
      qc.invalidateQueries({ queryKey: ['rates'] });
      qc.invalidateQueries({ queryKey: ['missing-rates'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['time-entries-list'] });
      qc.invalidateQueries({ queryKey: ['time-entries-aggregates'] });
    },
  });
}

export function useRecalcCosts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assigneeId?: string) => ratesApi.recalculate(assigneeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rates'] });
      // Time-entry views use distinct first-key strings; invalidate each
      // (React Query matches by prefix, so a bare ['time-entries'] is a no-op).
      qc.invalidateQueries({ queryKey: ['time-entries-list'] });
      qc.invalidateQueries({ queryKey: ['time-entries-by-user'] });
      qc.invalidateQueries({ queryKey: ['time-entries-by-client'] });
      qc.invalidateQueries({ queryKey: ['time-entries-by-dept'] });
      qc.invalidateQueries({ queryKey: ['billable-summary'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['missing-rates'] });
    },
  });
}

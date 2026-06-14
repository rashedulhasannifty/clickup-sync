import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { budgetsApi } from '../api/budgets';
import type { Budget } from '../api/budgets';

export function useBudgets() {
  return useQuery({ queryKey: ['budgets'], queryFn: budgetsApi.list });
}

export function useBudgetStatus(month?: string) {
  return useQuery({ queryKey: ['budget-status', month ?? 'current'], queryFn: () => budgetsApi.status(month) });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['budget-status'] });
  };
}

export function useCreateBudget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: Omit<Budget, 'id' | 'updatedAt'>) => budgetsApi.create(data),
    onSuccess: invalidate,
  });
}

export function useUpdateBudget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<Budget, 'id' | 'updatedAt'>> }) => budgetsApi.update(id, data),
    onSuccess: invalidate,
  });
}

export function useDeleteBudget() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => budgetsApi.remove(id),
    onSuccess: invalidate,
  });
}

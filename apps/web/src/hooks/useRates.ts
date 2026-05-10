import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ratesApi } from '../api/rates';
import type { Rate } from '../api/rates';

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

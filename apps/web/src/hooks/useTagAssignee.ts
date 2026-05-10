import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tagAssigneeApi } from '../api/tag-assignee';
import type { TagAssignee } from '../api/tag-assignee';

export function useTagAssignee() {
  return useQuery({ queryKey: ['tag-assignee'], queryFn: tagAssigneeApi.list });
}

export function useCreateTagAssignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<TagAssignee, 'id'>) => tagAssigneeApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tag-assignee'] }),
  });
}

export function useUpdateTagAssignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<TagAssignee, 'id'>> }) =>
      tagAssigneeApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tag-assignee'] }),
  });
}

export function useDeleteTagAssignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tagAssigneeApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tag-assignee'] }),
  });
}

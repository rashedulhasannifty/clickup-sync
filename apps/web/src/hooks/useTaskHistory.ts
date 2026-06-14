import { useQuery } from '@tanstack/react-query';
import { taskHistoryApi } from '../api/task-history';

export function useTaskHistory(taskId: string | null) {
  return useQuery({
    queryKey: ['task-history', taskId],
    queryFn: () => taskHistoryApi.get(taskId as string),
    enabled: !!taskId,
  });
}

import { useQuery } from '@tanstack/react-query';
import { searchApi, type SearchResult } from '../api/search';

const EMPTY: SearchResult = { tasks: [], assignees: [] };

export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => searchApi.query(q),
    enabled: q.length >= 2,
    placeholderData: (prev) => prev ?? EMPTY,
    staleTime: 10_000,
  });
}

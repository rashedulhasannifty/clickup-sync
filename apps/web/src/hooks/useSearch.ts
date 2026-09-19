import { useQuery } from '@tanstack/react-query';
import { searchApi, type SearchResult } from '../api/search';

const EMPTY: SearchResult = { tasks: [], assignees: [] };

/** `/admin/search` is `@Roles(OWNER, ADMIN)` — gate on `isAdmin`. */
export function useSearch(query: string, isAdmin = true) {
  const q = query.trim();
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => searchApi.query(q),
    enabled: q.length >= 2 && isAdmin,
    placeholderData: (prev) => prev ?? EMPTY,
    staleTime: 10_000,
  });
}

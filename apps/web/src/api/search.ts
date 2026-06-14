import { apiClient } from './client';

export interface SearchResult {
  tasks: { taskId: string; taskName: string; status: string | null; client: string | null }[];
  assignees: { userId: string; name: string | null; email: string | null }[];
}

export const searchApi = {
  query: (q: string): Promise<SearchResult> =>
    apiClient.get('/admin/search', { params: { q } }).then((r) => r.data),
};

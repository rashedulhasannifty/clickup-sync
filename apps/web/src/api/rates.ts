import { apiClient } from './client';

export interface Rate {
  id: string;
  assigneeId: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  currency: string;
  hourlyRateCents: number;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Nest returns `{ items, total, page, limit }`; older clients may expect a bare array. */
export function parseRatesListResponse(data: unknown): Rate[] {
  if (Array.isArray(data)) return data as Rate[];
  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as { items?: unknown }).items)
  ) {
    return (data as { items: Rate[] }).items;
  }
  return [];
}

export const ratesApi = {
  list: () =>
    apiClient
      .get('/admin/rates', { params: { page: 1, limit: 200 } })
      .then((r) => parseRatesListResponse(r.data)),
  create: (data: Omit<Rate, 'id' | 'createdAt' | 'updatedAt'>) =>
    apiClient.post('/admin/rates', data).then(r => r.data as Rate),
  update: (id: string, data: Partial<Omit<Rate, 'id' | 'createdAt' | 'updatedAt'>>) =>
    apiClient.patch(`/admin/rates/${id}`, data).then(r => r.data as Rate),
  remove: (id: string) => apiClient.delete(`/admin/rates/${id}`).then(r => r.data),
};

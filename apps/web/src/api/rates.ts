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

export const ratesApi = {
  list: () => apiClient.get('/admin/rates').then(r => r.data as Rate[]),
  create: (data: Omit<Rate, 'id' | 'createdAt' | 'updatedAt'>) =>
    apiClient.post('/admin/rates', data).then(r => r.data as Rate),
  update: (id: string, data: Partial<Omit<Rate, 'id' | 'createdAt' | 'updatedAt'>>) =>
    apiClient.patch(`/admin/rates/${id}`, data).then(r => r.data as Rate),
  remove: (id: string) => apiClient.delete(`/admin/rates/${id}`).then(r => r.data),
};

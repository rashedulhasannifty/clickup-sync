import { apiClient } from './client';

export interface TagAssignee {
  id: string;
  tagName: string;
  clickupUserId: string;
  clickupUserName: string | null;
  clickupEmail: string | null;
  active: boolean;
}

export const tagAssigneeApi = {
  list: () => apiClient.get('/admin/tag-assignee-map').then(r => r.data as TagAssignee[]),
  create: (data: Omit<TagAssignee, 'id'>) =>
    apiClient.post('/admin/tag-assignee-map', data).then(r => r.data as TagAssignee),
  update: (id: string, data: Partial<Omit<TagAssignee, 'id'>>) =>
    apiClient.patch(`/admin/tag-assignee-map/${id}`, data).then(r => r.data as TagAssignee),
  remove: (id: string) => apiClient.delete(`/admin/tag-assignee-map/${id}`).then(r => r.data),
};

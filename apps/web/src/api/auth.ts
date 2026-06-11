import { apiClient } from './client';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';
export interface MeResponse {
  user: { id: string; email: string | null; role: Role; isMachine: boolean };
  org: { id: string; name: string };
}

export const authApi = {
  me: () => apiClient.get<MeResponse>('/auth/me').then((r) => r.data),
  login: (email: string, password: string) =>
    apiClient.post('/auth/login', { email, password }).then((r) => r.data),
  signup: (body: { email: string; password: string; name: string; orgName: string }) =>
    apiClient.post('/auth/signup', body).then((r) => r.data),
  logout: () => apiClient.post('/auth/logout').then((r) => r.data),
  previewInvite: (token: string) =>
    apiClient.get(`/auth/invitations/${token}`).then((r) => r.data as { email: string; role: Role; orgName: string }),
  acceptInvite: (token: string, name: string, password: string) =>
    apiClient.post(`/auth/invitations/${token}/accept`, { name, password }).then((r) => r.data),
};

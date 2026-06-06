import { apiClient } from './client';
import type { Role } from './auth';

export interface OrgUser {
  id: string; email: string; name: string | null; role: Role; status: 'ACTIVE' | 'DISABLED'; lastLoginAt: string | null;
}
export interface Invite { id: string; email: string; role: Role; status: string; expiresAt: string; createdAt: string; }

export const usersApi = {
  list: () => apiClient.get<OrgUser[]>('/users').then((r) => r.data),
  changeRole: (id: string, role: Role) => apiClient.patch(`/users/${id}/role`, { role }).then((r) => r.data),
  setStatus: (id: string, status: 'ACTIVE' | 'DISABLED') => apiClient.patch(`/users/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/users/${id}`).then((r) => r.data),
  transferOwnership: (targetUserId: string) => apiClient.post('/users/transfer-ownership', { targetUserId }).then((r) => r.data),
  listInvites: () => apiClient.get<Invite[]>('/invitations').then((r) => r.data),
  invite: (email: string, role: Role) => apiClient.post('/invitations', { email, role }).then((r) => r.data),
  resendInvite: (id: string) => apiClient.post(`/invitations/${id}/resend`).then((r) => r.data),
  revokeInvite: (id: string) => apiClient.post(`/invitations/${id}/revoke`).then((r) => r.data),
};

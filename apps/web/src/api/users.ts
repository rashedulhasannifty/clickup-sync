import { apiClient } from './client';
import type { Role } from './auth';
import type { TeamMemberRoleValue } from './teams';

export interface UserTeamRef { id: string; name: string; role: TeamMemberRoleValue }

export interface OrgUser {
  id: string; email: string; name: string | null; role: Role; status: 'ACTIVE' | 'DISABLED'; lastLoginAt: string | null; createdAt: string;
  clickupUserId: string | null;
  teams: UserTeamRef[];
}
export interface Invite {
  id: string; email: string; role: Role; status: string; expiresAt: string; createdAt: string;
  clickupUserId: string | null;
  teams: { teamId: string; teamName: string | null; role: TeamMemberRoleValue }[];
}

export interface InvitePayload {
  email: string;
  role: Role;
  teams?: { teamId: string; role: TeamMemberRoleValue }[];
  /** undefined = auto-match by email, null = no link, string = explicit link. */
  clickupUserId?: string | null;
}

export const usersApi = {
  list: () => apiClient.get<OrgUser[]>('/users').then((r) => r.data),
  changeRole: (id: string, role: Role) => apiClient.patch(`/users/${id}/role`, { role }).then((r) => r.data),
  setStatus: (id: string, status: 'ACTIVE' | 'DISABLED') => apiClient.patch(`/users/${id}/status`, { status }).then((r) => r.data),
  setClickupUser: (id: string, clickupUserId: string | null) =>
    apiClient.patch(`/users/${id}/clickup-user`, { clickupUserId }).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/users/${id}`).then((r) => r.data),
  transferOwnership: (targetUserId: string) => apiClient.post('/users/transfer-ownership', { targetUserId }).then((r) => r.data),
  listInvites: () => apiClient.get<Invite[]>('/invitations').then((r) => r.data),
  invite: (payload: InvitePayload) => apiClient.post('/invitations', payload).then((r) => r.data),
  resendInvite: (id: string) => apiClient.post(`/invitations/${id}/resend`).then((r) => r.data),
  revokeInvite: (id: string) => apiClient.post(`/invitations/${id}/revoke`).then((r) => r.data),
};

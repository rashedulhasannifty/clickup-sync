import { apiClient } from './client';

export type TeamMemberRoleValue = 'LEAD' | 'MEMBER';

export interface TeamClient {
  optionId: string;
  name: string;
  archived: boolean;
}

export interface TeamMemberRow {
  userId: string;
  name: string | null;
  email: string;
  role: TeamMemberRoleValue;
  clickupUserId: string | null;
}

export interface TeamPendingInvite {
  invitationId: string;
  email: string;
  role: TeamMemberRoleValue;
}

export interface Team {
  id: string;
  name: string;
  clients: TeamClient[];
  members: TeamMemberRow[];
  pendingInvites: TeamPendingInvite[];
}

export interface ClientOption {
  optionId: string;
  fieldId: string;
  name: string;
  archived: boolean;
  teamId: string | null;
  teamName: string | null;
}

export interface TeamClientsConflict {
  optionId: string;
  teamId: string;
  teamName: string;
}

export interface Readiness {
  unassignedClients: ClientOption[];
  membersWithoutTeam: { id: string; name: string | null; email: string }[];
  usersWithoutClickupLink: { id: string; name: string | null; email: string }[];
  ambiguousNames: string[];
}

export interface MyTeam {
  id: string;
  name: string;
  role: TeamMemberRoleValue;
  clients: string[];
  members: { userId: string; name: string | null; email: string; clickupUserId: string | null; role: TeamMemberRoleValue }[];
}

export interface MyTeamsResponse {
  teams: MyTeam[];
  /** Active org users not already in a team the caller leads. `[]` for non-leads (R20). */
  candidates: { id: string; name: string | null; email: string }[];
}

export const teamsApi = {
  list: () => apiClient.get<Team[]>('/teams').then((r) => r.data),
  create: (name: string, optionIds: string[]) =>
    apiClient.post<{ id: string; name: string }>('/teams', { name, optionIds }).then((r) => r.data),
  rename: (id: string, name: string) => apiClient.patch(`/teams/${id}`, { name }).then((r) => r.data),
  remove: (id: string) => apiClient.delete<{ releasedClients: number }>(`/teams/${id}`).then((r) => r.data),
  setClients: (id: string, optionIds: string[], move = false) =>
    apiClient.put(`/teams/${id}/clients`, { optionIds, move }).then((r) => r.data),
  addMember: (id: string, userId: string, role: TeamMemberRoleValue) =>
    apiClient.post(`/teams/${id}/members`, { userId, role }).then((r) => r.data),
  setRole: (id: string, userId: string, role: TeamMemberRoleValue) =>
    apiClient.patch(`/teams/${id}/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (id: string, userId: string) => apiClient.delete(`/teams/${id}/members/${userId}`).then((r) => r.data),
  clientOptions: () => apiClient.get<ClientOption[]>('/teams/client-options').then((r) => r.data),
  readiness: () => apiClient.get<Readiness>('/teams/readiness').then((r) => r.data),
  mine: () => apiClient.get<MyTeamsResponse>('/my-teams').then((r) => r.data),
  leadAddMember: (teamId: string, userId: string) =>
    apiClient.post(`/my-teams/${teamId}/members`, { userId }).then((r) => r.data),
};

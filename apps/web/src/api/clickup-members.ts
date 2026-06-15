import { apiClient } from './client';

export interface ClickupMember {
  id: string;
  name: string | null;
  email: string | null;
  profilePicture: string | null;
  color: string | null;
  initials: string | null;
}

export const clickupMembersApi = {
  list: () => apiClient.get<ClickupMember[]>('/clickup/members').then((r) => r.data),
};

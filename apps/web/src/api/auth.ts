import { apiClient } from './client';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface AccessSummary {
  scopingEnabled: boolean;
  unrestricted: boolean;
  teams: { id: string; name: string; role: 'LEAD' | 'MEMBER' }[];
  canSeeCost: boolean;
  canSeeSprints: boolean;
  canEditChargeability: boolean;
  hasClickupLink: boolean;
  timesheetUserIds: string[] | null;
}

export interface MeResponse {
  user: { id: string; email: string | null; role: Role; isMachine: boolean };
  org: { id: string; name: string };
  // Optional: an older cached response (e.g. a stale service-worker cache, or
  // a session predating this field) may not carry it. Every consumer already
  // treats a missing `access` as unrestricted rather than denied — this makes
  // the type honest about that possibility instead of lying with `access!`.
  access?: AccessSummary;
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
  forgotPassword: (email: string) =>
    apiClient.post('/auth/forgot-password', { email }).then((r) => r.data as { ok: true }),
  previewReset: (token: string) =>
    apiClient.get(`/auth/reset-password/${token}`).then((r) => r.data as { email: string }),
  resetPassword: (token: string, password: string) =>
    apiClient.post(`/auth/reset-password/${token}`, { password }).then((r) => r.data),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post('/auth/change-password', { currentPassword, newPassword }).then((r) => r.data as { ok: true }),
};

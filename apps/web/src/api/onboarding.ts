import { apiClient } from './client';
import type { DocumentCategory } from './documents';

/** Mirrors `src/people/onboarding.types.ts`. */
export type OnboardingGroup = 'DOCUMENTS' | 'EQUIPMENT' | 'ACCOUNTS' | 'WELCOME';

export interface OnboardingItem {
  id: string;
  group: OnboardingGroup;
  /** Stable key for a standard item; null for a custom one. */
  key: string | null;
  label: string;
  /** Custom items can be removed; standard ones can only be marked N/A. */
  custom: boolean;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
  notApplicable: boolean;
  notApplicableAt: string | null;
  notApplicableByName: string | null;
  note: string | null;
  detail: string | null;
  suggested: { category: DocumentCategory; docType: string } | null;
  documentStatus: 'none' | 'linked' | 'removed';
  document: { id: string; fileName: string; contentType: string; version: number } | null;
}

export interface OnboardingGroupView {
  group: OnboardingGroup;
  label: string;
  resolved: number;
  total: number;
  items: OnboardingItem[];
}

export interface OnboardingView {
  employeeId: string;
  started: boolean;
  readOnly: boolean;
  resolved: number;
  total: number;
  groups: OnboardingGroupView[];
}

export interface OnboardingItemPatch {
  done?: boolean;
  notApplicable?: boolean;
  note?: string | null;
  detail?: string | null;
  documentId?: string | null;
}

const base = (employeeId: string) => `/people/employees/${encodeURIComponent(employeeId)}/onboarding`;

export const onboardingApi = {
  get: (employeeId: string) => apiClient.get<OnboardingView>(base(employeeId)).then((r) => r.data),
  start: (employeeId: string) => apiClient.post<OnboardingView>(`${base(employeeId)}/start`).then((r) => r.data),
  addItem: (employeeId: string, group: OnboardingGroup, label: string) =>
    apiClient.post<OnboardingView>(`${base(employeeId)}/items`, { group, label }).then((r) => r.data),
  updateItem: (employeeId: string, itemId: string, patch: OnboardingItemPatch) =>
    apiClient.patch<OnboardingView>(`${base(employeeId)}/items/${encodeURIComponent(itemId)}`, patch).then((r) => r.data),
  removeItem: (employeeId: string, itemId: string) =>
    apiClient.delete<OnboardingView>(`${base(employeeId)}/items/${encodeURIComponent(itemId)}`).then((r) => r.data),
};

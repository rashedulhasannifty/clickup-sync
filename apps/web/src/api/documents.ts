import { apiClient } from './client';

export type DocumentCategory = 'IDENTITY' | 'EMPLOYMENT' | 'EDUCATION' | 'APPRAISAL' | 'EXIT' | 'PERSONAL' | 'NOMINEE' | 'OTHER';
export type DocumentVisibility = 'HR_ONLY' | 'HR_AND_EMPLOYEE' | 'EVERYONE';
export type ExpiryStatus = 'none' | 'valid' | 'expiring' | 'expired';
export type CompanyStatusFilter = 'expiring' | 'expired' | 'missing';

export interface ExpiryInfo {
  status: ExpiryStatus;
  /** Whole days until expiry; negative once expired; null without an expiry. */
  daysLeft: number | null;
}

export interface PreviousVersion {
  id: string;
  version: number;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  category: DocumentCategory;
  docType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  expiresOn: string | null;
  expiry: ExpiryInfo;
  visibility: DocumentVisibility;
  uploadedBy: string | null;
  createdAt: string;
  previousVersions: PreviousVersion[];
}

export interface ChecklistItem {
  key: string;
  label: string;
  satisfied: boolean;
  documentId: string | null;
  expiry: ExpiryStatus;
}

export interface DocTypeOption {
  key: string;
  label: string;
}

export interface EmployeeDocumentsResponse {
  items: EmployeeDocument[];
  checklist: ChecklistItem[];
  /** The doc-type vocabulary per category (server-owned, so the checklist keys always match). */
  docTypes: Record<DocumentCategory, DocTypeOption[]>;
}

export interface EmployeeRef {
  id: string;
  fullName: string;
  status: string;
}

export type CompanyDocumentRow =
  | (Omit<EmployeeDocument, 'employeeId' | 'sha256' | 'uploadedBy' | 'previousVersions'> & { kind: 'document'; employee: EmployeeRef })
  | { kind: 'missing'; employee: EmployeeRef; requirement: { key: string; label: string; category: DocumentCategory } };

export interface CompanyCounts {
  total: number;
  expiring: number;
  expired: number;
  missing: number;
  missingEmployees: number;
}

export interface CompanyDocumentsResponse {
  counts: CompanyCounts;
  rows: CompanyDocumentRow[];
  total: number;
  page: number;
  limit: number;
}

export interface CompanyDocumentsParams {
  status?: CompanyStatusFilter;
  category?: DocumentCategory;
  employeeId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface UploadInput {
  file: File;
  category: DocumentCategory;
  docType: string;
  expiresOn?: string;
  visibility: DocumentVisibility;
}

export interface UpdateInput {
  category?: DocumentCategory;
  docType?: string;
  /** `null` clears the expiry. */
  expiresOn?: string | null;
  visibility?: DocumentVisibility;
}

/** Axios drops the JSON default header for FormData and lets the browser add the multipart boundary. */
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

/** True when the server says the documents feature isn't configured (storage env vars unset). */
export function isDocumentsDisabled(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 503;
}

export const documentsApi = {
  /** Same-origin URL for <iframe>/<img>/<a>: the session cookie authenticates it. */
  contentUrl: (id: string, download = false) => `/api/people/documents/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`,

  listForEmployee: (employeeId: string) =>
    apiClient.get<EmployeeDocumentsResponse>(`/people/employees/${encodeURIComponent(employeeId)}/documents`).then((r) => r.data),

  upload: (employeeId: string, input: UploadInput) => {
    const form = new FormData();
    form.append('category', input.category);
    form.append('docType', input.docType);
    form.append('visibility', input.visibility);
    if (input.expiresOn) form.append('expiresOn', input.expiresOn);
    form.append('file', input.file);
    return apiClient.post<EmployeeDocument>(`/people/employees/${encodeURIComponent(employeeId)}/documents`, form, MULTIPART).then((r) => r.data);
  },

  replace: (id: string, file: File, expiresOn?: string) => {
    const form = new FormData();
    if (expiresOn) form.append('expiresOn', expiresOn);
    form.append('file', file);
    return apiClient.post<EmployeeDocument>(`/people/documents/${encodeURIComponent(id)}/replace`, form, MULTIPART).then((r) => r.data);
  },

  update: (id: string, patch: UpdateInput) =>
    apiClient.patch<EmployeeDocument>(`/people/documents/${encodeURIComponent(id)}`, patch).then((r) => r.data),

  remove: (id: string) => apiClient.delete(`/people/documents/${encodeURIComponent(id)}`).then(() => undefined),

  listCompany: (params: CompanyDocumentsParams) =>
    apiClient.get<CompanyDocumentsResponse>('/people/documents', { params }).then((r) => r.data),
};

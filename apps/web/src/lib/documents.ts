import type { DocTypeOption, DocumentCategory, DocumentVisibility, ExpiryInfo } from '../api/documents';

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  IDENTITY: 'Identity',
  EMPLOYMENT: 'Employment',
  EDUCATION: 'Education',
  APPRAISAL: 'Appraisal',
  EXIT: 'Exit',
  PERSONAL: 'Personal',
  OTHER: 'Other',
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as DocumentCategory[];

export const VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  HR_ONLY: 'HR only',
  HR_AND_EMPLOYEE: 'HR + employee',
  EVERYONE: 'Everyone',
};
export const VISIBILITIES = Object.keys(VISIBILITY_LABELS) as DocumentVisibility[];

/** Mirrors MAX_UPLOAD_BYTES on the server; the server is the authority, this only saves a round trip. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.docx';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** `2026-10-28` -> `28 Oct 2026`, without a timezone shift (the value is a calendar date). */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function docTypeLabel(options: Record<string, DocTypeOption[]> | undefined, docType: string): string {
  for (const list of Object.values(options ?? {})) {
    const hit = list.find((t) => t.key === docType);
    if (hit) return hit.label;
  }
  return docType;
}

export interface ExpiryPill {
  tone: 'gray' | 'green' | 'amber' | 'red';
  /** The expiry date, for an "Expires" cell. */
  text: string;
  /** A short status, for a "Status" cell: "Expired", "21 days", "Valid". */
  status: string;
}

/** The pill for an expiry. `none` has no pill: callers render an em dash. */
export function expiryPill(expiry: ExpiryInfo, expiresOn: string | null): ExpiryPill | null {
  if (expiry.status === 'none') return null;
  const text = formatDate(expiresOn);
  if (expiry.status === 'expired') return { tone: 'red', text, status: 'Expired' };
  if (expiry.status === 'expiring') {
    const d = expiry.daysLeft ?? 0;
    return { tone: 'amber', text, status: d === 0 ? 'Today' : `${d} day${d === 1 ? '' : 's'}` };
  }
  return { tone: 'gray', text, status: 'Valid' };
}

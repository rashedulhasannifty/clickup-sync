/**
 * Pure rules for document expiry, the required checklist and the company-wide report. No Nest,
 * no Prisma, no clock: the caller passes `today` (a Dhaka calendar date, YYYY-MM-DD) so every
 * boundary is testable.
 *
 * Decisions, in one place:
 *  - A document is "expiring" when it expires today through today + 30 days (both inclusive);
 *    "expired" only once the expiry date has PASSED (a document expiring today is still valid today).
 *  - A required item is satisfied by the PRESENCE of a matching current document. An expired one
 *    still satisfies it (and is flagged by the expiry status), so a single problem is never counted
 *    twice, as both "expired" and "missing".
 *  - Employees who have EXITED are excluded from the alert counts and lists (expiring, expired,
 *    missing). Their documents still count towards the total.
 *  - Only CURRENT versions are considered (the caller never passes a replaced or deleted row).
 */
import { dhakaTodayParts } from '../budgets/budget-forecast';
import { docTypeLabel, EXPIRING_WITHIN_DAYS, REQUIRED_DOCUMENTS, type DocumentCategoryName } from './document-catalog';

export type ExpiryStatus = 'none' | 'valid' | 'expiring' | 'expired';

export interface ExpiryInfo {
  status: ExpiryStatus;
  /** Whole days from today to the expiry date; negative once expired; null when there is no expiry. */
  daysLeft: number | null;
}

/** Today's calendar date in Dhaka as YYYY-MM-DD. */
export function todayIsoDhaka(now: Date): string {
  const { year, month0, day } = dhakaTodayParts(now);
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

export function classifyExpiry(expiresOn: string | null, todayIso: string): ExpiryInfo {
  if (!expiresOn) return { status: 'none', daysLeft: null };
  const daysLeft = daysBetween(todayIso, expiresOn);
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft <= EXPIRING_WITHIN_DAYS) return { status: 'expiring', daysLeft };
  return { status: 'valid', daysLeft };
}

export interface ChecklistInput {
  id: string;
  docType: string;
  expiresOn: string | null;
}

export interface ChecklistItem {
  key: string;
  label: string;
  satisfied: boolean;
  /** The document that satisfies it (a non-expired one when several match). */
  documentId: string | null;
  expiry: ExpiryStatus;
}

export function computeChecklist(docs: ChecklistInput[], todayIso: string): ChecklistItem[] {
  return REQUIRED_DOCUMENTS.map((req) => {
    const matches = docs.filter((d) => req.satisfiedBy.includes(d.docType));
    const best = matches.find((d) => classifyExpiry(d.expiresOn, todayIso).status !== 'expired') ?? matches[0];
    return {
      key: req.key,
      label: req.label,
      satisfied: !!best,
      documentId: best?.id ?? null,
      expiry: best ? classifyExpiry(best.expiresOn, todayIso).status : 'none',
    };
  });
}

// ── company-wide report ──────────────────────────────────────────────────────

export interface ReportDocument {
  id: string;
  category: DocumentCategoryName;
  docType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  version: number;
  expiresOn: string | null;
  visibility: string;
  createdAt: string;
}

export interface ReportEmployee {
  id: string;
  fullName: string;
  status: string;
  documents: ReportDocument[];
}

export type CompanyStatusFilter = 'expiring' | 'expired' | 'missing';

export interface CompanyFilters {
  status?: CompanyStatusFilter;
  category?: DocumentCategoryName;
  employeeId?: string;
  search?: string;
}

export interface EmployeeRef {
  id: string;
  fullName: string;
  status: string;
}

export type CompanyRow =
  | ({ kind: 'document'; employee: EmployeeRef; expiry: ExpiryInfo } & ReportDocument)
  | { kind: 'missing'; employee: EmployeeRef; requirement: { key: string; label: string; category: DocumentCategoryName } };

export interface CompanyCounts {
  total: number;
  expiring: number;
  expired: number;
  /** Required items missing, summed over employees who have not exited. */
  missing: number;
  /** Distinct employees with at least one required item missing. */
  missingEmployees: number;
}

export interface CompanyReport {
  counts: CompanyCounts;
  rows: CompanyRow[];
}

const isExited = (e: { status: string }) => e.status === 'EXITED';

export function buildCompanyReport(employees: ReportEmployee[], todayIso: string, filters: CompanyFilters = {}): CompanyReport {
  const counts: CompanyCounts = { total: 0, expiring: 0, expired: 0, missing: 0, missingEmployees: 0 };
  const docRows: Extract<CompanyRow, { kind: 'document' }>[] = [];
  const missingRows: Extract<CompanyRow, { kind: 'missing' }>[] = [];

  for (const emp of employees) {
    const ref: EmployeeRef = { id: emp.id, fullName: emp.fullName, status: emp.status };
    counts.total += emp.documents.length;
    for (const doc of emp.documents) {
      const expiry = classifyExpiry(doc.expiresOn, todayIso);
      if (!isExited(emp)) {
        if (expiry.status === 'expiring') counts.expiring += 1;
        if (expiry.status === 'expired') counts.expired += 1;
      }
      docRows.push({ kind: 'document', employee: ref, expiry, ...doc });
    }
    if (!isExited(emp)) {
      const checklist = computeChecklist(emp.documents, todayIso);
      const missing = REQUIRED_DOCUMENTS.filter((_, i) => !checklist[i].satisfied);
      if (missing.length > 0) counts.missingEmployees += 1;
      counts.missing += missing.length;
      for (const req of missing) {
        missingRows.push({ kind: 'missing', employee: ref, requirement: { key: req.key, label: req.label, category: req.category } });
      }
    }
  }

  const needle = filters.search?.trim().toLowerCase();
  const byEmployee = (id: string) => !filters.employeeId || id === filters.employeeId;

  let rows: CompanyRow[];
  if (filters.status === 'missing') {
    rows = missingRows
      .filter((r) => byEmployee(r.employee.id))
      .filter((r) => !filters.category || r.requirement.category === filters.category)
      .filter((r) => !needle || r.employee.fullName.toLowerCase().includes(needle) || r.requirement.label.toLowerCase().includes(needle))
      .sort((a, b) => a.employee.fullName.localeCompare(b.employee.fullName) || a.requirement.label.localeCompare(b.requirement.label));
  } else {
    const alertOnly = filters.status === 'expiring' || filters.status === 'expired';
    rows = docRows
      .filter((r) => byEmployee(r.employee.id))
      .filter((r) => !filters.category || r.category === filters.category)
      .filter((r) => !alertOnly || (!isExited(r.employee) && r.expiry.status === filters.status))
      .filter(
        (r) =>
          !needle ||
          r.fileName.toLowerCase().includes(needle) ||
          r.employee.fullName.toLowerCase().includes(needle) ||
          docTypeLabel(r.docType).toLowerCase().includes(needle),
      )
      .sort((a, b) =>
        alertOnly
          ? (a.expiry.daysLeft ?? 0) - (b.expiry.daysLeft ?? 0) || a.employee.fullName.localeCompare(b.employee.fullName)
          : b.createdAt.localeCompare(a.createdAt) || a.employee.fullName.localeCompare(b.employee.fullName),
      );
  }
  return { counts, rows };
}

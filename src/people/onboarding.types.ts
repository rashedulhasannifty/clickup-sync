/**
 * Response shapes for the onboarding checklist under `/api/people/employees/:id/onboarding`.
 * The frontend mirrors these by hand (`apps/web/src/api/onboarding.ts`). Timestamps are ISO-8601.
 */

import type { DocumentCategoryName } from '../documents/document-catalog';
import type { OnboardingGroupValue, Progress } from './onboarding-checklist';

export type { OnboardingGroupValue, Progress };

export interface OnboardingDocumentRef {
  /** The CURRENT version (a replaced link is followed to its newest version). */
  id: string;
  fileName: string;
  contentType: string;
  version: number;
}

export interface OnboardingItemView {
  id: string;
  group: OnboardingGroupValue;
  /** Stable key for a seeded item; null for a custom one. */
  key: string | null;
  label: string;
  /** Custom items can be deleted; seeded ones can only be marked not applicable. */
  custom: boolean;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
  notApplicable: boolean;
  notApplicableAt: string | null;
  notApplicableByName: string | null;
  note: string | null;
  /** Free text: laptop serial, SIM number, email address... */
  detail: string | null;
  /** What an Upload from this item pre-fills; null for non-document and custom items. */
  suggested: { category: DocumentCategoryName; docType: string } | null;
  /** `removed`: a document was linked but has since been deleted. */
  documentStatus: 'none' | 'linked' | 'removed';
  document: OnboardingDocumentRef | null;
}

export interface OnboardingGroupView extends Progress {
  group: OnboardingGroupValue;
  label: string;
  items: OnboardingItemView[];
}

export interface OnboardingView extends Progress {
  employeeId: string;
  /** false until the checklist has been seeded (employees created before it existed). */
  started: boolean;
  /** An exited employee's checklist is read-only. */
  readOnly: boolean;
  groups: OnboardingGroupView[];
}

/** For the exit flow: what to collect back. */
export interface IssuedEquipment {
  key: string | null;
  label: string;
  detail: string | null;
}

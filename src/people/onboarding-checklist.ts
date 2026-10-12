/**
 * The joining checklist, after the company's paper form "Check List of Joining (New Employees)",
 * and the pure rules for ticking it. No I/O here: the service loads rows, asks these functions what
 * to write, and writes it.
 */

import type { DocumentCategoryName } from '../documents/document-catalog';

export const ONBOARDING_GROUPS = [
  'DOCUMENTS',
  'EQUIPMENT',
  'ACCOUNTS',
  'WELCOME',
] as const;
export type OnboardingGroupValue = (typeof ONBOARDING_GROUPS)[number];

export const ONBOARDING_GROUP_LABEL: Record<OnboardingGroupValue, string> = {
  DOCUMENTS: 'Documents to collect',
  EQUIPMENT: 'Provided by the office',
  ACCOUNTS: 'Software & accounts',
  WELCOME: 'Welcome',
};

export interface DefaultOnboardingItem {
  key: string;
  group: OnboardingGroupValue;
  label: string;
}

/** Order here is the order on the form and on screen (`position` = index). Keys are stable: never rename one. */
export const DEFAULT_ONBOARDING_ITEMS: readonly DefaultOnboardingItem[] = [
  // Documents to collect from the new employee
  {
    key: 'doc_resume',
    group: 'DOCUMENTS',
    label: 'Complete updated resume, duly signed',
  },
  {
    key: 'doc_job_application',
    group: 'DOCUMENTS',
    label: 'Application for the job',
  },
  {
    key: 'doc_release_letter',
    group: 'DOCUMENTS',
    label:
      'Release letter / clearance letter or acceptance of resignation from the previous employer',
  },
  {
    key: 'doc_experience',
    group: 'DOCUMENTS',
    label: 'Working experience certificates (if applicable)',
  },
  {
    key: 'doc_education',
    group: 'DOCUMENTS',
    label:
      'Photocopies of all educational certificates (originals verified by HR)',
  },
  {
    key: 'doc_nid_passport',
    group: 'DOCUMENTS',
    label: 'Photocopy of National ID card / Passport (pages 1–8)',
  },
  {
    key: 'doc_photos',
    group: 'DOCUMENTS',
    label: '4 recent passport-size colour photographs',
  },
  {
    key: 'doc_nominee_nid',
    group: 'DOCUMENTS',
    label: 'Photocopy of the nominee’s National ID card',
  },
  {
    key: 'doc_nominee_photos',
    group: 'DOCUMENTS',
    label: '2 recent passport-size colour photographs of the nominee',
  },
  {
    key: 'doc_salary_certificate',
    group: 'DOCUMENTS',
    label: 'Salary certificate / pay slip from the previous employer',
  },
  // Provided by the office
  { key: 'eq_laptop', group: 'EQUIPMENT', label: 'Laptop' },
  { key: 'eq_laptop_stand', group: 'EQUIPMENT', label: 'Laptop stand' },
  { key: 'eq_keyboard', group: 'EQUIPMENT', label: 'Keyboard' },
  { key: 'eq_mouse', group: 'EQUIPMENT', label: 'Mouse' },
  { key: 'eq_headphone', group: 'EQUIPMENT', label: 'Headphone' },
  { key: 'eq_sim', group: 'EQUIPMENT', label: 'SIM card' },
  {
    key: 'eq_stationery',
    group: 'EQUIPMENT',
    label: 'Stationery (notebook, pen & water bottle)',
  },
  // Software / accounts
  { key: 'acc_email', group: 'ACCOUNTS', label: 'Email ID' },
  { key: 'acc_time_doctor', group: 'ACCOUNTS', label: 'Time Doctor' },
  { key: 'acc_face_lock', group: 'ACCOUNTS', label: 'Face lock (office door)' },
  { key: 'acc_teams', group: 'ACCOUNTS', label: 'Microsoft Teams' },
  { key: 'acc_outlook', group: 'ACCOUNTS', label: 'Outlook' },
  { key: 'acc_bitwarden', group: 'ACCOUNTS', label: 'Bitwarden' },
  { key: 'acc_clickup', group: 'ACCOUNTS', label: 'ClickUp' },
  { key: 'acc_slack', group: 'ACCOUNTS', label: 'Slack (R&D only)' },
  // Welcome
  {
    key: 'wel_offer_letter',
    group: 'WELCOME',
    label: 'Offer letter (hard copy)',
  },
  { key: 'wel_flowers', group: 'WELCOME', label: 'Flower bouquet' },
  { key: 'wel_chocolate', group: 'WELCOME', label: 'Chocolate bar' },
];

export interface SuggestedDocument {
  category: DocumentCategoryName;
  /** A key valid for `category` in the document catalog (a unit test enforces it). */
  docType: string;
}

/** What an Upload from a DOCUMENTS item pre-fills. Keyed by item key; custom items get none. */
export const SUGGESTED_DOCUMENT: Readonly<Record<string, SuggestedDocument>> = {
  doc_resume: { category: 'EMPLOYMENT', docType: 'RESUME' },
  doc_job_application: { category: 'EMPLOYMENT', docType: 'JOB_APPLICATION' },
  doc_release_letter: {
    category: 'EMPLOYMENT',
    docType: 'PREVIOUS_RELEASE_LETTER',
  },
  doc_experience: { category: 'EMPLOYMENT', docType: 'EXPERIENCE_LETTER' },
  doc_salary_certificate: {
    category: 'EMPLOYMENT',
    docType: 'SALARY_CERTIFICATE',
  },
  doc_education: { category: 'EDUCATION', docType: 'EDUCATION_CERTIFICATE' },
  doc_nid_passport: { category: 'IDENTITY', docType: 'NATIONAL_ID' },
  doc_photos: { category: 'PERSONAL', docType: 'PASSPORT_PHOTO' },
  doc_nominee_nid: { category: 'NOMINEE', docType: 'NOMINEE_NID' },
  doc_nominee_photos: { category: 'NOMINEE', docType: 'NOMINEE_PHOTO' },
};

/** Rows to insert for a fresh checklist; `position` follows the form's order. */
export function defaultOnboardingRows(): {
  key: string;
  group: OnboardingGroupValue;
  label: string;
  position: number;
}[] {
  return DEFAULT_ONBOARDING_ITEMS.map((i, position) => ({ ...i, position }));
}

// -- ticking an item -------------------------------------------------------

export interface ItemState {
  done: boolean;
  notApplicable: boolean;
  documentId: string | null;
}

export interface ItemChange {
  done?: boolean;
  notApplicable?: boolean;
  /** A string links that document; null unlinks. Omitted leaves it alone. */
  documentId?: string | null;
}

export interface ItemWrite {
  done?: boolean;
  doneBy?: string | null;
  doneAt?: Date | null;
  notApplicable?: boolean;
  notApplicableBy?: string | null;
  notApplicableAt?: Date | null;
  documentId?: string | null;
}

export type ItemChangeResult =
  | { ok: true; write: ItemWrite }
  | { ok: false; error: string };

/**
 * Turns a requested change into the columns to write, keeping two invariants:
 *   1. never both done and N/A (the DB has a CHECK for it too);
 *   2. a linked document implies done — linking marks the item done, and un-ticking done or
 *      marking it N/A drops the link (the document itself stays in the employee's file).
 * Unlinking (`documentId: null`) leaves `done` as it is: the paper copy may still have been seen.
 * Re-ticking an item that is already done keeps the original who/when.
 */
export function resolveItemChange(
  current: ItemState,
  change: ItemChange,
  actor: string | null,
  now: Date,
): ItemChangeResult {
  const linking = typeof change.documentId === 'string';
  if (change.done === true && change.notApplicable === true)
    return {
      ok: false,
      error: 'An item cannot be both done and not applicable',
    };
  if (linking && change.notApplicable === true)
    return { ok: false, error: 'A not-applicable item cannot have a document' };
  if (linking && change.done === false)
    return { ok: false, error: 'Linking a document marks the item done' };

  const write: ItemWrite = {};
  const markDone = () => {
    if (!current.done)
      Object.assign(write, { done: true, doneBy: actor, doneAt: now });
    if (current.notApplicable)
      Object.assign(write, {
        notApplicable: false,
        notApplicableBy: null,
        notApplicableAt: null,
      });
  };

  if (linking) {
    markDone();
    write.documentId = change.documentId;
  } else if (change.documentId === null) {
    write.documentId = null;
  }

  if (change.done === true) markDone();
  if (change.done === false) {
    Object.assign(write, { done: false, doneBy: null, doneAt: null });
    if (current.documentId !== null) write.documentId = null;
  }

  if (change.notApplicable === true) {
    if (!current.notApplicable)
      Object.assign(write, {
        notApplicable: true,
        notApplicableBy: actor,
        notApplicableAt: now,
      });
    if (current.done)
      Object.assign(write, { done: false, doneBy: null, doneAt: null });
    if (current.documentId !== null) write.documentId = null;
  }
  if (change.notApplicable === false)
    Object.assign(write, {
      notApplicable: false,
      notApplicableBy: null,
      notApplicableAt: null,
    });

  return { ok: true, write };
}

// -- progress ---------------------------------------------------------------

export interface Progress {
  /** done or N/A */
  resolved: number;
  total: number;
}

export function progressOf(
  items: { done: boolean; notApplicable: boolean }[],
): Progress {
  return {
    resolved: items.filter((i) => i.done || i.notApplicable).length,
    total: items.length,
  };
}

/** Follows `replacedById` from a linked document to its current version. */
export function resolveLinkedDocument<
  D extends { id: string; replacedById: string | null; deletedAt: Date | null },
>(
  linkedId: string | null,
  byId: ReadonlyMap<string, D>,
):
  | { status: 'none' }
  | { status: 'removed' }
  | { status: 'linked'; document: D } {
  if (!linkedId) return { status: 'none' };
  let doc = byId.get(linkedId);
  // Bounded walk: a version chain is short, and a malformed loop must not hang a request.
  for (let hops = 0; doc && doc.replacedById && hops < 100; hops++) {
    const next = byId.get(doc.replacedById);
    if (!next) break;
    doc = next;
  }
  if (!doc || doc.deletedAt) return { status: 'removed' };
  return { status: 'linked', document: doc };
}

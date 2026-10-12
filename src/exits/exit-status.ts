/**
 * Pure rules for an exit's life cycle. No database, no clock: the service feeds these and the
 * specs pin them down.
 *
 *   NOTICE -> INTERVIEW -> CLEARANCE -> COMPLETED
 *      \          |            /
 *       +---- CANCELLED -------+     (from any active status)
 */

export type ExitStatusValue =
  | 'NOTICE'
  | 'INTERVIEW'
  | 'CLEARANCE'
  | 'COMPLETED'
  | 'CANCELLED';
export type ExitTypeValue =
  | 'RESIGNATION'
  | 'TERMINATION'
  | 'CONTRACT_END'
  | 'OTHER';
export type EmployeeStatusName =
  | 'INTERN'
  | 'PROBATION'
  | 'ACTIVE'
  | 'NOTICE'
  | 'EXITED';

export const EXIT_TYPES: readonly ExitTypeValue[] = [
  'RESIGNATION',
  'TERMINATION',
  'CONTRACT_END',
  'OTHER',
];

/** The statuses an exit can still move out of. At most one exit per employee is in one of these. */
export const ACTIVE_EXIT_STATUSES: readonly ExitStatusValue[] = [
  'NOTICE',
  'INTERVIEW',
  'CLEARANCE',
];

export const isActiveStatus = (s: ExitStatusValue): boolean =>
  ACTIVE_EXIT_STATUSES.includes(s);

/** What `advance` does. CLEARANCE has no next step: it ends with `complete`. */
export function nextStatus(s: ExitStatusValue): ExitStatusValue | null {
  if (s === 'NOTICE') return 'INTERVIEW';
  if (s === 'INTERVIEW') return 'CLEARANCE';
  return null;
}

export type ExitAction =
  | 'edit'
  | 'advance'
  | 'complete'
  | 'cancel'
  | 'letters';

/**
 * Which actions a status allows. Edits (dates, interview, clearance) and cancel need an active
 * exit; complete is only from CLEARANCE; letters can be (re)generated until the exit is cancelled.
 */
export function canDo(s: ExitStatusValue, action: ExitAction): boolean {
  switch (action) {
    case 'edit':
    case 'cancel':
      return isActiveStatus(s);
    case 'advance':
      return nextStatus(s) !== null;
    case 'complete':
      return s === 'CLEARANCE';
    case 'letters':
      return s !== 'CANCELLED';
  }
}

/** The statuses a cancelled exit can put an employee back on. */
export type RestorableStatus = 'INTERN' | 'PROBATION' | 'ACTIVE';

/**
 * The employee status to restore if the exit is cancelled: an intern stays an intern. An employee
 * who was already on NOTICE (a manual NOTICE_GIVEN event) has no earlier status recorded, so fall
 * back to what their dates imply: confirmed means ACTIVE, otherwise still on probation.
 */
export function statusBeforeExit(
  current: EmployeeStatusName,
  confirmationDate: string | null,
): RestorableStatus {
  if (current === 'INTERN' || current === 'PROBATION' || current === 'ACTIVE')
    return current;
  return confirmationDate ? 'ACTIVE' : 'PROBATION';
}

export type CompletionVerdict =
  | { ok: true; overridden: boolean; open: number }
  | { ok: false; open: number };

/** An item is resolved when it is done or marked not applicable. Only unresolved items are open. */
export const isResolved = (i: {
  done: boolean;
  notApplicable: boolean;
}): boolean => i.done || i.notApplicable;

/**
 * Completion needs every clearance item resolved (done or N/A), or an explicit override with a
 * non-blank note. The note is what makes an override a decision rather than a click; it is kept
 * on the exit.
 */
export function evaluateCompletion(
  items: readonly { done: boolean; notApplicable: boolean }[],
  overrideNote: string | null | undefined,
): CompletionVerdict {
  const open = items.filter((i) => !isResolved(i)).length;
  if (open === 0) return { ok: true, overridden: false, open };
  return overrideNote?.trim()
    ? { ok: true, overridden: true, open }
    : { ok: false, open };
}

/** Why a pair of dates is not acceptable, or null. Dates are `YYYY-MM-DD`. */
export function validateExitDates(args: {
  noticeDate: string;
  lastWorkingDay: string;
  joinDate: string;
}): string | null {
  if (args.lastWorkingDay < args.noticeDate)
    return 'The last working day cannot be before the notice date';
  if (args.lastWorkingDay < args.joinDate)
    return 'The last working day cannot be before the join date';
  return null;
}

export type ExitChecklistGroupValue = 'PROCESS' | 'ASSETS';
export const EXIT_CHECKLIST_GROUPS: readonly ExitChecklistGroupValue[] = [
  'PROCESS',
  'ASSETS',
];

export interface DefaultClearanceItem {
  group: ExitChecklistGroupValue;
  /** Stable id, so code (e.g. the interview auto-tick) never matches on a label. */
  key: string;
  label: string;
}

/** The key of the "Conduct exit interview" item, ticked when the interview is saved. */
export const EXIT_INTERVIEW_ITEM_KEY = 'exit_interview';

/**
 * Seeded on every new exit; editable afterwards (add/remove). This is the company's manual
 * Employee-Exit-Checklist: the process tasks, then the company assets to collect. Order is the
 * display order within each group.
 */
export const DEFAULT_CLEARANCE_ITEMS: readonly DefaultClearanceItem[] = [
  {
    group: 'PROCESS',
    key: 'termination_paperwork',
    label: 'Ensure termination paperwork is complete',
  },
  {
    group: 'PROCESS',
    key: 'inform_stakeholders',
    label:
      'Inform key stakeholders (payroll, IT, operations, legal and senior management) to prepare for the exit process',
  },
  {
    group: 'PROCESS',
    key: 'communicate_internally',
    label: 'Communicate the employee exit internally',
  },
  {
    group: 'PROCESS',
    key: 'communicate_clients',
    label: 'Communicate the employee exit externally to clients',
  },
  {
    group: 'PROCESS',
    key: 'handover_document',
    label:
      'Ensure a handover document is created and shared with relevant stakeholders',
  },
  { group: 'PROCESS', key: 'collect_assets', label: 'Collect company assets' },
  {
    group: 'PROCESS',
    key: 'remove_software_access',
    label:
      'Remove software access (WhatsApp, Teams, Slack, Face lock, Outlook, Time Doctor, ClickUp, Nifty Timer)',
  },
  {
    group: 'PROCESS',
    key: 'final_payments',
    label: 'Arrange final payments & benefits',
  },
  {
    group: 'PROCESS',
    key: 'binding_agreements',
    label: 'Review binding agreements',
  },
  {
    group: 'PROCESS',
    key: EXIT_INTERVIEW_ITEM_KEY,
    label: 'Conduct exit interview',
  },
  {
    group: 'PROCESS',
    key: 'thank_employee',
    label: 'Thank employee on final day',
  },
  {
    group: 'PROCESS',
    key: 'contact_linkedin',
    label:
      "Collect exiting employee's contact information and connect on LinkedIn",
  },
  {
    group: 'PROCESS',
    key: 'check_in_team',
    label: 'Check in with remaining team members',
  },
  {
    group: 'PROCESS',
    key: 'recruit_replacement',
    label: 'Initiate recruiting for a replacement',
  },
  {
    group: 'PROCESS',
    key: 'update_org_chart',
    label: 'Update organizational chart',
  },
  { group: 'ASSETS', key: 'asset_laptop', label: 'Laptop' },
  { group: 'ASSETS', key: 'asset_phone', label: 'Phone' },
  { group: 'ASSETS', key: 'asset_monitor', label: 'Monitor' },
  { group: 'ASSETS', key: 'asset_mouse_keyboard', label: 'Mouse and keyboard' },
  { group: 'ASSETS', key: 'asset_id_card', label: 'ID/Access card' },
  { group: 'ASSETS', key: 'asset_vehicle', label: 'Company vehicle' },
];

/** Equipment handed over at joining, as the onboarding checklist records it. */
export interface IssuedItem {
  key: string | null;
  label: string;
  detail: string | null;
}

export interface SeedClearanceItem {
  group: ExitChecklistGroupValue;
  key: string | null;
  label: string;
}

/** Joining equipment that IS one of the standard assets: its detail (serial etc.) is added there. */
const ISSUED_TO_ASSET: Record<string, string> = {
  eq_laptop: 'asset_laptop',
  eq_keyboard: 'asset_mouse_keyboard',
  eq_mouse: 'asset_mouse_keyboard',
};

/** Consumables handed over at joining; nobody collects a used notebook back. */
const NOT_COLLECTED = new Set(['eq_stationery']);

/**
 * The checklist a new exit starts with: the company sheet, plus every piece of equipment the
 * joining checklist says was issued, so nothing handed over is forgotten at the exit. Issued items
 * matching a standard asset add their detail to its label; the rest become extra ASSETS lines
 * (seeded ones keyed `issued_<key>`, custom ones unkeyed).
 */
export function clearanceItemsFor(
  issued: readonly IssuedItem[],
): SeedClearanceItem[] {
  const details = new Map<string, string[]>();
  const extra: SeedClearanceItem[] = [];
  for (const item of issued) {
    if (item.key && NOT_COLLECTED.has(item.key)) continue;
    const detail = item.detail?.trim() || null;
    const asset = item.key ? ISSUED_TO_ASSET[item.key] : undefined;
    if (asset) {
      if (detail) details.set(asset, [...(details.get(asset) ?? []), detail]);
      continue;
    }
    extra.push({
      group: 'ASSETS',
      key: item.key ? `issued_${item.key}` : null,
      label: `${item.label} (issued at joining)${detail ? ` — ${detail}` : ''}`,
    });
  }
  const seeded = DEFAULT_CLEARANCE_ITEMS.map((d): SeedClearanceItem => {
    const found = details.get(d.key);
    return {
      group: d.group,
      key: d.key,
      label: found ? `${d.label} — ${found.join(', ')}` : d.label,
    };
  });
  return [...seeded, ...extra];
}

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
export type EmployeeStatusName = 'PROBATION' | 'ACTIVE' | 'NOTICE' | 'EXITED';

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

/**
 * The employee status to restore if the exit is cancelled. An employee who was already on NOTICE
 * (a manual NOTICE_GIVEN event) has no earlier status recorded, so fall back to what their dates
 * imply: confirmed means ACTIVE, otherwise still on probation.
 */
export function statusBeforeExit(
  current: EmployeeStatusName,
  confirmationDate: string | null,
): 'PROBATION' | 'ACTIVE' {
  if (current === 'PROBATION' || current === 'ACTIVE') return current;
  return confirmationDate ? 'ACTIVE' : 'PROBATION';
}

export type CompletionVerdict =
  | { ok: true; overridden: boolean; open: number }
  | { ok: false; open: number };

/**
 * Completion needs every clearance item done, or an explicit override with a non-blank note.
 * The note is what makes an override a decision rather than a click; it is kept on the exit.
 */
export function evaluateCompletion(
  items: readonly { done: boolean }[],
  overrideNote: string | null | undefined,
): CompletionVerdict {
  const open = items.filter((i) => !i.done).length;
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

/** Seeded on every new exit; editable afterwards (add/remove). Order is the display order. */
export const DEFAULT_CLEARANCE_ITEMS: readonly string[] = [
  'Laptop & charger returned',
  'ClickUp access removed',
  'Nifty Timer account disabled',
  'Handover of open tasks',
  'Final settlement / leave encashment',
];

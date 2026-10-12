import { defaultInternshipEnd } from '../../appraisals/appraisal-schedule';
import { eventEffects } from '../employment-events';
import type {
  EmployeeStatusValue,
  EmploymentEventTypeValue,
  EventSourceValue,
} from '../people.types';

/**
 * An employee's state as their employment history makes it (0035). Pure: no
 * I/O, no clock. Past records are ordinary employment events, so once HR adds
 * history from before the system, the employee is re-derived by replaying ALL
 * their events, APP and PAST_RECORD, oldest first, each through the same
 * `eventEffects` patch the live path applies.
 *
 * The fields split into groups, each driven by its own event types:
 *
 * - lifecycle: join date, status, probation start, internship end,
 *   confirmation date. Driven by a past "Joined", "Joined as intern",
 *   PROBATION_STARTED, INTERNSHIP_EXTENDED and CONFIRMED.
 * - designation: PROMOTED, DESIGNATION_CHANGED (the latest `toValue`).
 * - team: TRANSFERRED (the latest one whose team still exists).
 * - gross: INCREMENT (the latest whole-taka `toValue`).
 *
 * The app's own JOINED event is written at creation with the join date as it
 * was then; it drives nothing (a profile edit can move the join date without
 * it). Notice, exit and the NOTE a cancelled offboarding writes never take
 * part: past records never move anyone into or out of NOTICE/EXITED, so an
 * employee on notice keeps that status whatever the fold says.
 */

export interface HistoryState {
  joinDate: string;
  status: EmployeeStatusValue;
  probationStartDate: string | null;
  internshipEndDate: string | null;
  confirmationDate: string | null;
  designation: string;
  teamId: string | null;
  grossSalary: number | null;
}

export type HistoryGroup = 'lifecycle' | 'designation' | 'team' | 'gross';
export const HISTORY_GROUPS: readonly HistoryGroup[] = [
  'lifecycle',
  'designation',
  'team',
  'gross',
];

export const GROUP_FIELDS: Record<HistoryGroup, (keyof HistoryState)[]> = {
  lifecycle: [
    'joinDate',
    'status',
    'probationStartDate',
    'internshipEndDate',
    'confirmationDate',
  ],
  designation: ['designation'],
  team: ['teamId'],
  gross: ['grossSalary'],
};

export interface HistoryEvent {
  /** Stable identity: `event:<id>` for stored rows, anything unique for new ones. */
  key: string;
  type: EmploymentEventTypeValue;
  source: EventSourceValue;
  effectiveDate: string;
  fromValue: string | null;
  toValue: string | null;
  /** Tie-break after date and type rank: stored rows by id, new rows after them. */
  order: number;
}

/** The values a group had before its first past record (`employees.past_records_baseline`). */
export type HistoryBaselines = Partial<
  Record<HistoryGroup, Partial<HistoryState>>
>;

/** The group an event drives, or null (notes, notice, exit, the app's JOINED). */
export function groupOf(
  e: Pick<HistoryEvent, 'type' | 'source'>,
): HistoryGroup | null {
  switch (e.type) {
    case 'JOINED':
      return e.source === 'PAST_RECORD' ? 'lifecycle' : null;
    case 'JOINED_AS_INTERN':
    case 'PROBATION_STARTED':
    case 'INTERNSHIP_EXTENDED':
    case 'CONFIRMED':
      return 'lifecycle';
    case 'PROMOTED':
    case 'DESIGNATION_CHANGED':
      return 'designation';
    case 'TRANSFERRED':
      return 'team';
    case 'INCREMENT':
      return 'gross';
    default:
      return null;
  }
}

/** Same-day order: joining first, then probation, an extension, confirmation, the rest. */
const SAME_DAY_RANK: Partial<Record<EmploymentEventTypeValue, number>> = {
  JOINED: 0,
  JOINED_AS_INTERN: 0,
  PROBATION_STARTED: 1,
  INTERNSHIP_EXTENDED: 2,
  CONFIRMED: 3,
  NOTICE_GIVEN: 8,
  EXITED: 9,
};
const rank = (t: EmploymentEventTypeValue) => SAME_DAY_RANK[t] ?? 4;

export function sortHistory<T extends HistoryEvent>(events: readonly T[]): T[] {
  return [...events].sort(
    (a, b) =>
      (a.effectiveDate < b.effectiveDate
        ? -1
        : a.effectiveDate > b.effectiveDate
          ? 1
          : 0) ||
      rank(a.type) - rank(b.type) ||
      a.order - b.order,
  );
}

const FROZEN: ReadonlySet<EmployeeStatusValue> = new Set(['NOTICE', 'EXITED']);

export interface FoldStep {
  key: string;
  /** The status just before this event applied. */
  statusBefore: EmployeeStatusValue;
}

/** Moves the join date; a probation start or default internship end that sat on it moves too. */
function moveJoin(s: HistoryState, date: string): void {
  if (s.probationStartDate === s.joinDate) s.probationStartDate = date;
  if (
    s.internshipEndDate !== null &&
    s.internshipEndDate === defaultInternshipEnd(s.joinDate)
  )
    s.internshipEndDate = defaultInternshipEnd(date);
  s.joinDate = date;
}

/** `foldEmployeeHistory` plus each event's status before it (for the lifecycle rules). */
export function foldWithTrace(
  baseline: HistoryState,
  events: readonly HistoryEvent[],
  opts: { knownTeamIds: ReadonlySet<string> },
): { state: HistoryState; steps: FoldStep[] } {
  const s: HistoryState = { ...baseline };
  const frozen = FROZEN.has(baseline.status);
  const steps: FoldStep[] = [];
  for (const e of sortHistory(events)) {
    if (groupOf(e) === null) continue;
    steps.push({ key: e.key, statusBefore: s.status });
    const d = e.effectiveDate;
    if (e.type === 'JOINED' || e.type === 'JOINED_AS_INTERN') moveJoin(s, d);
    const patch = eventEffects({
      type: e.type,
      effectiveDate: d,
      toValue: e.toValue,
      teamResolves:
        e.type === 'TRANSFERRED' &&
        e.toValue !== null &&
        opts.knownTeamIds.has(e.toValue),
    });
    if (patch.designation !== undefined) s.designation = patch.designation;
    if (patch.confirmationDate !== undefined)
      s.confirmationDate = patch.confirmationDate;
    if (patch.status !== undefined && !frozen) s.status = patch.status;
    if (patch.teamId !== undefined) s.teamId = patch.teamId;
    if (patch.grossSalary !== undefined) s.grossSalary = patch.grossSalary;
    if (patch.probationStartDate !== undefined)
      s.probationStartDate = patch.probationStartDate;
    if (patch.internshipEndDate !== undefined)
      s.internshipEndDate = patch.internshipEndDate;
    if (e.type === 'JOINED_AS_INTERN') {
      // The internship starts the record over: no probation or confirmation yet.
      s.probationStartDate = null;
      s.confirmationDate = null;
      if (s.internshipEndDate === null || s.internshipEndDate <= d)
        s.internshipEndDate = defaultInternshipEnd(d);
    }
  }
  return { state: s, steps };
}

/**
 * The employee after replaying `events` (any order; sorted here) over
 * `baseline`, the fields as they were before any of them. A TRANSFERRED to a
 * team that no longer exists is history only, as on the live path.
 */
export function foldEmployeeHistory(
  baseline: HistoryState,
  events: readonly HistoryEvent[],
  opts: { knownTeamIds: ReadonlySet<string> },
): HistoryState {
  return foldWithTrace(baseline, events, opts).state;
}

const signature = (events: readonly HistoryEvent[], g: HistoryGroup): string =>
  events
    .filter((e) => groupOf(e) === g)
    .map(
      (e) =>
        `${e.key}|${e.type}|${e.effectiveDate}|${e.fromValue ?? ''}|${e.toValue ?? ''}`,
    )
    .sort()
    .join('\n');

const hasGroup = (events: readonly HistoryEvent[], g: HistoryGroup) =>
  events.some((e) => groupOf(e) === g);

function pick(s: HistoryState, g: HistoryGroup): Partial<HistoryState> {
  const out: Partial<HistoryState> = {};
  for (const f of GROUP_FIELDS[g]) (out as Record<string, unknown>)[f] = s[f];
  return out;
}

const RESTORABLE: ReadonlySet<string> = new Set(['INTERN', 'PROBATION', 'ACTIVE']);

export interface Recomputed {
  /** The employee as stored, with the changes applied. */
  state: HistoryState;
  /** Only the fields that differ from what is stored. */
  changes: Partial<HistoryState>;
  /** The new value of `employees.past_records_baseline`. */
  baselines: HistoryBaselines;
  /** The groups whose events changed (and were therefore re-folded). */
  touched: HistoryGroup[];
  /** The re-fold's walk (empty when nothing was re-folded). */
  steps: FoldStep[];
}

/**
 * What a change to the history (`before` -> `after`) does to the stored
 * employee. Only groups whose events changed are re-folded, so a profile edit
 * of an unrelated field is never overwritten. A group re-folds from its
 * baseline: the values from before its first past record when it already had
 * events (`baselines`, else what is stored), else what is stored now; the
 * baseline is remembered while the group has events and restored when the
 * last one is deleted. A stored NOTICE/EXITED status is never changed.
 */
export function recomputeEmployee(args: {
  stored: HistoryState;
  baselines: HistoryBaselines | null;
  before: readonly HistoryEvent[];
  after: readonly HistoryEvent[];
  knownTeamIds: ReadonlySet<string>;
}): Recomputed {
  const { stored, before, after } = args;
  const saved = args.baselines ?? {};
  const nextBaselines: HistoryBaselines = { ...saved };
  const composite: HistoryState = { ...stored };
  const touched: HistoryGroup[] = [];
  for (const g of HISTORY_GROUPS) {
    const had = hasGroup(before, g);
    const has = hasGroup(after, g);
    if (signature(before, g) === signature(after, g)) {
      if (!has) delete nextBaselines[g];
      continue;
    }
    touched.push(g);
    const base = had ? { ...pick(stored, g), ...(saved[g] ?? {}) } : pick(stored, g);
    if (g === 'lifecycle') {
      // A status from before a notice (or a stray value) never comes back over a stored one.
      if (FROZEN.has(stored.status) || !RESTORABLE.has(String(base.status)))
        base.status = stored.status;
    }
    Object.assign(composite, base);
    if (has) nextBaselines[g] = had ? (saved[g] ?? pick(stored, g)) : pick(stored, g);
    else delete nextBaselines[g];
  }
  const { state: folded, steps } = touched.length
    ? foldWithTrace(composite, after, { knownTeamIds: args.knownTeamIds })
    : { state: composite, steps: [] as FoldStep[] };
  const changes: Partial<HistoryState> = {};
  for (const g of touched)
    for (const f of GROUP_FIELDS[g])
      if (folded[f] !== stored[f])
        (changes as Record<string, unknown>)[f] = folded[f];
  return {
    state: { ...stored, ...changes },
    changes,
    baselines: nextBaselines,
    touched,
    steps,
  };
}

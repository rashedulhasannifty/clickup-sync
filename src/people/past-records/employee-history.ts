import { defaultInternshipEnd } from '../../appraisals/appraisal-schedule';
import { eventEffects, hasPastJoin, isJoinType } from '../employment-events';
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
 * The app's own JOINED (or JOINED_AS_INTERN) event is written at creation and
 * kept on the join date by a profile edit (0037), so it drives the join like a
 * past one, unless a past record gives the real join: then the app's row only
 * says when they were added here and takes no part (`activeEvents`). Notice,
 * exit and the NOTE a cancelled offboarding writes never take part: the
 * timeline never moves anyone into or out of NOTICE/EXITED, so an employee on
 * notice keeps that status whatever the fold says.
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

export const isJoin = (e: Pick<HistoryEvent, 'type'>): boolean =>
  isJoinType(e.type);

/**
 * The events that take part in the history: all of them, except the app's own
 * join row once a past record gives the real join date (it then only says when
 * they were added to this system).
 */
export function activeEvents<T extends Pick<HistoryEvent, 'type' | 'source'>>(
  events: readonly T[],
): T[] {
  return hasPastJoin(events)
    ? events.filter((e) => !(isJoin(e) && e.source === 'APP'))
    : [...events];
}

/** The join event in effect (the earliest active one), or null. */
export function joinEvent<T extends HistoryEvent>(events: readonly T[]): T | null {
  return sortHistory(activeEvents(events).filter(isJoin))[0] ?? null;
}

/** The group an event drives, or null (notes, notice, exit). */
export function groupOf(
  e: Pick<HistoryEvent, 'type' | 'source'>,
): HistoryGroup | null {
  switch (e.type) {
    case 'JOINED':
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
  for (const e of sortHistory(activeEvents(events))) {
    if (groupOf(e) === null) continue;
    steps.push({ key: e.key, statusBefore: s.status });
    const d = e.effectiveDate;
    if (isJoin(e)) moveJoin(s, d);
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

/**
 * Whether the group has events that call for a remembered baseline. The app's
 * own join row does not: every employee has one, and it only moves the join
 * date the profile already holds.
 */
const hasGroup = (events: readonly HistoryEvent[], g: HistoryGroup) =>
  events.some((e) => groupOf(e) === g && !(isJoin(e) && e.source === 'APP'));

function pick(s: HistoryState, g: HistoryGroup): Partial<HistoryState> {
  const out: Partial<HistoryState> = {};
  for (const f of GROUP_FIELDS[g]) (out as Record<string, unknown>)[f] = s[f];
  return out;
}

const RESTORABLE: ReadonlySet<string> = new Set(['INTERN', 'PROBATION', 'ACTIVE']);

/**
 * Whether an event can set `field` (lifecycle fields; the other groups have one
 * field each, driven by the whole group). A lifecycle field no event drives,
 * before or after the change, keeps its stored value: a profile edit of it is
 * never replaced by a remembered baseline.
 */
function drives(e: Pick<HistoryEvent, 'type' | 'source'>, field: keyof HistoryState): boolean {
  const g = groupOf(e);
  if (g === null) return false;
  if (g !== 'lifecycle') return GROUP_FIELDS[g].includes(field);
  const join = e.type === 'JOINED';
  switch (field) {
    case 'joinDate':
      return join || e.type === 'JOINED_AS_INTERN';
    case 'status':
      return ['JOINED_AS_INTERN', 'PROBATION_STARTED', 'CONFIRMED'].includes(e.type);
    case 'probationStartDate':
      return join || ['JOINED_AS_INTERN', 'PROBATION_STARTED'].includes(e.type);
    case 'internshipEndDate':
      return join || ['JOINED_AS_INTERN', 'INTERNSHIP_EXTENDED'].includes(e.type);
    case 'confirmationDate':
      return ['JOINED_AS_INTERN', 'CONFIRMED'].includes(e.type);
    default:
      return false;
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_DRIVERS: ReadonlySet<EmploymentEventTypeValue> = new Set([
  'JOINED_AS_INTERN',
  'PROBATION_STARTED',
  'CONFIRMED',
]);

/**
 * Where group `g` starts when the app's own events in it are being changed
 * (an APP event of the group in `before` or `after`): the values before its
 * first event, as far as the events tell them. Empty otherwise, so a history
 * made only of past records keeps its remembered baseline.
 *
 * - lifecycle: a status-changing APP event means the start status is the one
 *   before the earliest such change (an intern before "Moved to probation",
 *   else probation), with no confirmation; an APP "Moved to probation" or
 *   "Joined as intern" means probation starts on the join date until an event
 *   says otherwise (`probationStartDate` is a marker here: the caller sets it
 *   to the base join date, or null for someone who starts as an intern);
 *   an APP internship extension means the end starts at the earliest
 *   extension's old end; switching an app join away from "Joined as intern"
 *   clears the internship end.
 * - designation, team, gross: the `fromValue` of the earliest event that has
 *   one (what the app saw before it changed anything).
 */
function appEventStart(
  g: HistoryGroup,
  before: readonly HistoryEvent[],
  after: readonly HistoryEvent[],
  knownTeamIds: ReadonlySet<string>,
): Partial<HistoryState> {
  const all = [...before, ...after];
  const app = all.filter((e) => e.source === 'APP' && groupOf(e) === g);
  if (g === 'lifecycle') {
    const out: Partial<HistoryState> = {};
    if (app.some((e) => STATUS_DRIVERS.has(e.type))) {
      const first = sortHistory(all.filter((e) => STATUS_DRIVERS.has(e.type)))[0];
      out.status = first?.type === 'PROBATION_STARTED' ? 'INTERN' : 'PROBATION';
      out.confirmationDate = null;
    }
    if (app.some((e) => e.type === 'PROBATION_STARTED' || e.type === 'JOINED_AS_INTERN'))
      out.probationStartDate = null;
    if (app.some((e) => e.type === 'INTERNSHIP_EXTENDED')) {
      const first = sortHistory(all.filter((e) => e.type === 'INTERNSHIP_EXTENDED'))[0];
      out.internshipEndDate =
        first?.fromValue && DATE_ONLY.test(first.fromValue) ? first.fromValue : null;
    } else if (
      app.some((e) => e.type === 'JOINED_AS_INTERN') &&
      !after.some((e) => e.type === 'JOINED_AS_INTERN')
    )
      out.internshipEndDate = null;
    return out;
  }
  if (!before.some((e) => e.source === 'APP' && groupOf(e) === g)) return {};
  const from =
    sortHistory(before.filter((e) => groupOf(e) === g)).find((e) => e.fromValue !== null)
      ?.fromValue ?? null;
  if (from === null) return {};
  if (g === 'designation') return { designation: from };
  if (g === 'team') return knownTeamIds.has(from) ? { teamId: from } : {};
  return /^\d+$/.test(from) ? { grossSalary: Number(from) } : {};
}

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
  const { stored } = args;
  const before = activeEvents(args.before);
  const after = activeEvents(args.after);
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
    // A field no event drives (before or after) keeps what is stored now.
    for (const f of GROUP_FIELDS[g])
      if (!before.some((e) => drives(e, f)) && !after.some((e) => drives(e, f)))
        (base as Record<string, unknown>)[f] = stored[f];
    // A remembered baseline was taken with the app's own events already applied; once one of
    // those is edited or deleted the group starts from before its first event instead.
    const appStart = appEventStart(g, before, after, args.knownTeamIds);
    Object.assign(base, appStart);
    if (g === 'lifecycle') {
      if ('probationStartDate' in appStart)
        base.probationStartDate = base.status === 'INTERN' ? null : base.joinDate;
      // A status from before a notice (or a stray value) never comes back over a stored one.
      if (FROZEN.has(stored.status) || !RESTORABLE.has(String(base.status)))
        base.status = stored.status;
    }
    Object.assign(composite, base);
    if (has)
      // Once the start is worked out from the app's events, that is the group's baseline: a
      // remembered one was taken with those events already applied.
      nextBaselines[g] =
        Object.keys(appStart).length > 0
          ? pick(base as HistoryState, g)
          : had
            ? (saved[g] ?? pick(stored, g))
            : pick(stored, g);
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
  // "Joined as <designation>": the designation they still hold when nothing has changed it since.
  const joinedAs = joinEvent(after)?.toValue ?? null;
  if (
    joinedAs !== null &&
    joinedAs !== (joinEvent(before)?.toValue ?? null) &&
    !after.some((e) => groupOf(e) === 'designation') &&
    joinedAs !== stored.designation
  )
    changes.designation = joinedAs;
  return {
    state: { ...stored, ...changes },
    changes,
    baselines: nextBaselines,
    touched,
    steps,
  };
}

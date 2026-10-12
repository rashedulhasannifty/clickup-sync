import {
  dueDateTaken,
  type AppraisalOnRecord,
} from '../../appraisals/appraisal-schedule';
import type {
  AppraisalActionValue,
  AppraisalTypeValue,
  FormGrade,
} from '../../appraisals/appraisals.types';
import {
  appraisalOutlook,
  pastAppraisalOnRecord,
} from '../employee-mapper';
import type { EmployeeStatusValue } from '../people.types';
import {
  activeEvents,
  joinEvent,
  recomputeEmployee,
  sortHistory,
  type HistoryBaselines,
  type HistoryEvent,
  type HistoryState,
  type Recomputed,
} from './employee-history';
import {
  APPRAISAL_TYPE_LABEL,
  RECORD_LABEL,
  type PastEventType,
  type PastRecordInput,
} from './past-record-input';

/**
 * The rules for an employee's history as a whole (0035), and what a change to
 * it does. Pure. Both routes come through `evaluateHistory`: the import with
 * every new row at once, the per-employee editor with one added, edited or
 * removed record. Errors are reported only against the records being changed:
 * whatever the app itself recorded is never blamed on a past record.
 *
 * Messages never contain a salary figure.
 */

export interface StoredPastAppraisal {
  /** `appraisal:<id>` for a stored row. */
  key: string;
  type: AppraisalTypeValue;
  conductedOn: string;
  dueDate: string | null;
  marks: number | null;
  grade: FormGrade | null;
}

/** Everything about one employee the rules read. */
export interface EmployeeHistory {
  id: string;
  stored: HistoryState;
  baselines: HistoryBaselines | null;
  /** Every stored event, APP and PAST_RECORD. */
  events: HistoryEvent[];
  pastAppraisals: StoredPastAppraisal[];
  /** Appraisals in the system (cycles), as the schedule sees them. */
  systemAppraisals: AppraisalOnRecord[];
  /** The latest NOTICE_GIVEN date while the employee is on notice; else null. */
  noticeDate: string | null;
}

export interface HistoryOutlook {
  status: EmployeeStatusValue;
  designation: string;
  teamId: string | null;
  grossSalary: number | null;
  joinDate: string;
  probationStartDate: string | null;
  confirmationDate: string | null;
  nextAppraisal: { type: AppraisalTypeValue; dueDate: string; overdue: boolean } | null;
  overdue: { type: AppraisalTypeValue; dueDate: string }[];
}

const STATUS_CHANGING: ReadonlySet<string> = new Set([
  'JOINED_AS_INTERN',
  'PROBATION_STARTED',
  'CONFIRMED',
]);
const JOIN_TYPES: ReadonlySet<string> = new Set(['JOINED', 'JOINED_AS_INTERN']);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const labelOf = (type: string): string =>
  (RECORD_LABEL as Record<string, string>)[type] ??
  type.toLowerCase().replace(/_/g, ' ');

/** The end date before the latest extension: where the current internship term starts. */
function termStart(events: readonly HistoryEvent[]): string | null {
  const ext = sortHistory(events.filter((e) => e.type === 'INTERNSHIP_EXTENDED'));
  const last = ext[ext.length - 1];
  return last?.fromValue && DATE_ONLY.test(last.fromValue) ? last.fromValue : null;
}

/** The profile's view of a state: what it is and which appraisal is next or overdue. */
export function outlookOf(
  state: HistoryState,
  events: readonly HistoryEvent[],
  appraisals: readonly AppraisalOnRecord[],
  today: string,
): HistoryOutlook {
  const intern = state.status === 'INTERN';
  const { overdue, next } = appraisalOutlook(
    {
      joinDate: state.joinDate,
      status: state.status,
      probationStartDate: intern ? null : (state.probationStartDate ?? null),
      internshipEndDate: state.internshipEndDate,
      internshipTermStart: termStart(events),
      confirmationDate: state.confirmationDate,
      appraisals,
    },
    today,
  );
  return {
    status: state.status,
    designation: state.designation,
    teamId: state.teamId,
    grossSalary: state.grossSalary,
    joinDate: state.joinDate,
    probationStartDate: intern ? null : (state.probationStartDate ?? state.joinDate),
    confirmationDate: state.confirmationDate,
    nextAppraisal: next
      ? { type: next.type, dueDate: next.dueDate, overdue: next.overdue }
      : null,
    overdue: overdue.map((o) => ({ type: o.type, dueDate: o.dueDate })),
  };
}

const onRecord = (a: StoredPastAppraisal) =>
  pastAppraisalOnRecord({
    type: a.type,
    dueDate: a.dueDate,
    conductedOn: a.conductedOn,
  });

export interface Evaluation {
  /** Per changed record key: what is wrong with it. Empty when the history is valid. */
  errors: Map<string, string[]>;
  recomputed: Recomputed;
  before: HistoryOutlook;
  after: HistoryOutlook;
  /** Plain-language notes worth a second look (not errors). */
  warnings: string[];
}

const STATUS_WORD: Record<EmployeeStatusValue, string> = {
  INTERN: 'Intern',
  PROBATION: 'Probation',
  ACTIVE: 'Permanent',
  NOTICE: 'Notice',
  EXITED: 'Exited',
};
const STAGE: Partial<Record<EmployeeStatusValue, number>> = {
  INTERN: 0,
  PROBATION: 1,
  ACTIVE: 2,
};

/**
 * Validates the employee's whole history after a change and works out the
 * result. `events` and `pastAppraisals` are the complete lists AFTER the
 * change; `changed` holds the keys of the records being added or edited
 * (the ones errors are reported against).
 */
export function evaluateHistory(args: {
  employee: EmployeeHistory;
  events: HistoryEvent[];
  pastAppraisals: StoredPastAppraisal[];
  changed: ReadonlySet<string>;
  today: string;
  knownTeamIds: ReadonlySet<string>;
}): Evaluation {
  const { employee, events, pastAppraisals, changed, today, knownTeamIds } = args;
  const errors = new Map<string, string[]>();
  const add = (key: string, message: string) => {
    const list = errors.get(key) ?? [];
    if (!list.includes(message)) list.push(message);
    errors.set(key, list);
  };

  const recomputed = recomputeEmployee({
    stored: employee.stored,
    baselines: employee.baselines,
    before: employee.events,
    after: events,
    knownTeamIds,
  });
  const state = recomputed.state;
  const joinDate = state.joinDate;

  // Each lifecycle event's status just before it, from the recompute's own walk.
  const statusBefore = new Map(
    recomputed.steps.map((st) => [st.key, st.statusBefore]),
  );

  const byType = (t: string) => events.filter((e) => e.type === t);
  const joins = activeEvents(events).filter((e) => JOIN_TYPES.has(e.type));
  const internAt = byType('JOINED_AS_INTERN')[0]?.effectiveDate ?? null;
  const probations = byType('PROBATION_STARTED');
  const confirmations = byType('CONFIRMED');

  for (const e of events) {
    if (!changed.has(e.key)) continue;
    const d = e.effectiveDate;
    const label = labelOf(e.type);
    if (d > today) add(e.key, 'The date is in the future');
    if (!JOIN_TYPES.has(e.type) && d < joinDate)
      add(e.key, `Before the join date (${joinDate})`);
    if (JOIN_TYPES.has(e.type) && joins.length > 1)
      add(
        e.key,
        'Only one Joined or Joined as intern record per employee: keep the one with the real join date',
      );
    if (e.type === 'PROBATION_STARTED' && probations.length > 1) {
      const other = probations.find((p) => p.key !== e.key);
      add(e.key, `Already moved to probation on ${other?.effectiveDate}`);
    }
    if (e.type === 'CONFIRMED' && confirmations.length > 1) {
      const other = confirmations.find((p) => p.key !== e.key);
      add(e.key, `Already confirmed on ${other?.effectiveDate}`);
    }
    if (e.type === 'PROBATION_STARTED' && internAt && d < internAt)
      add(e.key, `Moved to probation before joining as an intern (${internAt})`);
    if (e.type === 'JOINED_AS_INTERN') {
      const early = [...probations, ...confirmations].find((p) => p.effectiveDate < d);
      if (early)
        add(
          e.key,
          `Joined as an intern after being ${early.type === 'CONFIRMED' ? 'confirmed' : 'moved to probation'} (${early.effectiveDate})`,
        );
    }
    if (e.type === 'CONFIRMED') {
      const late = probations.find((p) => p.effectiveDate > d);
      if (late)
        add(e.key, `Confirmed before moving to probation (${late.effectiveDate})`);
      else if (statusBefore.get(e.key) === 'INTERN')
        add(
          e.key,
          'An intern cannot be confirmed directly: add "Moved to probation" first',
        );
    }
    if (
      STATUS_CHANGING.has(e.type) &&
      employee.noticeDate !== null &&
      d >= employee.noticeDate
    )
      add(
        e.key,
        `On or after the notice date (${employee.noticeDate}): past records cannot change the status of someone on notice`,
      );
    if (e.type === 'TRANSFERRED' && (e.toValue === null || !knownTeamIds.has(e.toValue)))
      add(e.key, 'Unknown team: use the name of a team that exists');
    if (
      events.some(
        (o) => o.key !== e.key && o.type === e.type && o.effectiveDate === d,
      )
    )
      add(e.key, `There is already a ${label} record on ${d}`);
  }

  // A confirmation the system recorded, reached straight from an internship a past record
  // added: the intern was never moved to probation. Reported on that internship record.
  for (const c of confirmations) {
    if (changed.has(c.key) || statusBefore.get(c.key) !== 'INTERN') continue;
    for (const j of byType('JOINED_AS_INTERN'))
      if (changed.has(j.key) && j.effectiveDate <= c.effectiveDate)
        add(
          j.key,
          `They were confirmed on ${c.effectiveDate} with no "Moved to probation" after joining as an intern: add it`,
        );
  }

  // Confirmation before a changed probation start.
  for (const p of probations) {
    if (!changed.has(p.key)) continue;
    const early = confirmations.find((c) => c.effectiveDate < p.effectiveDate);
    if (early) add(p.key, `Moved to probation after being confirmed (${early.effectiveDate})`);
  }

  // Past appraisals.
  const anchorEmployee = {
    joinDate,
    status: state.status,
    probationStartDate: state.status === 'INTERN' ? null : state.probationStartDate,
    internshipEndDate: state.internshipEndDate,
  };
  for (const a of pastAppraisals) {
    if (!changed.has(a.key)) continue;
    const typeLabel = APPRAISAL_TYPE_LABEL[a.type].toLowerCase();
    if (a.conductedOn > today) add(a.key, 'The date is in the future');
    if (a.dueDate !== null && a.dueDate > today)
      add(a.key, 'The due date is in the future');
    if (a.conductedOn < joinDate) add(a.key, `Before the join date (${joinDate})`);
    if (a.dueDate !== null && a.dueDate < joinDate)
      add(a.key, `The due date is before the join date (${joinDate})`);
    if (
      pastAppraisals.some(
        (o) => o.key !== a.key && o.type === a.type && o.conductedOn === a.conductedOn,
      )
    ) {
      add(a.key, `There is already a ${typeLabel} appraisal on ${a.conductedOn}`);
      continue;
    }
    const at = a.dueDate ?? a.conductedOn;
    const inSystem = dueDateTaken(anchorEmployee, a.type, at, employee.systemAppraisals);
    if (inSystem) {
      add(
        a.key,
        `An appraisal in the system already covers the ${inSystem} ${typeLabel} due date`,
      );
      continue;
    }
    const others = pastAppraisals.filter((o) => o.key !== a.key).map(onRecord);
    const onPaper = dueDateTaken(anchorEmployee, a.type, at, others);
    if (onPaper)
      add(
        a.key,
        `Another past appraisal already covers the ${onPaper} ${typeLabel} due date`,
      );
  }

  const beforeRecords = [
    ...employee.systemAppraisals,
    ...employee.pastAppraisals.map(onRecord),
  ];
  const afterRecords = [...employee.systemAppraisals, ...pastAppraisals.map(onRecord)];
  const before = outlookOf(employee.stored, employee.events, beforeRecords, today);
  const after = outlookOf(state, events, afterRecords, today);

  const warnings: string[] = [];
  const from = STAGE[employee.stored.status];
  const to = STAGE[state.status];
  if (from !== undefined && to !== undefined && to < from)
    warnings.push(
      `Status goes back from ${STATUS_WORD[employee.stored.status]} to ${STATUS_WORD[state.status]}: ${
        state.status === 'INTERN'
          ? 'add "Moved to probation" (and "Confirmed") if they moved on'
          : 'add the "Confirmed" record if they were confirmed'
      }`,
    );
  return { errors, recomputed, before, after, warnings };
}

// --- The import: rows for one employee -------------------------------------

export interface IncomingRow {
  row: number;
  record: PastRecordInput;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
}

export interface PlannedEvent {
  row: number;
  key: string;
  type: PastEventType;
  date: string;
  fromValue: string | null;
  /** TRANSFERRED: the team id. */
  toValue: string | null;
  notes: string | null;
}

export interface PlannedAppraisal {
  row: number;
  key: string;
  type: AppraisalTypeValue;
  conductedOn: string;
  dueDate: string | null;
  marks: number | null;
  grade: FormGrade | null;
  outcome: string | null;
  actions: AppraisalActionValue[];
  notes: string | null;
}

export interface EmployeePlan {
  rowErrors: RowError[];
  /** Rows identical to something already recorded: skipped, not errors. */
  alreadyRecorded: number[];
  events: PlannedEvent[];
  appraisals: PlannedAppraisal[];
  evaluation: Evaluation;
}

/** The keys of an employee's stored past records (events and appraisals). */
export function pastRecordKeys(employee: EmployeeHistory): string[] {
  return [
    ...employee.events.filter((e) => e.source === 'PAST_RECORD').map((e) => e.key),
    ...employee.pastAppraisals.map((a) => a.key),
  ];
}

/** "Promotion of 2024-01-15", for a message about a stored record. */
export function describeStored(employee: EmployeeHistory, key: string): string {
  const e = employee.events.find((x) => x.key === key);
  if (e) return `${labelOf(e.type)} of ${e.effectiveDate}`;
  const a = employee.pastAppraisals.find((x) => x.key === key);
  return a
    ? `${APPRAISAL_TYPE_LABEL[a.type].toLowerCase()} appraisal of ${a.conductedOn}`
    : 'record';
}

const norm = (v: string | null) => (v ?? '').trim().toLowerCase();

/** Whether an incoming event says the same as a stored one of the same type and date. */
function sameEvent(stored: HistoryEvent, incoming: PlannedEvent): boolean {
  switch (incoming.type) {
    case 'PROMOTED':
    case 'DESIGNATION_CHANGED':
    case 'TRANSFERRED':
      return norm(stored.toValue) === norm(incoming.toValue);
    case 'INCREMENT':
      return Number(stored.toValue) === Number(incoming.toValue);
    default:
      return true;
  }
}

/**
 * One employee's rows from an import: team names resolved, duplicates within
 * the file and rows already recorded set aside, the rest validated against the
 * whole history (`evaluateHistory`). Applying twice adds nothing the second
 * time: every row is then "already recorded".
 */
export function planEmployeeImport(args: {
  employee: EmployeeHistory;
  rows: IncomingRow[];
  today: string;
  /** Lower-cased team name -> id, for the org. */
  teamIdsByName: ReadonlyMap<string, string>;
}): EmployeePlan {
  const { employee, rows, today, teamIdsByName } = args;
  const knownTeamIds = new Set(teamIdsByName.values());
  const rowErrors: RowError[] = [];
  const alreadyRecorded: number[] = [];
  const events: PlannedEvent[] = [];
  const appraisals: PlannedAppraisal[] = [];
  const seen = new Map<string, number>();

  for (const { row, record } of rows) {
    const dupKey =
      record.kind === 'event'
        ? `E|${record.type}|${record.date}`
        : `A|${record.type}|${record.conductedOn}`;
    const first = seen.get(dupKey);
    if (first !== undefined) {
      rowErrors.push({
        row,
        field: 'record',
        message: `Same record and date as row ${first}`,
      });
      continue;
    }
    seen.set(dupKey, row);

    if (record.kind === 'appraisal') {
      const existing = employee.pastAppraisals.find(
        (a) => a.type === record.type && a.conductedOn === record.conductedOn,
      );
      if (existing) {
        if (existing.grade === record.grade && existing.marks === record.marks)
          alreadyRecorded.push(row);
        else
          rowErrors.push({
            row,
            field: 'record',
            message: `A ${APPRAISAL_TYPE_LABEL[record.type].toLowerCase()} appraisal on this date is already recorded with a different grade or marks`,
          });
        continue;
      }
      appraisals.push({
        row,
        key: `row:${row}`,
        type: record.type,
        conductedOn: record.conductedOn,
        dueDate: record.dueDate,
        marks: record.marks,
        grade: record.grade,
        outcome: record.outcome,
        actions: record.actions,
        notes: record.notes,
      });
      continue;
    }

    let toValue = record.toValue;
    let fromValue = record.fromValue;
    if (record.type === 'TRANSFERRED') {
      const to = teamIdsByName.get(norm(toValue));
      if (!to) {
        rowErrors.push({
          row,
          field: 'to',
          message: `Unknown team "${toValue}": use the name of a team that exists`,
        });
        continue;
      }
      toValue = to;
      // An old team that no longer exists stays as its name (history only).
      fromValue = fromValue ? (teamIdsByName.get(norm(fromValue)) ?? fromValue) : null;
    }
    const planned: PlannedEvent = {
      row,
      key: `row:${row}`,
      type: record.type,
      date: record.date,
      fromValue,
      toValue,
      notes: record.notes,
    };
    if (record.type === 'JOINED' && record.date === employee.stored.joinDate) {
      const joinedAs = joinEvent(employee.events)?.toValue ?? null;
      if (record.toValue !== null && norm(record.toValue) !== norm(joinedAs))
        // Never drop the designation silently: the join itself is already on file.
        rowErrors.push({
          row,
          field: 'to',
          message:
            'This join date is already on file: set "Joined as" by editing the Joined entry on the employee page',
        });
      else alreadyRecorded.push(row);
      continue;
    }
    const sameDay = employee.events.find(
      (e) => e.type === record.type && e.effectiveDate === record.date,
    );
    if (sameDay) {
      if (sameEvent(sameDay, planned)) alreadyRecorded.push(row);
      else
        rowErrors.push({
          row,
          field: 'to',
          message: `A ${labelOf(record.type)} on this date is already recorded with a different value`,
        });
      continue;
    }
    events.push(planned);
  }

  const order0 = 1e15;
  const afterEvents: HistoryEvent[] = [
    ...employee.events,
    ...events.map((e, i) => ({
      key: e.key,
      type: e.type,
      source: 'PAST_RECORD' as const,
      effectiveDate: e.date,
      fromValue: e.fromValue,
      toValue: e.toValue,
      order: order0 + i,
    })),
  ];
  const afterAppraisals: StoredPastAppraisal[] = [
    ...employee.pastAppraisals,
    ...appraisals.map((a) => ({
      key: a.key,
      type: a.type,
      conductedOn: a.conductedOn,
      dueDate: a.dueDate,
      marks: a.marks,
      grade: a.grade,
    })),
  ];
  // The stored past records are re-checked too: a new join date can put one before it.
  const changed = new Set([
    ...events.map((e) => e.key),
    ...appraisals.map((a) => a.key),
    ...pastRecordKeys(employee),
  ]);
  const evaluation = evaluateHistory({
    employee,
    events: afterEvents,
    pastAppraisals: afterAppraisals,
    changed,
    today,
    knownTeamIds,
  });
  const rowOf = new Map<string, number>([
    ...events.map((e) => [e.key, e.row] as const),
    ...appraisals.map((a) => [a.key, a.row] as const),
  ]);
  const firstRow = rows.length > 0 ? Math.min(...rows.map((r) => r.row)) : 0;
  for (const [key, messages] of evaluation.errors) {
    const row = rowOf.get(key);
    const stored = row === undefined ? describeStored(employee, key) : null;
    for (const message of messages)
      rowErrors.push(
        row !== undefined
          ? { row, field: 'date', message }
          : { row: firstRow, field: 'record', message: `Conflicts with the ${stored} already recorded: ${message}` },
      );
  }
  rowErrors.sort((a, b) => a.row - b.row);
  return { rowErrors, alreadyRecorded, events, appraisals, evaluation };
}

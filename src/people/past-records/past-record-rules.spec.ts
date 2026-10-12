import type { HistoryEvent } from './employee-history';
import { normalizeRow, type PastRecordRowInput } from './past-record-input';
import {
  evaluateHistory,
  planEmployeeImport,
  type EmployeeHistory,
  type IncomingRow,
} from './past-record-rules';

const TODAY = '2026-10-12';
const TEAMS = new Map([
  ['platform', 'team-platform'],
  ['design', 'team-design'],
]);

/** Imported from logins in May 2024: ACTIVE, no history but the app's JOINED. */
function employee(over: Partial<EmployeeHistory> = {}): EmployeeHistory {
  return {
    id: 'emp-1',
    stored: {
      joinDate: '2024-05-01',
      status: 'ACTIVE',
      probationStartDate: '2024-05-01',
      internshipEndDate: null,
      confirmationDate: null,
      designation: 'Unassigned',
      teamId: null,
      grossSalary: 30000,
    },
    baselines: null,
    events: [appEvent(1, 'JOINED', '2024-05-01')],
    pastAppraisals: [],
    systemAppraisals: [],
    noticeDate: null,
    ...over,
  };
}

function appEvent(
  id: number,
  type: HistoryEvent['type'],
  date: string,
  toValue: string | null = null,
  source: HistoryEvent['source'] = 'APP',
): HistoryEvent {
  return { key: `event:${id}`, type, source, effectiveDate: date, fromValue: null, toValue, order: id };
}

/** Sheet rows (row numbers from 2) -> what the planner gets. */
function rows(...input: Omit<PastRecordRowInput, 'employee'>[]): IncomingRow[] {
  return input.map((r, i) => {
    const n = normalizeRow({ ...r, employee: 'a@x.test' });
    if (!n.ok) throw new Error(JSON.stringify(n.errors));
    return { row: i + 2, record: n.record };
  });
}

const plan = (e: EmployeeHistory, r: IncomingRow[]) =>
  planEmployeeImport({ employee: e, rows: r, today: TODAY, teamIdsByName: TEAMS });

describe('planEmployeeImport: the whole history', () => {
  it('a full history: intern, probation, confirmation, promotion, increment, transfer', () => {
    const p = plan(
      employee(),
      rows(
        { record: 'Joined as intern', date: '01/01/2022' },
        { record: 'Moved to probation', date: '2022-04-01' },
        { record: 'Confirmed', date: '2022-10-01' },
        { record: 'Promotion', date: '2024-01-01', to: 'Developer' },
        { record: 'Promotion', date: '2025-04-01', from: 'Developer', to: 'Senior Developer' },
        { record: 'Increment', date: '2025-04-01', from: 40000, to: 46000 },
        { record: 'Transfer', date: '2025-06-01', to: 'Platform' },
      ),
    );
    expect(p.rowErrors).toEqual([]);
    expect(p.events).toHaveLength(7);
    expect(p.events.find((e) => e.type === 'TRANSFERRED')?.toValue).toBe('team-platform');
    expect(p.evaluation.recomputed.changes).toEqual({
      joinDate: '2022-01-01',
      probationStartDate: '2022-04-01',
      internshipEndDate: '2022-04-01',
      confirmationDate: '2022-10-01',
      designation: 'Senior Developer',
      grossSalary: 46000,
      teamId: 'team-platform',
    });
    expect(p.evaluation.after).toMatchObject({
      status: 'ACTIVE',
      joinDate: '2022-01-01',
      probationStartDate: '2022-04-01',
      confirmationDate: '2022-10-01',
      designation: 'Senior Developer',
      grossSalary: 46000,
    });
    // Anchored on the probation start now: the 1 Apr 2026 yearly was missed.
    expect(p.evaluation.after.nextAppraisal).toEqual({ type: 'YEARLY', dueDate: '2026-04-01', overdue: true });
    expect(p.evaluation.before.nextAppraisal).toEqual({ type: 'YEARLY', dueDate: '2026-05-01', overdue: true });
  });

  it('applying the same rows again adds nothing: every row is already recorded', () => {
    const r = rows(
      { record: 'Joined as intern', date: '2022-01-01' },
      { record: 'Moved to probation', date: '2022-04-01' },
      { record: 'Promotion', date: '2024-01-01', to: 'Developer' },
      { record: 'Increment', date: '2025-04-01', to: 46000, amount: '15%' },
      { record: 'Transfer', date: '2025-06-01', to: 'platform' },
      { record: 'Appraisal', date: '2025-04-05', grade: 'B' },
    );
    const first = plan(employee(), r);
    expect(first.rowErrors).toEqual([]);
    // What the first apply stored.
    const stored = employee({
      stored: { ...employee().stored, ...first.evaluation.recomputed.changes },
      baselines: first.evaluation.recomputed.baselines,
      events: [
        ...employee().events,
        ...first.events.map((e, i) =>
          appEvent(100 + i, e.type, e.date, e.toValue, 'PAST_RECORD'),
        ),
      ],
      pastAppraisals: first.appraisals.map((a) => ({ ...a, key: `appraisal:${a.row}` })),
    });
    const second = plan(stored, r);
    expect(second.rowErrors).toEqual([]);
    expect(second.alreadyRecorded).toEqual([2, 3, 4, 5, 6, 7]);
    expect(second.events).toEqual([]);
    expect(second.appraisals).toEqual([]);
    expect(second.evaluation.recomputed.changes).toEqual({});
  });

  it('a Joined row on the stored join date is already recorded (the prefilled template row)', () => {
    const p = plan(employee(), rows({ record: 'Joined', date: '2024-05-01' }));
    expect(p).toMatchObject({ alreadyRecorded: [2], events: [], rowErrors: [] });
    // A different date is a correction of the join date.
    const moved = plan(employee(), rows({ record: 'Joined', date: '2023-02-01' }));
    expect(moved.evaluation.recomputed.changes).toEqual({ joinDate: '2023-02-01', probationStartDate: '2023-02-01' });
  });

  it('a same-day record with a different value is an error, not "already recorded"', () => {
    const e = employee({
      events: [...employee().events, appEvent(7, 'PROMOTED', '2025-01-01', 'Developer', 'PAST_RECORD')],
    });
    const p = plan(e, rows({ record: 'Promotion', date: '2025-01-01', to: 'Designer' }));
    expect(p.rowErrors).toEqual([
      { row: 2, field: 'to', message: 'A Promotion on this date is already recorded with a different value' },
    ]);
    expect(plan(e, rows({ record: 'promotion', date: '2025-01-01', to: ' developer ' })).alreadyRecorded).toEqual([2]);
  });

  it('the same record twice in the file is an error on the second row', () => {
    const p = plan(
      employee(),
      rows({ record: 'Confirmed', date: '2024-11-01' }, { record: 'Confirmed', date: '2024-11-01' }),
    );
    expect(p.rowErrors).toEqual([{ row: 3, field: 'record', message: 'Same record and date as row 2' }]);
  });

  it('refuses future dates and records before the join date', () => {
    const p = plan(
      employee(),
      rows({ record: 'Promotion', date: '2026-10-13', to: 'Lead' }, { record: 'Promotion', date: '2024-04-30', to: 'Dev' }),
    );
    expect(p.rowErrors).toEqual([
      { row: 2, field: 'date', message: 'The date is in the future' },
      { row: 3, field: 'date', message: 'Before the join date (2024-05-01)' },
    ]);
  });

  it('order: intern before probation before confirmation', () => {
    const p = plan(
      employee(),
      rows(
        { record: 'Joined as intern', date: '2022-01-01' },
        { record: 'Moved to probation', date: '2022-10-01' },
        { record: 'Confirmed', date: '2022-04-01' },
      ),
    );
    expect(p.rowErrors).toEqual(
      expect.arrayContaining([
        { row: 3, field: 'date', message: 'Moved to probation after being confirmed (2022-04-01)' },
        { row: 4, field: 'date', message: 'Confirmed before moving to probation (2022-10-01)' },
      ]),
    );
    const late = plan(
      employee(),
      rows({ record: 'Moved to probation', date: '2022-04-01' }, { record: 'Joined as intern', date: '2022-06-01' }),
    );
    expect(late.rowErrors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        'Moved to probation before joining as an intern (2022-06-01)',
        'Joined as an intern after being moved to probation (2022-04-01)',
      ]),
    );
  });

  it('an intern cannot be confirmed directly', () => {
    const p = plan(
      employee(),
      rows({ record: 'Joined as intern', date: '2022-01-01' }, { record: 'Confirmed', date: '2022-10-01' }),
    );
    expect(p.rowErrors).toEqual([
      { row: 3, field: 'date', message: 'An intern cannot be confirmed directly: add "Moved to probation" first' },
    ]);
    // Nor someone the app already has as an intern.
    const intern = employee({
      stored: { ...employee().stored, status: 'INTERN', probationStartDate: null, internshipEndDate: '2026-08-01' },
    });
    expect(plan(intern, rows({ record: 'Confirmed', date: '2026-07-01' })).rowErrors[0]?.message).toMatch(/cannot be confirmed directly/);
  });

  it('one probation start and one confirmation, against the app’s own events too', () => {
    const e = employee({ events: [...employee().events, appEvent(9, 'CONFIRMED', '2024-11-01')] });
    const p = plan(e, rows({ record: 'Confirmed', date: '2024-12-01' }));
    expect(p.rowErrors).toEqual([{ row: 2, field: 'date', message: 'Already confirmed on 2024-11-01' }]);
  });

  it('only one join record', () => {
    const p = plan(
      employee(),
      rows({ record: 'Joined', date: '2023-01-01' }, { record: 'Joined as intern', date: '2023-01-01' }),
    );
    expect(p.rowErrors.filter((e) => /Only one Joined/.test(e.message)).map((e) => e.row)).toEqual([2, 3]);
  });

  it('someone on notice: no status-changing record on or after the notice date', () => {
    const e = employee({ stored: { ...employee().stored, status: 'NOTICE' }, noticeDate: '2026-09-01' });
    const p = plan(e, rows({ record: 'Confirmed', date: '2026-09-15' }, { record: 'Promotion', date: '2026-09-20', to: 'Lead' }));
    expect(p.rowErrors).toEqual([
      {
        row: 2,
        field: 'date',
        message:
          'On or after the notice date (2026-09-01): past records cannot change the status of someone on notice',
      },
    ]);
  });

  it('a transfer to an unknown team is an error', () => {
    const p = plan(employee(), rows({ record: 'Transfer', date: '2025-01-01', to: 'Marketing' }));
    expect(p.rowErrors).toEqual([
      { row: 2, field: 'to', message: 'Unknown team "Marketing": use the name of a team that exists' },
    ]);
  });

  it('a new join date that puts a stored past record before it is reported on the first row', () => {
    const e = employee({
      events: [...employee().events, appEvent(5, 'PROMOTED', '2024-06-01', 'Developer', 'PAST_RECORD')],
    });
    const p = plan(e, rows({ record: 'Joined', date: '2024-07-01' }));
    expect(p.rowErrors).toEqual([
      {
        row: 2,
        field: 'record',
        message: 'Conflicts with the Promotion of 2024-06-01 already recorded: Before the join date (2024-07-01)',
      },
    ]);
  });

  it('warns when the status would go backwards', () => {
    const p = plan(employee(), rows({ record: 'Moved to probation', date: '2024-05-01' }));
    expect(p.rowErrors).toEqual([]);
    expect(p.evaluation.after.status).toBe('PROBATION');
    expect(p.evaluation.warnings).toEqual([
      'Status goes back from Permanent to Probation: add the "Confirmed" record if they were confirmed',
    ]);
  });
});

describe('past appraisals and the schedule', () => {
  it('a paper yearly appraisal clears the overdue yearly it stands for', () => {
    const e = employee();
    const none = plan(e, []);
    expect(none.evaluation.before.overdue).toEqual([{ type: 'YEARLY', dueDate: '2026-05-01' }]);
    const p = plan(e, rows({ record: 'Appraisal', date: '2026-05-10', marks: 82, appraisalType: 'Yearly' }));
    expect(p.rowErrors).toEqual([]);
    expect(p.appraisals[0]).toMatchObject({ grade: 'B', marks: 82, type: 'YEARLY', conductedOn: '2026-05-10' });
    expect(p.evaluation.before.nextAppraisal).toEqual({ type: 'YEARLY', dueDate: '2026-05-01', overdue: true });
    expect(p.evaluation.after.overdue).toEqual([]);
    expect(p.evaluation.after.nextAppraisal).toEqual({ type: 'HALF_YEARLY', dueDate: '2026-11-01', overdue: false });
  });

  it('a due date, when given, is what the paper appraisal stands for', () => {
    const p = plan(employee(), rows({ record: 'Appraisal', date: '2026-08-20', dueDate: '2026-05-01', grade: 'C' }));
    expect(p.evaluation.after.overdue).toEqual([]);
  });

  it('refuses a paper appraisal for a due date an appraisal in the system already covers', () => {
    const e = employee({ systemAppraisals: [{ type: 'YEARLY', dueDate: '2026-05-01', periodEnd: '2026-04-30' }] });
    const p = plan(e, rows({ record: 'Appraisal', date: '2026-05-03', grade: 'A' }));
    expect(p.rowErrors).toEqual([
      { row: 2, field: 'date', message: 'An appraisal in the system already covers the 2026-05-01 yearly due date' },
    ]);
  });

  it('refuses two paper appraisals for the same milestone, and future dates', () => {
    const p = plan(
      employee(),
      rows(
        { record: 'Appraisal', date: '2026-05-03', grade: 'A' },
        { record: 'Appraisal', date: '2026-05-20', grade: 'B' },
        { record: 'Appraisal', date: '2026-10-20', grade: 'B' },
      ),
    );
    expect(p.rowErrors).toEqual(
      expect.arrayContaining([
        { row: 3, field: 'date', message: 'Another past appraisal already covers the 2026-05-01 yearly due date' },
        { row: 4, field: 'date', message: 'The date is in the future' },
      ]),
    );
  });

  it('a stored paper appraisal with the same type and date: identical is already recorded, different is an error', () => {
    const e = employee({
      pastAppraisals: [
        { key: 'appraisal:p1', type: 'YEARLY', conductedOn: '2026-05-10', dueDate: null, marks: 82, grade: 'B' },
      ],
    });
    expect(plan(e, rows({ record: 'Appraisal', date: '2026-05-10', marks: 82 })).alreadyRecorded).toEqual([2]);
    expect(plan(e, rows({ record: 'Appraisal', date: '2026-05-10', grade: 'A' })).rowErrors[0].message).toMatch(
      /already recorded with a different grade or marks/,
    );
  });
});

describe('evaluateHistory (the editor)', () => {
  it('deleting a probation start that a confirmation of an intern relies on is refused', () => {
    const e = employee({
      events: [
        appEvent(1, 'JOINED', '2024-05-01'),
        appEvent(2, 'JOINED_AS_INTERN', '2022-01-01', null, 'PAST_RECORD'),
        appEvent(3, 'PROBATION_STARTED', '2022-04-01', null, 'PAST_RECORD'),
        appEvent(4, 'CONFIRMED', '2022-10-01', null, 'PAST_RECORD'),
      ],
    });
    const after = e.events.filter((x) => x.key !== 'event:3');
    const r = evaluateHistory({
      employee: e,
      events: after,
      pastAppraisals: [],
      changed: new Set(['event:2', 'event:4']),
      today: TODAY,
      knownTeamIds: new Set(TEAMS.values()),
    });
    expect(r.errors.get('event:4')).toEqual(['An intern cannot be confirmed directly: add "Moved to probation" first']);
  });
});

describe('the app’s own events and new past records together', () => {
  it('a past "Joined as intern" before an app-recorded confirmation needs a probation start', () => {
    const e = employee({
      stored: { ...employee().stored, confirmationDate: '2024-11-01' },
      events: [...employee().events, appEvent(9, 'CONFIRMED', '2024-11-01')],
    });
    const p = plan(e, rows({ record: 'Joined as intern', date: '2024-05-01' }));
    expect(p.rowErrors).toEqual([
      {
        row: 2,
        field: 'date',
        message: 'They were confirmed on 2024-11-01 with no "Moved to probation" after joining as an intern: add it',
      },
    ]);
    const fixed = plan(
      e,
      rows({ record: 'Joined as intern', date: '2024-05-01' }, { record: 'Moved to probation', date: '2024-08-01' }),
    );
    expect(fixed.rowErrors).toEqual([]);
    expect(fixed.evaluation.after).toMatchObject({ status: 'ACTIVE', probationStartDate: '2024-08-01', confirmationDate: '2024-11-01' });
  });
});

describe('planEmployeeImport: a Joined row on the join date already on file (0037)', () => {
  it('is skipped when it says nothing new, and an error (not silently dropped) when it carries a designation', () => {
    const employee = {
      id: 'e1',
      stored: {
        joinDate: '2024-05-01', status: 'ACTIVE' as const, probationStartDate: '2024-05-01', internshipEndDate: null,
        confirmationDate: null, designation: 'Unassigned', teamId: null, grossSalary: null,
      },
      baselines: null,
      events: [{ key: 'event:1', type: 'JOINED' as const, source: 'APP' as const, effectiveDate: '2024-05-01', fromValue: null, toValue: null, order: 1 }],
      pastAppraisals: [],
      systemAppraisals: [],
      noticeDate: null,
    };
    const join = (to: string | null) => ({
      row: 2,
      record: { kind: 'event' as const, type: 'JOINED' as const, date: '2024-05-01', fromValue: null, toValue: to, notes: null },
    });
    const plain = planEmployeeImport({ employee, rows: [join(null)], today: '2026-10-12', teamIdsByName: new Map() });
    expect(plain.alreadyRecorded).toEqual([2]);
    const withTitle = planEmployeeImport({ employee, rows: [join('Senior Software Engineer')], today: '2026-10-12', teamIdsByName: new Map() });
    expect(withTitle.rowErrors).toEqual([expect.objectContaining({ row: 2, field: 'to', message: expect.stringMatching(/edit.*Joined entry/) })]);
  });
});

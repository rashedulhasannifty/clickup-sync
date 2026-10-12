import {
  foldEmployeeHistory,
  groupOf,
  recomputeEmployee,
  sortHistory,
  type HistoryEvent,
  type HistoryState,
} from './employee-history';

const TEAMS = new Set(['team-a', 'team-b']);
const opts = { knownTeamIds: TEAMS };

let seq = 0;
function ev(
  type: HistoryEvent['type'],
  effectiveDate: string,
  toValue: string | null = null,
  extra: Partial<HistoryEvent> = {},
): HistoryEvent {
  seq++;
  return {
    key: `k${seq}`,
    type,
    source: 'PAST_RECORD',
    effectiveDate,
    fromValue: null,
    toValue,
    order: seq,
    ...extra,
  };
}

/** Imported from logins: ACTIVE, join date = account creation, no history. */
const imported: HistoryState = {
  joinDate: '2024-05-01',
  status: 'ACTIVE',
  probationStartDate: '2024-05-01',
  internshipEndDate: null,
  confirmationDate: null,
  designation: 'Unassigned',
  teamId: null,
  grossSalary: 30000,
};

describe('foldEmployeeHistory', () => {
  it('intern -> probation -> confirmed, with the join date moved to the internship start', () => {
    const s = foldEmployeeHistory(
      imported,
      [
        ev('CONFIRMED', '2021-10-01'),
        ev('JOINED_AS_INTERN', '2021-01-01'),
        ev('PROBATION_STARTED', '2021-04-01'),
      ],
      opts,
    );
    expect(s).toEqual({
      ...imported,
      joinDate: '2021-01-01',
      status: 'ACTIVE',
      probationStartDate: '2021-04-01',
      internshipEndDate: '2021-04-01',
      confirmationDate: '2021-10-01',
    });
  });

  it('stops at probation when there is no confirmation', () => {
    const s = foldEmployeeHistory(
      imported,
      [ev('JOINED_AS_INTERN', '2026-01-01'), ev('PROBATION_STARTED', '2026-04-01')],
      opts,
    );
    expect(s).toMatchObject({ status: 'PROBATION', probationStartDate: '2026-04-01', confirmationDate: null });
  });

  it('an intern record alone makes them an intern with the default 3-month internship', () => {
    const s = foldEmployeeHistory(imported, [ev('JOINED_AS_INTERN', '2026-08-15')], opts);
    expect(s).toMatchObject({
      status: 'INTERN',
      joinDate: '2026-08-15',
      probationStartDate: null,
      internshipEndDate: '2026-11-15',
      confirmationDate: null,
    });
  });

  it('same-day order: joining, then probation, then confirmation, whatever the input order', () => {
    const events = [
      ev('CONFIRMED', '2024-01-01'),
      ev('PROMOTED', '2024-01-01', 'Lead'),
      ev('PROBATION_STARTED', '2024-01-01'),
      ev('JOINED_AS_INTERN', '2024-01-01'),
    ];
    expect(sortHistory(events).map((e) => e.type)).toEqual([
      'JOINED_AS_INTERN',
      'PROBATION_STARTED',
      'CONFIRMED',
      'PROMOTED',
    ]);
    expect(foldEmployeeHistory(imported, events, opts).status).toBe('ACTIVE');
  });

  it('a past Joined moves the join date, and a probation start that sat on it', () => {
    expect(foldEmployeeHistory(imported, [ev('JOINED', '2020-03-01')], opts)).toMatchObject({
      joinDate: '2020-03-01',
      probationStartDate: '2020-03-01',
      status: 'ACTIVE',
    });
    // A probation start of its own stays.
    const own = { ...imported, probationStartDate: '2024-06-01' };
    expect(foldEmployeeHistory(own, [ev('JOINED', '2020-03-01')], opts).probationStartDate).toBe('2024-06-01');
  });

  it('the app’s own JOINED drives nothing (it carries the join date as it was at creation)', () => {
    const app = ev('JOINED', '2019-01-01', null, { source: 'APP' });
    expect(groupOf(app)).toBeNull();
    expect(foldEmployeeHistory(imported, [app], opts)).toEqual(imported);
  });

  it('designation, team and gross: the latest event wins, in date order not input order', () => {
    const s = foldEmployeeHistory(
      imported,
      [
        ev('PROMOTED', '2025-01-01', 'Senior Developer'),
        ev('DESIGNATION_CHANGED', '2023-01-01', 'Developer'),
        ev('INCREMENT', '2025-07-01', '60000'),
        ev('INCREMENT', '2024-07-01', '50000'),
        ev('TRANSFERRED', '2024-02-01', 'team-a'),
        ev('TRANSFERRED', '2025-02-01', 'team-gone'),
      ],
      opts,
    );
    expect(s).toMatchObject({ designation: 'Senior Developer', grossSalary: 60000, teamId: 'team-a' });
  });

  it('an increment that is not whole taka is history only', () => {
    expect(foldEmployeeHistory(imported, [ev('INCREMENT', '2025-07-01', 'about 50k')], opts).grossSalary).toBe(30000);
  });

  it('APP and PAST_RECORD events fold together', () => {
    const s = foldEmployeeHistory(
      imported,
      [
        ev('PROMOTED', '2026-09-01', 'Lead', { source: 'APP' }),
        ev('PROMOTED', '2023-01-01', 'Developer'),
      ],
      opts,
    );
    expect(s.designation).toBe('Lead');
  });

  it('never moves someone on notice (or exited) out of that status', () => {
    const onNotice = { ...imported, status: 'NOTICE' as const };
    const s = foldEmployeeHistory(onNotice, [ev('PROBATION_STARTED', '2024-06-01'), ev('CONFIRMED', '2024-12-01')], opts);
    expect(s).toMatchObject({ status: 'NOTICE', confirmationDate: '2024-12-01', probationStartDate: '2024-06-01' });
  });

  it('notes, notice and exit events are ignored', () => {
    const s = foldEmployeeHistory(
      imported,
      [ev('NOTE', '2025-01-01', 'ACTIVE', { source: 'APP', fromValue: 'NOTICE' }), ev('NOTICE_GIVEN', '2024-01-01', null, { source: 'APP' })],
      opts,
    );
    expect(s).toEqual(imported);
  });
});

describe('recomputeEmployee', () => {
  const app = (type: HistoryEvent['type'], d: string, to: string | null = null) =>
    ev(type, d, to, { source: 'APP', key: `event:${++seq}` });

  it('changes only the fields the new records change, and remembers the baseline', () => {
    const before = [app('JOINED', '2024-05-01')];
    const after = [...before, ev('PROMOTED', '2025-01-01', 'Developer')];
    const r = recomputeEmployee({ stored: imported, baselines: null, before, after, knownTeamIds: TEAMS });
    expect(r.touched).toEqual(['designation']);
    expect(r.changes).toEqual({ designation: 'Developer' });
    expect(r.baselines).toEqual({ designation: { designation: 'Unassigned' } });
  });

  it('is a no-op when nothing changed (a re-apply)', () => {
    const before = [app('JOINED', '2024-05-01'), ev('PROMOTED', '2025-01-01', 'Developer')];
    const stored = { ...imported, designation: 'Developer' };
    const r = recomputeEmployee({
      stored,
      baselines: { designation: { designation: 'Unassigned' } },
      before,
      after: [...before],
      knownTeamIds: TEAMS,
    });
    expect(r).toMatchObject({ touched: [], changes: {}, baselines: { designation: { designation: 'Unassigned' } } });
  });

  it('deleting the last past record of a group restores the remembered values', () => {
    const promo = ev('PROMOTED', '2025-01-01', 'Developer');
    const lifecycle = [ev('JOINED_AS_INTERN', '2021-01-01'), ev('PROBATION_STARTED', '2021-04-01')];
    const stored: HistoryState = {
      ...imported,
      designation: 'Developer',
      joinDate: '2021-01-01',
      status: 'PROBATION',
      probationStartDate: '2021-04-01',
      internshipEndDate: '2021-04-01',
    };
    const baselines = {
      designation: { designation: 'Unassigned' },
      lifecycle: {
        joinDate: '2024-05-01',
        status: 'ACTIVE' as const,
        probationStartDate: '2024-05-01',
        internshipEndDate: null,
        confirmationDate: null,
      },
    };
    const r = recomputeEmployee({
      stored,
      baselines,
      before: [promo, ...lifecycle],
      after: [],
      knownTeamIds: TEAMS,
    });
    expect(r.state).toEqual(imported);
    expect(r.baselines).toEqual({});
  });

  it('a profile edit of an untouched group is never overwritten', () => {
    // Designation was edited by hand after an APP promotion; a past increment does not touch it.
    const stored = { ...imported, designation: 'Typed by hand' };
    const before = [app('PROMOTED', '2026-01-01', 'Lead')];
    const r = recomputeEmployee({
      stored,
      baselines: null,
      before,
      after: [...before, ev('INCREMENT', '2025-07-01', '45000')],
      knownTeamIds: TEAMS,
    });
    expect(r.changes).toEqual({ grossSalary: 45000 });
    expect(r.state.designation).toBe('Typed by hand');
  });

  it('editing a record re-folds from the remembered baseline, not from the current values', () => {
    const old = ev('INCREMENT', '2025-07-01', '45000');
    const edited = { ...old, toValue: '42000' };
    const r = recomputeEmployee({
      stored: { ...imported, grossSalary: 45000 },
      baselines: { gross: { grossSalary: 30000 } },
      before: [old],
      after: [edited],
      knownTeamIds: TEAMS,
    });
    expect(r.changes).toEqual({ grossSalary: 42000 });
    expect(r.baselines).toEqual({ gross: { grossSalary: 30000 } });
  });

  it('keeps a stored NOTICE status, and never restores one from a baseline', () => {
    const stored = { ...imported, status: 'NOTICE' as const };
    const r = recomputeEmployee({
      stored,
      baselines: null,
      before: [],
      after: [ev('PROBATION_STARTED', '2024-06-01'), ev('CONFIRMED', '2024-12-01')],
      knownTeamIds: TEAMS,
    });
    expect(r.state.status).toBe('NOTICE');
    expect(r.changes).toEqual({ probationStartDate: '2024-06-01', confirmationDate: '2024-12-01' });
  });

  it('a lifecycle group with app events re-folds from what is stored', () => {
    // Created as an intern in the app and moved to probation by an approved review.
    const stored: HistoryState = {
      ...imported,
      joinDate: '2026-01-01',
      status: 'PROBATION',
      probationStartDate: '2026-04-01',
      internshipEndDate: '2026-04-01',
    };
    const before = [app('JOINED', '2026-01-01'), app('PROBATION_STARTED', '2026-04-01')];
    const r = recomputeEmployee({
      stored,
      baselines: null,
      before,
      after: [...before, ev('CONFIRMED', '2026-10-01')],
      knownTeamIds: TEAMS,
    });
    expect(r.changes).toEqual({ status: 'ACTIVE', confirmationDate: '2026-10-01' });
    // Lifecycle already had events: the baseline remembered is what was stored then.
    expect(r.baselines.lifecycle).toMatchObject({ status: 'PROBATION' });
  });
});

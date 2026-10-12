import { dhakaInstant } from '../people-dates';
import type { StellarAttendanceParse, StellarDay } from './stellar-csv';
import { planAttendanceImport, planLeaveImport } from './stellar-import-plan';
import type { StellarLeaveParse } from './stellar-leaves-csv';

/** Fake people only. 2026-07-06 is a Monday; 07-04/05 the weekend. */
const emp = (id: string, attendanceId: string, over = {}) => ({
  id,
  fullName: `Employee ${id}`,
  attendanceId,
  joinDate: '2026-01-01',
  exitDate: null,
  ...over,
});

const day = (
  attendanceId: string,
  date: string,
  inMin: number | null,
  over: Partial<StellarDay> = {},
): StellarDay => ({
  attendanceId,
  date,
  firstIn: inMin === null ? null : dhakaInstant(date, inMin),
  lastOut: inMin === null ? null : dhakaInstant(date, inMin + 540),
  sessions: inMin === null ? 0 : 2,
  workedMinutes: inMin === null ? null : 500,
  missingOut: false,
  note: null,
  ...over,
});

const parse = (days: StellarDay[]): StellarAttendanceParse => ({
  days,
  users: [
    { attendanceId: '7', name: 'TEST ALPHA', department: 'R&D' },
    { attendanceId: '8', name: 'TEST BETA', department: 'BPO-A' },
    { attendanceId: '99', name: 'TEST UNKNOWN', department: 'BPO-B' },
  ],
  range: { from: '2026-07-03', to: '2026-07-08' },
  rowsRead: days.length,
  ignoredRows: 0,
  invalidRows: 0,
});

describe('planAttendanceImport', () => {
  const days = [
    day('7', '2026-07-03', 600),
    day('7', '2026-07-04', null), // weekend, no punches: not a day
    day('7', '2026-07-05', 660), // weekend work
    day('7', '2026-07-06', null), // business day, no punches
    day('7', '2026-07-07', 610),
    day('7', '2026-07-08', 620),
    day('99', '2026-07-06', 600),
    day('99', '2026-07-07', 600),
    day('8', '2026-07-06', 570),
  ];
  const plan = planAttendanceImport({
    parse: parse(days),
    employees: [emp('e7', '7'), emp('e8', '8', { joinDate: '2026-07-07' })],
    existing: [
      { employeeId: 'e7', date: '2026-07-03', source: 'DUMMY' },
      { employeeId: 'e7', date: '2026-07-06', source: 'STELLAR_CSV' },
      { employeeId: 'e7', date: '2026-07-07', source: 'DUMMY' },
      { employeeId: 'e7', date: '2026-07-08', source: 'STELLAR_API' },
      // Outside the file range: neither counted nor deleted.
      { employeeId: 'e7', date: '2026-07-01', source: 'DUMMY' },
    ],
    leaves: [
      { id: 'L1', employeeId: 'e7', source: 'dummy', startDate: '2026-07-06', endDate: '2026-07-06' },
      { id: 'L2', employeeId: 'e7', source: 'manual', startDate: '2026-07-06', endDate: '2026-07-06' },
      { id: 'L3', employeeId: 'e7', source: 'stellar', startDate: '2026-07-06', endDate: '2026-07-06' },
      { id: 'L4', employeeId: 'e7', source: 'dummy', startDate: '2026-06-01', endDate: '2026-06-01' },
      { id: 'L5', employeeId: 'eX', source: 'dummy', startDate: '2026-07-06', endDate: '2026-07-06' },
    ],
  });

  it('writes matched days, never over Stellar API rows, and keeps weekend work', () => {
    expect(plan.writes.filter((w) => w.employeeId === 'e7').map((w) => w.date)).toEqual([
      '2026-07-03',
      '2026-07-05',
      '2026-07-06',
      '2026-07-07',
    ]);
    const m = plan.matched.find((x) => x.employeeId === 'e7')!;
    expect(m).toMatchObject({
      days: 4,
      presentDays: 2,
      noPunchDays: 1,
      weekendDays: 1,
      keptApi: 1,
      replacedDummy: 2,
      replacedCsv: 1,
      dummyLeavesDeleted: 1,
      stellarName: 'TEST ALPHA',
      department: 'R&D',
    });
    const w = plan.writes.find((x) => x.date === '2026-07-03')!;
    expect(w).toMatchObject({ sessions: 2, workedMinutes: 500, minutesInOffice: 540 });
  });

  it('deletes only simulated leave of matched employees in the range', () => {
    expect(plan.dummyLeaveIds).toEqual(['L1']);
  });

  it('reports unmatched ids with name and department and never guesses', () => {
    expect(plan.unmatched).toEqual([
      { attendanceId: '99', name: 'TEST UNKNOWN', department: 'BPO-B', count: 2 },
    ]);
    expect(plan.writes.some((w) => w.employeeId === 'eX')).toBe(false);
  });

  it('skips days outside employment', () => {
    expect(plan.matched.find((x) => x.employeeId === 'e8')).toMatchObject({
      days: 0,
      outsideEmployment: 1,
    });
    expect(plan.replaceEmployeeIds.sort()).toEqual(['e7', 'e8']);
  });

  it('is idempotent: planning again over its own result writes the same rows and replaces only CSV', () => {
    const again = planAttendanceImport({
      parse: parse(days),
      employees: [emp('e7', '7'), emp('e8', '8', { joinDate: '2026-07-07' })],
      existing: [
        ...plan.writes.map((w) => ({ employeeId: w.employeeId, date: w.date, source: 'STELLAR_CSV' as const })),
        { employeeId: 'e7', date: '2026-07-08', source: 'STELLAR_API' as const },
      ],
      leaves: [],
    });
    expect(again.writes).toEqual(plan.writes);
    expect(again.totals).toMatchObject({ replacedDummy: 0, replacedCsv: 4, keptApi: 1, dummyLeavesDeleted: 0 });
  });
});

describe('planLeaveImport', () => {
  const leaveParse: StellarLeaveParse = {
    records: [
      { attendanceId: '7', name: 'Test Alpha', type: 'CASUAL', rawType: 'Casual Leave', startDate: '2026-07-02', endDate: '2026-07-06', days: 3, status: 'APPROVED', description: 'Family', applyDate: '2026-06-30', externalId: 'stellar:7:2026-07-02:CASUAL' },
      { attendanceId: '7', name: 'Test Alpha', type: 'SICK', rawType: 'Sick Leave', startDate: '2026-07-08', endDate: '2026-07-08', days: 1, status: 'REJECTED', description: null, applyDate: null, externalId: 'stellar:7:2026-07-08:SICK' },
      { attendanceId: '7', name: 'Test Alpha', type: 'OTHER', rawType: 'Paternity Leave', startDate: '2026-07-09', endDate: '2026-07-09', days: 1, status: 'APPROVED', description: 'Newborn', applyDate: null, externalId: 'stellar:7:2026-07-09:OTHER' },
      { attendanceId: '8', name: 'Test Beta', type: 'SICK', rawType: 'Sick Leave', startDate: '2026-07-02', endDate: '2026-07-02', days: 1, status: 'APPROVED', description: null, applyDate: null, externalId: 'stellar:8:2026-07-02:SICK' },
      { attendanceId: '99', name: 'Test Unknown', type: 'SICK', rawType: 'Sick Leave', startDate: '2026-07-02', endDate: '2026-07-02', days: 1, status: 'APPROVED', description: null, applyDate: null, externalId: 'stellar:99:2026-07-02:SICK' },
    ],
    users: [],
    range: { from: '2026-07-02', to: '2026-07-09' },
    rowsRead: 9,
    skipped: [{ attendanceId: '7', name: 'Test Alpha', date: '2026-07-04', rawType: 'Casual Leave', reason: 'weekend' }],
    warnings: [],
  };
  const plan = planLeaveImport({
    parse: leaveParse,
    employees: [emp('e7', '7'), emp('e8', '8', { exitDate: '2026-06-30' })],
    existing: [
      { id: 'S1', employeeId: 'e7', source: 'stellar', startDate: '2026-07-02', endDate: '2026-07-06' },
      { id: 'D1', employeeId: 'e7', source: 'dummy', startDate: '2026-07-07', endDate: '2026-07-07' },
      { id: 'M1', employeeId: 'e7', source: 'manual', startDate: '2026-07-07', endDate: '2026-07-07' },
      { id: 'S2', employeeId: 'e7', source: 'stellar', startDate: '2026-08-01', endDate: '2026-08-01' },
      { id: 'D2', employeeId: 'e8', source: 'dummy', startDate: '2026-07-03', endDate: '2026-07-03' },
    ],
  });

  it('inserts Stellar-sourced records with stable external ids, rejected ones kept as REJECTED', () => {
    expect(plan.inserts.map((i) => [i.externalId, i.status, i.source])).toEqual([
      ['stellar:7:2026-07-02:CASUAL', 'APPROVED', 'stellar'],
      ['stellar:7:2026-07-08:SICK', 'REJECTED', 'stellar'],
      ['stellar:7:2026-07-09:OTHER', 'APPROVED', 'stellar'],
    ]);
    expect(plan.inserts[0].reason).toBe('Family');
    expect(plan.inserts[2].reason).toBe('[Paternity Leave] Newborn');
  });

  it('replaces only stellar and simulated leave in range, never manual', () => {
    expect(plan.deleteIds.sort()).toEqual(['D1', 'D2', 'S1']);
    expect(plan.matched.find((m) => m.employeeId === 'e7')).toMatchObject({
      replacedStellar: 1,
      dummyLeavesDeleted: 1,
      approvedDays: 4,
      rejectedDays: 1,
    });
  });

  it('skips records outside employment, reports unmatched ids and the parser flags', () => {
    expect(plan.matched.find((m) => m.employeeId === 'e8')).toMatchObject({ outsideEmployment: 1, records: [] });
    expect(plan.unmatched.map((u) => u.attendanceId)).toEqual(['99']);
    expect(plan.totals).toMatchObject({ records: 3, skippedRows: 1, unmatchedIds: 1 });
  });
});

import { toProfile } from './employee-mapper';

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: 'e1',
    orgId: 'org',
    fullName: 'Jahid',
    email: 'jahid@x.test',
    employeeCode: null,
    userId: null,
    clickupUserId: null,
    designation: 'Engineer',
    grade: null,
    department: null,
    teamId: null,
    managerId: null,
    joinDate: new Date('2025-04-15T00:00:00Z'),
    confirmationDate: null,
    exitDate: null,
    status: 'ACTIVE',
    team: null,
    manager: null,
    concernName: null,
    academicQualification: null,
    experienceBeforeJoiningMonths: null,
    startingSalary: null,
    grossSalary: null,
    ...over,
  }) as never;

const appraisal = (
  type: string,
  dueDate: string | null,
  periodEnd: string,
) => ({
  dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
  periodEnd: new Date(`${periodEnd}T00:00:00Z`),
  cycle: { type, periodEnd: new Date(`${periodEnd}T00:00:00Z`) },
});

describe('toProfile nextAppraisal', () => {
  it('a confirmed employee: the next half-yearly, with the yearly also listed', () => {
    // The first anniversary (15 Apr 2026) was appraised, so nothing is overdue.
    const p = toProfile(
      row({ appraisals: [appraisal('YEARLY', '2026-04-15', '2026-04-14')] }),
      '2026-10-12',
    );
    expect(p.nextAppraisal).toEqual({
      type: 'HALF_YEARLY',
      dueDate: '2026-10-15',
      periodStart: '2026-04-15',
      periodEnd: '2026-10-14',
      overdue: false,
    });
    expect(p.upcomingAppraisals.map((a) => a.type)).toEqual([
      'HALF_YEARLY',
      'YEARLY',
    ]);
  });

  it('a missed due date with no appraisal comes first, flagged overdue', () => {
    const p = toProfile(row(), '2026-10-12');
    // On the anniversary both regular types fall due; only the yearly is listed.
    expect(p.nextAppraisal).toEqual({
      type: 'YEARLY',
      dueDate: '2026-04-15',
      periodStart: '2025-04-15',
      periodEnd: '2026-04-14',
      overdue: true,
    });
    // The upcoming list is still the future schedule.
    expect(p.upcomingAppraisals.map((a) => a.dueDate)).toEqual([
      '2026-10-15',
      '2027-04-15',
    ]);
  });

  it('a due date before the confirmation date is never overdue', () => {
    const p = toProfile(
      row({ confirmationDate: new Date('2026-05-01T00:00:00Z') }),
      '2026-10-12',
    );
    expect(p.nextAppraisal).toMatchObject({
      type: 'HALF_YEARLY',
      dueDate: '2026-10-15',
      overdue: false,
    });
  });

  it('a past confirmation is overdue only until it is launched', () => {
    const prob = {
      status: 'PROBATION',
      joinDate: new Date('2026-01-10T00:00:00Z'),
    };
    expect(toProfile(row(prob), '2026-10-12').nextAppraisal).toMatchObject({
      type: 'CONFIRMATION',
      dueDate: '2026-07-10',
      overdue: true,
    });
    const launched = toProfile(
      row({
        ...prob,
        appraisals: [appraisal('CONFIRMATION', '2026-07-10', '2026-07-09')],
      }),
      '2026-10-12',
    );
    expect(launched.nextAppraisal).toMatchObject({
      type: 'CONFIRMATION',
      dueDate: '2026-07-10',
      overdue: false,
    });
  });

  it('on probation: the confirmation', () => {
    const p = toProfile(
      row({ status: 'PROBATION', joinDate: new Date('2026-07-01T00:00:00Z') }),
      '2026-10-12',
    );
    expect(p.nextAppraisal).toMatchObject({
      type: 'CONFIRMATION',
      dueDate: '2027-01-01',
    });
  });

  it('exited: none', () => {
    const p = toProfile(
      row({ status: 'EXITED', exitDate: new Date('2026-09-30T00:00:00Z') }),
      '2026-10-12',
    );
    expect(p.nextAppraisal).toBeNull();
    expect(p.upcomingAppraisals).toEqual([]);
  });
});

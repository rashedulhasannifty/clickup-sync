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

describe('toProfile nextAppraisal', () => {
  it('a confirmed employee: the next half-yearly, with the yearly also listed', () => {
    const p = toProfile(row(), '2026-10-12');
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

import { eventEffects, eventPreconditionError } from './employment-events';

const e = (
  type: Parameters<typeof eventEffects>[0]['type'],
  toValue: string | null = null,
  teamResolves = false,
) => eventEffects({ type, effectiveDate: '2026-04-01', toValue, teamResolves });

describe('eventEffects', () => {
  it('PROMOTED / DESIGNATION_CHANGED set the designation', () => {
    expect(e('PROMOTED', 'Senior Engineer')).toEqual({
      designation: 'Senior Engineer',
    });
    expect(e('DESIGNATION_CHANGED', 'Lead')).toEqual({ designation: 'Lead' });
  });
  it('CONFIRMED sets confirmation date and ACTIVE', () => {
    expect(e('CONFIRMED')).toEqual({
      confirmationDate: '2026-04-01',
      status: 'ACTIVE',
    });
  });
  it('NOTICE_GIVEN -> NOTICE; EXITED sets exit date and EXITED', () => {
    expect(e('NOTICE_GIVEN')).toEqual({ status: 'NOTICE' });
    expect(e('EXITED')).toEqual({ exitDate: '2026-04-01', status: 'EXITED' });
  });
  it('TRANSFERRED moves the team only when the id resolves', () => {
    expect(e('TRANSFERRED', 't1', true)).toEqual({ teamId: 't1' });
    expect(e('TRANSFERRED', 't1', false)).toEqual({});
  });
  it('INCREMENT moves the gross salary only for a whole-taka amount', () => {
    expect(e('INCREMENT', '90400')).toEqual({ grossSalary: 90400 });
    expect(e('INCREMENT', '904.5')).toEqual({});
    expect(e('INCREMENT', null)).toEqual({});
  });
  it('JOINED and NOTE change nothing', () => {
    expect(e('NOTE')).toEqual({});
    expect(e('JOINED')).toEqual({});
  });
});

describe('the intern lifecycle events (0034)', () => {
  it('PROBATION_STARTED sets PROBATION and the probation start', () => {
    expect(e('PROBATION_STARTED')).toEqual({
      status: 'PROBATION',
      probationStartDate: '2026-04-01',
    });
  });
  it('INTERNSHIP_EXTENDED moves the internship end; a non-date is history only', () => {
    expect(e('INTERNSHIP_EXTENDED', '2026-06-30')).toEqual({
      internshipEndDate: '2026-06-30',
    });
    expect(e('INTERNSHIP_EXTENDED', 'soon')).toEqual({});
    expect(e('INTERNSHIP_EXTENDED', '2026-02-30')).toEqual({});
  });

  const pre = (
    type: Parameters<typeof eventPreconditionError>[0]['type'],
    over: Partial<Parameters<typeof eventPreconditionError>[0]> = {},
  ) =>
    eventPreconditionError({
      type,
      effectiveDate: '2026-04-01',
      toValue: null,
      status: 'INTERN',
      joinDate: '2026-01-01',
      internshipEndDate: '2026-03-31',
      ...over,
    });

  it('an intern is never confirmed directly', () => {
    expect(pre('CONFIRMED')).toMatch(/move them to probation first/);
    expect(pre('CONFIRMED', { status: 'PROBATION' })).toBeNull();
  });
  it('only an intern moves to probation, not before joining', () => {
    expect(pre('PROBATION_STARTED')).toBeNull();
    expect(pre('PROBATION_STARTED', { status: 'ACTIVE' })).toMatch(
      /Only an intern/,
    );
    expect(pre('PROBATION_STARTED', { effectiveDate: '2025-12-31' })).toMatch(
      /before the employee joined/,
    );
  });
  it('only an intern’s internship is extended, to a later date', () => {
    expect(pre('INTERNSHIP_EXTENDED', { toValue: '2026-05-31' })).toBeNull();
    expect(pre('INTERNSHIP_EXTENDED', { toValue: '2026-03-31' })).toMatch(
      /after the current one/,
    );
    expect(pre('INTERNSHIP_EXTENDED', { toValue: 'later' })).toMatch(
      /YYYY-MM-DD/,
    );
    expect(
      pre('INTERNSHIP_EXTENDED', {
        toValue: '2026-05-31',
        status: 'PROBATION',
      }),
    ).toMatch(/Only an intern/);
  });
  it('other events have no lifecycle precondition', () => {
    expect(pre('PROMOTED')).toBeNull();
  });
});

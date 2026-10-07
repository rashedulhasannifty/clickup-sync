import { eventEffects } from './employment-events';

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
  it('JOINED and NOTE change nothing', () => {
    expect(e('NOTE')).toEqual({});
    expect(e('JOINED')).toEqual({});
  });
});

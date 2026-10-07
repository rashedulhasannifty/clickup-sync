import {
  ACTIVE_EXIT_STATUSES,
  DEFAULT_CLEARANCE_ITEMS,
  canDo,
  evaluateCompletion,
  isActiveStatus,
  nextStatus,
  statusBeforeExit,
  validateExitDates,
  type ExitStatusValue,
} from './exit-status';

describe('exit status transitions', () => {
  it('advances NOTICE -> INTERVIEW -> CLEARANCE and stops there', () => {
    expect(nextStatus('NOTICE')).toBe('INTERVIEW');
    expect(nextStatus('INTERVIEW')).toBe('CLEARANCE');
    expect(nextStatus('CLEARANCE')).toBeNull();
    expect(nextStatus('COMPLETED')).toBeNull();
    expect(nextStatus('CANCELLED')).toBeNull();
  });

  it('treats exactly NOTICE, INTERVIEW and CLEARANCE as active', () => {
    expect(ACTIVE_EXIT_STATUSES).toEqual(['NOTICE', 'INTERVIEW', 'CLEARANCE']);
    expect(isActiveStatus('COMPLETED')).toBe(false);
    expect(isActiveStatus('CANCELLED')).toBe(false);
  });

  it.each<[ExitStatusValue, boolean, boolean, boolean, boolean, boolean]>([
    // status, edit, advance, complete, cancel, letters
    ['NOTICE', true, true, false, true, true],
    ['INTERVIEW', true, true, false, true, true],
    ['CLEARANCE', true, false, true, true, true],
    ['COMPLETED', false, false, false, false, true],
    ['CANCELLED', false, false, false, false, false],
  ])('%s allows edit=%s advance=%s complete=%s cancel=%s letters=%s', (s, edit, advance, complete, cancel, letters) => {
    expect(canDo(s, 'edit')).toBe(edit);
    expect(canDo(s, 'advance')).toBe(advance);
    expect(canDo(s, 'complete')).toBe(complete);
    expect(canDo(s, 'cancel')).toBe(cancel);
    expect(canDo(s, 'letters')).toBe(letters);
  });
});

describe('statusBeforeExit (what CANCELLED restores)', () => {
  it('keeps PROBATION and ACTIVE as they were', () => {
    expect(statusBeforeExit('PROBATION', null)).toBe('PROBATION');
    expect(statusBeforeExit('ACTIVE', '2026-01-01')).toBe('ACTIVE');
  });
  it('infers the status of someone already on NOTICE from their confirmation date', () => {
    expect(statusBeforeExit('NOTICE', '2026-01-01')).toBe('ACTIVE');
    expect(statusBeforeExit('NOTICE', null)).toBe('PROBATION');
  });
});

describe('evaluateCompletion', () => {
  it('passes when every item is done, with or without a note', () => {
    expect(evaluateCompletion([{ done: true }, { done: true }], null)).toEqual({
      ok: true,
      overridden: false,
      open: 0,
    });
    expect(evaluateCompletion([], 'ignored')).toEqual({
      ok: true,
      overridden: false,
      open: 0,
    });
  });
  it('refuses while items are open and there is no override note', () => {
    expect(evaluateCompletion([{ done: true }, { done: false }], null)).toEqual({
      ok: false,
      open: 1,
    });
    expect(evaluateCompletion([{ done: false }], '   ')).toEqual({
      ok: false,
      open: 1,
    });
  });
  it('accepts open items with a non-blank override note and says it overrode', () => {
    expect(
      evaluateCompletion([{ done: false }, { done: false }], 'Laptop is in transit'),
    ).toEqual({ ok: true, overridden: true, open: 2 });
  });
});

describe('validateExitDates', () => {
  const base = { noticeDate: '2026-10-01', lastWorkingDay: '2026-10-31', joinDate: '2025-01-01' };
  it('accepts a normal notice period and a same-day exit', () => {
    expect(validateExitDates(base)).toBeNull();
    expect(validateExitDates({ ...base, lastWorkingDay: '2026-10-01' })).toBeNull();
  });
  it('rejects a last working day before the notice date or the join date', () => {
    expect(validateExitDates({ ...base, lastWorkingDay: '2026-09-30' })).toMatch(/notice date/);
    expect(
      validateExitDates({ noticeDate: '2024-01-01', lastWorkingDay: '2024-12-31', joinDate: '2025-01-01' }),
    ).toMatch(/join date/);
  });
});

describe('DEFAULT_CLEARANCE_ITEMS', () => {
  it('is the spec list, in order', () => {
    expect(DEFAULT_CLEARANCE_ITEMS).toEqual([
      'Laptop & charger returned',
      'ClickUp access removed',
      'Nifty Timer account disabled',
      'Handover of open tasks',
      'Final settlement / leave encashment',
    ]);
  });
});

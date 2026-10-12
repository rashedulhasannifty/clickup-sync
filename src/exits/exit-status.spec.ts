import {
  ACTIVE_EXIT_STATUSES,
  DEFAULT_CLEARANCE_ITEMS,
  clearanceItemsFor,
  EXIT_INTERVIEW_ITEM_KEY,
  canDo,
  evaluateCompletion,
  isActiveStatus,
  isResolved,
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

describe('isResolved', () => {
  it('is true for done or not applicable, false only for an open item', () => {
    expect(isResolved({ done: true, notApplicable: false })).toBe(true);
    expect(isResolved({ done: false, notApplicable: true })).toBe(true);
    expect(isResolved({ done: false, notApplicable: false })).toBe(false);
  });
});

describe('evaluateCompletion', () => {
  const done = { done: true, notApplicable: false };
  const na = { done: false, notApplicable: true };
  const open = { done: false, notApplicable: false };

  it('passes when every item is done, with or without a note', () => {
    expect(evaluateCompletion([done, done], null)).toEqual({
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
  it('counts a not-applicable item as resolved, so a mix of done and N/A needs no override', () => {
    expect(evaluateCompletion([done, na, na], null)).toEqual({
      ok: true,
      overridden: false,
      open: 0,
    });
  });
  it('refuses while items are open and there is no override note', () => {
    expect(evaluateCompletion([done, na, open], null)).toEqual({
      ok: false,
      open: 1,
    });
    expect(evaluateCompletion([open], '   ')).toEqual({
      ok: false,
      open: 1,
    });
  });
  it('accepts open items with a non-blank override note and says it overrode', () => {
    expect(evaluateCompletion([open, open, na], 'Laptop is in transit')).toEqual({
      ok: true,
      overridden: true,
      open: 2,
    });
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
  it('is the company exit checklist: 15 process tasks, then 6 company assets, in order', () => {
    const process = DEFAULT_CLEARANCE_ITEMS.filter((i) => i.group === 'PROCESS');
    const assets = DEFAULT_CLEARANCE_ITEMS.filter((i) => i.group === 'ASSETS');
    expect(process).toHaveLength(15);
    expect(process[0].label).toBe('Ensure termination paperwork is complete');
    expect(process[14].label).toBe('Update organizational chart');
    expect(assets.map((i) => i.label)).toEqual([
      'Laptop',
      'Phone',
      'Monitor',
      'Mouse and keyboard',
      'ID/Access card',
      'Company vehicle',
    ]);
    // Groups are contiguous: every process task comes before every asset.
    expect(DEFAULT_CLEARANCE_ITEMS.slice(0, 15).every((i) => i.group === 'PROCESS')).toBe(true);
  });

  it('folds ClickUp and Nifty Timer into the software-access line', () => {
    const access = DEFAULT_CLEARANCE_ITEMS.find((i) => i.key === 'remove_software_access');
    for (const tool of ['WhatsApp', 'Teams', 'Slack', 'Face lock', 'Outlook', 'Time Doctor', 'ClickUp', 'Nifty Timer'])
      expect(access?.label).toContain(tool);
  });

  it('gives every item a unique key, including the exit interview the interview step ticks', () => {
    const keys = DEFAULT_CLEARANCE_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_CLEARANCE_ITEMS.find((i) => i.key === EXIT_INTERVIEW_ITEM_KEY)?.label).toBe(
      'Conduct exit interview',
    );
  });
});

describe('clearanceItemsFor', () => {
  it('is the company sheet when nothing was recorded at joining', () => {
    expect(clearanceItemsFor([])).toEqual(
      DEFAULT_CLEARANCE_ITEMS.map((d) => ({
        group: d.group,
        key: d.key,
        label: d.label,
      })),
    );
  });

  it('adds serials to the matching standard asset, several onto one line', () => {
    const items = clearanceItemsFor([
      { key: 'eq_laptop', label: 'Laptop', detail: ' SN-1 ' },
      { key: 'eq_keyboard', label: 'Keyboard', detail: 'K-9' },
      { key: 'eq_mouse', label: 'Mouse', detail: 'M-2' },
    ]);
    expect(items).toHaveLength(DEFAULT_CLEARANCE_ITEMS.length);
    const label = (k: string) => items.find((i) => i.key === k)?.label;
    expect(label('asset_laptop')).toBe('Laptop — SN-1');
    expect(label('asset_mouse_keyboard')).toBe('Mouse and keyboard — K-9, M-2');
  });

  it('leaves a standard asset unchanged when the issued item has no detail', () => {
    const items = clearanceItemsFor([
      { key: 'eq_laptop', label: 'Laptop', detail: '  ' },
    ]);
    expect(items.find((i) => i.key === 'asset_laptop')?.label).toBe('Laptop');
  });

  it('adds other issued equipment as extra assets, skipping stationery', () => {
    const items = clearanceItemsFor([
      { key: 'eq_sim', label: 'SIM card', detail: '01700000000' },
      { key: 'eq_stationery', label: 'Stationery', detail: null },
      { key: null, label: 'Projector', detail: null },
    ]);
    expect(items.slice(DEFAULT_CLEARANCE_ITEMS.length)).toEqual([
      {
        group: 'ASSETS',
        key: 'issued_eq_sim',
        label: 'SIM card (issued at joining) — 01700000000',
      },
      { group: 'ASSETS', key: null, label: 'Projector (issued at joining)' },
    ]);
  });
});

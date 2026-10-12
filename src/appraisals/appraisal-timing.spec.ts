import {
  appraisalTiming,
  arrearsMonths,
  dateEditError,
  defaultEffectiveMode,
  effectiveDateError,
  effectiveDateView,
  isLate,
  resolveEffectiveDate,
  TIMING_GRACE_DAYS,
} from './appraisal-timing';
import { arrearsLine, effectiveLine, timingLine } from './appraisal-form-pdf';

describe('appraisalTiming', () => {
  const due = '2026-01-15';

  it('has a grace of 3 days either side', () => {
    expect(TIMING_GRACE_DAYS).toBe(3);
  });

  it('signed off: on time within the grace, else early or late (boundaries)', () => {
    expect(appraisalTiming(due, '2026-01-15', 'x')).toEqual({
      status: 'ON_TIME',
      days: 0,
    });
    expect(appraisalTiming(due, '2026-01-18', 'x')).toEqual({
      status: 'ON_TIME',
      days: 3,
    });
    expect(appraisalTiming(due, '2026-01-12', 'x')).toEqual({
      status: 'ON_TIME',
      days: -3,
    });
    expect(appraisalTiming(due, '2026-01-19', 'x')).toEqual({
      status: 'LATE',
      days: 4,
    });
    expect(appraisalTiming(due, '2026-01-11', 'x')).toEqual({
      status: 'EARLY',
      days: 4,
    });
    expect(appraisalTiming(due, '2026-03-03', 'x')).toEqual({
      status: 'LATE',
      days: 47,
    });
  });

  it('open: overdue only past the grace, else days until due', () => {
    expect(appraisalTiming(due, null, '2026-01-10')).toEqual({
      status: 'OPEN',
      days: 5,
    });
    expect(appraisalTiming(due, null, '2026-01-18')).toEqual({
      status: 'OPEN',
      days: -3,
    });
    expect(appraisalTiming(due, null, '2026-01-19')).toEqual({
      status: 'OPEN_OVERDUE',
      days: 4,
    });
  });

  it('no due date (calendar cycle): no timing', () => {
    expect(appraisalTiming(null, '2026-01-15', '2026-01-15')).toBeNull();
  });
});

describe('effective date', () => {
  const base = {
    scoringMode: 'FORM_100' as const,
    mode: null,
    customDate: null,
    dueDate: '2026-01-15',
    periodStart: '2025-07-15',
    approvalDate: '2026-03-03',
  };

  it('defaults to the due date when late (same rule as the timing label), else the approval date', () => {
    expect(isLate('2026-01-15', '2026-01-18')).toBe(false);
    expect(isLate('2026-01-15', '2026-01-19')).toBe(true);
    expect(defaultEffectiveMode('FORM_100', '2026-01-15', '2026-01-19')).toBe(
      'DUE_DATE',
    );
    expect(defaultEffectiveMode('FORM_100', '2026-01-15', '2026-01-18')).toBe(
      'APPROVAL_DATE',
    );
    expect(defaultEffectiveMode('FORM_100', '2026-01-15', '2026-01-01')).toBe(
      'APPROVAL_DATE',
    );
    expect(defaultEffectiveMode('FORM_100', null, '2026-03-03')).toBe(
      'APPROVAL_DATE',
    );
    // Legacy cycles have no approval step to choose in.
    expect(defaultEffectiveMode('KPI_BLEND', '2026-01-15', '2026-03-03')).toBe(
      'APPROVAL_DATE',
    );
  });

  it('resolves each mode', () => {
    expect(resolveEffectiveDate(base)).toEqual({
      ok: true,
      mode: 'DUE_DATE',
      date: '2026-01-15',
    });
    expect(resolveEffectiveDate({ ...base, mode: 'APPROVAL_DATE' })).toEqual({
      ok: true,
      mode: 'APPROVAL_DATE',
      date: '2026-03-03',
    });
    expect(
      resolveEffectiveDate({
        ...base,
        mode: 'CUSTOM',
        customDate: '2026-02-01',
      }),
    ).toEqual({
      ok: true,
      mode: 'CUSTOM',
      date: '2026-02-01',
    });
  });

  it('CUSTOM needs a date not before the review period; DUE_DATE needs a due date', () => {
    expect(effectiveDateError({ ...base, mode: 'CUSTOM' })).toMatch(
      /Choose the date/,
    );
    expect(
      effectiveDateError({ ...base, mode: 'CUSTOM', customDate: '2025-07-14' }),
    ).toMatch(/before the review period/);
    expect(
      effectiveDateError({ ...base, mode: 'CUSTOM', customDate: '2025-07-15' }),
    ).toBeNull();
    expect(
      effectiveDateError({ ...base, mode: 'DUE_DATE', dueDate: null }),
    ).toMatch(/no due date/);
    expect(
      resolveEffectiveDate({ ...base, mode: 'DUE_DATE', dueDate: null }).ok,
    ).toBe(false);
  });

  it('counts whole months of arrears for an approved, backdated increment only', () => {
    const a = {
      decision: 'APPROVED' as const,
      actions: ['INCREMENT' as const],
      effectiveDate: '2026-01-15',
      approvalDate: '2026-03-03',
    };
    expect(arrearsMonths(a)).toBe(1);
    expect(arrearsMonths({ ...a, approvalDate: '2026-04-15' })).toBe(3);
    expect(arrearsMonths({ ...a, effectiveDate: '2026-03-03' })).toBe(0);
    expect(arrearsMonths({ ...a, actions: ['CONFIRM'] })).toBe(0);
    expect(arrearsMonths({ ...a, decision: 'NOT_APPROVED' })).toBe(0);
  });

  it('the view: a preview before sign-off, the stored values after', () => {
    const v = effectiveDateView({
      ...base,
      decision: 'APPROVED',
      actions: ['INCREMENT'],
      frozen: null,
    });
    expect(v).toEqual({
      mode: 'DUE_DATE',
      date: '2026-01-15',
      defaulted: true,
      backdated: true,
      arrearsMonths: 1,
    });
    const frozen = effectiveDateView({
      ...base,
      decision: 'APPROVED',
      actions: ['CONFIRM'],
      frozen: { mode: 'APPROVAL_DATE', date: '2026-03-03' },
    });
    expect(frozen).toEqual({
      mode: 'APPROVAL_DATE',
      date: '2026-03-03',
      defaulted: false,
      backdated: false,
      arrearsMonths: 0,
    });
    expect(
      effectiveDateView({
        ...base,
        mode: 'CUSTOM',
        decision: null,
        actions: [],
        frozen: null,
      }),
    ).toBeNull();
  });
});

describe('dateEditError', () => {
  const ok = {
    joinDate: '2025-01-20',
    periodStart: '2026-01-20',
    periodEnd: '2026-07-19',
    dueDate: '2026-07-20',
  };
  it('accepts a period that ends on or before the due date', () => {
    expect(dateEditError(ok)).toBeNull();
    expect(dateEditError({ ...ok, periodEnd: '2026-07-20' })).toBeNull();
    expect(dateEditError({ ...ok, dueDate: null })).toBeNull();
  });
  it('refuses an inverted period, one before joining, one past the due date, or a due date before joining', () => {
    expect(dateEditError({ ...ok, periodStart: '2026-07-20' })).toMatch(
      /start on or before/,
    );
    expect(dateEditError({ ...ok, periodStart: '2025-01-19' })).toMatch(
      /before the employee joined/,
    );
    expect(dateEditError({ ...ok, periodEnd: '2026-07-21' })).toMatch(
      /end on or before the due date/,
    );
    expect(
      dateEditError({
        ...ok,
        periodStart: '2025-01-20',
        periodEnd: '2025-01-20',
        dueDate: '2025-01-01',
      }),
    ).toMatch(/due date cannot be before/);
    expect(
      dateEditError({
        ...ok,
        joinDate: '2020-01-01',
        periodStart: '2020-01-01',
        periodEnd: '2026-07-19',
      }),
    ).toMatch(/two years/);
  });
});

describe('PDF lines', () => {
  it('reads like the form: due, signed off and how late', () => {
    expect(
      timingLine('2026-01-15', '2026-03-03', { status: 'LATE', days: 47 }),
    ).toBe('Due 15 Jan 2026 · signed off 3 Mar 2026 (47 days late)');
    expect(
      timingLine('2026-01-15', '2026-01-16', { status: 'ON_TIME', days: 1 }),
    ).toBe('Due 15 Jan 2026 · signed off 16 Jan 2026 (on time)');
    expect(
      timingLine('2026-01-15', null, { status: 'OPEN_OVERDUE', days: 27 }),
    ).toBe('Due 15 Jan 2026 · open, 27 days overdue');
    expect(timingLine(null, null, null)).toBeNull();
  });
  it('says when the outcome is backdated, and the arrears months', () => {
    expect(
      effectiveLine({
        mode: 'DUE_DATE',
        date: '2026-01-15',
        defaulted: false,
        backdated: true,
        arrearsMonths: 1,
      }),
    ).toBe('Effective from 15 Jan 2026 (backdated to the due date)');
    expect(
      effectiveLine({
        mode: 'APPROVAL_DATE',
        date: '2026-03-03',
        defaulted: false,
        backdated: false,
        arrearsMonths: 0,
      }),
    ).toBe('Effective from 3 Mar 2026');
    expect(arrearsLine(1)).toMatch(/^1 month of increment arrears/);
    expect(arrearsLine(0)).toBeNull();
  });
});

import {
  excelSerialToIso,
  normalizeRow,
  parseActions,
  parseAppraisalType,
  parseDate,
  parseGrade,
  parseMarks,
  parseMoney,
  parsePercent,
  parseRecordKind,
} from './past-record-input';

const value = <T>(p: { ok: true; value: T } | { ok: false; error: string }) => {
  if (!p.ok) throw new Error(p.error);
  return p.value;
};

describe('parseRecordKind', () => {
  it.each([
    ['Joined', 'JOINED'],
    ['joined as intern', 'JOINED_AS_INTERN'],
    ['JOINED AS INTERN', 'JOINED_AS_INTERN'],
    ['Moved to probation', 'PROBATION_STARTED'],
    ['moved-to-probation', 'PROBATION_STARTED'],
    ['Confirmed', 'CONFIRMED'],
    ['Promotion', 'PROMOTED'],
    ['Designation change', 'DESIGNATION_CHANGED'],
    ['Transfer', 'TRANSFERRED'],
    ['Increment', 'INCREMENT'],
    ['  appraisal ', 'APPRAISAL'],
    ['PROMOTED', 'PROMOTED'],
  ])('%s -> %s', (label, kind) => {
    expect(value(parseRecordKind(label))).toBe(kind);
  });

  it('refuses exits with a pointer to offboarding, and unknown labels with the list', () => {
    expect(parseRecordKind('Resigned')).toEqual({
      ok: false,
      error: expect.stringMatching(/Start offboarding/),
    });
    expect(parseRecordKind('EXITED')).toEqual({ ok: false, error: expect.stringMatching(/offboarding/) });
    expect(parseRecordKind('Bonus')).toEqual({
      ok: false,
      error: expect.stringMatching(/Unknown record type "Bonus".*Joined as intern/),
    });
    expect(parseRecordKind('')).toEqual({ ok: false, error: 'Record type is missing' });
  });
});

describe('parseDate', () => {
  it('reads YYYY-MM-DD and day-first DD/MM/YYYY', () => {
    expect(value(parseDate('2024-01-05'))).toBe('2024-01-05');
    expect(value(parseDate('05/01/2024'))).toBe('2024-01-05');
    expect(value(parseDate('5/1/2024'))).toBe('2024-01-05');
    expect(value(parseDate('03.04.2024'))).toBe('2024-04-03');
    expect(value(parseDate('03-04-2024'))).toBe('2024-04-03');
    expect(value(parseDate('2024-1-5'))).toBe('2024-01-05');
  });

  it('takes the date part of an ISO timestamp', () => {
    expect(value(parseDate('2024-02-29T00:00:00.000Z'))).toBe('2024-02-29');
  });

  it('reads Excel serial day numbers, as numbers and as text', () => {
    expect(excelSerialToIso(45292)).toBe('2024-01-01');
    expect(value(parseDate(45292))).toBe('2024-01-01');
    expect(value(parseDate('45351'))).toBe('2024-02-29');
    expect(value(parseDate(45292.75))).toBe('2024-01-01'); // a time of day is dropped
  });

  it('refuses impossible and ambiguous dates', () => {
    expect(parseDate('31/02/2024').ok).toBe(false);
    expect(parseDate('2023-02-29').ok).toBe(false);
    expect(parseDate('12/25/2024').ok).toBe(false); // month-first: month 25
    expect(parseDate('Jan 5 2024')).toEqual({
      ok: false,
      error: expect.stringMatching(/YYYY-MM-DD or DD\/MM\/YYYY/),
    });
    expect(parseDate(undefined, 'Due date')).toEqual({ ok: false, error: 'Due date is missing' });
    expect(parseDate(0).ok).toBe(false);
  });
});

describe('numbers', () => {
  it('reads whole-taka money with separators and currency marks', () => {
    expect(value(parseMoney('1,25,000', 'x'))).toBe(125000);
    expect(value(parseMoney('BDT 50000', 'x'))).toBe(50000);
    expect(value(parseMoney('50000 tk', 'x'))).toBe(50000);
    expect(value(parseMoney(50000, 'x'))).toBe(50000);
    expect(value(parseMoney('', 'x'))).toBeNull();
    expect(parseMoney('50000.5', 'Gross')).toEqual({ ok: false, error: 'Gross must be whole taka' });
    expect(parseMoney('-5', 'Gross').ok).toBe(false);
    expect(parseMoney('0', 'Gross').ok).toBe(false);
    expect(parseMoney('abc', 'Gross')).toEqual({ ok: false, error: 'Gross is not a number' });
  });

  it('reads percentages', () => {
    expect(value(parsePercent('12%', 'x'))).toBe(12);
    expect(value(parsePercent('12.5 %', 'x'))).toBe(12.5);
    expect(value(parsePercent(10, 'x'))).toBe(10);
    expect(parsePercent('0', 'x').ok).toBe(false);
    expect(parsePercent('ten', 'x').ok).toBe(false);
  });

  it('reads marks 0-100 and grades A-F', () => {
    expect(value(parseMarks('87.5'))).toBe(87.5);
    expect(value(parseMarks(0))).toBe(0);
    expect(parseMarks('101')).toEqual({ ok: false, error: 'Marks must be between 0 and 100' });
    expect(parseMarks('-1').ok).toBe(false);
    expect(value(parseGrade('b'))).toBe('B');
    expect(value(parseGrade(''))).toBeNull();
    expect(parseGrade('G').ok).toBe(false);
    expect(parseGrade('A+').ok).toBe(false);
  });
});

describe('appraisal fields', () => {
  it('types: Yearly by default, the four labels and the enum values', () => {
    expect(value(parseAppraisalType(''))).toBe('YEARLY');
    expect(value(parseAppraisalType('Half-yearly'))).toBe('HALF_YEARLY');
    expect(value(parseAppraisalType('half yearly'))).toBe('HALF_YEARLY');
    expect(value(parseAppraisalType('Confirmation'))).toBe('CONFIRMATION');
    expect(value(parseAppraisalType('Internship review'))).toBe('INTERNSHIP');
    expect(value(parseAppraisalType('YEARLY'))).toBe('YEARLY');
    expect(parseAppraisalType('Quarterly').ok).toBe(false);
  });

  it('actions: a comma list of labels, de-duplicated', () => {
    expect(value(parseActions('Increment, Promotion'))).toEqual(['INCREMENT', 'PROMOTION']);
    expect(value(parseActions('confirm; increment; Increment'))).toEqual(['CONFIRM', 'INCREMENT']);
    expect(value(parseActions('Training/Transfer'))).toEqual(['TRAINING_TRANSFER']);
    expect(value(parseActions(''))).toEqual([]);
    expect(parseActions('Increment, Bonus')).toEqual({
      ok: false,
      error: expect.stringMatching(/Unknown action "Bonus"/),
    });
  });
});

describe('normalizeRow', () => {
  it('a promotion: designation text, the employee by email (lower-cased) or code', () => {
    expect(
      normalizeRow({ employee: 'Ana@X.test', record: 'Promotion', date: '15/01/2024', to: 'Senior Developer', from: 'Developer' }),
    ).toEqual({
      ok: true,
      employee: { email: 'ana@x.test' },
      record: {
        kind: 'event',
        type: 'PROMOTED',
        date: '2024-01-15',
        fromValue: 'Developer',
        toValue: 'Senior Developer',
        notes: null,
      },
    });
    const byCode = normalizeRow({ employee: 'E-007', record: 'Confirmed', date: '2024-01-15' });
    expect(byCode).toMatchObject({ ok: true, employee: { code: 'E-007' } });
  });

  it('a promotion or transfer needs "to"', () => {
    expect(normalizeRow({ employee: 'a@x', record: 'Promotion', date: '2024-01-01' })).toEqual({
      ok: false,
      errors: [{ field: 'to', message: expect.stringMatching(/new designation/) }],
    });
    expect(normalizeRow({ employee: 'a@x', record: 'Transfer', date: '2024-01-01' })).toEqual({
      ok: false,
      errors: [{ field: 'to', message: expect.stringMatching(/new team name/) }],
    });
  });

  it('an increment from old and new gross: the percent goes in the notes', () => {
    const r = normalizeRow({ employee: 'a@x', record: 'Increment', date: '2024-07-01', from: '40,000', to: 44000, notes: 'Annual' });
    expect(r).toMatchObject({
      ok: true,
      record: { type: 'INCREMENT', fromValue: '40000', toValue: '44000', notes: '10% · Annual' },
    });
  });

  it('an increment from the new gross and a percent works out the old gross', () => {
    const r = normalizeRow({ employee: 'a@x', record: 'Increment', date: '2024-07-01', to: '55000', amount: '10%' });
    expect(r).toMatchObject({ ok: true, record: { fromValue: '50000', toValue: '55000', notes: '10%' } });
  });

  it('an increment from the old gross and a percent works out the new gross', () => {
    const r = normalizeRow({ employee: 'a@x', record: 'Increment', date: '2024-07-01', from: 50000, amount: 12 });
    expect(r).toMatchObject({ ok: true, record: { fromValue: '50000', toValue: '56000', notes: '12%' } });
  });

  it('an amount over 100 with no "to" is the new gross', () => {
    const r = normalizeRow({ employee: 'a@x', record: 'Increment', date: '2024-07-01', amount: '60000' });
    expect(r).toMatchObject({ ok: true, record: { fromValue: null, toValue: '60000', notes: null } });
  });

  it('refuses an increment with no new gross, a lower new gross, or fractions, without quoting figures', () => {
    const none = normalizeRow({ employee: 'a@x', record: 'Increment', date: '2024-07-01', amount: '10%' });
    expect(none).toEqual({ ok: false, errors: [{ field: 'to', message: expect.stringMatching(/needs the new gross/) }] });
    const lower = normalizeRow({ employee: 'a@x', record: 'Increment', date: '2024-07-01', from: 60000, to: 50000 });
    expect(lower).toEqual({ ok: false, errors: [{ field: 'to', message: 'The new gross must be higher than the old gross' }] });
    const frac = normalizeRow({ employee: 'a@x', record: 'Increment', date: '2024-07-01', to: '50000.50' });
    expect(frac.ok).toBe(false);
    for (const r of [none, lower, frac])
      if (!r.ok) for (const e of r.errors) expect(e.message).not.toMatch(/\d{4,}/);
  });

  it('amount on a non-increment row is an error', () => {
    expect(normalizeRow({ employee: 'a@x', record: 'Confirmed', date: '2024-01-01', amount: '5%' })).toEqual({
      ok: false,
      errors: [{ field: 'amount', message: 'Amount is only used on Increment rows' }],
    });
  });

  it('an appraisal: Yearly by default, the grade derived from the marks when not given', () => {
    const r = normalizeRow({ employee: 'a@x', record: 'Appraisal', date: '2025-04-03', marks: '84', actions: 'Increment, Promotion', outcome: 'Promoted', dueDate: '01/04/2025' });
    expect(r).toEqual({
      ok: true,
      employee: { email: 'a@x' },
      record: {
        kind: 'appraisal',
        type: 'YEARLY',
        conductedOn: '2025-04-03',
        dueDate: '2025-04-01',
        marks: 84,
        grade: 'B',
        outcome: 'Promoted',
        actions: ['INCREMENT', 'PROMOTION'],
        notes: null,
      },
    });
    const given = normalizeRow({ employee: 'a@x', record: 'Appraisal', date: '2025-04-03', grade: 'a', appraisalType: 'Confirmation' });
    expect(given).toMatchObject({ ok: true, record: { grade: 'A', marks: null, type: 'CONFIRMATION', dueDate: null } });
  });

  it('collects every field error of a row at once', () => {
    const r = normalizeRow({ record: 'Appraisal', date: '31/02/2024', marks: '120', grade: 'Z' });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.map((e) => e.field).sort()).toEqual(['date', 'employee', 'grade', 'marks']);
  });

  it('the editor path needs no employee', () => {
    expect(normalizeRow({ record: 'Confirmed', date: '2024-01-01' }, { requireEmployee: false })).toMatchObject({
      ok: true,
      employee: null,
    });
  });
});

describe('normalizeRow: the designation they joined as (0037)', () => {
  it('keeps "to" on a join as the designation, and leaves it null when empty', () => {
    const r = normalizeRow({ record: 'Joined', date: '2024-01-01', to: ' Senior Software Engineer ' }, { requireEmployee: false });
    expect(r.ok && r.record.kind === 'event' && r.record.toValue).toBe('Senior Software Engineer');
    const i = normalizeRow({ record: 'Joined as intern', date: '2024-01-01' }, { requireEmployee: false });
    expect(i.ok && i.record.kind === 'event' && i.record.toValue).toBeNull();
  });
});

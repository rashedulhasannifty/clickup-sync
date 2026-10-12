import {
  cellValue,
  dialogErrors,
  excelSerialToIso,
  headerKey,
  RECORD_KINDS,
  rowsFromCells,
  TEMPLATE_COLUMNS,
} from '../apps/web/src/lib/pastRecords';
import { normalizeRow, RECORD_LABEL } from '../src/people/past-records/past-record-input';

const HEADER = TEMPLATE_COLUMNS.map((c) => c.header);

describe('past records in the browser: reading the sheet', () => {
  it('the template’s labels are exactly the ones the server reads', () => {
    expect(RECORD_KINDS.map((k) => k.label)).toEqual(Object.values(RECORD_LABEL));
    for (const k of RECORD_KINDS) {
      const r = normalizeRow({ employee: 'a@x', record: k.label, date: '2024-01-01', to: '1000', from: '500' });
      // Only a refused record label would make `record` the failing field.
      if (!r.ok) expect(r.errors.map((e) => e.field)).not.toContain('record');
    }
  });

  it('maps headers loosely: the template’s, plain names, and a few aliases', () => {
    expect(HEADER.map(headerKey)).toEqual(TEMPLATE_COLUMNS.map((c) => c.key));
    expect(headerKey('Email')).toBe('employee');
    expect(headerKey('  APPRAISAL TYPE ')).toBe('appraisalType');
    expect(headerKey('Due Date')).toBe('dueDate');
    expect(headerKey('Something else')).toBeNull();
    // The prefilled template's name column is for reading only.
    expect(headerKey('Name (not imported)')).toBeNull();
  });

  it('cells: date cells and Excel serials become YYYY-MM-DD, rich text and formulas their text', () => {
    expect(cellValue(new Date(Date.UTC(2024, 0, 5)), 'date')).toBe('2024-01-05');
    expect(cellValue(45292, 'date')).toBe('2024-01-01');
    expect(excelSerialToIso(45351)).toBe('2024-02-29');
    expect(cellValue(45292, 'to')).toBe(45292); // a gross is not a date
    expect(cellValue({ richText: [{ text: 'Pro' }, { text: 'motion' }] })).toBe('Promotion');
    expect(cellValue({ formula: 'A1*1.1', result: 44000 }, 'to')).toBe(44000);
    expect(cellValue({ text: 'a@x.test', hyperlink: 'mailto:a@x.test' })).toBe('a@x.test');
    expect(cellValue('   ')).toBeUndefined();
    expect(cellValue(null)).toBeUndefined();
  });

  it('rows keep their sheet row numbers; blank and example rows are skipped', () => {
    const cells: unknown[][] = [
      HEADER,
      ['name@company.com', 'Joined as intern', '2023-01-02', null, null, null, null, null, null, null, null, null, 'EXAMPLE: delete this row'],
      [],
      ['ana@x.test', 'Promotion', new Date(Date.UTC(2024, 0, 15)), 'Developer', 'Senior Developer'],
      ['E-7', 'Appraisal', 45292, null, null, null, 'b', 84, 'Yearly', 'Increment, Promotion', null, 'Promoted'],
    ];
    const read = rowsFromCells(cells, [1, 2, 3, 4, 5]);
    expect(read.problems).toEqual([]);
    expect(read.skippedExamples).toBe(1);
    expect(read.rows).toEqual([
      { row: 4, employee: 'ana@x.test', record: 'Promotion', date: '2024-01-15', from: 'Developer', to: 'Senior Developer' },
      {
        row: 5,
        employee: 'E-7',
        record: 'Appraisal',
        date: '2024-01-01',
        grade: 'b',
        marks: 84,
        appraisalType: 'Yearly',
        actions: 'Increment, Promotion',
        outcome: 'Promoted',
      },
    ]);
    // What the browser sends, the server reads.
    for (const row of read.rows) expect(normalizeRow(row).ok).toBe(true);
  });

  it('a CSV-like sheet with the header further down, and the missing-column and empty cases', () => {
    const read = rowsFromCells([[], ['Email', 'Record', 'Date'], ['a@x', 'Confirmed', '01/02/2024']]);
    expect(read.rows).toEqual([{ row: 3, employee: 'a@x', record: 'Confirmed', date: '01/02/2024' }]);
    expect(rowsFromCells([['Name', 'When'], ['A', '2024-01-01']]).problems).toEqual([
      'No "Employee (email or code)" column. Start from the template.',
      'No "Record" column. Start from the template.',
      'No "Date" column. Start from the template.',
    ]);
    expect(rowsFromCells([]).problems).toEqual(['The sheet is empty.']);
    expect(rowsFromCells([HEADER, ['x@y', 'Joined', '2024-01-01', '', '', '', '', '', '', '', '', '', 'EXAMPLE']]).problems).toEqual([
      'Only the example rows are filled in. Add your records below them (or replace them).',
    ]);
  });
});

describe('the "Add past record" dialog checks', () => {
  const blank = { date: '2025-01-01', from: '', to: '', amount: '', grade: '', marks: '' };
  const today = '2026-10-12';
  it('needs a date, not in the future', () => {
    expect(dialogErrors('CONFIRMED', { ...blank, date: '' }, today)).toEqual({ date: 'Set the date.' });
    expect(dialogErrors('CONFIRMED', { ...blank, date: '2026-10-13' }, today)).toEqual({ date: 'The date cannot be in the future.' });
    expect(dialogErrors('CONFIRMED', blank, today)).toEqual({});
  });
  it('promotions need a designation, transfers a team', () => {
    expect(dialogErrors('PROMOTED', blank, today)).toEqual({ to: 'Enter the new designation.' });
    expect(dialogErrors('TRANSFERRED', blank, today)).toEqual({ to: 'Choose the team.' });
  });
  it('increments: whole taka, a new gross (or old gross and %), and higher than before', () => {
    expect(dialogErrors('INCREMENT', blank, today).to).toMatch(/new gross/);
    expect(dialogErrors('INCREMENT', { ...blank, from: '40,000', amount: '10' }, today)).toEqual({});
    expect(dialogErrors('INCREMENT', { ...blank, to: '45000.5' }, today)).toEqual({ to: 'Whole taka, more than zero.' });
    expect(dialogErrors('INCREMENT', { ...blank, from: '50000', to: '45000' }, today)).toEqual({
      to: 'The new gross must be higher than the old gross.',
    });
    expect(dialogErrors('INCREMENT', { ...blank, to: '45000', amount: 'ten' }, today)).toEqual({ amount: 'A percentage, e.g. 12 or 12.5%.' });
  });
  it('appraisals: grade A-F and marks 0-100', () => {
    expect(dialogErrors('APPRAISAL', { ...blank, grade: 'G', marks: '101' }, today)).toEqual({ grade: 'A to F.', marks: '0 to 100.' });
    expect(dialogErrors('APPRAISAL', { ...blank, grade: 'b', marks: '84' }, today)).toEqual({});
  });
});

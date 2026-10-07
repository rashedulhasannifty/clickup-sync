import { buildLetter, formatLongDate, type LetterInput } from './letter-content';

const input = (over: Partial<LetterInput> = {}): LetterInput => ({
  kind: 'experience',
  companyName: 'Acme Ltd',
  employeeName: 'Ada Lovelace',
  employeeCode: 'E-014',
  designation: 'Senior Engineer',
  department: 'Engineering',
  joinDate: '2024-03-04',
  noticeDate: '2026-10-01',
  lastWorkingDay: '2026-10-31',
  exitType: 'RESIGNATION',
  issuedOn: '2026-10-07',
  ...over,
});

describe('formatLongDate', () => {
  it('uses a month-name table', () => {
    expect(formatLongDate('2026-10-07')).toBe('7 October 2026');
    expect(formatLongDate('2025-01-31')).toBe('31 January 2025');
    expect(formatLongDate('2026-12-01')).toBe('1 December 2026');
  });
  it('hands back anything that is not a date unchanged', () => {
    expect(formatLongDate('soon')).toBe('soon');
    expect(formatLongDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('experience letter', () => {
  const l = buildLetter(input());
  it('is filed as EXPERIENCE_LETTER with a readable file name', () => {
    expect(l.docType).toBe('EXPERIENCE_LETTER');
    expect(l.fileName).toBe('Experience letter - Ada Lovelace.pdf');
    expect(l.title).toBe('Experience Letter');
  });
  it('states name, company, designation, department and both dates', () => {
    const body = l.paragraphs.join('\n');
    expect(body).toContain('Ada Lovelace was employed by Acme Ltd as Senior Engineer in the Engineering department');
    expect(body).toContain('from 4 March 2024 to 31 October 2026');
  });
  it('carries the issue date, the employee code and the company as signatory', () => {
    expect(l.dateLine).toBe('Date: 7 October 2026');
    expect(l.referenceLine).toBe('Employee code: E-014');
    expect(l.signatory).toEqual(['Human Resources', 'Acme Ltd']);
  });
  it('omits the department and the reference when there are none', () => {
    const bare = buildLetter(input({ department: null, employeeCode: null }));
    expect(bare.paragraphs.join('\n')).not.toContain('department');
    expect(bare.referenceLine).toBeNull();
  });
  it('uses no gendered pronouns', () => {
    const text = [...l.paragraphs, ...buildLetter(input({ kind: 'release' })).paragraphs].join(' ');
    expect(text).not.toMatch(/\b(he|she|his|her|him|hers)\b/i);
  });
});

describe('release letter', () => {
  it('is filed as RELEASE_LETTER and addressed to the employee', () => {
    const l = buildLetter(input({ kind: 'release' }));
    expect(l.docType).toBe('RELEASE_LETTER');
    expect(l.fileName).toBe('Release letter - Ada Lovelace.pdf');
    expect(l.salutation).toBe('Dear Ada Lovelace,');
  });
  it('cites the notice date for a resignation and releases from the last working day', () => {
    const body = buildLetter(input({ kind: 'release' })).paragraphs.join('\n');
    expect(body).toContain('resignation of Ada Lovelace (Senior Engineer), notified on 1 October 2026');
    expect(body).toContain('close of business on 31 October 2026');
    expect(body).toContain('joined Acme Ltd on 4 March 2024');
  });
  it('words a termination, a contract end and other exits differently', () => {
    const open = (exitType: LetterInput['exitType']) =>
      buildLetter(input({ kind: 'release', exitType })).paragraphs[0];
    expect(open('TERMINATION')).toContain('the employment of Ada Lovelace (Senior Engineer) with Acme Ltd ends');
    expect(open('CONTRACT_END')).toContain('ends on completion of its term');
    expect(open('OTHER')).toContain('is released from employment with Acme Ltd');
    expect(open('TERMINATION')).not.toContain('resignation');
  });
});

describe('file names', () => {
  it('strips path separators and characters Content-Disposition dislikes', () => {
    const l = buildLetter(input({ employeeName: 'A/B: "C"*' }));
    expect(l.fileName).toBe('Experience letter - A B C.pdf');
  });
  it('falls back to a placeholder name', () => {
    expect(buildLetter(input({ employeeName: '///' })).fileName).toBe('Experience letter - Employee.pdf');
  });
  it('falls back to a generic company when the organisation has no name', () => {
    expect(buildLetter(input({ companyName: '  ' })).company).toBe('The Company');
  });
});

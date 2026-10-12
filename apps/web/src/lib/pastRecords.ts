import type { PastRecordRow } from '../api/pastRecords';

/**
 * Past records in the browser: the record types HR can enter, the template's
 * columns, and turning a spreadsheet's cells into rows for the server. Pure (no
 * ExcelJS, no DOM) so it is tested from the root jest suite. The server checks
 * every value again (`normalizeRow`); this only reads the sheet faithfully.
 */

export type RecordKind =
  | 'JOINED'
  | 'JOINED_AS_INTERN'
  | 'PROBATION_STARTED'
  | 'CONFIRMED'
  | 'PROMOTED'
  | 'DESIGNATION_CHANGED'
  | 'TRANSFERRED'
  | 'INCREMENT'
  | 'APPRAISAL';

export type RecordField = 'from' | 'to' | 'amount' | 'appraisal';

export interface RecordKindInfo {
  kind: RecordKind;
  /** What HR types in the Record column (and what the server reads). */
  label: string;
  /** One plain sentence: what it is and what it changes. */
  hint: string;
  /** How to fill the row, for the "How to fill" sheet. */
  howTo: string;
  fields: RecordField[];
}

export const RECORD_KINDS: RecordKindInfo[] = [
  {
    kind: 'JOINED',
    label: 'Joined',
    hint: 'The real join date, when it differs from the one on file.',
    howTo:
      'Date = the day they joined. To = the designation they joined as (optional). A row with the join date already on file is skipped; to set "Joined as" for it, edit the Joined entry on the employee page.',
    fields: ['to'],
  },
  {
    kind: 'JOINED_AS_INTERN',
    label: 'Joined as intern',
    hint: 'They started as an intern. Sets the join date and the internship.',
    howTo: 'Date = the first day of the internship. To = the designation they joined as (optional). Use this (in place of the Joined row) for people who started as interns.',
    fields: ['to'],
  },
  {
    kind: 'PROBATION_STARTED',
    label: 'Moved to probation',
    hint: 'Probation began. Confirmation and yearly appraisals count from this date.',
    howTo: 'Date = the first day of probation. After an internship, usually the day after it ended.',
    fields: [],
  },
  {
    kind: 'CONFIRMED',
    label: 'Confirmed',
    hint: 'Probation passed; they became permanent.',
    howTo: 'Date = the confirmation date. An intern must be moved to probation before being confirmed.',
    fields: [],
  },
  {
    kind: 'PROMOTED',
    label: 'Promotion',
    hint: 'A promotion to a new designation.',
    howTo: 'Date = when it took effect. To = the new designation (required). From = the old one (optional).',
    fields: ['from', 'to'],
  },
  {
    kind: 'DESIGNATION_CHANGED',
    label: 'Designation change',
    hint: 'A new title that was not a promotion.',
    howTo: 'Date = when it took effect. To = the new designation (required). From = the old one (optional).',
    fields: ['from', 'to'],
  },
  {
    kind: 'TRANSFERRED',
    label: 'Transfer',
    hint: 'Moved to another team.',
    howTo: 'Date = when it took effect. To = the team name exactly as it is in the app (required). From = the old team (optional).',
    fields: ['from', 'to'],
  },
  {
    kind: 'INCREMENT',
    label: 'Increment',
    hint: 'A salary increase. The latest one sets the present gross salary.',
    howTo:
      'Date = when it took effect. From = the old gross, To = the new gross, in whole taka. Or give To and Amount (the increment %), e.g. 12%.',
    fields: ['from', 'to', 'amount'],
  },
  {
    kind: 'APPRAISAL',
    label: 'Appraisal',
    hint: 'An appraisal done on paper before this system. Counts as already appraised.',
    howTo:
      'Date = the day it was done. Appraisal type = Yearly (default), Half-yearly, Confirmation or Internship review. Grade A–F and/or Marks 0–100 (the grade is worked out from the marks if left empty). Actions = what was recommended, e.g. "Increment, Promotion". Due date (optional) = the due date it was for. Outcome = the result in a few words.',
    fields: ['appraisal'],
  },
];

export const RECORD_KIND = Object.fromEntries(RECORD_KINDS.map((k) => [k.kind, k])) as Record<RecordKind, RecordKindInfo>;

export const APPRAISAL_TYPE_CHOICES = ['Yearly', 'Half-yearly', 'Confirmation', 'Internship review'];
export const ACTION_CHOICES = ['Confirm', 'Increment', 'Promotion', 'Termination', 'Dismissal', 'Training/Transfer'];

/** The template's columns, in order. `key` is the row field. */
export const TEMPLATE_COLUMNS: { key: Exclude<keyof PastRecordRow, 'row'>; header: string; width: number; help: string }[] = [
  { key: 'employee', header: 'Employee (email or code)', width: 30, help: 'Their work email, or their employee code.' },
  { key: 'record', header: 'Record', width: 20, help: 'Pick from the list: what happened.' },
  { key: 'date', header: 'Date', width: 13, help: 'YYYY-MM-DD or DD/MM/YYYY (day first). A date cell also works.' },
  { key: 'from', header: 'From', width: 22, help: 'The old designation, team or gross salary.' },
  { key: 'to', header: 'To', width: 22, help: 'The new designation, team or gross salary.' },
  { key: 'amount', header: 'Amount', width: 10, help: 'Increments: the increment %, e.g. 12%.' },
  { key: 'grade', header: 'Grade', width: 8, help: 'Appraisals: A to F.' },
  { key: 'marks', header: 'Marks', width: 8, help: 'Appraisals: 0 to 100.' },
  { key: 'appraisalType', header: 'Appraisal type', width: 18, help: 'Appraisals: Yearly (default), Half-yearly, Confirmation or Internship review.' },
  { key: 'actions', header: 'Actions', width: 24, help: 'Appraisals: what was recommended, comma separated.' },
  { key: 'dueDate', header: 'Due date', width: 13, help: 'Appraisals, optional: the due date it was for.' },
  { key: 'outcome', header: 'Outcome', width: 26, help: 'Appraisals, optional: the result in a few words.' },
  { key: 'notes', header: 'Notes', width: 30, help: 'Anything else worth keeping.' },
];

/** Example rows start their notes with this; the reader skips them. */
export const EXAMPLE_MARK = 'EXAMPLE';

export const TEMPLATE_EXAMPLES: Partial<Record<Exclude<keyof PastRecordRow, 'row'>, string>>[] = [
  { employee: 'name@company.com', record: 'Joined as intern', date: '2023-01-02', notes: `${EXAMPLE_MARK}: delete this row` },
  { employee: 'name@company.com', record: 'Increment', date: '2024-07-01', from: '40000', to: '45000', notes: `${EXAMPLE_MARK}: delete this row` },
  {
    employee: 'name@company.com',
    record: 'Appraisal',
    date: '2025-04-03',
    grade: 'B',
    marks: '84',
    appraisalType: 'Yearly',
    actions: 'Increment, Promotion',
    outcome: 'Promoted to Senior Developer',
    notes: `${EXAMPLE_MARK}: delete this row`,
  },
];

const squash = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const HEADER_ALIASES: Record<string, Exclude<keyof PastRecordRow, 'row'>> = {
  employee: 'employee',
  email: 'employee',
  'employee email': 'employee',
  'employee code': 'employee',
  code: 'employee',
  record: 'record',
  'record type': 'record',
  type: 'record',
  date: 'date',
  'effective date': 'date',
  from: 'from',
  to: 'to',
  amount: 'amount',
  'increment': 'amount',
  grade: 'grade',
  marks: 'marks',
  'appraisal type': 'appraisalType',
  actions: 'actions',
  'due date': 'dueDate',
  outcome: 'outcome',
  notes: 'notes',
  note: 'notes',
};

/** A header cell -> the row field it fills, or null for a column we do not read. */
export function headerKey(header: string): Exclude<keyof PastRecordRow, 'row'> | null {
  return HEADER_ALIASES[squash(header)] ?? null;
}

const DATE_KEYS = new Set(['date', 'dueDate']);

/** Excel's day 0 is 1899-12-30 (absorbs the phantom 29 Feb 1900 for every real date). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 61) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * One cell as the server should get it. Dates (ExcelJS gives a UTC-midnight
 * Date for a date-formatted cell) become `YYYY-MM-DD`; a plain number in a
 * date column is an Excel serial day; rich text, formulas and links give their
 * text or result. Empty cells are undefined.
 */
export function cellValue(v: unknown, key?: string): string | number | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (key && DATE_KEYS.has(key)) return excelSerialToIso(v) ?? v;
    return v;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? undefined : t;
  }
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return cellValue((o.richText as { text?: string }[]).map((r) => r.text ?? '').join(''), key);
    if ('result' in o) return cellValue(o.result, key);
    if (typeof o.text === 'string') return cellValue(o.text, key);
  }
  return undefined;
}

export interface ReadResult {
  rows: PastRecordRow[];
  /** Problems with the sheet as a whole (no header, no rows, missing columns). */
  problems: string[];
  /** Example rows left in from the template, skipped. */
  skippedExamples: number;
}

/**
 * A sheet's cells (first row the header; `rowNumbers[i]` is the sheet row of
 * `cells[i]`, default i + 1) -> rows for the server. Blank rows and the
 * template's example rows are skipped; every row keeps its sheet row number.
 */
export function rowsFromCells(cells: unknown[][], rowNumbers?: number[]): ReadResult {
  const problems: string[] = [];
  const headerAt = cells.findIndex((r) => r.some((c) => cellValue(c) !== undefined));
  if (headerAt < 0) return { rows: [], problems: ['The sheet is empty.'], skippedExamples: 0 };
  const keys = cells[headerAt].map((h) => {
    const text = cellValue(h);
    return typeof text === 'string' ? headerKey(text) : null;
  });
  for (const required of ['employee', 'record', 'date'] as const)
    if (!keys.includes(required))
      problems.push(`No "${TEMPLATE_COLUMNS.find((c) => c.key === required)?.header}" column. Start from the template.`);
  const rows: PastRecordRow[] = [];
  let skippedExamples = 0;
  for (let i = headerAt + 1; i < cells.length; i++) {
    const row: PastRecordRow = { row: rowNumbers?.[i] ?? i + 1 };
    let any = false;
    cells[i].forEach((c, col) => {
      const key = keys[col];
      if (!key) return;
      const v = cellValue(c, key);
      if (v === undefined) return;
      (row as Record<string, unknown>)[key] = typeof v === 'number' && !['date', 'dueDate', 'from', 'to', 'amount', 'marks'].includes(key) ? String(v) : v;
      any = true;
    });
    if (!any) continue;
    if (typeof row.notes === 'string' && row.notes.toUpperCase().startsWith(EXAMPLE_MARK)) {
      skippedExamples++;
      continue;
    }
    rows.push(row);
  }
  if (problems.length === 0 && rows.length === 0)
    problems.push(skippedExamples > 0 ? 'Only the example rows are filled in. Add your records below them (or replace them).' : 'No records found under the header row.');
  return { rows, problems, skippedExamples };
}

/** The most rows one import may carry (the server's limit too). */
export const MAX_IMPORT_ROWS = 2000;

/** "Permanent", "Probation", ... for the before -> after cards. */
export const STATUS_WORD: Record<string, string> = {
  INTERN: 'Intern',
  PROBATION: 'Probation',
  ACTIVE: 'Permanent',
  NOTICE: 'Notice period',
  EXITED: 'Exited',
};

/** Field errors of the "Add past record" dialog, before it is sent (the server re-checks). */
export function dialogErrors(
  kind: RecordKind,
  f: { date: string; from: string; to: string; amount: string; grade: string; marks: string },
  today: string,
): Partial<Record<'date' | 'from' | 'to' | 'amount' | 'grade' | 'marks', string>> {
  const out: Partial<Record<'date' | 'from' | 'to' | 'amount' | 'grade' | 'marks', string>> = {};
  if (!f.date) out.date = 'Set the date.';
  else if (f.date > today) out.date = 'The date cannot be in the future.';
  const money = (v: string) => /^\d+$/.test(v.replace(/[,\s]/g, '')) && Number(v.replace(/[,\s]/g, '')) > 0;
  if (kind === 'PROMOTED' || kind === 'DESIGNATION_CHANGED') {
    if (!f.to.trim()) out.to = 'Enter the new designation.';
  }
  if (kind === 'TRANSFERRED' && !f.to) out.to = 'Choose the team.';
  if (kind === 'INCREMENT') {
    if (f.from && !money(f.from)) out.from = 'Whole taka, more than zero.';
    if (f.to && !money(f.to)) out.to = 'Whole taka, more than zero.';
    if (f.amount && !/^\d+(\.\d+)?%?$/.test(f.amount.trim())) out.amount = 'A percentage, e.g. 12 or 12.5%.';
    if (!f.to && !(f.from && f.amount)) out.to = 'Enter the new gross (or the old gross and the %).';
    if (!out.from && !out.to && f.from && f.to && Number(f.to.replace(/[,\s]/g, '')) <= Number(f.from.replace(/[,\s]/g, '')))
      out.to = 'The new gross must be higher than the old gross.';
  }
  if (kind === 'APPRAISAL') {
    if (f.grade && !/^[A-Fa-f]$/.test(f.grade)) out.grade = 'A to F.';
    if (f.marks && !(Number(f.marks) >= 0 && Number(f.marks) <= 100 && f.marks.trim() !== '')) out.marks = '0 to 100.';
  }
  return out;
}

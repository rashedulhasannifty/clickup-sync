import type { PastRecordRow } from '../api/pastRecords';
import { parseCsv } from './attachmentPreview';
import {
  ACTION_CHOICES,
  APPRAISAL_TYPE_CHOICES,
  EXAMPLE_MARK,
  RECORD_KINDS,
  TEMPLATE_COLUMNS,
  TEMPLATE_EXAMPLES,
  rowsFromCells,
  type ReadResult,
} from './pastRecords';

/**
 * The past-records spreadsheet: the downloadable template (ExcelJS, built in
 * the browser) and reading an uploaded .xlsx or .csv back into rows. ExcelJS
 * loads lazily, so its bundle only downloads when someone uses this page.
 */

async function excel() {
  const mod = await import('exceljs');
  return ((mod as { default?: typeof import('exceljs') }).default ?? mod) as typeof import('exceljs');
}

const HEADER_FILL = 'FF4F46E5';
/** Rows that get the dropdowns (data validation); plenty for a first migration. */
const VALIDATED_ROWS = 2000;

function download(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface TemplateEmployee {
  email: string;
  employeeCode: string | null;
  fullName: string;
  joinDate: string;
  status: string;
}

/**
 * The template: a "Records" sheet (header, then either 3 example rows or one
 * "Joined" row per current employee) with dropdowns for Record and Appraisal
 * type, and a "How to fill" sheet explaining each record type in plain words.
 */
export async function downloadTemplate(employees: TemplateEmployee[] | null): Promise<void> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Records', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.height = 20;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { vertical: 'middle' };
  header.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.note = TEMPLATE_COLUMNS[col - 1]?.help ?? '';
  });
  // Dates and codes are typed as text so Excel never turns 03/04/2024 into a US date.
  for (const key of ['date', 'dueDate', 'employee'] as const) ws.getColumn(key).numFmt = '@';

  if (employees) {
    // Who each row is, for reading only: a column the reader ignores, so a name never ends up
    // in a record's notes. "Joined" on the join date on file is skipped as already recorded.
    const nameCol = TEMPLATE_COLUMNS.length + 1;
    const nameHeader = ws.getCell(1, nameCol);
    nameHeader.value = 'Name (not imported)';
    nameHeader.font = { bold: true, color: { argb: 'FF6B7280' } };
    ws.getColumn(nameCol).width = 26;
    for (const e of employees) {
      const row = ws.addRow({ employee: e.email, record: 'Joined', date: e.joinDate });
      row.getCell(nameCol).value = e.fullName;
    }
  } else {
    for (const ex of TEMPLATE_EXAMPLES) ws.addRow(ex).font = { italic: true, color: { argb: 'FF6B7280' } };
  }

  const recordList = `"${RECORD_KINDS.map((k) => k.label).join(',')}"`;
  const typeList = `"${APPRAISAL_TYPE_CHOICES.join(',')}"`;
  const recordCol = TEMPLATE_COLUMNS.findIndex((c) => c.key === 'record') + 1;
  const typeCol = TEMPLATE_COLUMNS.findIndex((c) => c.key === 'appraisalType') + 1;
  for (let r = 2; r <= VALIDATED_ROWS + 1; r++) {
    ws.getCell(r, recordCol).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [recordList],
      showErrorMessage: true,
      errorTitle: 'Record',
      error: 'Pick a record type from the list.',
    };
    ws.getCell(r, typeCol).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [typeList],
      showErrorMessage: true,
      errorTitle: 'Appraisal type',
      error: 'Pick an appraisal type from the list.',
    };
  }

  const how = wb.addWorksheet('How to fill');
  how.columns = [
    { header: 'Record', key: 'a', width: 22 },
    { header: 'What it means and how to fill the row', key: 'b', width: 110 },
  ];
  how.getRow(1).font = { bold: true };
  const intro = [
    ['', 'One row per event in someone’s history before this system. Fill the Records sheet, then upload it on People → Import past records.'],
    ['', 'Employee: their work email, or their employee code. Dates: YYYY-MM-DD or DD/MM/YYYY (day first), or a date cell.'],
    ['', `You see every change before anything is saved. Rows already recorded are skipped, so uploading the same file twice is safe. Example rows (Notes starting with "${EXAMPLE_MARK}") are ignored.`],
    ['', 'Notice and exits are not past records: use Start offboarding on the employee page.'],
    ['', ''],
  ];
  for (const [a, b] of intro) how.addRow({ a, b }).getCell(2).alignment = { wrapText: true };
  for (const k of RECORD_KINDS) {
    const row = how.addRow({ a: k.label, b: `${k.hint} ${k.howTo}` });
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }
  how.addRow({});
  how.addRow({ a: 'Columns', b: '' }).getCell(1).font = { bold: true };
  for (const c of TEMPLATE_COLUMNS) how.addRow({ a: c.header, b: c.help }).getCell(2).alignment = { wrapText: true };
  how.addRow({ a: 'Actions', b: `One or more of: ${ACTION_CHOICES.join(', ')}.` });

  const buf = await wb.xlsx.writeBuffer();
  download(buf as ArrayBuffer, employees ? 'past-records-with-employees.xlsx' : 'past-records-template.xlsx');
}

/** An uploaded .xlsx (first sheet named "Records", else the first sheet) or .csv -> rows. */
export async function readRecordsFile(file: File): Promise<ReadResult> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const { rows } = parseCsv(await file.text(), Number.POSITIVE_INFINITY);
    return rowsFromCells(rows);
  }
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return { rows: [], problems: ['That file could not be read as an .xlsx workbook.'], skippedExamples: 0 };
  }
  const ws = wb.getWorksheet('Records') ?? wb.worksheets[0];
  if (!ws) return { rows: [], problems: ['The workbook has no sheets.'], skippedExamples: 0 };
  const cells: unknown[][] = [];
  const numbers: number[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const values = row.values as unknown[];
    // ExcelJS rows are 1-based: index 0 is always empty.
    cells.push(values.slice(1));
    numbers.push(n);
  });
  return rowsFromCells(cells, numbers);
}

export type { PastRecordRow };

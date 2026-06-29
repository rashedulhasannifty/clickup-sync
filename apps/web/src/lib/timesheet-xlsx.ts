/**
 * Grouped .xlsx export for the Timesheet page. Unlike the flat `exportXlsx`
 * helper, this writes day-grouped rows: a day header row, one row per task under
 * it, a day subtotal row, repeated per day, then a grand-total row.
 *
 * Honors the page's Hide/Show Cost toggle via `includeCost` (cost column dropped
 * when false). Missing-rate cost cells are left blank, never 0.
 */
import type { Timesheet } from '../hooks/useReports';

function stamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const HEADER_FILL = 'FF4F46E5'; // indigo accent, matches xlsx.ts
const DAY_FILL = 'FFEEF2FF';    // light indigo for day header rows
const TOTAL_FILL = 'FFE5E7EB';  // grey for the grand-total row

export async function exportTimesheetXlsx(opts: {
  assigneeName: string;
  sheet: Timesheet;
  includeCost: boolean;
}): Promise<void> {
  const { assigneeName, sheet, includeCost } = opts;

  // CJS/ESM interop, same as xlsx.ts.
  const mod = await import('exceljs');
  const ExcelJS = ((mod as { default?: typeof import('exceljs') }).default ?? mod) as typeof import('exceljs');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Timesheet', { views: [{ state: 'frozen', ySplit: 1 }] });

  // Columns: Date | Task | Hours [| Cost]. Date column doubles as the label
  // column for day headers / subtotals.
  const lastCol = includeCost ? 4 : 3;
  ws.columns = [
    { key: 'c0', width: 16 },                                  // Date / label
    { key: 'c1', width: 48 },                                  // Task
    // Fixed 2 decimals (not '#,##0.##'): the optional-digit form renders whole
    // numbers with a dangling decimal point — 0 → "0.", 1 → "1." — in Excel /
    // Sheets / LibreOffice. '#,##0.00' shows "0.00" / "1.00" / "5.25" cleanly.
    { key: 'c2', width: 12, style: { numFmt: '#,##0.00' } },   // Hours
    ...(includeCost ? [{ key: 'c3', width: 14, style: { numFmt: '#,##0.00' } }] : []),
  ];

  // Header row.
  const headerCells = includeCost ? ['Date', 'Task', 'Hours', 'Cost'] : ['Date', 'Task', 'Hours'];
  const header = ws.addRow(headerCells);
  header.height = 20;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.alignment = { vertical: 'middle', horizontal: 'left' };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  });

  const fillRow = (rowNumber: number, argb: string) => {
    const row = ws.getRow(rowNumber);
    for (let c = 1; c <= lastCol; c++) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    }
    row.font = { bold: true };
  };

  for (const day of sheet.days) {
    // Day header: "2026-06-22 · Mon" in the Date col, day subtotal in Hours/Cost.
    const dayHeaderVals: (string | number | null)[] = [
      `${day.date} · ${day.weekday}`,
      day.tasks.length ? '' : '(no time logged)',
      day.subtotalHours,
    ];
    if (includeCost) dayHeaderVals.push(day.subtotalCostAud); // null → blank cell
    const dayRow = ws.addRow(dayHeaderVals);
    fillRow(dayRow.number, DAY_FILL);

    // Task rows.
    for (const task of day.tasks) {
      const vals: (string | number | null)[] = ['', task.taskName ?? task.taskId, task.hours];
      if (includeCost) vals.push(task.costAud); // null (missing rate) → blank cell
      ws.addRow(vals);
    }
  }

  // Grand-total row.
  const totalVals: (string | number | null)[] = ['Total', '', sheet.totalHours];
  if (includeCost) totalVals.push(sheet.totalCostAud);
  const totalRow = ws.addRow(totalVals);
  fillRow(totalRow.number, TOTAL_FILL);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = assigneeName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'assignee';
  a.href = url;
  a.download = `timesheet-${safeName}-${stamp(new Date())}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

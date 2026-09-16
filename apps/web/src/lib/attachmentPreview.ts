/**
 * Pure helpers for the in-app attachment viewer. No DOM or React, so they are unit-tested from the
 * root Jest suite (test/attachment-preview.spec.ts).
 */

/** Rows shown in a table preview; the rest is a download. */
export const PREVIEW_ROW_LIMIT = 500;

export type ViewerKind = 'pdf' | 'image' | 'csv' | 'xlsx' | 'xls' | 'other';

// Mirrors src/xero/xero-attachment-delivery.ts. It MUST NOT be wider: the server only serves PDFs
// and raster images inline, so e.g. an SVG shown in an <img> here would just fail to load.
const BY_TYPE: Record<string, ViewerKind> = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
};
const BY_EXT: Record<string, ViewerKind> = {
  pdf: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', csv: 'csv', xlsx: 'xlsx', xls: 'xls',
};

export function viewerKind(fileName: string, mimeType: string | null): ViewerKind {
  const declared = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (BY_TYPE[declared]) return BY_TYPE[declared];
  return BY_EXT[fileName.toLowerCase().split('.').pop() ?? ''] ?? 'other';
}

export interface TablePreview {
  rows: string[][];
  /** Data rows in the whole file, before the preview cap. */
  total: number;
}

/**
 * RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes, CRLF/LF/CR line
 * ends, a leading UTF-8 BOM, and no phantom empty row from a trailing newline.
 */
export function parseCsv(text: string, limit = PREVIEW_ROW_LIMIT): TablePreview {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let total = 0;
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let sawAny = false;

  const endRow = () => {
    row.push(field);
    field = '';
    total += 1;
    if (rows.length < limit) rows.push(row);
    row = [];
    sawAny = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; sawAny = true; }
    else if (c === ',') { row.push(field); field = ''; sawAny = true; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else { field += c; sawAny = true; }
  }
  if (sawAny || field !== '' || row.length) endRow();
  return { rows, total };
}

/**
 * An exceljs cell value as display text. exceljs returns objects for rich text, hyperlinks,
 * formulas and errors; rendering them raw would print "[object Object]".
 */
export function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
  }
  if (typeof v !== 'object') return String(v);
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('');
  if ('result' in o) return cellText(o.result);
  if ('formula' in o || 'sharedFormula' in o) return '';
  if (typeof o.text === 'string') return o.text;
  if (typeof o.error === 'string') return o.error;
  return '';
}

/** The API's JSON error message out of a response axios was told to read as bytes. */
export function errorMessageFromBytes(data: unknown): string | undefined {
  try {
    const text = data instanceof ArrayBuffer ? new TextDecoder().decode(data) : typeof data === 'string' ? data : null;
    if (!text) return (data as { message?: string } | null)?.message;
    const parsed = JSON.parse(text) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : undefined;
  } catch {
    return undefined;
  }
}

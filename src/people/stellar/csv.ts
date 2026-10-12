/**
 * Minimal RFC 4180 CSV reader: quoted fields, `""` escapes, commas and newlines
 * inside quotes, CRLF or LF line ends, and a leading UTF-8 BOM. Pure; the
 * Stellar exports are a few thousand rows, so a whole-string parse is fine.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines (a trailing newline, or an empty line in the middle) carry no data.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** Thrown for a file that is not the expected export; the message is safe to show. */
export class StellarCsvError extends Error {}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Column index by header name (case/space-insensitive), wherever the column
 * sits: the exports lead with an unnamed index column. Throws when a required
 * column is missing, so a wrong file fails loudly instead of importing nothing.
 */
export function headerIndex<K extends string>(
  header: string[],
  required: Record<K, string>,
  optional: Record<string, string> = {},
  kind = 'Stellar HRM',
): Record<K, number> & Record<string, number> {
  const names = header.map(norm);
  const out: Record<string, number> = {};
  const missing: string[] = [];
  for (const [key, name] of Object.entries<string>(required)) {
    const idx = names.indexOf(norm(name));
    if (idx < 0) missing.push(name);
    out[key] = idx;
  }
  for (const [key, name] of Object.entries<string>(optional))
    out[key] = names.indexOf(norm(name));
  if (missing.length > 0)
    throw new StellarCsvError(
      `Not a ${kind} export: missing column${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${m}"`).join(', ')}`,
    );
  return out as Record<K, number> & Record<string, number>;
}

export type StellarExportKind = 'attendance' | 'leaves';

/**
 * Which Stellar HRM export a file is, from its header alone: the attendance
 * export has `In Time`/`Out Time`, the leave export `Leave Type`. Null for anything else.
 */
export function detectStellarExport(text: string): StellarExportKind | null {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const end = src.search(/\r?\n/);
  const header = (parseCsv(end < 0 ? src : src.slice(0, end))[0] ?? []).map(
    norm,
  );
  if (header.includes('in time') && header.includes('out time'))
    return 'attendance';
  if (header.includes('leave type')) return 'leaves';
  return null;
}

/** `YYYY-MM-DD` from `2026-07-06` or `2026-07-06 00:00:00`; null when it is not a real date. */
export function parseIsoDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(raw.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

/** A Stellar User ID as stored and matched: digits without leading zeros ("041" -> "41"). */
export const stellarId = (raw: string): string => raw.trim().replace(/^0+(?=\d)/, '');

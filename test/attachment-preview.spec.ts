import { cellText, errorMessageFromBytes, parseCsv, viewerKind } from '../apps/web/src/lib/attachmentPreview';

describe('parseCsv', () => {
  it('parses plain rows and ignores a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual({ rows: [['a', 'b'], ['1', '2']], total: 2 });
  });

  it('handles quotes, escaped quotes, and commas and newlines inside quotes', () => {
    const { rows } = parseCsv('name,note\n"Smith, J","said ""hi""\nthen left"\n');
    expect(rows).toEqual([['name', 'note'], ['Smith, J', 'said "hi"\nthen left']]);
  });

  it('handles CRLF and bare CR line ends and strips a BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r3,4').rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('keeps empty fields, including trailing ones', () => {
    expect(parseCsv('a,,c,\n').rows).toEqual([['a', '', 'c', '']]);
  });

  it('caps the rows it returns but counts every row', () => {
    const csv = Array.from({ length: 1200 }, (_, i) => `${i},x`).join('\n');
    const out = parseCsv(csv, 500);
    expect(out.rows).toHaveLength(500);
    expect(out.total).toBe(1200);
    expect(out.rows[499]).toEqual(['499', 'x']);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual({ rows: [], total: 0 });
  });
});

describe('cellText', () => {
  it('renders exceljs value objects as text, never [object Object]', () => {
    expect(cellText({ richText: [{ text: 'Hel' }, { text: 'lo' }] })).toBe('Hello');
    expect(cellText({ formula: 'A1*2', result: 42 })).toBe('42');
    expect(cellText({ text: 'Xero', hyperlink: 'https://xero.com' })).toBe('Xero');
    expect(cellText({ error: '#DIV/0!' })).toBe('#DIV/0!');
    expect(cellText(new Date('2026-09-16T00:00:00Z'))).toBe('2026-09-16');
    expect(cellText(new Date('2026-09-16T14:30:00Z'))).toBe('2026-09-16 14:30');
    expect(cellText(null)).toBe('');
    expect(cellText(true)).toBe('true');
  });
});

describe('viewerKind', () => {
  it('matches the server inline allowlist, and never treats SVG as an image', () => {
    expect(viewerKind('a.pdf', 'application/pdf')).toBe('pdf');
    expect(viewerKind('a.JPG', 'application/octet-stream')).toBe('image');
    expect(viewerKind('a.svg', 'image/svg+xml')).toBe('other');
    expect(viewerKind('data.csv', null)).toBe('csv');
    expect(viewerKind('book.xlsx', null)).toBe('xlsx');
    expect(viewerKind('old.xls', null)).toBe('xls');
  });
});

describe('errorMessageFromBytes', () => {
  it('reads the API message out of an arraybuffer error body', () => {
    const buf = new TextEncoder().encode(JSON.stringify({ message: 'This file is larger than 25 MB.' })).buffer;
    expect(errorMessageFromBytes(buf)).toBe('This file is larger than 25 MB.');
    expect(errorMessageFromBytes(new TextEncoder().encode('<html>').buffer)).toBeUndefined();
  });
});

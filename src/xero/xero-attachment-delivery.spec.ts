import { attachmentDelivery, attachmentKind, contentDisposition, safeContentType } from './xero-attachment-delivery';

describe('attachment delivery policy', () => {
  it('serves PDFs and raster images inline, with nosniff and no caching', () => {
    for (const [name, type] of [['a.pdf', 'application/pdf'], ['a.png', 'image/png'], ['a.jpg', 'image/jpeg'], ['a.gif', 'image/gif'], ['a.webp', 'image/webp']]) {
      const d = attachmentDelivery(name, type, false);
      expect(d.inline).toBe(true);
      expect(d.headers['Content-Type']).toBe(type);
      expect(d.headers['Content-Disposition']).toMatch(/^inline;/);
      expect(d.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(d.headers['Cache-Control']).toBe('private, no-store');
    }
  });

  it('never serves script-capable formats inline, even when they claim to be images', () => {
    for (const [name, type] of [['x.svg', 'image/svg+xml'], ['x.html', 'text/html'], ['x.xml', 'application/xml'], ['x.js', 'text/javascript']]) {
      const d = attachmentDelivery(name, type, false);
      expect(d.inline).toBe(false);
      expect(d.headers['Content-Type']).toBe('application/octet-stream');
      expect(d.headers['Content-Disposition']).toMatch(/^attachment;/);
      expect(d.headers['Content-Security-Policy']).toBe("sandbox; default-src 'none'");
    }
  });

  it('download=1 forces a download even for an inline-safe type', () => {
    const d = attachmentDelivery('a.pdf', 'application/pdf', true);
    expect(d.inline).toBe(false);
    expect(d.headers['Content-Disposition']).toMatch(/^attachment;/);
    expect(d.headers['Content-Security-Policy']).toBe("sandbox; default-src 'none'");
  });

  it('gives PDFs a CSP without sandbox or object-src, which blank Chrome\'s PDF viewer', () => {
    const csp = attachmentDelivery('a.pdf', 'application/pdf', false).headers['Content-Security-Policy'];
    expect(csp).not.toMatch(/sandbox/);
    expect(csp).not.toMatch(/object-src/);
    expect(csp).not.toMatch(/default-src/);
    expect(csp).toBe("frame-ancestors 'self'");
  });

  it('locks images down to no script and no framing by other origins', () => {
    const csp = attachmentDelivery('a.png', 'image/png', false).headers['Content-Security-Policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('script-src');
  });

  it('falls back to the extension when Xero stores a generic type, still allowlisted', () => {
    expect(safeContentType('report.xlsx', 'application/octet-stream')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(safeContentType('data.CSV', null)).toBe('text/csv');
    expect(safeContentType('photo.JPEG', null)).toBe('image/jpeg');
    expect(safeContentType('evil.svg', 'application/octet-stream')).toBe('application/octet-stream');
    expect(safeContentType('noext', null)).toBe('application/octet-stream');
  });

  it('ignores MIME parameters and case', () => {
    expect(safeContentType('a', 'Application/PDF; charset=binary')).toBe('application/pdf');
  });

  it('classifies kinds for the viewer', () => {
    expect(attachmentKind('a.pdf', null)).toBe('pdf');
    expect(attachmentKind('a.csv', 'text/csv')).toBe('csv');
    expect(attachmentKind('a.xlsx', null)).toBe('xlsx');
    expect(attachmentKind('a.xls', null)).toBe('xls');
    expect(attachmentKind('a.svg', 'image/svg+xml')).toBe('other');
  });

  it('builds a Content-Disposition that cannot inject headers and keeps the real UTF-8 name', () => {
    const v = contentDisposition('attachment', 'Q3 "final"\r\nSet-Cookie: x=1 — রসিদ.pdf');
    expect(v).not.toMatch(/[\r\n]/);
    expect(v).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    expect(decodeURIComponent(v.split("UTF-8''")[1])).toBe('Q3 "final"\r\nSet-Cookie: x=1 — রসিদ.pdf');
  });
});

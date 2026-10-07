import { DOCX_CONTENT_TYPE, sanitizeFileName, sniffFileType, zipEntryNames } from './file-sniff';
import {
  buildZip, docmBytes, docxBytes, exeBytes, gifBytes, htmlBytes, jpegBytes, pdfBytes, pngBytes, svgBytes, webpBytes, xlsxBytes,
} from './testing/fixtures';

describe('sniffFileType', () => {
  it.each([
    ['PDF', pdfBytes(), 'application/pdf', 'pdf'],
    ['JPEG', jpegBytes(), 'image/jpeg', 'jpg'],
    ['PNG', pngBytes(), 'image/png', 'png'],
    ['WebP', webpBytes(), 'image/webp', 'webp'],
    ['DOCX', docxBytes(), DOCX_CONTENT_TYPE, 'docx'],
  ])('accepts %s by its magic bytes', (_name, bytes, contentType, extension) => {
    expect(sniffFileType(bytes)).toEqual({ contentType, extension });
  });

  it.each([
    ['HTML', htmlBytes()],
    ['SVG', svgBytes()],
    ['an EXE', exeBytes()],
    ['a GIF (not on the documents allowlist)', gifBytes()],
    ['an xlsx (a zip, but not Word)', xlsxBytes()],
    ['a macro-enabled docm', docmBytes()],
    ['a plain zip', buildZip(['readme.txt'])],
    ['an empty file', Buffer.alloc(0)],
    ['RIFF that is not WebP (a WAV)', Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WAVE')])],
    ['plain text', Buffer.from('hello world')],
  ])('rejects %s', (_name, bytes) => {
    expect(sniffFileType(bytes)).toBeNull();
  });

  it('ignores whatever the client claims — only bytes count', () => {
    // HTML renamed to .pdf is still HTML.
    expect(sniffFileType(Buffer.from('<html><body>not a pdf</body></html>'))).toBeNull();
  });

  it('needs the PDF marker at offset 0', () => {
    expect(sniffFileType(Buffer.concat([Buffer.from('junk'), pdfBytes()]))).toBeNull();
  });

  it('does not throw on a truncated or corrupt zip', () => {
    const z = docxBytes();
    expect(sniffFileType(z.subarray(0, 30))).toBeNull();
    const corrupt = Buffer.from(z);
    corrupt.writeUInt32LE(0x7fffffff, corrupt.length - 6); // central directory offset far past the end
    expect(sniffFileType(corrupt)).toBeNull();
    expect(zipEntryNames(Buffer.from('PK\x03\x04'))).toBeNull();
  });
});

describe('zipEntryNames', () => {
  it('lists the entry names of a zip', () => {
    expect(zipEntryNames(buildZip(['a.txt', 'dir/b.txt']))).toEqual(['a.txt', 'dir/b.txt']);
  });
});

describe('sanitizeFileName', () => {
  const pdf = { contentType: 'application/pdf', extension: 'pdf' };
  const jpeg = { contentType: 'image/jpeg', extension: 'jpg' };

  it('keeps an ordinary name and lower-cases the extension', () => {
    expect(sanitizeFileName('Offer letter.PDF', pdf)).toBe('Offer letter.pdf');
  });

  it('keeps jpeg as an accepted spelling for JPEG bytes', () => {
    expect(sanitizeFileName('photo.jpeg', jpeg)).toBe('photo.jpeg');
  });

  it('rewrites the extension to what the bytes are, so evil.html carrying PDF bytes is not .html', () => {
    expect(sanitizeFileName('evil.html', pdf)).toBe('evil.pdf');
    expect(sanitizeFileName('nid.svg', pdf)).toBe('nid.pdf');
    expect(sanitizeFileName('noext', pdf)).toBe('noext.pdf');
    expect(sanitizeFileName('a.b.exe', pdf)).toBe('a.b.pdf');
  });

  it('does not mistake a version number for an extension', () => {
    expect(sanitizeFileName('Contract v1.2', pdf)).toBe('Contract v1.2.pdf');
  });

  it('keeps only the basename: no path traversal, no Windows fake path', () => {
    expect(sanitizeFileName('../../etc/passwd', pdf)).toBe('passwd.pdf');
    expect(sanitizeFileName('C:\\fakepath\\scan.pdf', pdf)).toBe('scan.pdf');
    expect(sanitizeFileName('a/b\\c/d.pdf', pdf)).toBe('d.pdf');
  });

  it('strips control characters, CR/LF (header injection) and bidi overrides', () => {
    expect(sanitizeFileName('a\r\nSet-Cookie: x=1.pdf', pdf)).toBe('aSet-Cookie_ x=1.pdf');
    expect(sanitizeFileName('inv\u202Efdp.exe', pdf)).toBe('invfdp.pdf');
    expect(sanitizeFileName('bell\u0007.pdf', pdf)).toBe('bell.pdf');
  });

  it('replaces characters that are awkward in headers and file systems', () => {
    expect(sanitizeFileName('a<b>:"c|d?e*.pdf', pdf)).toBe('a_b___c_d_e_.pdf');
  });

  it('never returns an empty or dot-only stem', () => {
    expect(sanitizeFileName('', pdf)).toBe('document.pdf');
    expect(sanitizeFileName('...', pdf)).toBe('document.pdf');
    expect(sanitizeFileName('.pdf', pdf)).toBe('document.pdf');
    expect(sanitizeFileName('   ', pdf)).toBe('document.pdf');
  });

  it('bounds the length', () => {
    const out = sanitizeFileName(`${'x'.repeat(500)}.pdf`, pdf);
    expect(out.length).toBeLessThanOrEqual(124);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('keeps non-ASCII names, and repairs a UTF-8 name that arrived decoded as latin-1', () => {
    expect(sanitizeFileName('নিয়োগপত্র.pdf', pdf)).toBe('নিয়োগপত্র.pdf');
    expect(sanitizeFileName('café.pdf', pdf)).toBe('café.pdf');
    const mangled = Buffer.from('নিয়োগপত্র.pdf', 'utf8').toString('latin1');
    expect(sanitizeFileName(mangled, pdf)).toBe('নিয়োগপত্র.pdf');
  });
});

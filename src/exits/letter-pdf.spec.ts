import { sniffFileType } from '../documents/file-sniff';
import { buildLetter } from './letter-content';
import { renderLetterPdf } from './letter-pdf';

describe('renderLetterPdf', () => {
  it('produces a real PDF that the documents module accepts by magic bytes', async () => {
    const letter = buildLetter({
      kind: 'experience',
      companyName: 'Acme Ltd',
      employeeName: 'Ada Lovelace',
      employeeCode: null,
      designation: 'Engineer',
      department: null,
      joinDate: '2024-03-04',
      noticeDate: '2026-10-01',
      lastWorkingDay: '2026-10-31',
      exitType: 'RESIGNATION',
      issuedOn: '2026-10-07',
    });
    const pdf = await renderLetterPdf(letter);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(sniffFileType(pdf)?.contentType).toBe('application/pdf');
  });

  it('embeds a Bengali-capable TrueType font for a Bengali name and never uses Helvetica', async () => {
    const letter = buildLetter({
      kind: 'release',
      companyName: 'Acme Ltd',
      employeeName: 'রাশেদুল হাসান',
      employeeCode: null,
      designation: 'Senior Developer',
      department: null,
      joinDate: '2024-03-04',
      noticeDate: '2026-10-01',
      lastWorkingDay: '2026-10-31',
      exitType: 'RESIGNATION',
      issuedOn: '2026-10-07',
    });
    expect(letter.paragraphs.join(' ')).toContain('রাশেদুল হাসান');
    const pdf = await renderLetterPdf(letter);
    expect(sniffFileType(pdf)?.contentType).toBe('application/pdf');
    const text = pdf.toString('latin1');
    // Embedded font programs (FontFile2 = TrueType), subset-tagged with the family's PostScript name.
    expect(text).toContain('/FontFile2');
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+HindSiliguri-Regular/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+HindSiliguri-Bold/);
    expect(text).not.toContain('Helvetica');
  });

  it('fails loudly instead of falling back to Helvetica when the font files are missing', () => {
    jest.isolateModules(() => {
      jest.doMock('node:fs', () => ({ ...jest.requireActual('node:fs'), existsSync: () => false }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { loadLetterFonts } = require('./letter-fonts') as typeof import('./letter-fonts');
      expect(() => loadLetterFonts()).toThrow(/Letter font file is missing/);
    });
    jest.dontMock('node:fs');
  });
});

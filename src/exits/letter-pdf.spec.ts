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
});

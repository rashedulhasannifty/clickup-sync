import PDFDocument from 'pdfkit';
import type { LetterContent } from './letter-content';

/**
 * Lays a letter out on one A4 page. Only the built-in Helvetica is used (no font files to ship),
 * which covers Latin text; a name in another script would not render, so keep that in mind
 * before storing non-Latin names.
 *
 * What the letter SAYS lives in `buildLetter` (pure, unit-tested). This only draws it, and is
 * checked by asserting the output is a PDF that the documents module's magic-byte sniffer accepts.
 */
export function renderLetterPdf(letter: LetterContent): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: { Title: letter.title, Author: letter.company, Creator: letter.company },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text(letter.company);
    doc.moveDown(0.3);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .lineWidth(0.75)
      .stroke('#999999');
    doc.moveDown(1.5);

    doc.font('Helvetica').fontSize(11).text(letter.dateLine);
    if (letter.referenceLine) doc.text(letter.referenceLine);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(14).text(letter.title.toUpperCase(), { align: 'center' });
    doc.moveDown(1.5);

    doc.font('Helvetica').fontSize(11).text(letter.salutation);
    doc.moveDown(0.8);
    for (const p of letter.paragraphs) {
      doc.text(p, { align: 'justify', lineGap: 3 });
      doc.moveDown(0.8);
    }

    doc.moveDown(1);
    doc.text(letter.closing);
    doc.moveDown(3);
    letter.signatory.forEach((line, idx) => {
      doc.font(idx === 0 ? 'Helvetica-Bold' : 'Helvetica').text(line);
    });

    doc.end();
  });
}

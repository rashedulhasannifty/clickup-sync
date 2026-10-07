/** Test-only builders for tiny, valid-by-magic-bytes files. Never imported by production code. */

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

/** A ZIP of empty STORED entries with the given names. Enough for central-directory sniffing. */
export function buildZip(names: string[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(0), u32(0), u16(nameBuf.length), u16(0), nameBuf,
    ]);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(0), u32(0), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]), u16(0), u16(0), u16(names.length), u16(names.length), u32(cd.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}

export const pdfBytes = (): Buffer => Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
export const jpegBytes = (): Buffer => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
export const pngBytes = (): Buffer =>
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
export const webpBytes = (): Buffer =>
  Buffer.concat([Buffer.from('RIFF'), u32(12), Buffer.from('WEBP'), Buffer.from('VP8 ')]);
export const docxBytes = (): Buffer => buildZip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
export const xlsxBytes = (): Buffer => buildZip(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml']);
export const docmBytes = (): Buffer => buildZip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']);
export const htmlBytes = (): Buffer => Buffer.from('<!doctype html><script>alert(1)</script>');
export const svgBytes = (): Buffer => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const exeBytes = (): Buffer => Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
export const gifBytes = (): Buffer => Buffer.from('GIF89a\x01\x00\x01\x00');

/**
 * Decides what an uploaded file REALLY is from its leading bytes, never from the client's
 * Content-Type or filename, and cleans up the name we store. Pure and dependency-free.
 *
 * Allowlist: PDF, JPEG, PNG, WebP, DOCX. Anything else (HTML, SVG, an .exe renamed to .pdf,
 * GIF, an .xlsx renamed to .docx) is rejected: `sniffFileType` returns null.
 */

export interface SniffedType {
  contentType: string;
  /** Canonical extension, lower-case, no dot. */
  extension: string;
}

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PDF: SniffedType = { contentType: 'application/pdf', extension: 'pdf' };
const JPEG: SniffedType = { contentType: 'image/jpeg', extension: 'jpg' };
const PNG: SniffedType = { contentType: 'image/png', extension: 'png' };
const WEBP: SniffedType = { contentType: 'image/webp', extension: 'webp' };
const DOCX: SniffedType = { contentType: DOCX_CONTENT_TYPE, extension: 'docx' };

/** Extensions that are acceptable spellings for a sniffed type. */
const EXTENSION_ALIASES: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  [DOCX_CONTENT_TYPE]: ['docx'],
};

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/** Names of the entries in a ZIP archive's central directory. No decompression, fully bounds-checked. */
export function zipEntryNames(buf: Buffer): string[] | null {
  const EOCD_MIN = 22;
  if (buf.length < EOCD_MIN) return null;
  // The end-of-central-directory record sits in the last 22 + 65535 bytes (max comment length).
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_MIN - 0xffff); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  // 0xFFFF / 0xFFFFFFFF mean ZIP64; a Word document never needs it.
  if (entries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) return null;
  if (cdOffset + cdSize > buf.length) return null;

  const names: string[] = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > end || !startsWith(buf, [0x50, 0x4b, 0x01, 0x02], p)) return null;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLen > end) return null;
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** A real .docx: an OPC package with a Word main part, and no VBA macro project (.docm). */
function isDocx(buf: Buffer): boolean {
  const names = zipEntryNames(buf);
  if (!names) return false;
  const set = new Set(names);
  return set.has('[Content_Types].xml') && set.has('word/document.xml') && !set.has('word/vbaProject.bin');
}

export function sniffFileType(buf: Buffer): SniffedType | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF; // %PDF-
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return JPEG;
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  // RIFF <size> WEBP
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return WEBP;
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) && isDocx(buf)) return DOCX;
  return null;
}

/**
 * multer/busboy can hand back a UTF-8 filename decoded as latin-1 ("à¦…" instead of "অ").
 * If re-reading the bytes as UTF-8 gives a clean string, that is what the client sent.
 */
function repairLatin1(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name) || /[\u0100-\uffff]/.test(name)) return name;
  const repaired = Buffer.from(name, 'latin1').toString('utf8');
  return repaired.includes('\ufffd') ? name : repaired;
}

const MAX_STEM_CHARS = 120;

/**
 * The name we store and later put in Content-Disposition. Basename only (no `../`, no
 * `C:\fakepath\`), no control or bidi-override characters, bounded length, never empty, and
 * the extension is rewritten to match what the bytes really are — so `evil.html` carrying
 * PDF bytes is stored as `evil.pdf`, never something a browser would treat as a page.
 */
export function sanitizeFileName(raw: string, sniffed: SniffedType): string {
  let name = repairLatin1(raw ?? '');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  let stem = name;
  const dot = name.lastIndexOf('.');
  if (dot >= 0) {
    const ext = name.slice(dot + 1);
    // Only a letter-led, short suffix counts as an extension ("v1.2" is not one).
    if (/^[a-z][a-z0-9]{0,4}$/i.test(ext)) stem = name.slice(0, dot);
  }
  stem = stem.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  stem = Array.from(stem).slice(0, MAX_STEM_CHARS).join('').trim();
  if (!stem) stem = 'document';

  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const keep = dot >= 0 && (EXTENSION_ALIASES[sniffed.contentType] ?? []).includes(ext) ? ext : sniffed.extension;
  return `${stem}.${keep}`;
}

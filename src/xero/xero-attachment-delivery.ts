/**
 * How an attachment's bytes are handed to the browser. Pure, so every security-relevant
 * decision here is unit-tested without HTTP.
 *
 * The threat: these are files other people uploaded to Xero, served from OUR origin to a
 * logged-in Owner/Admin. A file the browser treats as a document (HTML, SVG, XML) could run
 * script with that session. So:
 *  - Only formats that cannot carry script are ever `inline`: PDF and raster images. SVG is
 *    deliberately NOT an image here.
 *  - Everything else is `attachment` (a download), whatever the caller asks for.
 *  - The Content-Type comes from an allowlist; anything else is application/octet-stream,
 *    and `nosniff` stops the browser second-guessing it.
 *  - Each response carries its own CSP. It cannot be one strict policy for all: Chrome's
 *    built-in PDF viewer renders nothing when the PDF response has `sandbox` or
 *    `object-src 'none'` (helmet's global default), so PDFs get only `frame-ancestors`.
 *    That is safe because Chrome's PDF viewer does not execute document JavaScript.
 *    See https://issues.chromium.org/issues/40328564.
 */

export type AttachmentKind = 'pdf' | 'image' | 'csv' | 'xlsx' | 'xls' | 'other';

const INLINE_TYPES: Record<string, AttachmentKind> = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
};

const DOWNLOAD_TYPES: Record<string, AttachmentKind> = {
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
};

const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

const OCTET = 'application/octet-stream';

/** Allowlisted MIME type for a file, from its stored MIME type, falling back to the extension. */
export function safeContentType(fileName: string, mimeType: string | null): string {
  const declared = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (INLINE_TYPES[declared] || DOWNLOAD_TYPES[declared]) return declared;
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  // Xero often stores a generic type (octet-stream) for spreadsheets and CSVs; the extension is
  // the better signal there. Still allowlisted, so an unknown extension stays octet-stream.
  return BY_EXTENSION[ext] ?? OCTET;
}

export function attachmentKind(fileName: string, mimeType: string | null): AttachmentKind {
  const type = safeContentType(fileName, mimeType);
  return INLINE_TYPES[type] ?? DOWNLOAD_TYPES[type] ?? 'other';
}

/** RFC 6266 / 5987: an ASCII fallback plus the exact UTF-8 name, with no header-injection characters. */
export function contentDisposition(disposition: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export interface AttachmentDelivery {
  headers: Record<string, string>;
  inline: boolean;
}

export function attachmentDelivery(fileName: string, mimeType: string | null, forceDownload: boolean): AttachmentDelivery {
  const contentType = safeContentType(fileName, mimeType);
  const kind = INLINE_TYPES[contentType];
  const inline = !forceDownload && !!kind;
  const csp = !inline
    ? "sandbox; default-src 'none'"
    : kind === 'pdf'
      ? "frame-ancestors 'self'"
      : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'";
  return {
    inline,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', fileName),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': csp,
      'Cache-Control': 'private, no-store',
    },
  };
}

import { docTypeLabel, expiryPill, formatBytes, formatDate } from '../apps/web/src/lib/documents';
import { viewerKind } from '../apps/web/src/lib/attachmentPreview';

describe('document display helpers', () => {
  it('formats a calendar date without a timezone shift', () => {
    expect(formatDate('2026-10-28')).toBe('28 Oct 2026');
    expect(formatDate('2026-10-28T00:00:00.000Z')).toBe('28 Oct 2026');
    expect(formatDate(null)).toBe('—');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('turns an expiry into a pill: red when expired, amber with days left, gray when valid, none without', () => {
    expect(expiryPill({ status: 'none', daysLeft: null }, null)).toBeNull();
    expect(expiryPill({ status: 'expired', daysLeft: -5 }, '2026-10-02')).toMatchObject({ tone: 'red', status: 'Expired' });
    expect(expiryPill({ status: 'expiring', daysLeft: 21 }, '2026-10-28')).toMatchObject({ tone: 'amber', status: '21 days', text: '28 Oct 2026' });
    expect(expiryPill({ status: 'expiring', daysLeft: 1 }, '2026-10-08')?.status).toBe('1 day');
    expect(expiryPill({ status: 'expiring', daysLeft: 0 }, '2026-10-07')?.status).toBe('Today');
    expect(expiryPill({ status: 'valid', daysLeft: 400 }, '2031-02-14')).toMatchObject({ tone: 'gray', status: 'Valid' });
  });

  it('looks a doc type label up across categories, falling back to the key', () => {
    const types = { IDENTITY: [{ key: 'NATIONAL_ID', label: 'National ID (NID)' }] };
    expect(docTypeLabel(types, 'NATIONAL_ID')).toBe('National ID (NID)');
    expect(docTypeLabel(types, 'MYSTERY')).toBe('MYSTERY');
  });

  it('previews only what the server serves inline: PDFs and raster images, never DOCX or SVG', () => {
    expect(viewerKind('a.pdf', 'application/pdf')).toBe('pdf');
    expect(viewerKind('a.webp', 'image/webp')).toBe('image');
    expect(viewerKind('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('other');
    expect(viewerKind('a.svg', 'image/svg+xml')).toBe('other');
  });
});

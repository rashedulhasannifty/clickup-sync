const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6, no DST.

/**
 * Convert a bucket key (e.g. '2026-05-21' as BD-local bucket start) to the
 * UTC ISO window that contains all time entries falling in that bucket.
 *
 * - day:   [bucketStart, bucketStart + 1 day)
 * - week:  [bucketStart, bucketStart + 7 days)  (Sunday-start week)
 * - month: [bucketStart, first day of next month)
 *
 * Returns `from` inclusive and `to` inclusive-of-last-ms so the existing
 * `/time-entries/by-client?from=…&to=…` endpoint (closed-closed) yields the
 * correct set without crossing into the next bucket.
 */
export function bucketWindowUtc(
  bucket: string,
  bucketType: 'day' | 'week' | 'month',
): { from: string; to: string } {
  const [yStr, mStr, dStr] = bucket.split('-');
  const y = Number(yStr);
  const m = Number(mStr); // 1-indexed
  const d = Number(dStr);
  if (!y || !m || !d) {
    throw new Error(`bucketWindowUtc: invalid bucket "${bucket}"`);
  }

  // Midnight BD local in UTC ms.
  const startUtcMs = Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS;

  let endExclusiveUtcMs: number;
  if (bucketType === 'day') {
    endExclusiveUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  } else if (bucketType === 'week') {
    endExclusiveUtcMs = startUtcMs + 7 * 24 * 60 * 60 * 1000;
  } else {
    // month: end = first day of next month at midnight BD local.
    endExclusiveUtcMs = Date.UTC(y, m, 1) - DHAKA_OFFSET_MS;
  }

  return {
    from: new Date(startUtcMs).toISOString(),
    to: new Date(endExclusiveUtcMs - 1).toISOString(),
  };
}

/**
 * Human-readable label for a bucket, e.g. for a drawer title.
 * - day:   'Tuesday, May 21, 2026'
 * - week:  'Week of May 17 – May 23, 2026'
 * - month: 'May 2026'
 */
export function bucketLabel(bucket: string, bucketType: 'day' | 'week' | 'month'): string {
  const [yStr, mStr, dStr] = bucket.split('-');
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const d = Number(dStr);
  const start = new Date(Date.UTC(y, m, d));
  const fmtDay = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const fmtMon = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const fmtMonth = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });

  if (bucketType === 'day') return fmtDay.format(start);
  if (bucketType === 'month') return fmtMonth.format(start);
  // week: Sunday start, Saturday end
  const end = new Date(Date.UTC(y, m, d + 6));
  return `Week of ${fmtMon.format(start)} – ${fmtMon.format(end)}, ${y}`;
}

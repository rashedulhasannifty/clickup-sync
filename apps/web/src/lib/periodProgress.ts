import type { CostTrendBucket } from '../hooks/useReports';

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * If `bucket` represents the current incomplete BD-local period, returns
 * `{ elapsed, total }` in seconds. Otherwise returns `null`.
 *
 * - day:   bucket date equals today (BD)
 * - week:  bucket date equals the Sunday on/before today (BD)
 * - month: bucket date equals the 1st of the current month (BD)
 */
export function currentPeriodProgress(
  bucket: string,
  bucketType: CostTrendBucket,
  now: Date = new Date(),
): { elapsed: number; total: number } | null {
  const parts = bucket.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]); // 1-indexed
  const d = Number(parts[2]);
  if (!y || !m || !d) return null;

  // Shift "now" into Dhaka-local time by adding the offset, then read it as
  // UTC. The resulting Date's getUTC* values represent BD local.
  const nowBdMs = now.getTime() + DHAKA_OFFSET_MS;
  const nowBd = new Date(nowBdMs);
  const bdYear  = nowBd.getUTCFullYear();
  const bdMonth = nowBd.getUTCMonth(); // 0-indexed
  const bdDay   = nowBd.getUTCDate();
  const bdDow   = nowBd.getUTCDay();   // 0 = Sunday

  if (bucketType === 'day') {
    if (y !== bdYear || (m - 1) !== bdMonth || d !== bdDay) return null;
    const bucketStartBdMs = Date.UTC(y, m - 1, d);
    const elapsedMs = nowBdMs - bucketStartBdMs;
    if (elapsedMs <= 0) return null;
    return { elapsed: elapsedMs / 1000, total: 86400 };
  }

  if (bucketType === 'week') {
    // Today's Sunday in BD local.
    const todaySundayMs = Date.UTC(bdYear, bdMonth, bdDay - bdDow);
    const bucketStartMs = Date.UTC(y, m - 1, d);
    if (todaySundayMs !== bucketStartMs) return null;
    const elapsedMs = nowBdMs - bucketStartMs;
    if (elapsedMs <= 0) return null;
    return { elapsed: elapsedMs / 1000, total: 7 * 86400 };
  }

  // month
  if (y !== bdYear || (m - 1) !== bdMonth || d !== 1) return null;
  const monthStartMs = Date.UTC(y, m - 1, 1);
  const elapsedMs = nowBdMs - monthStartMs;
  if (elapsedMs <= 0) return null;
  // Days in month: day 0 of (m) gives the last day of (m-1). Since m is
  // 1-indexed, passing m directly gets us the last day of *this* month.
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { elapsed: elapsedMs / 1000, total: daysInMonth * 86400 };
}

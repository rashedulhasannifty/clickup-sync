/**
 * Shared date helpers for the report services. Extracted from the former
 * monolithic `ReportsService` so every split report service resolves default
 * windows and parses query-string dates identically.
 */

export function defaultFrom(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}

export function defaultFromForBucket(bucket: 'day' | 'week' | 'month'): Date {
  const d = new Date();
  if (bucket === 'day')   { d.setDate(d.getDate() - 30); return d; }
  if (bucket === 'week')  { d.setDate(d.getDate() - 7 * 12); return d; }
  // month: 12 months back
  d.setMonth(d.getMonth() - 12);
  return d;
}

export function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

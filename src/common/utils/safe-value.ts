export const toStringOrNull = (value: unknown): string | null => value === null || value === undefined || value === '' ? null : String(value);
export const toStringOrEmpty = (value: unknown): string => value === null || value === undefined ? '' : String(value);
export const toNumberOrZero = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
// Postgres int4 range. A value outside it (e.g. a mis-mapped "number" custom
// field holding a huge id/phone number that got matched into sprint_points)
// would overflow an `integer` column and abort the whole upsert/backfill, so
// treat anything out of [0, INT32_MAX] as garbage → 0.
export const INT32_MAX = 2147483647;
export const toSafeInt32 = (value: unknown): number => {
  const n = Math.trunc(toNumberOrZero(value));
  return n >= 0 && n <= INT32_MAX ? n : 0;
};
export const joinNames = (items: unknown[], key = 'username'): string | null => {
  const values = items.map((x: any) => x?.[key]).filter(Boolean).map(String);
  return values.length ? values.join(',') : null;
};

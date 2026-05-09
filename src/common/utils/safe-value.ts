export const toStringOrNull = (value: unknown): string | null => value === null || value === undefined || value === '' ? null : String(value);
export const toStringOrEmpty = (value: unknown): string => value === null || value === undefined ? '' : String(value);
export const toNumberOrZero = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
export const joinNames = (items: unknown[], key = 'username'): string | null => {
  const values = items.map((x: any) => x?.[key]).filter(Boolean).map(String);
  return values.length ? values.join(',') : null;
};

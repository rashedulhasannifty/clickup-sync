export function fromClickupMillis(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function subtractDays(days: number): Date { const d = new Date(); d.setDate(d.getDate() - days); return d; }
export function subtractHours(hours: number): Date { const d = new Date(); d.setHours(d.getHours() - hours); return d; }

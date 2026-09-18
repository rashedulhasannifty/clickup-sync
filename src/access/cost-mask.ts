import { AccessScope, canSeeCost } from "./access-scope";

/** Every money field a report row can carry. Hours are never masked. */
// `currency` is deliberately absent: it's a label, not an amount, and keeping it a
// non-null string lets the web type every cost field as `number | null`.
export const COST_FIELDS = [
  "costCents",
  "hourlyRateCents",
  "rateId",
  "cost",
  "estimation",
  "validCostCents",
  "costAud",
  "totalCostAud",
  "totalCostCents",
] as const;

/**
 * Null the cost fields of one row unless the viewer may see cost for its client.
 * Nulls rather than deletes, so the JSON shape is stable and the UI renders "—".
 */
export function maskCost<T extends Record<string, unknown>>(
  row: T,
  s: AccessScope,
  optionId: string | null,
  fields: readonly string[] = COST_FIELDS,
): T {
  if (canSeeCost(s, optionId)) return row;
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) if (f in out) out[f] = null;
  return out as T;
}

/**
 * Shared parsing for the dashboard's multi-select filter params.
 *
 * The Tasks and Time Entries filter dropdowns send their selections as a
 * comma-separated list in the *existing* single-value query params
 * (`?client=Acme,Beta`). That keeps every pre-existing deep-link working —
 * `?client=Acme` simply parses as a one-element list — so no caller had to
 * change when the dropdowns became multi-select.
 */

/**
 * Split a comma-separated query param into a de-duplicated list of trimmed,
 * non-empty values.
 *
 * Returns `undefined` when nothing usable remains (absent param, empty string,
 * or commas only) so callers can treat "absent" and "empty selection"
 * identically and skip the where-clause entirely.
 */
export function csvList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return [...new Set(parts)];
}

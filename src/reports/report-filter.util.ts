import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';

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

/**
 * Resolves the `list_id`s matching a `sprintStatus` filter, for the
 * `AND t.list_id IN (...)` clause shared by `tasks()` / `timeEntriesList()` /
 * `timeEntriesAggregates()`.
 *
 * `clickup_tasks`/`clickup_time_entries` have no Prisma relation to
 * `clickup_lists` (`ClickupList` declares no `@relation` back to
 * `ClickupTask`), so a nested `{ list: { archived } }` where-clause isn't
 * available — this two-step "fetch ids, then IN" is the join, done in
 * application code instead of SQL.
 *
 * Returns `undefined` for `sprintStatus` of `'all'`, absent, or any other
 * unrecognized value — the caller must skip pushing a clause in that case
 * (backward-compatible: no `sprintStatus` means the exact pre-existing
 * query). Returns an actual (possibly empty) array for `'active'` /
 * `'completed'` — callers MUST still push the `{ listId: { in: [] } }` clause
 * when the array is empty (e.g. `if (ids)`, never `if (ids?.length)`):
 * "completed" with zero archived lists must return zero tasks, not silently
 * fall through to unfiltered.
 */
export async function sprintStatusListIds(
  prisma: Pick<PrismaService, '$queryRaw'>,
  sprintStatus?: string,
): Promise<string[] | undefined> {
  if (sprintStatus !== 'active' && sprintStatus !== 'completed') return undefined;
  const archived = sprintStatus === 'completed';
  const rows = await prisma.$queryRaw<{ list_id: string }[]>(Prisma.sql`
    SELECT list_id FROM clickup_lists WHERE archived = ${archived}
  `);
  return rows.map((r) => r.list_id);
}

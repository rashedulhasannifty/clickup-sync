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

/**
 * Task columns covered by the dashboard's free-text search.
 *
 * Deliberately short, indexed-friendly columns only — `description` and the raw
 * JSON payload are excluded because ILIKE over those gets expensive fast.
 *
 * Shared so the Tasks page and the Time Entries page resolve the SAME task set
 * for the same query. They used to diverge: Tasks searched ten task columns
 * while Time Entries searched only `task.taskName`, so a task matching on
 * `listName`, `client`, or `department` appeared on one page and not the other —
 * and a task renamed in ClickUp could silently drop out of one page's results
 * while staying in the other's. Any field added here must reach both pages, so
 * add it here rather than at either call site.
 */
export function taskSearchOr(q: string): Prisma.ClickupTaskWhereInput[] {
  const match = { contains: q, mode: 'insensitive' as const };
  return [
    { taskName: match },
    { taskId: match },
    { assigneesNames: match },
    { assigneesEmails: match },
    { client: match },
    { listName: match },
    { spaceName: match },
    { sprintName: match },
    { department: match },
    { executiveName: match },
  ];
}

/**
 * The same task-side search clauses, reached through `ClickupTimeEntry.task`.
 *
 * Derived from `taskSearchOr` rather than restated so the two can never drift.
 * Entries with no task row match none of these — callers OR in the
 * entry-specific fields (logger name/email, time-entry id) separately, which is
 * what keeps a task-less entry findable.
 */
export function timeEntryTaskSearchOr(q: string): Prisma.ClickupTimeEntryWhereInput[] {
  return taskSearchOr(q).map((task) => ({ task }));
}

/**
 * Sentinel `taskId` for the "entries with no task at all" bucket.
 *
 * `clickup_time_entries.task_id` is nullable and those rows are deliberately
 * kept visible (see the archived-filter and search notes below), so the
 * grouped-by-task view collects them under one synthetic row. A real ClickUp
 * task id is an alphanumeric slug, so this bracketed value can never collide.
 */
export const NO_TASK_ID = '__none__';

/** Every filter the Time Entries page (and its grouped/aggregate siblings) accepts. */
export interface TimeEntryFilters {
  /** Inclusive `start_time` window. Callers parse/default these before calling. */
  from: Date;
  to: Date;
  /** Comma-separated multi-selects (see `csvList`). */
  userId?: string;
  status?: string;
  client?: string;
  listId?: string;
  folderId?: string;
  /** Our own per-task flag, NOT ClickUp's per-entry `billable` column. */
  chargeable?: string;
  search?: string;
  spaceId?: string;
  missingOnly?: string;
  archived?: string;
  sprintStatus?: string;
  /** Exact-match single task, or `NO_TASK_ID` for the task-less bucket. */
  taskId?: string;
}

/**
 * The one where-clause builder behind `/reports/time-entries`,
 * `/reports/time-entries/aggregates` and `/reports/time-entries/by-task`.
 *
 * This used to be an inlined copy per method, with a comment arguing that one
 * local copy was easier to reason about than a shared helper. That held while
 * the two consumers were independent. It stopped holding once the grouped view
 * arrived: a task's collapsed total and the entries revealed by expanding it
 * are two queries whose result sets MUST coincide, or the breakdown visibly
 * fails to sum to the number above it. Same reasoning ties the metric cards to
 * the rows they summarize. Divergence here is a data bug, not a style nit —
 * so there is exactly one copy.
 */
export async function buildTimeEntryWhere(
  prisma: Pick<PrismaService, '$queryRaw'>,
  f: TimeEntryFilters,
): Promise<Prisma.ClickupTimeEntryWhereInput> {
  const where: Prisma.ClickupTimeEntryWhereInput = { startTime: { gte: f.from, lte: f.to } };
  const and: Prisma.ClickupTimeEntryWhereInput[] = [];
  if (f.spaceId) and.push({ task: { spaceId: f.spaceId, isDeleted: false } });
  // The categorical filters are multi-select in the dashboard and arrive as a
  // comma-separated list. A single value parses as a one-element list, so
  // pre-existing deep-links (e.g. `?userId=u1&status=NO_RATE_FOUND`) behave
  // exactly as before.
  const clients = csvList(f.client);
  const listIds = csvList(f.listId);
  const folderIds = csvList(f.folderId);
  const userIds = csvList(f.userId);
  const statuses = csvList(f.status);
  // Intentionally no `isDeleted: false` here (unlike the spaceId clause):
  // the base list shows entries regardless of task soft-deletion, so the
  // client filter stays consistent with that. Don't "fix" this to exclude
  // deleted tasks — it would make client-only vs client+space disagree.
  if (clients) and.push({ task: { client: { in: clients } } });
  if (listIds) and.push({ task: { listId: { in: listIds } } });
  if (folderIds) and.push({ task: { folderId: { in: folderIds } } });
  // ClickUp `archived` flag. Archived status lives only on the joined task
  // (time entries have no archived column of their own). 'exclude' keeps
  // entries whose task isn't archived AND entries with no task at all — hence
  // `NOT { task archived:true }`, not `task { archived:false }`, which would
  // also drop null-task rows. 'only' keeps just archived-task entries.
  // 'include'/undefined applies no constraint.
  if (f.archived === 'only') and.push({ task: { archived: true } });
  else if (f.archived === 'exclude') and.push({ NOT: { task: { archived: true } } });
  // Sprint (== clickup_lists row) status filter: 'active'/'completed' scopes
  // to entries whose task's list isn't/is archived (dropping task-less
  // entries — no task, no sprint, unlike the archived filter above which
  // deliberately keeps them); 'all'/absent/unrecognized emits no clause
  // (backward-compatible). See `sprintStatusListIds` for the fetch-ids-then-IN
  // rationale (no Prisma relation from ClickupList to ClickupTask).
  const sprintListIds = await sprintStatusListIds(prisma, f.sprintStatus);
  if (sprintListIds) and.push({ task: { listId: { in: sprintListIds } } });
  if (userIds) where.userId = { in: userIds };
  // Exact match, never `contains`: the grouped view expands a row by re-querying
  // its own task id, and a substring match would pull in every task whose id
  // merely contains it.
  if (f.taskId === NO_TASK_ID) where.taskId = null;
  else if (f.taskId) where.taskId = f.taskId;
  if (f.missingOnly === 'true') {
    where.status = 'NO_RATE_FOUND';
  } else if (statuses) {
    where.status = { in: statuses };
  }
  // Chargeability lives on the task. 'true' must keep entries with no task at
  // all — they have no flag to read and count as chargeable — hence
  // `NOT { task isChargeable:false }` rather than `task { isChargeable:true }`,
  // which would drop them. Same shape as the archived filter above.
  if (f.chargeable === 'true') and.push({ NOT: { task: { isChargeable: false } } });
  else if (f.chargeable === 'false') and.push({ task: { isChargeable: false } });
  if (f.search?.trim()) {
    const q = f.search.trim();
    const match = { contains: q, mode: 'insensitive' as const };
    and.push({
      OR: [
        // Every task column the Tasks page searches, so both pages resolve the
        // same task set for the same query.
        ...timeEntryTaskSearchOr(q),
        // Entry-specific fields on top — these also keep a task-less entry findable.
        { userName: match },
        { userEmail: match },
        { taskId: match },
        { timeEntryId: match },
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
}

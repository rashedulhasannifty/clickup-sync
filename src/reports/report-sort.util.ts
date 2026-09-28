import { Prisma } from "@prisma/client";

import { AccessScope, isUnrestricted } from "../access/access-scope";

/**
 * Column ordering for the three server-paginated list reports (Tasks, Time
 * entries, Time entries grouped by task).
 *
 * Every parser here is a WHITELIST keyed on the column keys the DataTable on
 * the matching page sends, and every one falls back to that report's original
 * order when the key is absent or unrecognized. That fallback is the contract:
 * callers that never send `sort` — the exports, `TaskTimeEntriesPanel`, any
 * future consumer — keep byte-identical ordering.
 *
 * Two rules every sort here obeys:
 *
 * - **A unique tie-break always comes last.** These lists are paged with
 *   OFFSET, so a non-unique ORDER BY lets rows duplicate or vanish between
 *   pages — Postgres is free to return equal rows in any order per query.
 * - **Nullable columns put nulls last** in both directions. Postgres defaults
 *   NULLs first on DESC, which would open `client desc` on a page of blanks.
 *   The one column this cannot cover is `taskName` — see `timeEntryOrderBy`.
 */
export type SortDir = "asc" | "desc";

/** `desc` unless the caller literally asked for `asc` — matches `/reports/work`. */
export function parseSortDir(v: string | undefined): SortDir {
  return v === "asc" ? "asc" : "desc";
}

/**
 * Cost is the one field a scoped viewer may not see (`maskCost` nulls it per
 * row), and ranking rows by a value the viewer can't read leaks it: position in
 * a cost-sorted list is a comparison, and combined with the visible hours it
 * gives away the rate. `/reports/work` solves this by splitting cost-sorted
 * rows into a visible block and a direction-independent hidden block
 * (`sortRows` in `work.assemble.ts`), which it can do because it sorts in
 * application code over the whole filtered set.
 *
 * These two list reports page in SQL, where that split isn't expressible, so
 * they take the conservative branch instead: a cost/rate sort is honored only
 * for a viewer who can see every row's cost, and anyone else falls back to the
 * report's default order. With team scoping off — the default — `resolveScope`
 * returns `unrestricted` for every role, so this changes nothing for anyone.
 */
function mayRankByCost(scope: AccessScope): boolean {
  return isUnrestricted(scope);
}

/** `{ sort, nulls: 'last' }` — for a nullable column, in either direction. */
function nullsLast(dir: SortDir): Prisma.SortOrderInput {
  return { sort: dir, nulls: "last" };
}

/**
 * `/reports/tasks`. Keys are the Tasks page's DataTable column keys (snake_case
 * there, camelCase in Prisma). No cost column is rendered on that page, so
 * nothing here is maskable.
 */
export function taskOrderBy(
  sort: string | undefined,
  dir: SortDir,
): Prisma.ClickupTaskOrderByWithRelationInput[] {
  // Unique tie-break: `task_id` is the primary key.
  const tie: Prisma.ClickupTaskOrderByWithRelationInput = { taskId: "asc" };
  switch (sort) {
    case "task_name":
      return [{ taskName: dir }, tie];
    case "status":
      return [{ status: nullsLast(dir) }, tie];
    case "space_name":
      return [{ spaceName: nullsLast(dir) }, tie];
    case "list_name":
      return [{ listName: nullsLast(dir) }, tie];
    case "client":
      return [{ client: nullsLast(dir) }, tie];
    case "department":
      return [{ department: nullsLast(dir) }, tie];
    case "sprint_name":
      return [{ sprintName: nullsLast(dir) }, tie];
    case "sprint_points":
      return [{ sprintPoints: dir }, tie];
    case "time_estimate":
      return [{ timeEstimate: nullsLast(dir) }, tie];
    case "time_spent":
      return [{ timeSpent: nullsLast(dir) }, tie];
    case "synced_at":
      return [{ syncedAt: dir }, tie];
    case "updated_date":
      return [{ updatedDate: nullsLast(dir) }, tie];
    // The page's original order, kept for every unrecognized key.
    default:
      return [{ updatedDate: "desc" }];
  }
}

/**
 * `/reports/time-entries` (the flat view). Task attributes sort through the
 * relation, so a time entry with no task at all joins to NULL and takes the
 * nulls-last treatment alongside a task whose own `client`/`list_name` is null.
 *
 * `taskName` is the exception: `task_name` is NOT NULL on the task, so Prisma
 * types it `SortOrder` with no `nulls` modifier even though the join can still
 * produce NULL for a task-less entry. `taskName desc` therefore leads with
 * those task-less rows (Postgres' NULLS FIRST default on DESC). They only
 * reach an unrestricted viewer — `buildTimeEntryWhere`'s task-relation filter
 * drops task-less entries for a scoped one — and every row that does have a
 * task still orders correctly, so this is accepted rather than worked around.
 */
export function timeEntryOrderBy(
  sort: string | undefined,
  dir: SortDir,
  scope: AccessScope,
): Prisma.ClickupTimeEntryOrderByWithRelationInput[] {
  // Unique tie-break: `time_entry_id` is the primary key.
  const tie: Prisma.ClickupTimeEntryOrderByWithRelationInput = {
    timeEntryId: "asc",
  };
  switch (sort) {
    case "taskName":
      return [{ task: { taskName: dir } }, tie];
    case "client":
      return [{ task: { client: nullsLast(dir) } }, tie];
    case "listName":
      return [{ task: { listName: nullsLast(dir) } }, tie];
    case "timeEntryId":
      return [{ timeEntryId: dir }];
    case "userName":
      return [{ userName: nullsLast(dir) }, tie];
    case "durationHours":
      return [{ durationHours: dir }, tie];
    case "chargeable":
      return [{ isChargeable: dir }, tie];
    case "status":
      return [{ status: dir }, tie];
    case "syncedAt":
      return [{ syncedAt: dir }, tie];
    case "startTime":
      return [{ startTime: nullsLast(dir) }, tie];
    // Maskable — see `mayRankByCost`. A scoped viewer gets the default order.
    case "costAud":
      return mayRankByCost(scope)
        ? [{ costCents: dir }, tie]
        : [{ startTime: "desc" }];
    case "hourlyRateCents":
      return mayRankByCost(scope)
        ? [{ hourlyRateCents: dir }, tie]
        : [{ startTime: "desc" }];
    // The page's original order, kept for every unrecognized key.
    default:
      return [{ startTime: "desc" }];
  }
}

/** Sort keys `/reports/time-entries/by-task` folds in application code. */
export type TaskGroupSort =
  | "taskName"
  | "client"
  | "listName"
  | "entryCount"
  | "totalHours"
  | "chargeableHours"
  | "chargeable"
  | "missingRateCount"
  | "lastActivity"
  | "costAud";

/** The grouped view's original order. */
export const TASK_GROUP_SORT_DEFAULT: TaskGroupSort = "totalHours";

/** The three keys that need the task join done BEFORE the page slice. */
const TASK_GROUP_JOINED_SORTS: readonly TaskGroupSort[] = [
  "taskName",
  "client",
  "listName",
];

export function parseTaskGroupSort(
  v: string | undefined,
  scope: AccessScope,
): TaskGroupSort {
  switch (v) {
    case "taskName":
    case "client":
    case "listName":
    case "entryCount":
    case "totalHours":
    case "chargeableHours":
    case "chargeable":
    case "missingRateCount":
    case "lastActivity":
      return v;
    // Maskable — see `mayRankByCost`.
    case "costAud":
      return mayRankByCost(scope) ? "costAud" : TASK_GROUP_SORT_DEFAULT;
    default:
      return TASK_GROUP_SORT_DEFAULT;
  }
}

/** True when this sort reads a column that lives on the task, not the bucket. */
export function taskGroupSortNeedsTask(sort: TaskGroupSort): boolean {
  return TASK_GROUP_JOINED_SORTS.includes(sort);
}

/** One folded bucket, as much of it as sorting reads. */
export interface SortableTaskGroup {
  taskId: string;
  entryCount: number;
  hours: number;
  chargeableHours: number;
  nonChargeableCount: number;
  validCostCents: number;
  missingRateCount: number;
  lastActivity: Date | null;
}

/** The task columns a `taskName`/`client`/`listName` sort needs, by task id. */
export interface TaskGroupSortAttrs {
  taskName: string | null;
  client: string | null;
  listName: string | null;
}

/**
 * Order the folded buckets before the page slice. Text keys read from `attrs`
 * (the task join); everything else is on the bucket itself.
 *
 * `chargeable` ranks the tri-state pill the row renders rather than a raw
 * boolean — wholly chargeable, then partial, then wholly not — so the column
 * sorts by what it displays. `nonChargeableCount`, not the hours sum, decides
 * it, for the same reason the pill uses it: a bucket of only 0-duration
 * non-chargeable entries would otherwise read as fully chargeable.
 */
export function sortTaskGroups<T extends SortableTaskGroup>(
  buckets: T[],
  sort: TaskGroupSort,
  dir: SortDir,
  attrs: ReadonlyMap<string, TaskGroupSortAttrs>,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const text = (b: T): string | null => {
    const a = attrs.get(b.taskId);
    if (!a) return null;
    return sort === "taskName"
      ? a.taskName
      : sort === "client"
        ? a.client
        : a.listName;
  };
  const num = (b: T): number => {
    switch (sort) {
      case "entryCount":
        return b.entryCount;
      case "chargeableHours":
        return b.chargeableHours;
      case "missingRateCount":
        return b.missingRateCount;
      case "lastActivity":
        return b.lastActivity?.getTime() ?? 0;
      case "costAud":
        return b.validCostCents;
      // 0 = wholly chargeable, 1 = partial, 2 = wholly non-chargeable.
      case "chargeable":
        return b.nonChargeableCount === 0
          ? 0
          : b.nonChargeableCount < b.entryCount
            ? 1
            : 2;
      default:
        return b.hours;
    }
  };
  return [...buckets].sort((a, b) => {
    // Unique tie-break (the task id) closes every branch, so equal rows keep a
    // stable order across pages.
    const tie = a.taskId.localeCompare(b.taskId);
    if (taskGroupSortNeedsTask(sort)) {
      const av = text(a);
      const bv = text(b);
      // Nulls last in BOTH directions, matching the SQL-side sorts: `(No task)`
      // rows, and tasks whose row is gone, land at the end rather than opening
      // the first page of a descending sort.
      if (av == null || bv == null) {
        if (av == null && bv == null) return tie;
        return av == null ? 1 : -1;
      }
      return (
        av.localeCompare(bv, undefined, { sensitivity: "base" }) * sign || tie
      );
    }
    return (num(a) - num(b)) * sign || tie;
  });
}

import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { parseDate } from './report-date.util';
import { csvList, sprintStatusListIds, taskSearchOr } from './report-filter.util';

/**
 * "Everything on this task is chargeable": the flag says so, no (task,
 * assignee) rule contradicts it, and no entry has been overridden away.
 * `none` rather than "all entries are chargeable" so a task with no time on it
 * still qualifies. `partial` is defined as the complement of these two, which
 * is what keeps the three filter buckets exhaustive — see the filter below.
 */
export const WHOLLY_CHARGEABLE = {
  isChargeable: true,
  chargeabilityRules: { none: { chargeable: false } },
  timeEntries: { none: { isChargeable: false } },
} satisfies Prisma.ClickupTaskWhereInput;

export const WHOLLY_NON_CHARGEABLE = {
  isChargeable: false,
  chargeabilityRules: { none: { chargeable: true } },
  timeEntries: { none: { isChargeable: true } },
} satisfies Prisma.ClickupTaskWhereInput;

/** Columns the task list (and the /work page's rows) render. */
export const TASK_LIST_SELECT = {
  taskId: true, taskName: true, url: true, spaceId: true, spaceName: true, status: true, statusType: true, statusColor: true,
  priority: true, parentTaskId: true, assigneesNames: true, assigneesEmails: true,
  updatedDate: true, syncedAt: true, sprintPoints: true, sprintName: true, cost: true,
  client: true, subProjects: true, department: true, isDeleted: true, archived: true,
  listName: true, dueDate: true, timeEstimate: true, timeSpent: true,
  createdDate: true, closedDate: true, startDate: true, syncCount: true,
  estimation: true, folderName: true, creatorName: true, executiveName: true,
  isChargeable: true,
} satisfies Prisma.ClickupTaskSelect;

/** Every filter the Tasks page accepts. Multi-selects are comma-separated (see `csvList`). */
export interface TaskFilters {
  spaceId?: string;
  status?: string;
  search?: string;
  /** Applied to `updated_date` unless `dateWindow: false`. */
  from?: string;
  to?: string;
  priority?: string;
  /** Task assignee NAMES (substring match on `assignees_names`). */
  assigneeNames?: string;
  type?: string;
  archived?: string;
  client?: string;
  taskIds?: string;
  listId?: string;
  folderId?: string;
  sprintStatus?: string;
  chargeable?: string;
  subProject?: string;
}

export interface TaskWhereOptions {
  /** Apply `from`/`to` to `updated_date` (the Tasks page's meaning). Default true. */
  dateWindow?: boolean;
  /** Hide soft-deleted tasks. Default true. */
  excludeDeleted?: boolean;
}

/**
 * The one where-clause builder behind `/reports/tasks`, and the task side of
 * `/reports/work`. Extracted from `TasksReportService.tasks` unchanged; the two
 * options exist only so /work can list deleted tasks that have time in range
 * and apply its own "updated OR logged" date rule.
 */
export async function buildTaskWhere(
  prisma: Pick<PrismaService, '$queryRaw'>,
  f: TaskFilters,
  opts: TaskWhereOptions = {},
): Promise<Prisma.ClickupTaskWhereInput> {
  const where: Prisma.ClickupTaskWhereInput = {};
  // Clauses that would otherwise collide on a single `where` key accumulate
  // here and land on `where.AND` at the end. The assignee filter and the
  // free-text search each need their own OR group, so neither can own a bare
  // top-level key. Same pattern as `timeEntriesList`.
  const and: Prisma.ClickupTaskWhereInput[] = [];
  if (opts.excludeDeleted !== false) where.isDeleted = false;
  if (f.archived === 'only') {
    where.archived = true;
  } else if (f.archived === 'include') {
    // show archived and non-archived
  } else {
    // exclude, hide, undefined, '' — default: hide archived tasks
    where.archived = false;
  }
  // The categorical filters are multi-select in the dashboard and arrive as a
  // comma-separated list. A single value parses as a one-element list, so
  // pre-existing deep-links (e.g. `?client=Acme`) behave exactly as before.
  const statuses = csvList(f.status);
  const priorities = csvList(f.priority);
  const clients = csvList(f.client);
  const subProjects = csvList(f.subProject);
  const listIds = csvList(f.listId);
  const folderIds = csvList(f.folderId);
  const assigneeNames = csvList(f.assigneeNames);
  if (f.spaceId) where.spaceId = f.spaceId;
  if (statuses) where.status = { in: statuses };
  if (priorities) where.priority = { in: priorities };
  if (clients) where.client = { in: clients };
  // Any-of, exact per value — see `buildTimeEntryWhere`.
  if (subProjects) where.subProjects = { hasSome: subProjects };
  if (listIds) where.listId = { in: listIds };
  if (folderIds) where.folderId = { in: folderIds };
  if (f.type === 'parent') where.parentTaskId = null;
  if (f.type === 'subtask') where.parentTaskId = { not: null };
  // `assignees_names` is a single comma-joined string, so each selected name
  // is a substring match and multiple names OR together. Substring matching
  // means "Sam" also matches "Sameer" — pre-existing behavior, unchanged.
  if (assigneeNames) {
    and.push({
      OR: assigneeNames.map((n) => ({
        assigneesNames: { contains: n, mode: 'insensitive' as const },
      })),
    });
  }
  if (f.taskIds) {
    const ids = f.taskIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) where.taskId = { in: ids };
  }
  if (opts.dateWindow !== false && (f.from || f.to)) {
    where.updatedDate = { gte: parseDate(f.from, new Date(0)), lte: parseDate(f.to, new Date()) };
  }
  // Free-text search across short, indexed-friendly fields (see `taskSearchOr`
  // for the field list and why it is shared with the Time Entries page).
  if (f.search?.trim()) {
    and.push({ OR: taskSearchOr(f.search.trim()) });
  }
  // Sprint (== clickup_lists row) status filter: 'active'/'completed' scopes
  // to tasks whose list isn't/is archived; 'all'/absent/unrecognized emits
  // no clause at all. See `sprintStatusListIds` for the fetch-ids-then-IN
  // rationale, and why an empty array must still push a (never-matching)
  // clause instead of being treated as "no filter".
  const sprintListIds = await sprintStatusListIds(prisma, f.sprintStatus);
  if (sprintListIds) and.push({ listId: { in: sprintListIds } });

  // Chargeability filter. Defined on the task flag, its (task, assignee)
  // rules and its entries — exactly the inputs of the tri-state pill that
  // `tasks()` emits — so the three buckets are mutually exclusive. Anything
  // else (absent, 'all', unrecognized) emits no clause.
  if (f.chargeable === 'true') {
    and.push(WHOLLY_CHARGEABLE);
  } else if (f.chargeable === 'false') {
    and.push(WHOLLY_NON_CHARGEABLE);
  } else if (f.chargeable === 'partial') {
    // The COMPLEMENT of the other two, not an enumeration of the ways a task
    // can be split. Enumerating them left a hole: a task whose every entry
    // was overridden away is not "mixed" and has no disagreeing rule, so it
    // matched none of the three buckets and was reachable by no filter.
    // Defining partial structurally makes the three exhaustive by
    // construction — a future signal cannot escape them again. Two separate
    // NOTs, not `NOT: [a, b]`, so this is unambiguously NOT(a) AND NOT(b).
    and.push({ NOT: WHOLLY_CHARGEABLE });
    and.push({ NOT: WHOLLY_NON_CHARGEABLE });
  }
  if (and.length) where.AND = and;
  return where;
}

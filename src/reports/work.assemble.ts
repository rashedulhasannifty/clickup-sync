import { isPartiallyChargeable } from '../time-entries/chargeability';

/**
 * Pure assembly for `/reports/work`. Everything here is Prisma-free so the
 * rules the spec cares about — the pill, the date reason, sort, totals — are
 * tested directly. See docs/superpowers/specs/2026-09-14-tasks-and-time-one-table-design.md.
 */

/**
 * Every column the /work table can order by. The values are that page's own
 * DataTable column keys, so a header click sends the key it is labelled with.
 *
 * The four text keys (`name`, `status`, `client`, `list`, `sprint`) and the
 * three numeric ones (`est`, `lifetime`, `points`) read the task; `logged`,
 * `cost` and `lastActivity` read the in-range entry bucket. A column that has
 * no single value to order by — the charge pill, the assignee stack, the rate
 * summary, the multi-valued sub-project list — is deliberately absent and is
 * marked `sortable: false` on the page instead, so no header offers a sort that
 * wouldn't happen.
 */
export type WorkSort =
  | 'logged' | 'updated' | 'name' | 'cost' | 'lastActivity'
  | 'status' | 'client' | 'list' | 'sprint' | 'est' | 'lifetime' | 'points';
export type RowChargeable = 'yes' | 'no' | 'partial';
export type ChargeableSource = 'entries' | 'task';

/** One `groupBy` row over time entries, already converted from Prisma types. */
export interface EntryGroupRow {
  taskId: string | null;
  userId: string | null;
  userName: string | null;
  status: string;
  currency: string | null;
  isChargeable: boolean;
  count: number;
  hours: number;
  costCents: number;
  lastStart: Date | null;
}

/** The in-range entries of one task, summed. */
export interface EntryBucket {
  entryCount: number;
  hours: number;
  chargeableHours: number;
  nonChargeableCount: number;
  /** Rated entries only — a NO_RATE_FOUND entry is counted, never costed. */
  costCents: number;
  missingRateCount: number;
  excludedCount: number;
  lastActivity: Date | null;
  currency: string | null;
  loggers: Map<string, string | null>;
}

export function foldEntryGroups(rows: EntryGroupRow[], noTaskKey: string): Map<string, EntryBucket> {
  const out = new Map<string, EntryBucket>();
  for (const r of rows) {
    const key = r.taskId ?? noTaskKey;
    let b = out.get(key);
    if (!b) {
      b = {
        entryCount: 0, hours: 0, chargeableHours: 0, nonChargeableCount: 0, costCents: 0,
        missingRateCount: 0, excludedCount: 0, lastActivity: null, currency: null, loggers: new Map(),
      };
      out.set(key, b);
    }
    b.entryCount += r.count;
    b.hours += r.hours;
    // Counts, not an hours sum, decide chargeability — see `rowChargeable`.
    if (r.isChargeable) b.chargeableHours += r.hours;
    else b.nonChargeableCount += r.count;
    // Same rule as `timeEntriesByTask`: an entry with no rate contributes no
    // cost and is surfaced as a count instead.
    if (r.status === 'NO_RATE_FOUND') b.missingRateCount += r.count;
    else b.costCents += r.costCents;
    if (r.status === 'COST_EXCLUDED') b.excludedCount += r.count;
    if (r.userId) b.loggers.set(r.userId, r.userName);
    if (r.lastStart && (!b.lastActivity || r.lastStart > b.lastActivity)) b.lastActivity = r.lastStart;
    b.currency ??= r.currency;
  }
  return out;
}

/** The Tasks page's pill inputs for one task (all-time, not range-scoped). */
export interface TaskChargeInputs {
  taskChargeable: boolean;
  rules: boolean[];
  entryCount: number;
  nonChargeableCount: number;
}

/**
 * The ONE function behind both the row pill and the `chargeable` filter on
 * /work, so the two cannot disagree and the buckets stay exhaustive.
 *
 * - A row with counted entries answers from those entries (range-scoped, like
 *   `timeEntriesByTask`, which passes `rules: []` for the same reason).
 * - A row with none (listed because it was updated) answers with the task's
 *   standing answer, from exactly the inputs `tasksList` uses.
 */
export function rowChargeable(
  bucket: EntryBucket | undefined,
  task: TaskChargeInputs | undefined,
): { chargeable: RowChargeable; source: ChargeableSource } {
  if (bucket && bucket.entryCount > 0) {
    if (bucket.nonChargeableCount === 0) return { chargeable: 'yes', source: 'entries' };
    if (bucket.nonChargeableCount === bucket.entryCount) return { chargeable: 'no', source: 'entries' };
    return { chargeable: 'partial', source: 'entries' };
  }
  if (!task) {
    // Guessing "yes" here is exactly the silent wrong answer the spec forbids.
    throw new Error('rowChargeable: task inputs required for a row with no counted entries');
  }
  if (isPartiallyChargeable({
    taskChargeable: task.taskChargeable,
    rules: task.rules,
    entryCount: task.entryCount,
    nonChargeableCount: task.nonChargeableCount,
  })) {
    return { chargeable: 'partial', source: 'task' };
  }
  return { chargeable: task.taskChargeable ? 'yes' : 'no', source: 'task' };
}

/** A task that passed the task filters and the date rule. */
export interface WorkCandidate {
  taskId: string;
  taskName: string | null;
  updatedDate: Date | null;
  isDeleted: boolean;
  isChargeable: boolean;
  // Loaded for the whole candidate set purely so `sortRows` can order by them
  // before the page slice — the rendered values come from the page-only
  // TASK_LIST_SELECT join. Optional: the synthetic `(No task)` row has none of
  // them, and neither do the assembly tests that don't sort by them.
  status?: string | null;
  client?: string | null;
  listName?: string | null;
  sprintName?: string | null;
  sprintPoints?: number | null;
  timeEstimate?: bigint | number | null;
  timeSpent?: bigint | number | null;
}

export interface ResolvedRow extends WorkCandidate {
  bucket: EntryBucket | undefined;
  inRangeBecause: 'updated' | 'logged' | 'both';
}

export function inRangeBecause(
  c: WorkCandidate,
  bucket: EntryBucket | undefined,
  from: Date,
  to: Date,
): 'updated' | 'logged' | 'both' {
  // A deleted task is only ever listed for its time (see the spec's "Special rows").
  const updated = !c.isDeleted && c.updatedDate != null && c.updatedDate >= from && c.updatedDate <= to;
  const logged = !!bucket && bucket.entryCount > 0;
  if (updated && logged) return 'both';
  return logged ? 'logged' : 'updated';
}

const WORK_SORTS: readonly WorkSort[] = [
  'logged', 'updated', 'name', 'cost', 'lastActivity',
  'status', 'client', 'list', 'sprint', 'est', 'lifetime', 'points',
];

export function parseWorkSort(v: string | undefined): WorkSort {
  return WORK_SORTS.includes(v as WorkSort) ? (v as WorkSort) : 'logged';
}

/**
 * The keys whose value can be genuinely absent, and which therefore order
 * missing rows LAST in both directions — matching the SQL-side list reports so
 * the same data doesn't sort two ways on two pages. `name` is deliberately not
 * here: it keeps its original `?? ''` behaviour.
 *
 * `points` is absent for a different reason: `sprint_points` is NOT NULL with a
 * default of 0, so there is no "missing" to distinguish from a real zero.
 */
const NULLS_LAST_SORTS: readonly WorkSort[] = ['status', 'client', 'list', 'sprint', 'est', 'lifetime'];
const TEXT_SORTS: readonly WorkSort[] = ['status', 'client', 'list', 'sprint'];

/**
 * `canSeeCost` decides, per row, whether the viewer may see ITS cost. Under
 * `sort=cost` a row the viewer can't see cost for must not be ranked by that
 * hidden cost at all — not even indirectly via its position relative to
 * visible-cost rows in a chosen direction — or a MEMBER-only viewer could
 * infer a hidden client's relative cost (and, combined with visible hours,
 * its rate) purely from where its tasks land in the list. So cost-sorted
 * rows split into two blocks: visible-cost rows sorted normally by
 * direction, then EVERY hidden-cost row after them (regardless of `dir`),
 * order-stable via `taskId` so a hidden row's position never depends on its
 * real cost. Every other sort key is unaffected — cost is the only masked
 * field. Defaults to "every row visible" so callers that don't scope (or
 * don't sort by cost) see byte-identical behavior to before this existed.
 */
export function sortRows<T extends ResolvedRow>(
  rows: T[],
  sort: WorkSort,
  dir: 'asc' | 'desc',
  canSeeCost: (row: T) => boolean = () => true,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  if (sort === 'cost') {
    const visible = rows.filter((r) => canSeeCost(r));
    const hidden = rows.filter((r) => !canSeeCost(r));
    const sortedVisible = [...visible].sort((a, b) => {
      const cmp = (a.bucket?.costCents ?? 0) - (b.bucket?.costCents ?? 0);
      return cmp * sign || a.taskId.localeCompare(b.taskId);
    });
    // Never sorted by `dir` — a hidden row's rank must never move with the
    // viewer's chosen direction, which would itself leak a comparison.
    const sortedHidden = [...hidden].sort((a, b) => a.taskId.localeCompare(b.taskId));
    return [...sortedVisible, ...sortedHidden];
  }
  // One value per row for the chosen key. `null` means "absent", which only the
  // NULLS_LAST_SORTS keys can produce — every other key has a real zero.
  const value = (r: T): string | number | null => {
    switch (sort) {
      case 'status': return r.status ?? null;
      case 'client': return r.client ?? null;
      case 'list': return r.listName ?? null;
      case 'sprint': return r.sprintName ?? null;
      case 'est': return r.timeEstimate == null ? null : Number(r.timeEstimate);
      case 'lifetime': return r.timeSpent == null ? null : Number(r.timeSpent);
      case 'points': return Number(r.sprintPoints ?? 0);
      case 'lastActivity': return r.bucket?.lastActivity?.getTime() ?? 0;
      case 'updated': return r.updatedDate?.getTime() ?? 0;
      case 'name': return r.taskName ?? '';
      default: return r.bucket?.hours ?? 0;
    }
  };
  const isText = TEXT_SORTS.includes(sort) || sort === 'name';
  const nullsLast = NULLS_LAST_SORTS.includes(sort);
  return [...rows].sort((a, b) => {
    // Stable tie-break so equal rows don't shuffle between pages.
    const tie = a.taskId.localeCompare(b.taskId);
    const av = value(a);
    const bv = value(b);
    if (nullsLast && (av == null || bv == null)) {
      // Last in BOTH directions: a descending sort must not open on a page of
      // blanks, and a row's rank must not flip just because the value is absent.
      if (av == null && bv == null) return tie;
      return av == null ? 1 : -1;
    }
    const cmp = isText
      ? String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' })
      : Number(av ?? 0) - Number(bv ?? 0);
    return cmp * sign || tie;
  });
}

export interface WorkTotals {
  tasks: number;
  entries: number;
  hours: number;
  chargeableHours: number;
  costCents: number;
  missingRateCount: number;
}

/** Summed over the rows passed in — callers pass EVERY matching row, never a page. */
export function sumTotals(rows: ResolvedRow[]): WorkTotals {
  const t: WorkTotals = { tasks: rows.length, entries: 0, hours: 0, chargeableHours: 0, costCents: 0, missingRateCount: 0 };
  for (const r of rows) {
    if (!r.bucket) continue;
    t.entries += r.bucket.entryCount;
    t.hours += r.bucket.hours;
    t.chargeableHours += r.bucket.chargeableHours;
    t.costCents += r.bucket.costCents;
    t.missingRateCount += r.bucket.missingRateCount;
  }
  return t;
}

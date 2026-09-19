import { isPartiallyChargeable } from '../time-entries/chargeability';

/**
 * Pure assembly for `/reports/work`. Everything here is Prisma-free so the
 * rules the spec cares about — the pill, the date reason, sort, totals — are
 * tested directly. See docs/superpowers/specs/2026-09-14-tasks-and-time-one-table-design.md.
 */

export type WorkSort = 'logged' | 'updated' | 'name' | 'cost' | 'lastActivity';
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

export function parseWorkSort(v: string | undefined): WorkSort {
  return v === 'updated' || v === 'name' || v === 'cost' || v === 'lastActivity' ? v : 'logged';
}

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
  const num = (r: T): number => {
    switch (sort) {
      case 'lastActivity': return r.bucket?.lastActivity?.getTime() ?? 0;
      case 'updated': return r.updatedDate?.getTime() ?? 0;
      default: return r.bucket?.hours ?? 0;
    }
  };
  return [...rows].sort((a, b) => {
    const cmp = sort === 'name'
      ? (a.taskName ?? '').localeCompare(b.taskName ?? '', undefined, { sensitivity: 'base' })
      : num(a) - num(b);
    // Stable tie-break so equal rows don't shuffle between pages.
    return cmp * sign || a.taskId.localeCompare(b.taskId);
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

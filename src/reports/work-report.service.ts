import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { defaultFrom, parseDate } from './report-date.util';
import { buildTimeEntryWhere, NO_TASK_ID, taskSearchOr } from './report-filter.util';
import { buildTaskWhere, TASK_LIST_SELECT } from './task-filter.util';
import {
  foldEntryGroups, inRangeBecause, parseWorkSort, rowChargeable, sortRows, sumTotals,
  type ChargeableSource, type EntryBucket, type ResolvedRow, type RowChargeable,
  type TaskChargeInputs, type WorkCandidate,
} from './work.assemble';

/** Query params of `/reports/work` and `/reports/work/entries`. */
export interface WorkParams {
  from?: string;
  to?: string;
  spaceId?: string;
  search?: string;
  // Task-only filters: choose rows, never change a row's Logged.
  status?: string;
  priority?: string;
  type?: string;
  /** Task assignee NAMES, like the Tasks page `assigneeId`. */
  assignedTo?: string;
  // Entry filters: choose which entries are counted.
  /** Entry `userId`s (who logged the time). */
  loggedBy?: string;
  costStatus?: string;
  missingOnly?: string;
  // Task attributes: applied to both sides.
  client?: string;
  subProject?: string;
  listId?: string;
  folderId?: string;
  archived?: string;
  sprintStatus?: string;
  /** Row pill filter: 'true' | 'false' | 'partial'. */
  chargeable?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  offset?: number;
}

type PillRow = ResolvedRow & { pill?: { chargeable: RowChargeable; source: ChargeableSource } };

const MS_PER_H = 3_600_000;
/** Same cap as the Time Entries export. */
const MAX_EXPORT_ENTRIES = 5000;
const PILL_FOR: Record<string, RowChargeable> = { true: 'yes', false: 'no', partial: 'partial' };

/**
 * Defaults for the spec's declared task fields on the synthetic `NO_TASK_ID`
 * row: it has no `clickup_tasks` record to spread from (its id is never in
 * `pageIds`, so `full`/`fullById` never carries it), so `toItem`'s `rest`
 * would otherwise leave every one of these `undefined` — including the
 * response type's non-nullable `subProjects: string[]` and `archived:
 * boolean`, which a frontend built against that type (`row.subProjects.map`)
 * would crash on.
 */
const NO_TASK_ROW_DEFAULTS = {
  parentTaskId: null as string | null,
  status: null as string | null,
  statusColor: null as string | null,
  priority: null as string | null,
  assigneesNames: null as string | null,
  client: null as string | null,
  subProjects: [] as string[],
  listName: null as string | null,
  sprintName: null as string | null,
  sprintPoints: null as number | null,
  updatedDate: null as Date | null,
  archived: false,
  url: null as string | null,
};

/**
 * Backs the /work page: every task with activity in the range (updated OR time
 * logged), each carrying the in-range time on it. See the spec for why this is
 * two reused where-builders plus an in-memory merge rather than one SQL query.
 *
 * Sorting and paging happen in application code over every matching task.
 * That is safe only because this page always has a bounded range (same
 * argument as `timeEntriesByTask`). Do not add an all-time mode here without
 * moving sort + paging into SQL first.
 */
@Injectable()
export class WorkReportService {
  constructor(private readonly prisma: PrismaService) {}

  async work(p: WorkParams) {
    // Clamp both ends: an unvalidated negative `limit` (e.g. `Number('-5') || 50` === -5)
    // would reach `rows.slice` untouched and slice from the wrong end.
    const limit = Math.min(Math.max(p.limit ?? 50, 1), 5000);
    const offset = Math.max(p.offset ?? 0, 0);
    const { rows, candidatesById } = await this.resolveRows(p);
    const page = rows.slice(offset, offset + limit);

    // Without a chargeable filter the pill was not needed to filter, so its
    // task inputs are loaded for this page only (as `tasksList` does).
    const needInputs = page.filter((r) => !r.pill && !(r.bucket && r.bucket.entryCount > 0)).map((r) => r.taskId);
    const inputs = await this.taskChargeInputs(needInputs, candidatesById);
    for (const r of page) r.pill ??= rowChargeable(r.bucket, inputs.get(r.taskId));

    const pageIds = page.map((r) => r.taskId).filter((id) => id !== NO_TASK_ID);
    const full = pageIds.length
      ? await this.prisma.clickupTask.findMany({ where: { taskId: { in: pageIds } }, select: TASK_LIST_SELECT })
      : [];
    const fullById = new Map(full.map((t) => [t.taskId, t]));

    return {
      items: page.map((r) => this.toItem(r, fullById.get(r.taskId))),
      total: rows.length,
      limit,
      offset,
      totals: sumTotals(rows),
    };
  }

  /** Every counted entry behind the rows `work(p)` would list (export). */
  async workEntries(p: WorkParams) {
    const { rows, entryWhere } = await this.resolveRows(p);
    const taskIds = rows.map((r) => r.taskId).filter((id) => id !== NO_TASK_ID);
    const or: Prisma.ClickupTimeEntryWhereInput[] = [];
    if (taskIds.length) or.push({ taskId: { in: taskIds } });
    if (rows.some((r) => r.taskId === NO_TASK_ID)) or.push({ taskId: null });
    if (!or.length) return { items: [], truncated: false };
    const found = await this.prisma.clickupTimeEntry.findMany({
      where: { AND: [entryWhere, { OR: or }] },
      orderBy: [{ startTime: 'desc' }],
      take: MAX_EXPORT_ENTRIES + 1,
      select: {
        timeEntryId: true, taskId: true, userId: true, userName: true, userEmail: true,
        startTime: true, endTime: true, durationHours: true, hourlyRateCents: true,
        costCents: true, currency: true, status: true, isChargeable: true,
        chargeableOverride: true, description: true, task: { select: { taskName: true } },
      },
    });
    // Over the cap, return nothing rather than a partial list: a workbook whose
    // Entries sheet silently misses some of the Tasks sheet's hours is worse
    // than no workbook. The page tells the user to narrow the filters.
    if (found.length > MAX_EXPORT_ENTRIES) return { items: [], truncated: true };
    return {
      items: found.map((e) => ({
        timeEntryId: e.timeEntryId,
        taskId: e.taskId,
        taskName: e.task?.taskName ?? null,
        userId: e.userId,
        userName: e.userName,
        userEmail: e.userEmail,
        startTime: e.startTime,
        endTime: e.endTime,
        durationHours: e.durationHours.toNumber(),
        hourlyRateCents: Number(e.hourlyRateCents),
        costCents: Number(e.costCents),
        currency: e.currency,
        status: e.status,
        chargeable: e.isChargeable,
        chargeableOverride: e.chargeableOverride,
        description: e.description,
      })),
      truncated: false,
    };
  }

  private static entryFiltersActive(p: WorkParams): boolean {
    return !!(p.loggedBy || p.costStatus || p.missingOnly === 'true');
  }

  private static taskOnlyFiltersActive(p: WorkParams): boolean {
    return !!(p.status || p.priority || p.type || p.assignedTo || p.search?.trim());
  }

  /**
   * Candidate rows with buckets, the chargeable filter applied (if set), sorted.
   * Shared by `work` and `workEntries` so the export can never list a different
   * task set than the page.
   */
  private async resolveRows(raw: WorkParams) {
    // Include is the page default and must mean the same thing on both sides
    // (buildTaskWhere treats undefined as "exclude", buildTimeEntryWhere as "include").
    const p: WorkParams = { ...raw, archived: raw.archived || 'include' };
    const from = parseDate(p.from, defaultFrom());
    const to = parseDate(p.to, new Date());

    const entryWhere = await this.entryWhere(p, from, to);
    const groups = await this.prisma.clickupTimeEntry.groupBy({
      by: ['taskId', 'userId', 'userName', 'status', 'currency', 'isChargeable'],
      where: entryWhere,
      _count: true,
      _sum: { durationHours: true, costCents: true },
      _max: { startTime: true },
    });
    const buckets = foldEntryGroups(groups.map((g) => ({
      taskId: g.taskId,
      userId: g.userId,
      userName: g.userName,
      status: g.status,
      currency: g.currency,
      isChargeable: g.isChargeable,
      count: typeof g._count === 'number' ? g._count : 0,
      hours: g._sum.durationHours?.toNumber() ?? 0,
      costCents: Number(g._sum.costCents ?? 0n),
      lastStart: g._max.startTime,
    })), NO_TASK_ID);

    const candidates = await this.candidates(p, from, to, buckets);
    const candidatesById = new Map(candidates.map((c) => [c.taskId, c]));
    let rows: PillRow[] = candidates.map((c) => {
      const bucket = buckets.get(c.taskId);
      return { ...c, bucket, inRangeBecause: inRangeBecause(c, bucket, from, to) };
    });

    const wanted = p.chargeable && Object.hasOwn(PILL_FOR, p.chargeable) ? PILL_FOR[p.chargeable] : undefined;
    if (wanted) {
      // Filter the WHOLE candidate set before paging, so `total` and the pager
      // count only rows that pass. That needs every no-entry row's task inputs.
      const ids = rows.filter((r) => !(r.bucket && r.bucket.entryCount > 0)).map((r) => r.taskId);
      const inputs = await this.taskChargeInputs(ids, candidatesById);
      for (const r of rows) r.pill = rowChargeable(r.bucket, inputs.get(r.taskId));
      rows = rows.filter((r) => r.pill!.chargeable === wanted);
    }

    const sorted = sortRows(rows, parseWorkSort(p.sort), p.dir === 'asc' ? 'asc' : 'desc');
    return { rows: sorted, candidatesById, entryWhere };
  }

  // Mirrored by `toEntryListParams` in apps/web/src/lib/workParams.ts — the expanded
  // entry rows must list exactly what this counts. Change both together.
  /** The entry side. Spec, "Space filter decision": never pass spaceId down. */
  private async entryWhere(p: WorkParams, from: Date, to: Date): Promise<Prisma.ClickupTimeEntryWhereInput> {
    const where = await buildTimeEntryWhere(this.prisma, {
      from, to,
      userId: p.loggedBy,
      status: p.costStatus,
      missingOnly: p.missingOnly,
      client: p.client,
      subProject: p.subProject,
      listId: p.listId,
      folderId: p.folderId,
      archived: p.archived,
      sprintStatus: p.sprintStatus,
    });
    // buildTimeEntryWhere's own space clause adds `isDeleted: false`, which
    // would drop deleted tasks' time only when a space is picked.
    return p.spaceId ? { AND: [where, { task: { spaceId: p.spaceId } }] } : where;
  }

  private async candidates(
    p: WorkParams,
    from: Date,
    to: Date,
    buckets: Map<string, EntryBucket>,
  ): Promise<WorkCandidate[]> {
    const taskBase = await buildTaskWhere(this.prisma, {
      spaceId: p.spaceId, status: p.status, priority: p.priority, type: p.type,
      assigneeNames: p.assignedTo, client: p.client, subProject: p.subProject,
      listId: p.listId, folderId: p.folderId, archived: p.archived, sprintStatus: p.sprintStatus,
    }, { dateWindow: false, excludeDeleted: false });

    const bucketIds = [...buckets.keys()].filter((id) => id !== NO_TASK_ID);
    const inclusion: Prisma.ClickupTaskWhereInput = WorkReportService.entryFiltersActive(p)
      ? { taskId: { in: bucketIds } }
      : { OR: [{ updatedDate: { gte: from, lte: to }, isDeleted: false }, { taskId: { in: bucketIds } }] };

    const and: Prisma.ClickupTaskWhereInput[] = [taskBase, inclusion];
    const q = p.search?.trim();
    if (q) {
      // Task search, plus an exact time-entry-ID match (spec, Rule 2).
      const hit = await this.prisma.clickupTimeEntry.findFirst({ where: { timeEntryId: q }, select: { taskId: true } });
      and.push({ OR: [...taskSearchOr(q), ...(hit?.taskId ? [{ taskId: hit.taskId }] : [])] });
    }

    const found = await this.prisma.clickupTask.findMany({
      where: { AND: and },
      select: { taskId: true, taskName: true, updatedDate: true, isDeleted: true, isChargeable: true },
    });
    const out: WorkCandidate[] = found;
    // Entries with no task: one synthetic row, only when no task-only filter
    // could have excluded it (a task-less entry has no status/priority/name).
    if (buckets.has(NO_TASK_ID) && !WorkReportService.taskOnlyFiltersActive(p)) {
      out.push({ taskId: NO_TASK_ID, taskName: null, updatedDate: null, isDeleted: false, isChargeable: true });
    }
    return out;
  }

  /** The Tasks page's pill inputs (flag, rules, all-time entry counts) for `ids`. */
  private async taskChargeInputs(
    ids: string[],
    candidatesById: Map<string, WorkCandidate>,
  ): Promise<Map<string, TaskChargeInputs>> {
    const real = ids.filter((id) => id !== NO_TASK_ID);
    const out = new Map<string, TaskChargeInputs>();
    if (!real.length) return out;
    const [rules, counts] = await Promise.all([
      this.prisma.taskAssigneeChargeability.findMany({ where: { taskId: { in: real } }, select: { taskId: true, chargeable: true } }),
      this.prisma.clickupTimeEntry.groupBy({ by: ['taskId', 'isChargeable'], where: { taskId: { in: real } }, _count: true }),
    ]);
    for (const id of real) {
      out.set(id, { taskChargeable: candidatesById.get(id)?.isChargeable ?? true, rules: [], entryCount: 0, nonChargeableCount: 0 });
    }
    for (const r of rules) out.get(r.taskId)?.rules.push(r.chargeable);
    for (const g of counts) {
      const t = g.taskId ? out.get(g.taskId) : undefined;
      if (!t) continue;
      const n = typeof g._count === 'number' ? g._count : 0;
      t.entryCount += n;
      if (!g.isChargeable) t.nonChargeableCount += n;
    }
    return out;
  }

  private toItem(r: PillRow, t: Prisma.ClickupTaskGetPayload<{ select: typeof TASK_LIST_SELECT }> | undefined) {
    const b = r.bucket;
    // Drop the raw BigInt/Decimal columns: timeEstimate/timeSpent are re-added as hours below; cost/estimation are not used by /work.
    const { timeEstimate, timeSpent, cost: _cost, estimation: _estimation, ...rest } = t ?? ({} as Partial<NonNullable<typeof t>>);
    return {
      // `rest` is `{}` for the synthetic NO_TASK_ID row (no task to spread
      // from); fill every spec-declared field with its default first so
      // `rest` only ever overrides it, never leaves it `undefined`.
      ...(t ? {} : NO_TASK_ROW_DEFAULTS),
      ...rest,
      taskId: r.taskId,
      taskName: t?.taskName ?? null,
      isDeleted: r.isDeleted,
      timeEstimateHours: timeEstimate != null ? Number(timeEstimate) / MS_PER_H : null,
      lifetimeSpentHours: timeSpent != null ? Number(timeSpent) / MS_PER_H : null,
      inRangeBecause: r.inRangeBecause,
      chargeable: r.pill!.chargeable,
      chargeableSource: r.pill!.source,
      logged: b ? {
        entryCount: b.entryCount,
        hours: b.hours,
        chargeableHours: b.chargeableHours,
        costCents: b.costCents,
        currency: b.currency ?? 'USD',
        missingRateCount: b.missingRateCount,
        excludedCount: b.excludedCount,
        lastActivity: b.lastActivity,
        loggers: [...b.loggers.entries()]
          .map(([userId, userName]) => ({ userId, userName }))
          .sort((x, y) => (x.userName ?? '').localeCompare(y.userName ?? '')),
      } : null,
    };
  }
}

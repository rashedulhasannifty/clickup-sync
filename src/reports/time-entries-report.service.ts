import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { assembleTimesheet, dhakaDate, type TimesheetAggRow } from './timesheet.assemble';
import { defaultFrom, parseDate } from './report-date.util';
import { buildTimeEntryWhere, NO_TASK_ID } from './report-filter.util';
import { isPartiallyChargeable, resolveChargeability } from '../time-entries/chargeability';
import { AccessScope, canSeeCost, isUnrestricted, leadClientIds, timesheetUserIds } from '../access/access-scope';
import { maskCost } from '../access/cost-mask';
import { leadScopeSql, taskScopeSql, taskScopeWhere, timeEntryScopeWhere } from '../access/scope-query';
import { requireLeadView } from '../access/scope.decorator';

/**
 * Join key for `timeEntriesByUser`'s two `groupBy(['userId','userName','userEmail'])`
 * queries (visible rows + lead-scoped cost rows) — MUST use the exact same
 * grain on both sides, or a user with more than one name/email variant in the
 * window gets their lead cost double-counted (see the call site).
 */
function userGroupKey(userId: string | null, userName: string | null, userEmail: string | null): string {
  return `${userId ?? ''}|${userName ?? ''}|${userEmail ?? ''}`;
}

/** Time-entry report queries (timesheets, per-user/client/department rollups, list + aggregates). */
@Injectable()
export class TimeEntriesReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Distinct assignees that have at least one time entry. Feeds the
   *  "Exclude assignee" picker (all assignees with tracked time, so an admin
   *  can pre-emptively exclude someone who currently has a rate) AND the
   *  timesheet picker.
   *
   *  Unrestricted: unchanged. Scoped: LEFT JOINs the task (an entry can have
   *  none — a task-less/expense-style logger must not be dropped) so a
   *  viewer sees assignees who logged time on an in-scope task — OR'd with
   *  `timesheetUserIds` so a led member also appears via their own entries
   *  even when every one of them is task-less (`taskScopeSql` reads a NULL
   *  task's `scope_client_option_id` as out of scope, so default-deny still
   *  holds; the `OR` is what actually admits them). */
  async timeEntriesAssignees(scope: AccessScope) {
    type Row = { user_id: string; user_name: string | null; user_email: string | null };
    if (isUnrestricted(scope)) {
      const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT user_id,
               MAX(user_name)  AS user_name,
               MAX(user_email) AS user_email
        FROM clickup_time_entries
        WHERE user_id IS NOT NULL
        GROUP BY user_id
        ORDER BY MAX(user_name) NULLS LAST
      `);
      return rows.map((r) => ({ id: r.user_id, name: r.user_name, email: r.user_email }));
    }
    // Always an array for a scoped viewer (never null) — but `?? []` guards
    // the type regardless, and passing an empty array through `= ANY(...)`
    // is valid Postgres (matches nothing), not an error.
    const allowed = timesheetUserIds(scope) ?? [];
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT clickup_time_entries.user_id AS user_id,
             MAX(clickup_time_entries.user_name)  AS user_name,
             MAX(clickup_time_entries.user_email) AS user_email
      FROM clickup_time_entries
      LEFT JOIN clickup_tasks t ON t.task_id = clickup_time_entries.task_id
      WHERE clickup_time_entries.user_id IS NOT NULL
        AND (${taskScopeSql(scope, 't')} OR clickup_time_entries.user_id = ANY(${allowed}::text[]))
      GROUP BY clickup_time_entries.user_id
      ORDER BY MAX(clickup_time_entries.user_name) NULLS LAST
    `);
    return rows.map((r) => ({ id: r.user_id, name: r.user_name, email: r.user_email }));
  }

  /**
   * Single-assignee timesheet: per-Dhaka-day, per-task hours + cost for one user
   * over [from, to]. The SQL buckets by Dhaka day (start_time is UTC-naive — label
   * UTC first, exactly like costTrend) and aggregates per (day, task). The pure
   * `assembleTimesheet` then builds the weekday skeleton, unions worked days, and
   * applies the missing-rate cost rule. cost_cents for NO_RATE_FOUND entries is
   * never summed as valid (see data-model rule).
   *
   * Access: the viewer must lead `userId`'s team, or be `userId` themself
   * (`timesheetUserIds`) — otherwise 403, checked BEFORE the query runs. The
   * timesheet itself is deliberately NOT client-filtered (decision 10): a row
   * from a client the viewer doesn't lead still appears with its hours, just
   * with its cost masked (`canSeeCost`).
   */
  async timesheet(userId: string, fromParam: string | undefined, toParam: string | undefined, scope: AccessScope) {
    const allowed = timesheetUserIds(scope);
    if (allowed !== null && !allowed.includes(userId)) {
      throw new ForbiddenException('Not allowed to view this timesheet');
    }

    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const TZ = Prisma.raw(`'Asia/Dhaka'`);

    type Row = {
      day: string;
      task_id: string;
      task_name: string | null;
      user_name: string | null;
      hours: number;
      valid_cost_cents: bigint;
      entry_count: number;
      missing_rate_count: number;
      client_option_id: string | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT to_char((e.start_time AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
             e.task_id                                                         AS task_id,
             MAX(t.task_name)                                                  AS task_name,
             MAX(e.user_name)                                                  AS user_name,
             COALESCE(SUM(e.duration_hours), 0)::float                         AS hours,
             COALESCE(SUM(CASE WHEN e.status <> 'NO_RATE_FOUND' THEN e.cost_cents ELSE 0 END), 0)::bigint AS valid_cost_cents,
             COUNT(*)::int                                                     AS entry_count,
             SUM(CASE WHEN e.status = 'NO_RATE_FOUND' THEN 1 ELSE 0 END)::int  AS missing_rate_count,
             MAX(t.scope_client_option_id)                                     AS client_option_id
      FROM clickup_time_entries e
      LEFT JOIN clickup_tasks t ON t.task_id = e.task_id
      WHERE e.user_id = ${userId}
        AND e.start_time IS NOT NULL
        AND e.start_time >= ${from}
        AND e.start_time <= ${to}
      GROUP BY day, e.task_id
      ORDER BY day, task_name
    `);

    const aggRows: TimesheetAggRow[] = rows.map((r) => ({
      day: r.day,
      taskId: r.task_id,
      taskName: r.task_name,
      hours: Number(r.hours),
      validCostCents: canSeeCost(scope, r.client_option_id) ? Number(r.valid_cost_cents) : null,
      entryCount: Number(r.entry_count),
      missingRateCount: Number(r.missing_rate_count),
      scopeClientOptionId: r.client_option_id,
    }));

    const sheet = assembleTimesheet(aggRows, dhakaDate(from), dhakaDate(to));
    const userName = rows.find((r) => r.user_name)?.user_name ?? null;

    return {
      userId,
      userName,
      from: from.toISOString(),
      to: to.toISOString(),
      ...sheet,
    };
  }

  /**
   * Total hours + cost per assignee.
   *
   * Unrestricted: unchanged (every row's real cost, sorted by cost desc).
   * Scoped (Ruling R12): the scope filter narrows which entries are VISIBLE
   * at all (member-or-lead); cost is then narrowed further to a second
   * groupBy scoped to LEAD clients only, so a user's cost is the sum of just
   * their led-visible entries. `costPartial` is true whenever that led count
   * is less than the visible count (including 0 — see `totalCostAud: null`
   * below). Sorted by hours, never by cost, so a partially-hidden total can't
   * leak a ranking of hidden money (Ruling R12).
   */
  async timeEntriesByUser(scope: AccessScope, fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const where = { startTime: { gte: from, lte: to }, ...timeEntryScopeWhere(scope) };
    const rows = await this.prisma.clickupTimeEntry.groupBy({
      by: ['userId', 'userName', 'userEmail'],
      where,
      _count: true,
      _sum: { durationHours: true, costCents: true },
    });

    if (isUnrestricted(scope)) {
      return rows
        .map(r => ({
          userId: r.userId,
          userName: r.userName,
          userEmail: r.userEmail,
          totalHours: r._sum.durationHours?.toNumber() ?? 0,
          totalCostAud: Number(r._sum.costCents ?? 0n) / 100,
          costPartial: false,
        }))
        .sort((a, b) => b.totalCostAud - a.totalCostAud);
    }

    // `leadClientIds` is never null for a scoped viewer, but `?? []` keeps the
    // type honest and matches the "leads nothing" fast path below.
    const leadIds = leadClientIds(scope) ?? [];
    // Grouped by the SAME `by` keys as the visible-rows query above — not just
    // `['userId']`. One ClickUp user can appear as several distinct groups
    // here (a display-name change mid-window yields two ['userId','userName',
    // 'userEmail'] rows for the same person) — grouping the cost half by
    // `userId` alone would fold those back into ONE lead-cost row and then
    // hand that row's FULL cost + count to every name/email variant of that
    // user, double-counting both the cost and the "how many entries are led"
    // count `costPartial` compares against.
    const costRows = leadIds.length
      ? await this.prisma.clickupTimeEntry.groupBy({
          by: ['userId', 'userName', 'userEmail'],
          where: { ...where, task: { scopeClientOptionId: { in: leadIds } } },
          _count: true,
          _sum: { costCents: true },
        })
      : [];
    const costByUser = new Map(
      costRows.map((r) => [
        userGroupKey(r.userId, r.userName, r.userEmail),
        { costCents: Number(r._sum.costCents ?? 0n), count: r._count },
      ]),
    );

    return rows
      .map(r => {
        const led = costByUser.get(userGroupKey(r.userId, r.userName, r.userEmail));
        const totalEntries = r._count;
        const ledCount = led?.count ?? 0;
        return {
          userId: r.userId,
          userName: r.userName,
          userEmail: r.userEmail,
          totalHours: r._sum.durationHours?.toNumber() ?? 0,
          // Ruling R12: zero led-visible rows -> null (never a misleading $0);
          // otherwise the partial (or full) sum of just the led rows.
          totalCostAud: ledCount > 0 ? led!.costCents / 100 : null,
          costPartial: ledCount !== totalEntries,
        };
      })
      .sort((a, b) => b.totalHours - a.totalHours);
  }

  /**
   * Current-period totals and the equal-length prior-period totals, used by
   * the Overview page's KPI cards to render period-over-period deltas. The
   * prior window is `[from - (to - from), from)` — exclusive on the upper
   * bound so it doesn't overlap with the current window.
   *
   * Soft-deleted tasks are excluded from both windows. Access (Ruling R1):
   * gated HERE (not the controller — R15/fix round 1) via `requireLeadView`.
   * Task visibility narrows both windows' hours; cost is narrowed further to
   * LEAD clients only (`leadScopeSql`). Ruling R12 (fix round 1): each window
   * independently nulls its own `totalCostAud` — not just for a viewer who
   * leads no client anywhere, but also for a PARTIAL lead whose window
   * happens to hold zero LEAD-visible rows this period (`has_led_cost`) —
   * rather than a misleadingly precise $0. `costPartial` is true whenever the
   * window has at least one visible-but-not-led row. Both flags are computed
   * only over rows that actually exist in the window (`entry_count`), so an
   * empty window reports a genuine 0/false rather than a stray null/partial.
   */
  async overviewDeltas(scope: AccessScope, fromParam?: string, toParam?: string) {
    requireLeadView(scope);

    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const spanMs = to.getTime() - from.getTime();
    const priorFrom = new Date(from.getTime() - spanMs);
    const priorTo = from;

    type Row = {
      total_hours: number | null;
      total_cost_cents: bigint | null;
      entry_count: number;
      has_led_cost: boolean | null;
      cost_partial: boolean | null;
    };
    const sumWindow = (winFrom: Date, winTo: Date, upperOp: 'lte' | 'lt') => {
      const upper = upperOp === 'lte'
        ? Prisma.sql`e.start_time <= ${winTo}`
        : Prisma.sql`e.start_time <  ${winTo}`;
      return this.prisma.$queryRaw<Row[]>(Prisma.sql`
        SELECT COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
               COALESCE(SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN e.cost_cents ELSE 0 END), 0)::bigint
                 AS total_cost_cents,
               COUNT(*)::int AS entry_count,
               BOOL_OR(${leadScopeSql(scope, 't')}) AS has_led_cost,
               BOOL_OR(NOT ${leadScopeSql(scope, 't')}) AS cost_partial
        FROM clickup_time_entries e
        JOIN clickup_tasks t ON e.task_id = t.task_id
        WHERE e.start_time IS NOT NULL
          AND e.start_time >= ${winFrom}
          AND ${upper}
          AND t.is_deleted = false
          AND ${taskScopeSql(scope, 't')}
      `);
    };

    const [currentRows, priorRows] = await Promise.all([
      // 'lte': current window is closed-right on `to` (matches other endpoints).
      sumWindow(from, to, 'lte'),
      // 'lt': prior window is open-right on `from` so a row at exactly `from`
      // is counted only in the current window, not both.
      sumWindow(priorFrom, priorTo, 'lt'),
    ]);

    const EMPTY_WINDOW: Row = {
      total_hours: 0, total_cost_cents: 0n, entry_count: 0, has_led_cost: null, cost_partial: null,
    };
    const mapRow = (r: Row) => {
      // An INNER JOIN, unlike `spaces()`'s LEFT JOIN — no phantom NULL row
      // when nothing matches, so `entry_count === 0` alone means "no rows".
      const hasRows = r.entry_count > 0;
      const hasLedCost = hasRows && !!r.has_led_cost;
      return {
        totalHours: Number(r.total_hours ?? 0),
        // Null (not $0) when rows exist but none of them are LEAD-visible —
        // covers both "leads no client at all" and "leads SOME client, but
        // not the one(s) active this window" uniformly.
        totalCostAud: hasRows && !hasLedCost ? null : Number(r.total_cost_cents ?? 0n) / 100,
        costPartial: hasRows ? !!r.cost_partial : false,
      };
    };

    return {
      current: mapRow(currentRows[0] ?? EMPTY_WINDOW),
      prior:   mapRow(priorRows[0]   ?? EMPTY_WINDOW),
    };
  }

  /**
   * Total hours + cost per client. Scoped viewers see every VISIBLE client
   * (member-or-lead), with cost narrowed to LEAD clients only.
   *
   * Grouped by `t.client` (a display NAME), not the scope option id — two
   * option ids can in principle share one display name (a rename, a
   * duplicate label), so `MAX(t.scope_client_option_id)` plus a single
   * `canSeeCost` check would be wrong whenever a group actually straddles a
   * led and a non-led option id (fix round 1, item 5). Uses the same general
   * `BOOL_OR`-based rule as `timeEntriesByDepartment` instead: sum only
   * LEAD-visible cost into the group; null it only when the group has zero
   * LEAD-visible rows; `costPartial` true whenever any row's cost was
   * excluded.
   */
  async timeEntriesByClient(scope: AccessScope, fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    type Row = {
      client: string; total_hours: number; total_cost_cents: number; has_led_cost: boolean; cost_partial: boolean;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT t.client,
        COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
        COALESCE(SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN e.cost_cents ELSE 0 END), 0)::float AS total_cost_cents,
        BOOL_OR(${leadScopeSql(scope, 't')}) AS has_led_cost,
        BOOL_OR(NOT ${leadScopeSql(scope, 't')}) AS cost_partial
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time >= ${from} AND e.start_time <= ${to}
        AND t.is_deleted = false
        AND t.client IS NOT NULL AND t.client <> ''
        AND ${taskScopeSql(scope, 't')}
      GROUP BY t.client
      ORDER BY total_cost_cents DESC
    `);
    return rows.map(r => ({
      client: r.client,
      totalHours: Number(r.total_hours),
      totalCostAud: r.has_led_cost ? Number(r.total_cost_cents) / 100 : null,
      costPartial: !!r.cost_partial,
    }));
  }

  /**
   * Total hours + cost per department. Unlike `timeEntriesByClient`, a
   * department can span several clients, so the group's LEAD-visibility isn't
   * a single option id: `has_led_cost`/`cost_partial` are computed with
   * `BOOL_OR` over every row folded into the group (Ruling R12 — sum only
   * LEAD-visible cost; null only when the group has zero LEAD-visible rows;
   * `costPartial` true whenever any row's cost was excluded).
   */
  async timeEntriesByDepartment(scope: AccessScope, fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    type Row = {
      department: string; total_hours: number; total_cost_cents: number; has_led_cost: boolean; cost_partial: boolean;
    };
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT t.department,
        COALESCE(SUM(e.duration_hours), 0)::float AS total_hours,
        COALESCE(SUM(CASE WHEN ${leadScopeSql(scope, 't')} THEN e.cost_cents ELSE 0 END), 0)::float AS total_cost_cents,
        BOOL_OR(${leadScopeSql(scope, 't')}) AS has_led_cost,
        BOOL_OR(NOT ${leadScopeSql(scope, 't')}) AS cost_partial
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time >= ${from} AND e.start_time <= ${to}
        AND t.department IS NOT NULL AND t.department <> ''
        AND ${taskScopeSql(scope, 't')}
      GROUP BY t.department
      ORDER BY total_cost_cents DESC
    `);
    return rows.map(r => ({
      department: r.department,
      totalHours: Number(r.total_hours),
      totalCostAud: r.has_led_cost ? Number(r.total_cost_cents) / 100 : null,
      costPartial: !!r.cost_partial,
    }));
  }

  /** Chargeable vs non-chargeable hours for the window. No cost split: a
   *  non-chargeable entry always costs zero, so one side would be a column of
   *  zeros and the other would equal total cost. */
  async timeEntriesChargeableSummary(scope: AccessScope, fromParam?: string, toParam?: string) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const window = { startTime: { gte: from, lte: to }, ...timeEntryScopeWhere(scope) };
    // One partition, not two: the total comes from the bare window and the
    // non-chargeable side is the remainder. Two independently-queried halves
    // are only correct if they're exhaustive over the window, which nothing
    // here guarantees for rows with a null task FK — and if they aren't, this
    // summary quietly disagrees with every other total on the page.
    const [total, chargeable] = await Promise.all([
      this.prisma.clickupTimeEntry.aggregate({ where: window, _sum: { durationHours: true } }),
      this.prisma.clickupTimeEntry.aggregate({ where: { AND: [window, { isChargeable: true }] }, _sum: { durationHours: true } }),
    ]);
    const totalHours = total._sum.durationHours?.toNumber() ?? 0;
    const chargeableHours = chargeable._sum.durationHours?.toNumber() ?? 0;
    return {
      chargeableHours,
      // The chargeable where is strictly a subset of the window, so in any
      // single consistent read this can't go negative. The clamp guards the one
      // case that isn't: these two aggregates aren't in a transaction, so an
      // entry written between them can make the subset out-count the total.
      nonChargeableHours: Math.max(0, totalHours - chargeableHours),
    };
  }

  /**
   * Server-side aggregates for the Time Entries page metric cards.
   * Must accept the *same* filter set as `timeEntriesList` so the cards
   * reflect the user's filters, not just the current page of 50 — which is why
   * both share `buildTimeEntryWhere` rather than each keeping a local copy.
   */
  async timeEntriesAggregates(
    // Required, no default, and FIRST (Ruling R10): TS disallows a required
    // param after optional ones, and a default here would be fail-open. Every
    // HTTP path supplies a real one via the controller's @Scope().
    scope: AccessScope,
    userId?: string,
    fromParam?: string,
    toParam?: string,
    status?: string,
    chargeable?: string,
    search?: string,
    spaceId?: string,
    missingOnly?: string,
    client?: string,
    listId?: string,
    folderId?: string,
    archived?: string,
    sprintStatus?: string,
    subProject?: string,
  ) {
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const where = await buildTimeEntryWhere(this.prisma, {
      from, to, userId, status, chargeable, search, spaceId, missingOnly,
      client, listId, folderId, archived, sprintStatus, subProject,
    }, scope);

    // The totals come from the caller's `where` verbatim — the same row set
    // `timeEntriesList` pages with `count({ where })` and `timeEntriesByTask`
    // groups over. Deriving them by summing a chargeable and a non-chargeable
    // partition made these cards the ONLY surface on the page whose numbers
    // depended on those two halves being exhaustive over the filter (rows with
    // a null task FK are the case nothing guarantees), so the cards could
    // disagree with the pager and the table directly beneath them.
    //
    // The chargeable split still needs its own call: `byStatus` groups only on
    // `status`, not `isChargeable`. Only that half is queried; the
    // non-chargeable side is the remainder, so the two can never disagree.
    const chargeableWhere = { AND: [where, { isChargeable: true }] };
    // Cost is masked at the aggregate level too: `where` is already scoped to
    // every VISIBLE entry (member or lead), but cost may only be summed over
    // entries whose client the viewer LEADS. `leadClientIds` is null only when
    // unrestricted, so this narrows further ONLY for a scoped viewer.
    const leadIds = leadClientIds(scope);
    const costWhere =
      leadIds !== null ? { AND: [where, { task: { scopeClientOptionId: { in: leadIds } } }] } : where;
    const [totalAgg, chargeableAgg, byStatus, costAgg] = await Promise.all([
      this.prisma.clickupTimeEntry.aggregate({ where, _count: true, _sum: { durationHours: true, costCents: true } }),
      this.prisma.clickupTimeEntry.aggregate({ where: chargeableWhere, _sum: { durationHours: true } }),
      this.prisma.clickupTimeEntry.groupBy({ by: ['status'], where, _count: true }),
      leadIds !== null
        // durationHours too (Ruling R12/#2): a partial lead's avg rate must
        // divide LED cost by LED hours, not by every visible hour — dividing
        // by `totalHours` (member-or-lead) understates the rate whenever the
        // viewer sees more hours than they lead cost for.
        ? this.prisma.clickupTimeEntry.aggregate({ where: costWhere, _count: true, _sum: { costCents: true, durationHours: true } })
        : Promise.resolve(null),
    ]);

    const totalEntries = totalAgg._count;
    const totalHours = totalAgg._sum.durationHours?.toNumber() ?? 0;
    const chargeableHours = chargeableAgg._sum.durationHours?.toNumber() ?? 0;
    // See timeEntriesChargeableSummary: `chargeableWhere` is strictly a subset
    // of `where`, so only a write landing between these two un-transacted
    // aggregates can push the subset above the total. Clamp rather than print a
    // negative figure beside a positive one.
    const nonChargeableHours = Math.max(0, totalHours - chargeableHours);
    const costCalculatedCount = byStatus.find(s => s.status === 'COST_CALCULATED')?._count ?? 0;
    const noRateFoundCount = byStatus.find(s => s.status === 'NO_RATE_FOUND')?._count ?? 0;
    // True only when the cost aggregate excluded rows the totals above still
    // count (visible-but-not-led) — i.e. the viewer is scoped AND some entries
    // in `where` fell outside the lead-scoped cost aggregate. This is also
    // true whenever the viewer leads no client at all in this window, since
    // costAgg._count is then always 0.
    const costPartial = leadIds !== null && totalAgg._count !== (costAgg?._count ?? 0);

    // Ruling R17 (canonical R12 rule): null, not a misleadingly precise $0,
    // only when the viewer is scoped AND this window has visible rows
    // (`totalEntries > 0`) but the LEAD-scoped aggregate matched none of them
    // (`costAgg` count 0) — not merely because the viewer leads nothing
    // ANYWHERE in scope. A lead of client A must still see A's cost total for
    // a window that also has (masked) client-B rows. An empty window
    // (`totalEntries === 0`) falls through to the LEAD-sum branch below,
    // where `costAgg`'s sums are themselves 0, keeping today's $0.
    // Unrestricted (`leadIds === null`) is exactly the pre-existing behavior.
    let totalCostCents: number | null;
    let avgRateCents: number | null;
    if (leadIds === null) {
      totalCostCents = Number(totalAgg._sum.costCents ?? 0n);
      avgRateCents = totalHours > 0 ? Math.round(totalCostCents / totalHours) : 0;
    } else if (totalEntries > 0 && (costAgg?._count ?? 0) === 0) {
      totalCostCents = null;
      avgRateCents = null;
    } else {
      const leadCostCents = Number(costAgg!._sum.costCents ?? 0n);
      const leadHours = costAgg!._sum.durationHours?.toNumber() ?? 0;
      totalCostCents = leadCostCents;
      avgRateCents = leadHours > 0 ? Math.round(leadCostCents / leadHours) : 0;
    }

    return {
      totalEntries,
      totalHours,
      chargeableHours,
      nonChargeableHours,
      totalCostCents,
      avgRateCents,
      costCalculatedCount,
      noRateFoundCount,
      costPartial,
    };
  }

  async timeEntriesList(
    // Required, no default, and FIRST (Ruling R10): TS disallows a required
    // param after optional ones, and a default here would be fail-open. Every
    // HTTP path supplies a real one via the controller's @Scope().
    scope: AccessScope,
    userId?: string,
    fromParam?: string,
    toParam?: string,
    status?: string,
    limit = 50,
    offset = 0,
    chargeable?: string,
    search?: string,
    spaceId?: string,
    missingOnly?: string,
    client?: string,
    listId?: string,
    folderId?: string,
    archived?: string,
    sprintStatus?: string,
    taskId?: string,
    subProject?: string,
  ) {
    // Same rationale as `tasks()`: cap allows CSV export to fetch the entire
    // filtered set; normal pagination tops out at 100 rows/page.
    const safeLimit = Math.min(limit, 5000);
    const from = parseDate(fromParam, defaultFrom());
    const to = parseDate(toParam, new Date());
    const where = await buildTimeEntryWhere(this.prisma, {
      from, to, userId, status, chargeable, search, spaceId, missingOnly,
      client, listId, folderId, archived, sprintStatus, taskId, subProject,
    }, scope);
    const [items, total] = await Promise.all([
      this.prisma.clickupTimeEntry.findMany({
        where,
        orderBy: { startTime: 'desc' },
        take: safeLimit,
        skip: offset,
        select: {
          timeEntryId: true, taskId: true, userId: true, userName: true, userEmail: true,
          startTime: true, endTime: true, durationHours: true, hourlyRateCents: true,
          costCents: true, status: true, description: true, syncedAt: true,
          rateId: true, currency: true, isChargeable: true, chargeableOverride: true,
          task: { select: { taskName: true, client: true, subProjects: true, listName: true, scopeClientOptionId: true } },
        },
      }),
      this.prisma.clickupTimeEntry.count({ where }),
    ]);
    return {
      items: items.map(e => maskCost(
        {
          timeEntryId: e.timeEntryId,
          taskId: e.taskId ?? '',
          taskName: e.task?.taskName ?? null,
          client: e.task?.client ?? null,
          subProjects: e.task?.subProjects ?? [],
          listName: e.task?.listName ?? null,
          userId: e.userId ?? '',
          userName: e.userName,
          userEmail: e.userEmail,
          startTime: e.startTime,
          endTime: e.endTime,
          durationHours: e.durationHours.toNumber(),
          hourlyRateCents: Number(e.hourlyRateCents),
          costAud: Number(e.costCents) / 100,
          status: e.status,
          // Resolved and stored on the row itself (see the chargeability
          // resolver) — not derived from the joined task, which can't see a
          // per-assignee rule.
          chargeable: e.isChargeable,
          // The RAW override, alongside the resolved answer above. The two are
          // different questions: `chargeable` is what applies, `chargeableOverride`
          // is whether THIS row is what decided it. Without both, a row reading
          // "non-chargeable" gives no way to tell an inherited answer from an
          // explicit one, and no way to know whether "clear override" means
          // anything here. null = inherited from the rule or the task flag.
          chargeableOverride: e.chargeableOverride,
          description: e.description,
          syncedAt: e.syncedAt,
          rateId: e.rateId != null ? e.rateId.toString() : null,
          currency: e.currency ?? 'USD',
        },
        scope,
        e.task?.scopeClientOptionId ?? null,
      )),
      total,
      limit: safeLimit,
      offset,
    };
  }

  /**
   * The Time Entries page grouped by task: one row per task carrying the summed
   * hours, cost and entry count of every entry that passes the *same* filters
   * as `timeEntriesList`.
   *
   * Grouping has to happen here, not in the browser: the page is server-paginated,
   * so folding the current 50-row page would total "the entries that happened to
   * land on this page" — a task whose entries straddle a page boundary would show
   * a different figure depending on where you were in the pager.
   *
   * Implemented as a Prisma `groupBy` at the (task, assignee, status,
   * currency) grain folded in application code, rather than raw SQL, so it reuses
   * the byte-identical `where` object `timeEntriesList` uses. That is what
   * guarantees an expanded row sums to the collapsed total above it. The grain is
   * bounded by tasks x assignees x 3 (the handful of status values), so the
   * fold stays cheap.
   *
   * `total` counts TASKS, not entries — it drives the pager.
   *
   * Sorting and pagination happen over the folded set in application code, so
   * cost scales with how many tasks the window holds. That is safe because the
   * grouped view never sees an unbounded window: the page's only all-time path
   * is deep-link mode, and deep links force the flat view (`ALL_TIME_FROM` and
   * `setGroupBy('none')` in TimeEntriesPage). Don't route an all-time query here
   * without giving this a DB-side ORDER BY / LIMIT first.
   */
  async timeEntriesByTask(params: {
    userId?: string;
    from?: string;
    to?: string;
    status?: string;
    chargeable?: string;
    search?: string;
    spaceId?: string;
    missingOnly?: string;
    client?: string;
    subProject?: string;
    listId?: string;
    folderId?: string;
    archived?: string;
    sprintStatus?: string;
    limit?: number;
    offset?: number;
    // Required, no default (Ruling R10): a default here would be fail-open —
    // a future caller that forgets it would silently see every client's cost.
    // Every HTTP path supplies a real one via the controller's `@Scope()`.
    scope: AccessScope;
  }) {
    // Same rationale as `timeEntriesList`: the cap lets the Excel export pull the
    // whole filtered set in one call; the pager tops out at 100 rows.
    const safeLimit = Math.min(params.limit ?? 50, 5000);
    const offset = params.offset ?? 0;
    const from = parseDate(params.from, defaultFrom());
    const to = parseDate(params.to, new Date());
    const scope = params.scope;
    const where = await buildTimeEntryWhere(this.prisma, { ...params, from, to }, scope);

    const groups = await this.prisma.clickupTimeEntry.groupBy({
      by: ['taskId', 'userId', 'userName', 'status', 'currency', 'isChargeable'],
      where,
      _count: true,
      _sum: { durationHours: true, costCents: true },
      _max: { startTime: true },
    });

    type Bucket = {
      taskId: string;
      entryCount: number;
      hours: number;
      chargeableHours: number;
      nonChargeableCount: number;
      validCostCents: number;
      missingRateCount: number;
      excludedCount: number;
      lastActivity: Date | null;
      currency: string | null;
      assignees: Map<string, string | null>;
    };
    const buckets = new Map<string, Bucket>();
    for (const g of groups) {
      // A null `task_id` is a real, deliberately-kept row (see NO_TASK_ID) — it
      // gets its own bucket rather than being dropped, so the rows on screen
      // still sum to the metric cards above them.
      const key = g.taskId ?? NO_TASK_ID;
      let b = buckets.get(key);
      if (!b) {
        b = {
          taskId: key, entryCount: 0, hours: 0, chargeableHours: 0, nonChargeableCount: 0,
          validCostCents: 0, missingRateCount: 0, excludedCount: 0,
          lastActivity: null, currency: null, assignees: new Map(),
        };
        buckets.set(key, b);
      }
      const hours = g._sum.durationHours?.toNumber() ?? 0;
      const count = g._count;
      b.entryCount += count;
      b.hours += hours;
      // Chargeability is per entry now, so a task can be partly chargeable —
      // this is a real sum, not the task's flag applied to the whole bucket.
      // `nonChargeableCount` (not the hours sum) is what decides the two
      // booleans below: a bucket of only 0-duration non-chargeable entries
      // would otherwise satisfy `chargeableHours === hours` (0 === 0) and
      // misreport itself as fully chargeable.
      if (g.isChargeable) b.chargeableHours += hours;
      else b.nonChargeableCount += count;
      // Mirrors `timesheet()` and the data-model rule: an entry with no rate
      // contributes no cost, and is surfaced as a count instead of being
      // silently rolled into a total that looks calculated.
      if (g.status === 'NO_RATE_FOUND') b.missingRateCount += count;
      else b.validCostCents += Number(g._sum.costCents ?? 0n);
      // Excluded entries are stored with cost_cents = 0 (see CostCalculator), so
      // the branch above adds nothing for them — but they must still be visible,
      // or a task with nothing but excluded time reads as fully costed.
      if (g.status === 'COST_EXCLUDED') b.excludedCount += count;
      if (g.userId) b.assignees.set(g.userId, g.userName);
      const last = g._max.startTime;
      if (last && (!b.lastActivity || last > b.lastActivity)) b.lastActivity = last;
      b.currency ??= g.currency;
    }

    const all = [...buckets.values()].sort(
      (a, b) =>
        b.hours - a.hours
        // Stable tie-break so equal-hour tasks don't shuffle between pages.
        || a.taskId.localeCompare(b.taskId),
    );
    const page = all.slice(offset, offset + safeLimit);

    // Task columns are joined for the current page only — `all` can be every
    // task in the window, and the name/client/list are needed just for the rows
    // actually rendered.
    const taskIds = page.map((b) => b.taskId).filter((id) => id !== NO_TASK_ID);
    const tasks = taskIds.length
      ? await this.prisma.clickupTask.findMany({
          where: { taskId: { in: taskIds } },
          select: { taskId: true, taskName: true, client: true, subProjects: true, listName: true, scopeClientOptionId: true },
        })
      : [];
    const taskById = new Map(tasks.map((t) => [t.taskId, t]));

    return {
      items: page.map((b) => {
        const t = taskById.get(b.taskId);
        return maskCost(
          {
            taskId: b.taskId,
            taskName: t?.taskName ?? null,
            client: t?.client ?? null,
            subProjects: t?.subProjects ?? [],
            listName: t?.listName ?? null,
            entryCount: b.entryCount,
            assignees: [...b.assignees.entries()]
              .map(([userId, userName]) => ({ userId, userName }))
              .sort((x, y) => (x.userName ?? '').localeCompare(y.userName ?? '')),
            totalHours: b.hours,
            // `chargeable` is tri-state at the row level: all, none, or some.
            // Decided by entry counts, not the hours sum — a bucket of only
            // 0-duration non-chargeable entries must not read as "all
            // chargeable" just because 0 hours equals 0 hours.
            chargeable: b.nonChargeableCount === 0,
            // `rules: []` on purpose. Every other number on this row — hours,
            // cost, entry count — is scoped to the current filter window, so the
            // pill must be too. A standing rule for someone whose entries fall
            // OUTSIDE the window would otherwise print "partial" beside columns
            // showing nothing partial about them. The Tasks page asks the
            // unscoped question and does pass rules.
            partiallyChargeable: isPartiallyChargeable({
              rules: [],
              entryCount: b.entryCount,
              nonChargeableCount: b.nonChargeableCount,
            }),
            chargeableHours: b.chargeableHours,
            costAud: b.validCostCents / 100,
            missingRateCount: b.missingRateCount,
            excludedCount: b.excludedCount,
            lastActivity: b.lastActivity,
            currency: b.currency ?? 'USD',
          },
          scope,
          t?.scopeClientOptionId ?? null,
        );
      }),
      total: buckets.size,
      limit: safeLimit,
      offset,
    };
  }

  /**
   * Everyone who has logged time on one task, with the chargeability answer
   * that currently applies to them and which layer produced it. Backs the task
   * drawer's per-assignee controls.
   *
   * Grouped from time entries rather than from the task's `assignees_names`,
   * because billing follows who logged the time — and `assignees_names` carries
   * no user ids to key a rule on.
   *
   * Access (Ruling R13/R14): a scoped viewer gets the task via a
   * scope-filtered `findFirst` and a 404 for a missing OR out-of-scope task —
   * checked, and thrown, BEFORE the rules/entries queries run, so neither is
   * ever read for a task the viewer can't see. Unrestricted (Owner/Admin, or
   * a flag-off MEMBER) reproduces today's exact behaviour: no existence check
   * at all — a missing task just resolves `task` to `null` and the resolver
   * falls back to its 'default' source, same as before scoping existed.
   */
  async taskAssigneeChargeability(taskId: string, scope: AccessScope) {
    const TASK_SELECT = { isChargeable: true, scopeClientOptionId: true } as const;
    const task = isUnrestricted(scope)
      ? await this.prisma.clickupTask.findUnique({ where: { taskId }, select: TASK_SELECT })
      : await this.prisma.clickupTask.findFirst({ where: { taskId, ...taskScopeWhere(scope) }, select: TASK_SELECT });
    if (!task && !isUnrestricted(scope)) {
      throw new NotFoundException('Task not found');
    }

    const [rules, groups] = await Promise.all([
      this.prisma.taskAssigneeChargeability.findMany({ where: { taskId }, select: { userId: true, chargeable: true } }),
      // Grouped by `userId` alone — NOT `['userId', 'userName']` — so one
      // person whose display name changed across their history still yields
      // one row. `_max: { userName }` picks a single representative name the
      // same way `tasksLists`'s `MAX(space_name)` does in
      // `tasks-report.service.ts` for the analogous space_id/space_name split.
      this.prisma.clickupTimeEntry.groupBy({
        by: ['userId'],
        where: { taskId },
        _count: true,
        _sum: { durationHours: true },
        _max: { userName: true },
      }),
    ]);
    const ruleByUser = new Map(rules.map((r) => [r.userId, r.chargeable]));
    // Anyone with a rule but no logged time still belongs in this list — that
    // is the prospective case standing rules exist for (set the rule, then the
    // work happens). Building the rows from the groupBy alone would hide the
    // rule here while the Tasks page pill, which reads the rules directly,
    // reported the task partial: two views contradicting each other. They get
    // a zero row with no name, since only entries carry a display name.
    const loggedUserIds = new Set(groups.map((g) => g.userId).filter((id): id is string => id != null));
    const ruleOnlyRows = rules
      .filter((r) => !loggedUserIds.has(r.userId))
      .map((r) => ({ userId: r.userId, _max: { userName: null }, _count: 0, _sum: { durationHours: null } }));

    return [...groups, ...ruleOnlyRows]
      .filter((g): g is typeof g & { userId: string } => g.userId != null)
      .map((g) => {
        const rule = ruleByUser.get(g.userId) ?? null;
        // Phase 1 has no per-entry override writer, so `entryOverride` is not
        // consulted here. Phase 2 adds it and this call gains a third input.
        const { chargeable, source } = resolveChargeability({ rule, taskChargeable: task?.isChargeable });
        // No cost field exists on this row today, so this is a no-op — kept
        // for defence-in-depth/consistency with every other masked report row.
        return maskCost(
          {
            userId: g.userId,
            userName: g._max.userName,
            entryCount: g._count,
            hours: g._sum.durationHours?.toNumber() ?? 0,
            rule,
            chargeable,
            source,
          },
          scope,
          task?.scopeClientOptionId ?? null,
        );
      })
      .sort((a, b) => (a.userName ?? '').localeCompare(b.userName ?? ''));
  }
}

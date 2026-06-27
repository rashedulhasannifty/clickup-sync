/**
 * Pure assembly for the Timesheet report. The SQL layer (reports.service.ts)
 * does the Dhaka-day bucketing and per-(day,task) aggregation; this module turns
 * those flat rows into the grouped, weekday-zero-filled, missing-rate-aware shape
 * the API returns. Kept pure (no Prisma/DB) so it is unit-tested directly.
 *
 * Money note: `*CostCents`/`*CostAud` are named AUD but hold USD in practice
 * (see the currency-aud-usd-debt note). Naming is kept for consistency.
 */

/** One aggregated (Dhaka-day, task) row coming out of the SQL query. */
export interface TimesheetAggRow {
  day: string;            // 'YYYY-MM-DD' Dhaka calendar date
  taskId: string;
  taskName: string | null;
  hours: number;
  /** Sum of cost_cents over entries that are NOT NO_RATE_FOUND. */
  validCostCents: number;
  /** Total entries in this (day, task) bucket. */
  entryCount: number;
  /** Count of NO_RATE_FOUND entries in this bucket. */
  missingRateCount: number;
}

export interface TimesheetTask {
  taskId: string;
  taskName: string | null;
  hours: number;
  /** Dollars, or null when the task has no valid-cost entry (all missing). */
  costAud: number | null;
  entryCount: number;
  missingRateCount: number;
}

export interface TimesheetDay {
  date: string;           // 'YYYY-MM-DD'
  weekday: string;        // 'Mon'..'Sun'
  isWeekend: boolean;
  tasks: TimesheetTask[];
  subtotalHours: number;
  subtotalCostAud: number | null;
  missingRateCount: number;
}

export interface Timesheet {
  days: TimesheetDay[];
  totalHours: number;
  totalCostAud: number | null;
  missingRateCount: number;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dhaka calendar date ('YYYY-MM-DD') of a UTC instant. en-CA formats as ISO date. */
export function dhakaDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Inclusive ascending list of 'YYYY-MM-DD' dates. Iterated in UTC (no DST drift). */
export function eachDate(fromDhaka: string, toDhaka: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${fromDhaka}T00:00:00Z`);
  const end = Date.parse(`${toDhaka}T00:00:00Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

function weekdayOf(date: string): { weekday: string; isWeekend: boolean } {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return { weekday: WEEKDAY[dow], isWeekend: dow === 0 || dow === 6 };
}

/**
 * Uniform cost rule applied at task/day/grand level: cost is null when there is
 * no valid-cost entry (every entry was NO_RATE_FOUND), otherwise the summed
 * valid cost in dollars. This avoids a misleading real $0 against logged hours.
 */
function cost(validCostCents: number, entryCount: number, missingRateCount: number): number | null {
  const hasValidCostEntry = entryCount - missingRateCount > 0;
  return hasValidCostEntry ? validCostCents / 100 : null;
}

export function assembleTimesheet(
  rows: TimesheetAggRow[],
  fromDhaka: string,
  toDhaka: string,
): Timesheet {
  // Group rows by Dhaka day.
  const byDay = new Map<string, TimesheetAggRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }

  // Day set = weekday skeleton ∪ any day that has entries (so worked weekends and
  // any boundary day an entry buckets into are included).
  const dayset = new Set<string>();
  for (const d of eachDate(fromDhaka, toDhaka)) {
    if (!weekdayOf(d).isWeekend) dayset.add(d);
  }
  for (const d of byDay.keys()) dayset.add(d);
  const orderedDays = [...dayset].sort();

  let totalHours = 0;
  let totalValidCostCents = 0;
  let totalEntryCount = 0;
  let totalMissing = 0;

  const days: TimesheetDay[] = orderedDays.map((date) => {
    const { weekday, isWeekend } = weekdayOf(date);
    const dayRows = (byDay.get(date) ?? [])
      .slice()
      .sort((a, b) => (a.taskName ?? '').localeCompare(b.taskName ?? '') || a.taskId.localeCompare(b.taskId));

    let subtotalHours = 0;
    let subtotalValidCostCents = 0;
    let dayEntryCount = 0;
    let dayMissing = 0;

    const tasks: TimesheetTask[] = dayRows.map((r) => {
      subtotalHours += r.hours;
      subtotalValidCostCents += r.validCostCents;
      dayEntryCount += r.entryCount;
      dayMissing += r.missingRateCount;
      return {
        taskId: r.taskId,
        taskName: r.taskName,
        hours: r.hours,
        costAud: cost(r.validCostCents, r.entryCount, r.missingRateCount),
        entryCount: r.entryCount,
        missingRateCount: r.missingRateCount,
      };
    });

    totalHours += subtotalHours;
    totalValidCostCents += subtotalValidCostCents;
    totalEntryCount += dayEntryCount;
    totalMissing += dayMissing;

    return {
      date,
      weekday,
      isWeekend,
      tasks,
      subtotalHours,
      subtotalCostAud: cost(subtotalValidCostCents, dayEntryCount, dayMissing),
      missingRateCount: dayMissing,
    };
  });

  return {
    days,
    totalHours,
    totalCostAud: cost(totalValidCostCents, totalEntryCount, totalMissing),
    missingRateCount: totalMissing,
  };
}

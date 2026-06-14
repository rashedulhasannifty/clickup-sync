import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { BudgetsRepository } from './budgets.repository';
import {
  dhakaTodayParts,
  monthBounds,
  countBusinessDays,
  forecastRunRate,
  forecastTrailing,
  deriveBudgetStatus,
  type BudgetStatus,
} from './budget-forecast';

const NO_CLIENT = 'No client';

export interface ClientBudgetStatusRow {
  client: string;
  monthlyAmount: number | null;   // dollars; null when no budget
  currency: string | null;
  mtdCost: number;                // dollars
  mtdHours: number;
  forecastRunRate: number;        // dollars
  forecastTrailing: number;       // dollars
  pctOfBudget: number | null;     // mtdCost / monthlyAmount
  forecastPct: number | null;     // run-rate forecast / monthlyAmount (server default)
  status: BudgetStatus;
  dailySeries: { date: string; cost: number }[];
}

interface DailyRow { day: string; client: string; cost_cents: bigint; hours: string }

function parseMonth(month: string | undefined, now: Date): { year: number; month0: number } {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  if (m) {
    const [y, mm] = m.split('-').map(Number);
    return { year: y, month0: mm - 1 };
  }
  const t = dhakaTodayParts(now);
  return { year: t.year, month0: t.month0 };
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: BudgetsRepository,
  ) {}

  async clientBudgetStatus(args: { month?: string; now?: Date }): Promise<ClientBudgetStatusRow[]> {
    const now = args.now ?? new Date();
    const { year, month0 } = parseMonth(args.month, now);
    const bounds = monthBounds(year, month0);

    // Clamp "today" to the target month: future month -> month start (no spend yet);
    // past month -> month end; current month -> actual Dhaka today.
    const t = dhakaTodayParts(now);
    const todayIso = `${t.year}-${String(t.month0 + 1).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    const effectiveToday =
      todayIso < bounds.start ? bounds.start :
      todayIso > bounds.end   ? bounds.end   :
      todayIso;

    const TZ = Prisma.raw(`'Asia/Dhaka'`);
    const dhakaDay = Prisma.sql`((e.start_time AT TIME ZONE 'UTC' AT TIME ZONE ${TZ})::date)`;

    // Index-friendly superset range on the raw start_time column (timestamp-without-tz
    // holding UTC). Postgres can use the start_time index for this range; the exact
    // dhakaDay predicates below then trim to the precise Dhaka calendar window. Pad by a
    // day on each side so the raw range is a guaranteed superset regardless of session TZ.
    const rawLower = new Date(`${addDaysIso(bounds.start, -1)}T00:00:00Z`);
    const rawUpper = new Date(`${addDaysIso(effectiveToday, 2)}T00:00:00Z`);

    const dailyRows = await this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
      SELECT to_char(${dhakaDay}, 'YYYY-MM-DD')              AS day,
             COALESCE(NULLIF(t.client, ''), ${NO_CLIENT})    AS client,
             COALESCE(SUM(e.cost_cents), 0)::bigint          AS cost_cents,
             COALESCE(SUM(e.duration_hours), 0)::text        AS hours -- ::text avoids Decimal/float ambiguity for SUM of a numeric column via $queryRaw; parsed with Number() below
      FROM clickup_time_entries e
      JOIN clickup_tasks t ON e.task_id = t.task_id
      WHERE e.start_time IS NOT NULL
        AND e.start_time >= ${rawLower}
        AND e.start_time <  ${rawUpper}
        AND ${dhakaDay} >= ${bounds.start}::date
        AND ${dhakaDay} <= ${effectiveToday}::date
        AND t.is_deleted = false
      GROUP BY 1, 2
    `);

    // Group daily rows by client.
    const byClient = new Map<string, DailyRow[]>();
    for (const r of dailyRows) {
      const list = byClient.get(r.client) ?? [];
      list.push(r);
      byClient.set(r.client, list);
    }

    // Resolve the applicable budget per client (latest validFrom covering the month;
    // validFrom <= month end AND (validTo null OR validTo >= month start)).
    const budgets = await this.repo.findAllRows(); // sorted client asc, validFrom desc
    const budgetFor = new Map<string, { amountCents: number; currency: string }>();
    for (const b of budgets) {
      if (budgetFor.has(b.client)) continue; // first match = latest validFrom (desc order)
      const vf = b.validFrom.toISOString().slice(0, 10);
      const vt = b.validTo ? b.validTo.toISOString().slice(0, 10) : null;
      if (vf <= bounds.end && (vt === null || vt >= bounds.start)) {
        budgetFor.set(b.client, { amountCents: b.monthlyAmountCents, currency: b.currency });
      }
    }

    // Every client that either has spend this month or has a budget row.
    const clients = new Set<string>([...byClient.keys(), ...budgetFor.keys()]);

    const businessDaysInMonth = countBusinessDays(bounds.start, bounds.end);
    const businessDaysElapsed = countBusinessDays(bounds.start, effectiveToday);
    const remainingCalendarDays = Math.max(
      0,
      Math.round((new Date(`${bounds.end}T00:00:00Z`).getTime() - new Date(`${effectiveToday}T00:00:00Z`).getTime()) / 86_400_000),
    );
    const last7Start = addDaysIso(effectiveToday, -6);

    const rows: ClientBudgetStatusRow[] = [];
    for (const client of clients) {
      const days = byClient.get(client) ?? [];
      const mtdCents = days.reduce((s, d) => s + Number(d.cost_cents), 0);
      const mtdHours = days.reduce((s, d) => s + Number(d.hours), 0);
      const last7Cents = days
        .filter((d) => d.day >= last7Start && d.day <= effectiveToday)
        .reduce((s, d) => s + Number(d.cost_cents), 0);

      const frCents = forecastRunRate(mtdCents, businessDaysElapsed, businessDaysInMonth);
      const ftCents = forecastTrailing(mtdCents, last7Cents, remainingCalendarDays);

      const budget = budgetFor.get(client) ?? null;
      const budgetCents = budget ? budget.amountCents : null;
      const status = deriveBudgetStatus(mtdCents, frCents, budgetCents);

      rows.push({
        client,
        monthlyAmount: budgetCents != null ? budgetCents / 100 : null,
        currency: budget?.currency ?? null,
        mtdCost: mtdCents / 100,
        mtdHours: Number(mtdHours.toFixed(2)),
        forecastRunRate: frCents / 100,
        forecastTrailing: ftCents / 100,
        // budgetCents is null (no budget) or a positive integer; the falsy check covers both null and a defensive 0, matching deriveBudgetStatus's no-budget guard.
        pctOfBudget: budgetCents ? mtdCents / budgetCents : null,
        forecastPct: budgetCents ? frCents / budgetCents : null,
        status,
        dailySeries: days
          .slice()
          .sort((a, b) => a.day.localeCompare(b.day))
          .map((d) => ({ date: d.day, cost: Number(d.cost_cents) / 100 })),
      });
    }

    // Budgeted/active clients first (by MTD desc), no-budget rows last.
    rows.sort((a, b) => {
      if ((a.status === 'no-budget') !== (b.status === 'no-budget')) return a.status === 'no-budget' ? 1 : -1;
      return b.mtdCost - a.mtdCost;
    });
    return rows;
  }
}

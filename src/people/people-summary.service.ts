import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { monthBounds } from '../budgets/budget-forecast';
import {
  buildAttendanceStrip,
  classifyToday,
  computeLeaveBalance,
  type AttendanceRow,
  type TypedLeave,
} from './attendance-math';
import {
  ATTENDANCE_PROVIDER,
  type AttendanceProvider,
} from './attendance-provider';
import { AttendanceRepository } from './attendance.repository';
import { toProfile } from './employee-mapper';
import {
  EmployeesRepository,
  type EmployeeListFilter,
  type EmployeeRow,
} from './employees.repository';
import { EmployeesService } from './employees.service';
import { computeKpis, type KpiComputation, type KpiInput } from './kpi-math';
import { DEFAULT_PERIOD_DAYS, TREND_MONTHS } from './people.constants';
import {
  addDays,
  dateColumnToIso,
  dhakaDateOf,
  lastMonths,
  type DateRange,
} from './people-dates';
import {
  PeopleMetricsRepository,
  type DeliveryRow,
  type HoursRow,
} from './people-metrics.repository';
import type { DirectoryRow, EmployeeSummary, TrendPoint } from './people.types';

/** Longest period the summary will compute; bounds the per-day row fetch. */
const MAX_PERIOD_DAYS = 731;

/** Everything one employee's KPIs are computed from, already narrowed to that employee. */
interface EmployeeData {
  hours: HoursRow[];
  deliveries: DeliveryRow[];
  attendance: AttendanceRow[];
  leaves: TypedLeave[];
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/**
 * The employee-at-a-glance summary and the directory. All numbers come from
 * `kpi-math`; this service only fetches the inputs (batched, aggregated in SQL
 * where it can be) and shapes the response.
 */
@Injectable()
export class PeopleSummaryService {
  constructor(
    private readonly employeesRepo: EmployeesRepository,
    private readonly employees: EmployeesService,
    private readonly attendance: AttendanceRepository,
    private readonly metrics: PeopleMetricsRepository,
    @Inject(ATTENDANCE_PROVIDER) private readonly provider: AttendanceProvider,
  ) {}

  async summary(
    orgId: string,
    id: string,
    q: { from?: string; to?: string },
  ): Promise<EmployeeSummary> {
    const today = dhakaDateOf(new Date());
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -(DEFAULT_PERIOD_DAYS - 1));
    if (from > to)
      throw new BadRequestException('`from` must be on or before `to`');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_PERIOD_DAYS) {
      throw new BadRequestException(
        `The period cannot exceed ${MAX_PERIOD_DAYS} days`,
      );
    }

    const row = await this.employeesRepo.findById(orgId, id);
    if (!row) throw new NotFoundException('Employee not found');
    const profile = toProfile(row, today);

    // One fetch window wide enough for the period, the 6-month trend, the 30-day
    // strip (inside the trend) and the calendar-year leave balance.
    const months = lastMonths(today, TREND_MONTHS);
    const trendFrom = monthBounds(months[0].year, months[0].month0).start;
    const year = Number(today.slice(0, 4));
    const fetchFrom = [from, trendFrom, `${year}-01-01`].sort()[0];
    const fetchTo = to > today ? to : today;

    const data = await this.loadOne(row, fetchFrom, fetchTo);
    const [events, latestSource] = await Promise.all([
      this.employeesRepo.listEvents(id),
      this.attendance.latestSource(orgId, id),
    ]);

    const employment = {
      joinDate: profile.joinDate,
      exitDate: profile.exitDate,
    };
    const compute = (period: DateRange): KpiComputation =>
      computeKpis(this.input(period, employment, row, data));

    const main = compute({ from, to });
    const trend: TrendPoint[] = months.map(({ year: y, month0 }) => {
      const b = monthBounds(y, month0);
      const period: DateRange = {
        from: b.start,
        to: b.end < today ? b.end : today,
      };
      const c = compute(period);
      return {
        month: b.start.slice(0, 7),
        overall: c.overall.score,
        utilisation: c.kpis.utilisation.value,
        chargeable: c.kpis.chargeable.value,
        onTimeDelivery: c.kpis.onTimeDelivery.value,
        punctuality: c.kpis.punctuality.value,
      };
    });

    return {
      employee: profile,
      period: { from, to },
      kpis: main.kpis,
      overall: main.overall,
      trend,
      attendance: buildAttendanceStrip({
        today,
        employment,
        rows: data.attendance,
        leaves: data.leaves,
      }),
      leaveBalance: computeLeaveBalance(year, data.leaves),
      events: await this.employees.eventViews(orgId, events),
      attendanceSource: latestSource ?? this.provider.source,
      hours: main.hours,
    };
  }

  /**
   * KPIs for one employee over any period, from the same inputs and maths as
   * the summary. Used by appraisals to snapshot the cycle period; the caller
   * decides the period (no default, no length cap beyond what it passes).
   */
  async kpisForPeriod(
    orgId: string,
    id: string,
    period: DateRange,
  ): Promise<KpiComputation> {
    const row = await this.employeesRepo.findById(orgId, id);
    if (!row) throw new NotFoundException('Employee not found');
    const profile = toProfile(row, dhakaDateOf(new Date()));
    const data = await this.loadOne(row, period.from, period.to);
    return computeKpis(
      this.input(
        period,
        { joinDate: profile.joinDate, exitDate: profile.exitDate },
        row,
        data,
      ),
    );
  }

  /** Directory rows with today's state and the 90-day overall score, in a fixed number of queries. */
  async directory(
    orgId: string,
    filter: EmployeeListFilter,
  ): Promise<DirectoryRow[]> {
    const today = dhakaDateOf(new Date());
    const period: DateRange = {
      from: addDays(today, -(DEFAULT_PERIOD_DAYS - 1)),
      to: today,
    };
    const rows = await this.employeesRepo.list(orgId, filter);
    if (rows.length === 0) return [];

    const byEmployee = await this.loadMany(rows, period.from, period.to);
    return rows.map((row) => {
      const profile = toProfile(row, today);
      const data = byEmployee.get(row.id) ?? {
        hours: [],
        deliveries: [],
        attendance: [],
        leaves: [],
      };
      const employment = {
        joinDate: profile.joinDate,
        exitDate: profile.exitDate,
      };
      const c = computeKpis(this.input(period, employment, row, data));
      return {
        ...profile,
        today: classifyToday({
          today,
          employment,
          row: data.attendance.find((a) => a.date === today),
          leaves: data.leaves,
        }),
        score: c.overall.score,
        band: c.overall.band,
        partial: c.overall.partial,
      };
    });
  }

  private input(
    period: DateRange,
    employment: { joinDate: string; exitDate: string | null },
    row: EmployeeRow,
    data: EmployeeData,
  ): KpiInput {
    return {
      period,
      employment,
      clickupLinked: row.clickupUserId !== null,
      hours: data.hours.map((h) => ({
        date: h.date,
        hours: h.hours,
        chargeableHours: h.chargeableHours,
      })),
      deliveries: data.deliveries.map((d) => ({
        closedOn: d.closedOn,
        dueOn: d.dueOn,
      })),
      attendance: data.attendance.map((a) => ({
        date: a.date,
        firstIn: a.firstIn,
      })),
      approvedLeave: data.leaves,
    };
  }

  private async loadOne(
    row: EmployeeRow,
    from: string,
    to: string,
  ): Promise<EmployeeData> {
    return (
      (await this.loadMany([row], from, to)).get(row.id) ?? {
        hours: [],
        deliveries: [],
        attendance: [],
        leaves: [],
      }
    );
  }

  /** Four batched queries (hours, deliveries, attendance, leave) for any number of employees. */
  private async loadMany(
    rows: EmployeeRow[],
    from: string,
    to: string,
  ): Promise<Map<string, EmployeeData>> {
    const ids = rows.map((r) => r.id);
    const clickupIds = rows.flatMap((r) =>
      r.clickupUserId ? [r.clickupUserId] : [],
    );
    const [hours, deliveries, attendance, leaves] = await Promise.all([
      this.metrics.hoursByDay(clickupIds, from, to),
      this.metrics.deliveries(clickupIds, from, to),
      this.attendance.attendanceRows(ids, from, to),
      this.attendance.approvedLeaves(ids, from, to),
    ]);
    const hoursBy = groupBy(hours, (h) => h.clickupUserId);
    const deliveriesBy = groupBy(deliveries, (d) => d.clickupUserId);
    const attendanceBy = groupBy(attendance, (a) => a.employeeId);
    const leavesBy = groupBy(leaves, (l) => l.employeeId);

    const out = new Map<string, EmployeeData>();
    for (const r of rows) {
      out.set(r.id, {
        hours: (r.clickupUserId && hoursBy.get(r.clickupUserId)) || [],
        deliveries:
          (r.clickupUserId && deliveriesBy.get(r.clickupUserId)) || [],
        attendance: (attendanceBy.get(r.id) ?? []).map((a) => ({
          date: dateColumnToIso(a.date),
          firstIn: a.firstIn,
          lastOut: a.lastOut,
          minutesInOffice: a.minutesInOffice,
        })),
        leaves: (leavesBy.get(r.id) ?? []).map((l) => ({
          type: l.type,
          startDate: dateColumnToIso(l.startDate),
          endDate: dateColumnToIso(l.endDate),
          days: l.days.toNumber(),
        })),
      });
    }
    return out;
  }
}

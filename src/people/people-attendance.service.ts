import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth.types';
import {
  classifyToday,
  detailOf,
  isInOffice,
  type AttendanceRow,
  type TypedLeave,
} from './attendance-math';
import { punctualityOf } from './shift-math';
import {
  ATTENDANCE_PROVIDER,
  type AttendanceProvider,
} from './attendance-provider';
import { AttendanceRepository } from './attendance.repository';
import { sourceLabel } from './attendance-source';
import { EmployeesRepository } from './employees.repository';
import { HolidaysRepository } from './holidays.repository';
import { assertNotExited } from './employee-readonly';
import { LEAVE_LIST_LIMIT } from './people.constants';
import {
  dateColumnToIso,
  dhakaDateOf,
  isBusinessDay,
  isWorkingDay,
} from './people-dates';
import type {
  LeaveRecordView,
  LeaveStatusValue,
  LeaveTypeValue,
  TodayAttendance,
  TodayCounts,
  TodayRow,
} from './people.types';

interface LeaveRow {
  id: string;
  employeeId: string;
  type: LeaveTypeValue;
  startDate: Date;
  endDate: Date;
  days: { toNumber(): number };
  status: LeaveStatusValue;
  reason: string | null;
  source: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  employee: { fullName: string };
}

export function toLeaveView(r: LeaveRow): LeaveRecordView {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee.fullName,
    type: r.type,
    startDate: dateColumnToIso(r.startDate),
    endDate: dateColumnToIso(r.endDate),
    days: r.days.toNumber(),
    status: r.status,
    reason: r.reason,
    source: r.source,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Today's door log, the leave list, and manual leave decisions. */
@Injectable()
export class PeopleAttendanceService {
  constructor(
    private readonly employees: EmployeesRepository,
    private readonly attendance: AttendanceRepository,
    private readonly holidays: HolidaysRepository,
    @Inject(ATTENDANCE_PROVIDER) private readonly provider: AttendanceProvider,
  ) {}

  async today(orgId: string): Promise<TodayAttendance> {
    const today = dhakaDateOf(new Date());
    const employees = await this.employees.list(orgId, {});
    const ids = employees.map((e) => e.id);
    const [attendanceRows, approved, pending, latest, coverage, holidays] =
      await Promise.all([
        this.attendance.attendanceRows(ids, today, today),
        this.attendance.approvedLeaves(ids, today, today),
        this.attendance.countPendingFrom(orgId, today),
        this.attendance.latestSource(orgId),
        this.attendance.coverage(orgId),
        this.holidays.map(orgId, today, today),
      ]);
    const rows = new Map<string, AttendanceRow>(
      attendanceRows.map((r) => [
        r.employeeId,
        { ...r, date: dateColumnToIso(r.date) },
      ]),
    );
    const leaves = new Map<string, TypedLeave[]>();
    for (const l of approved) {
      const t: TypedLeave = {
        type: l.type,
        startDate: dateColumnToIso(l.startDate),
        endDate: dateColumnToIso(l.endDate),
        days: l.days.toNumber(),
      };
      leaves.set(l.employeeId, [...(leaves.get(l.employeeId) ?? []), t]);
    }

    const out: TodayRow[] = [];
    const counts: TodayCounts = {
      total: 0,
      inOffice: 0,
      late: 0,
      onLeave: 0,
      notIn: 0,
      pendingRequests: pending,
    };
    for (const e of employees) {
      const row = rows.get(e.id);
      const state = classifyToday({
        today,
        employment: {
          joinDate: dateColumnToIso(e.joinDate),
          exitDate: e.exitDate ? dateColumnToIso(e.exitDate) : null,
        },
        row,
        leaves: leaves.get(e.id) ?? [],
        punctuality: punctualityOf(e.shift),
        holidays,
      });
      if (state === 'non-working') continue;
      const inOffice = isInOffice(row);
      // Weekend and holiday work is listed, but nobody is expected: it is not in the total.
      if (state !== 'weekend') counts.total++;
      if (inOffice) counts.inOffice++;
      if (state === 'late') counts.late++;
      if (state === 'leave') counts.onLeave++;
      if (state === 'not-in') counts.notIn++;
      out.push({
        employeeId: e.id,
        fullName: e.fullName,
        designation: e.designation,
        teamName: e.team?.name ?? null,
        state,
        firstIn: row?.firstIn ? row.firstIn.toISOString() : null,
        lastOut: row?.lastOut ? row.lastOut.toISOString() : null,
        minutesInOffice: row?.minutesInOffice ?? null,
        inOffice,
        ...detailOf(row),
      });
    }
    // Earliest arrivals first; people with no entry yet sort last, then by name.
    out.sort((a, b) => {
      if (a.firstIn && b.firstIn) return a.firstIn.localeCompare(b.firstIn);
      if (a.firstIn) return -1;
      if (b.firstIn) return 1;
      return a.fullName.localeCompare(b.fullName);
    });
    return {
      date: today,
      workingDay: isWorkingDay(today, holidays),
      holiday: isBusinessDay(today) ? (holidays.get(today) ?? null) : null,
      attendanceSource: latest ? sourceLabel(latest) : this.provider.source,
      canSync: this.provider.canSync,
      coverage: coverage.map((c) => ({ ...c, source: sourceLabel(c.source) })),
      counts,
      rows: out,
    };
  }

  async listLeaves(
    orgId: string,
    f: {
      status?: LeaveStatusValue;
      from?: string;
      to?: string;
      employeeId?: string;
    },
  ): Promise<LeaveRecordView[]> {
    const rows = await this.attendance.listLeaves({
      orgId,
      ...f,
      limit: LEAVE_LIST_LIMIT,
    });
    return rows.map(toLeaveView);
  }

  /** PENDING -> APPROVED | REJECTED. Anything already decided is a 409, never a silent overwrite. */
  async decide(
    principal: AuthPrincipal,
    id: string,
    status: 'APPROVED' | 'REJECTED',
  ): Promise<LeaveRecordView> {
    const existing = await this.attendance.findLeave(principal.orgId, id);
    if (!existing) throw new NotFoundException('Leave record not found');
    assertNotExited(existing.employee);
    if (existing.status !== 'PENDING')
      throw new ConflictException(`Leave is already ${existing.status}`);
    const won = await this.attendance.decide(
      id,
      status,
      principal.isMachine ? null : principal.userId,
    );
    if (!won) throw new ConflictException('Leave was decided by someone else');
    const fresh = await this.attendance.findLeave(principal.orgId, id);
    return toLeaveView(fresh as NonNullable<typeof fresh>);
  }
}

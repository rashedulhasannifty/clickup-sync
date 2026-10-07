import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { dateColumnToIso, isoToDateColumn } from './people-dates';
import type { ProviderLeaveRow } from './attendance-provider';
import type { LeaveStatusValue } from './people.types';

export interface AttendanceUpsert {
  employeeId: string;
  /** `YYYY-MM-DD` */
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
  minutesInOffice: number | null;
  source: string;
}

export interface LeaveUpsert extends Omit<ProviderLeaveRow, 'email'> {
  employeeId: string;
}

export interface LeaveUpsertResult {
  created: number;
  updated: number;
  /** Rows a person already decided: left exactly as they were. */
  preserved: number;
}

export interface LeaveListFilter {
  orgId: string;
  status?: LeaveStatusValue;
  employeeId?: string;
  /** Leaves ending on/after. */
  from?: string;
  /** Leaves starting on/before. */
  to?: string;
  limit: number;
}

const CHUNK = 500;

/** Owns every write to `attendance_days` and `leave_records`. */
@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  attendanceRows(employeeIds: string[], from: string, to: string) {
    if (employeeIds.length === 0) return Promise.resolve([]);
    return this.prisma.attendanceDay.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: isoToDateColumn(from), lte: isoToDateColumn(to) },
      },
      select: {
        employeeId: true,
        date: true,
        firstIn: true,
        lastOut: true,
        minutesInOffice: true,
      },
    });
  }

  /** Source of the most recently dated attendance row, optionally for one employee; null when there is none. */
  async latestSource(
    orgId: string,
    employeeId?: string,
  ): Promise<string | null> {
    const row = await this.prisma.attendanceDay.findFirst({
      where: { employee: { orgId }, ...(employeeId ? { employeeId } : {}) },
      orderBy: { date: 'desc' },
      select: { source: true },
    });
    return row?.source ?? null;
  }

  /** APPROVED leave overlapping [from, to]. */
  approvedLeaves(employeeIds: string[], from: string, to: string) {
    if (employeeIds.length === 0) return Promise.resolve([]);
    return this.prisma.leaveRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startDate: { lte: isoToDateColumn(to) },
        endDate: { gte: isoToDateColumn(from) },
      },
      select: {
        employeeId: true,
        type: true,
        startDate: true,
        endDate: true,
        days: true,
      },
    });
  }

  listLeaves(f: LeaveListFilter) {
    return this.prisma.leaveRecord.findMany({
      where: {
        employee: { orgId: f.orgId },
        ...(f.status ? { status: f.status } : {}),
        ...(f.employeeId ? { employeeId: f.employeeId } : {}),
        ...(f.from ? { endDate: { gte: isoToDateColumn(f.from) } } : {}),
        ...(f.to ? { startDate: { lte: isoToDateColumn(f.to) } } : {}),
      },
      include: { employee: { select: { fullName: true } } },
      orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      take: f.limit,
    });
  }

  countPendingFrom(orgId: string, fromDate: string): Promise<number> {
    return this.prisma.leaveRecord.count({
      where: {
        employee: { orgId },
        status: 'PENDING',
        endDate: { gte: isoToDateColumn(fromDate) },
      },
    });
  }

  findLeave(orgId: string, id: string) {
    return this.prisma.leaveRecord.findFirst({
      where: { id, employee: { orgId } },
      include: { employee: { select: { fullName: true } } },
    });
  }

  /**
   * PENDING -> APPROVED/REJECTED, atomically: the `status: 'PENDING'` guard is in
   * the WHERE, so two admins deciding at once cannot both win. Returns whether
   * this call made the decision.
   */
  async decide(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    decidedBy: string | null,
  ): Promise<boolean> {
    const res = await this.prisma.leaveRecord.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, decidedBy, decidedAt: new Date() },
    });
    return res.count === 1;
  }

  /**
   * Idempotent upsert keyed on (employee_id, date). Raw multi-row INSERT .. ON
   * CONFLICT because a 90-day sync is thousands of rows and one Prisma upsert
   * per row would be thousands of round trips.
   */
  async upsertAttendance(rows: AttendanceUpsert[]): Promise<number> {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const values = rows
        .slice(i, i + CHUNK)
        .map(
          (r) =>
            Prisma.sql`(${r.employeeId}, ${r.date}::date, ${r.firstIn}::timestamptz, ${r.lastOut}::timestamptz, ${r.minutesInOffice}::int, ${r.source}, now())`,
        );
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO attendance_days (employee_id, date, first_in, last_out, minutes_in_office, source, synced_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (employee_id, date) DO UPDATE SET
          first_in = EXCLUDED.first_in,
          last_out = EXCLUDED.last_out,
          minutes_in_office = EXCLUDED.minutes_in_office,
          source = EXCLUDED.source,
          synced_at = now()
      `);
    }
    return rows.length;
  }

  /**
   * Upserts provider leave on (source, external_id). A row somebody has decided
   * (`decided_at` set) is never touched: a later sync of a PENDING request must
   * not undo a manual APPROVED/REJECTED. Keying on `decided_at` rather than on
   * the status matters because the providers themselves emit APPROVED rows.
   * Rows already identical to the provider's are skipped, so a steady-state
   * re-sync writes nothing.
   */
  async upsertProviderLeaves(
    source: string,
    leaves: LeaveUpsert[],
  ): Promise<LeaveUpsertResult> {
    const result: LeaveUpsertResult = { created: 0, updated: 0, preserved: 0 };
    if (leaves.length === 0) return result;

    const existing = await this.prisma.leaveRecord.findMany({
      where: { source, externalId: { in: leaves.map((l) => l.externalId) } },
    });
    const byExternal = new Map(
      existing.map((r) => [r.externalId as string, r]),
    );

    const toCreate: Prisma.LeaveRecordCreateManyInput[] = [];
    const toUpdate: {
      id: string;
      data: Prisma.LeaveRecordUncheckedUpdateManyInput;
    }[] = [];
    for (const l of leaves) {
      const row = byExternal.get(l.externalId);
      if (!row) {
        toCreate.push({
          employeeId: l.employeeId,
          type: l.type,
          startDate: isoToDateColumn(l.startDate),
          endDate: isoToDateColumn(l.endDate),
          days: l.days,
          status: l.status,
          reason: l.reason ?? null,
          source,
          externalId: l.externalId,
        });
        continue;
      }
      if (row.decidedAt) {
        result.preserved++;
        continue;
      }
      const same =
        row.employeeId === l.employeeId &&
        row.type === l.type &&
        dateColumnToIso(row.startDate) === l.startDate &&
        dateColumnToIso(row.endDate) === l.endDate &&
        row.days.toNumber() === l.days &&
        row.status === l.status &&
        (row.reason ?? null) === (l.reason ?? null);
      if (same) continue;
      toUpdate.push({
        id: row.id,
        data: {
          employeeId: l.employeeId,
          type: l.type,
          startDate: isoToDateColumn(l.startDate),
          endDate: isoToDateColumn(l.endDate),
          days: l.days,
          status: l.status,
          reason: l.reason ?? null,
        },
      });
    }

    if (toCreate.length > 0) {
      // skipDuplicates: a concurrent sync that inserted the same external id wins quietly.
      const created = await this.prisma.leaveRecord.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      result.created = created.count;
    }
    if (toUpdate.length > 0) {
      // The decided_at IS NULL guard closes the read-then-write gap: a decision
      // landing between the read above and this write still wins.
      for (const u of toUpdate) {
        const res = await this.prisma.leaveRecord.updateMany({
          where: { id: u.id, decidedAt: null },
          data: u.data,
        });
        if (res.count === 1) result.updated++;
        else result.preserved++;
      }
    }
    return result;
  }
}

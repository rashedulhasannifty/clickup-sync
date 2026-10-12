import { Injectable } from '@nestjs/common';
import { Prisma, type AttendanceSource } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { dateColumnToIso, isoToDateColumn } from './people-dates';
import type { ProviderLeaveRow } from './attendance-provider';
import type {
  AttendanceWrite,
  ExistingAttendance,
  ExistingLeave,
  LeaveInsert,
} from './stellar/stellar-import-plan';
import type { LeaveStatusValue } from './people.types';

export interface AttendanceUpsert {
  employeeId: string;
  /** `YYYY-MM-DD` */
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
  minutesInOffice: number | null;
  /** In/out sessions; null when the provider only reports first/last. */
  sessions?: number | null;
  workedMinutes?: number | null;
  missingOut?: boolean;
  note?: string | null;
  source: AttendanceSource;
}

/** Date span of the attendance rows of one source, for "Stellar HRM import, 1 Jul - 12 Oct". */
export interface SourceCoverage {
  source: AttendanceSource;
  from: string;
  to: string;
  rows: number;
}

/** The columns every attendance read returns. */
export const ATTENDANCE_SELECT = {
  employeeId: true,
  date: true,
  firstIn: true,
  lastOut: true,
  minutesInOffice: true,
  sessions: true,
  workedMinutes: true,
  missingOut: true,
  note: true,
  source: true,
} satisfies Prisma.AttendanceDaySelect;

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
/** Rows per createMany in an import: well under Postgres' 65 535 bind parameters. */
const IMPORT_CHUNK = 1000;
/** A full-quarter import is a few thousand rows; leave the transaction room. */
const IMPORT_TX = { timeout: 60_000, maxWait: 10_000 };

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
      select: ATTENDANCE_SELECT,
    });
  }

  /**
   * (employee|date) keys that hold real (non-DUMMY) attendance in [from, to].
   * The dummy sync must not invent leave on a day the door system has.
   */
  async realAttendanceKeys(
    employeeIds: string[],
    from: string,
    to: string,
  ): Promise<Set<string>> {
    if (employeeIds.length === 0) return new Set();
    const rows = await this.prisma.attendanceDay.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: isoToDateColumn(from), lte: isoToDateColumn(to) },
        source: { not: 'DUMMY' },
      },
      select: { employeeId: true, date: true },
    });
    return new Set(
      rows.map((r) => `${r.employeeId}|${dateColumnToIso(r.date)}`),
    );
  }

  /** Every attendance row of these employees in [from, to], with its source (import planning). */
  async attendanceSourcesIn(
    employeeIds: string[],
    from: string,
    to: string,
  ): Promise<ExistingAttendance[]> {
    if (employeeIds.length === 0) return [];
    const rows = await this.prisma.attendanceDay.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: isoToDateColumn(from), lte: isoToDateColumn(to) },
      },
      select: { employeeId: true, date: true, source: true },
    });
    return rows.map((r) => ({ ...r, date: dateColumnToIso(r.date) }));
  }

  /** Leave rows of these sources overlapping [from, to] (import planning). */
  async leavesOfSourcesIn(
    employeeIds: string[],
    sources: string[],
    from: string,
    to: string,
  ): Promise<ExistingLeave[]> {
    if (employeeIds.length === 0) return [];
    const rows = await this.prisma.leaveRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        source: { in: sources },
        startDate: { lte: isoToDateColumn(to) },
        endDate: { gte: isoToDateColumn(from) },
      },
      select: {
        id: true,
        employeeId: true,
        source: true,
        startDate: true,
        endDate: true,
        decidedAt: true,
      },
    });
    return rows.map(({ decidedAt, ...r }) => ({
      ...r,
      decided: decidedAt !== null,
      startDate: dateColumnToIso(r.startDate),
      endDate: dateColumnToIso(r.endDate),
    }));
  }

  /**
   * Apply a Stellar CSV attendance import atomically: delete the DUMMY and
   * STELLAR_CSV rows of the matched employees over the file's range (never
   * STELLAR_API), insert the file's rows (a STELLAR_API row that appeared
   * meanwhile wins: skipDuplicates), and delete the simulated leave the plan
   * named. Re-running the same file converges on the same rows.
   */
  async applyStellarAttendanceImport(args: {
    employeeIds: string[];
    from: string;
    to: string;
    writes: AttendanceWrite[];
    dummyLeaveIds: string[];
  }): Promise<{ deleted: number; inserted: number; leavesDeleted: number }> {
    return this.prisma.$transaction(async (tx) => {
      const deleted =
        args.employeeIds.length === 0
          ? { count: 0 }
          : await tx.attendanceDay.deleteMany({
              where: {
                employeeId: { in: args.employeeIds },
                date: {
                  gte: isoToDateColumn(args.from),
                  lte: isoToDateColumn(args.to),
                },
                source: { in: ['DUMMY', 'STELLAR_CSV'] },
              },
            });
      let inserted = 0;
      for (let i = 0; i < args.writes.length; i += IMPORT_CHUNK) {
        const res = await tx.attendanceDay.createMany({
          data: args.writes.slice(i, i + IMPORT_CHUNK).map((w) => ({
            employeeId: w.employeeId,
            date: isoToDateColumn(w.date),
            firstIn: w.firstIn,
            lastOut: w.lastOut,
            minutesInOffice: w.minutesInOffice,
            sessions: w.sessions,
            workedMinutes: w.workedMinutes,
            missingOut: w.missingOut,
            note: w.note,
            source: 'STELLAR_CSV' as const,
          })),
          skipDuplicates: true,
        });
        inserted += res.count;
      }
      const leaves =
        args.dummyLeaveIds.length === 0
          ? { count: 0 }
          : await tx.leaveRecord.deleteMany({
              where: { id: { in: args.dummyLeaveIds }, source: 'dummy' },
            });
      return {
        deleted: deleted.count,
        inserted,
        leavesDeleted: leaves.count,
      };
    }, IMPORT_TX);
  }

  /**
   * Apply a Stellar leave import atomically: delete the `stellar`/`dummy`
   * rows the plan named (the source guard makes a manual leave undeletable
   * here even by a bad plan), then insert the file's records.
   */
  async applyStellarLeaveImport(args: {
    deleteIds: string[];
    inserts: LeaveInsert[];
  }): Promise<{ deleted: number; inserted: number }> {
    return this.prisma.$transaction(async (tx) => {
      const deleted =
        args.deleteIds.length === 0
          ? { count: 0 }
          : await tx.leaveRecord.deleteMany({
              where: {
                id: { in: args.deleteIds },
                source: { in: ['stellar', 'dummy'] },
              },
            });
      let inserted = 0;
      for (let i = 0; i < args.inserts.length; i += IMPORT_CHUNK) {
        const res = await tx.leaveRecord.createMany({
          data: args.inserts.slice(i, i + IMPORT_CHUNK).map((l) => ({
            employeeId: l.employeeId,
            type: l.type,
            startDate: isoToDateColumn(l.startDate),
            endDate: isoToDateColumn(l.endDate),
            days: l.days,
            status: l.status,
            reason: l.reason,
            source: l.source,
            externalId: l.externalId,
          })),
          skipDuplicates: true,
        });
        inserted += res.count;
      }
      return { deleted: deleted.count, inserted };
    }, IMPORT_TX);
  }

  /** Per-source date span of the org's attendance rows, newest data first. */
  async coverage(orgId: string): Promise<SourceCoverage[]> {
    const rows = await this.prisma.$queryRaw<
      { source: AttendanceSource; from: string; to: string; rows: number }[]
    >`
      -- Dates as text and the enum/count cast explicitly, like people-metrics:
      -- the driver adapter's raw DATE/BIGINT/enum types are not relied on.
      SELECT a.source::text AS source,
             to_char(min(a.date), 'YYYY-MM-DD') AS "from",
             to_char(max(a.date), 'YYYY-MM-DD') AS "to",
             count(*)::int AS "rows"
      FROM attendance_days a
      JOIN employees e ON e.id = a.employee_id
      WHERE e.org_id = ${orgId}
      GROUP BY a.source
      ORDER BY max(a.date) DESC`;
    return rows.map((r) => ({
      source: r.source,
      from: r.from,
      to: r.to,
      rows: Number(r.rows),
    }));
  }

  /** Source of the most recently dated attendance row, optionally for one employee; null when there is none. */
  async latestSource(
    orgId: string,
    employeeId?: string,
  ): Promise<AttendanceSource | null> {
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
      include: { employee: { select: { fullName: true, status: true } } },
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
   *
   * A row is only overwritten by a source at least as real as its own:
   * Postgres orders enum values by declaration (DUMMY < STELLAR_CSV <
   * STELLAR_API), so the dummy sync can never clobber imported door data.
   */
  async upsertAttendance(rows: AttendanceUpsert[]): Promise<number> {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const values = rows
        .slice(i, i + CHUNK)
        .map(
          (r) =>
            Prisma.sql`(${r.employeeId}, ${r.date}::date, ${r.firstIn}::timestamptz, ${r.lastOut}::timestamptz, ${r.minutesInOffice}::int, ${r.sessions ?? null}::int, ${r.workedMinutes ?? null}::int, ${r.missingOut ?? false}::boolean, ${r.note ?? null}::text, ${r.source}::"AttendanceSource", now())`,
        );
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO attendance_days (employee_id, date, first_in, last_out, minutes_in_office, sessions, worked_minutes, missing_out, note, source, synced_at)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (employee_id, date) DO UPDATE SET
          first_in = EXCLUDED.first_in,
          last_out = EXCLUDED.last_out,
          minutes_in_office = EXCLUDED.minutes_in_office,
          sessions = EXCLUDED.sessions,
          worked_minutes = EXCLUDED.worked_minutes,
          missing_out = EXCLUDED.missing_out,
          note = EXCLUDED.note,
          source = EXCLUDED.source,
          synced_at = now()
        WHERE attendance_days.source <= EXCLUDED.source
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

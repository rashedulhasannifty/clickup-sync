import type { AttendanceSource } from '@prisma/client';
import { minutesBetween } from '../attendance-math';
import { isBusinessDay } from '../people-dates';
import type { LeaveStatusValue, LeaveTypeValue } from '../people.types';
import type { StellarAttendanceParse } from './stellar-csv';
import {
  STELLAR_LEAVE_SOURCE,
  type StellarLeaveFlag,
  type StellarLeaveParse,
} from './stellar-leaves-csv';

/**
 * Pure import planners: given a parsed Stellar HRM export and what is already
 * in the database, decide exactly what to write and what to delete. The
 * service only loads the inputs and applies the plan in one transaction, so
 * every rule below is unit-tested here:
 *
 * - matching is by `Employee.attendanceId` only; unmatched ids are reported, never guessed;
 * - attendance replaces DUMMY and STELLAR_CSV rows of matched employees over the
 *   file's date range, never STELLAR_API rows;
 * - simulated (`source='dummy'`) leave of matched employees in that range is
 *   deleted: it was fabricated, and real data now covers those days;
 * - the leave import replaces only `source='stellar'` leave, never manual leave;
 * - days outside the employee's employment are skipped and counted;
 * - a weekend day with no punches is not a day at all; one with punches is weekend work.
 */

export const DUMMY_LEAVE_SOURCE = 'dummy';

export interface ImportEmployee {
  id: string;
  fullName: string;
  attendanceId: string;
  /** `YYYY-MM-DD` */
  joinDate: string;
  exitDate: string | null;
}

export interface ExistingAttendance {
  employeeId: string;
  date: string;
  source: AttendanceSource;
}

export interface ExistingLeave {
  id: string;
  employeeId: string;
  source: string;
  startDate: string;
  endDate: string;
  /** Approved or rejected in the app (`decided_at` set): never replaced by a file. */
  decided?: boolean;
}

export interface DateSpan {
  from: string;
  to: string;
}

const overlaps = (a: DateSpan, from: string, to: string) =>
  a.from <= to && from <= a.to;

const employed = (e: ImportEmployee, from: string, to: string) =>
  to >= e.joinDate && (e.exitDate === null || from <= e.exitDate);

function byAttendanceId(employees: ImportEmployee[]) {
  return new Map(employees.map((e) => [e.attendanceId, e]));
}

function dummyLeavesOf(
  leaves: ExistingLeave[],
  employeeId: string,
  range: DateSpan,
): ExistingLeave[] {
  return leaves.filter(
    (l) =>
      l.employeeId === employeeId &&
      l.source === DUMMY_LEAVE_SOURCE &&
      overlaps(range, l.startDate, l.endDate),
  );
}

// ---------------------------------------------------------------- attendance

export interface AttendanceWrite {
  employeeId: string;
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
  minutesInOffice: number | null;
  sessions: number;
  workedMinutes: number | null;
  missingOut: boolean;
  note: string | null;
}

export interface MatchedAttendance {
  attendanceId: string;
  employeeId: string;
  fullName: string;
  stellarName: string;
  department: string | null;
  /** Rows this import writes for the employee. */
  days: number;
  /** Business days with punches. */
  presentDays: number;
  /** Business days without any punch. */
  noPunchDays: number;
  /** Weekend days with punches (extra work). */
  weekendDays: number;
  /** Days before joining / after exit: skipped. */
  outsideEmployment: number;
  /** Existing rows removed and replaced. */
  replacedDummy: number;
  replacedCsv: number;
  /** Days already holding Stellar API data: left alone. */
  keptApi: number;
  dummyLeavesDeleted: number;
}

export interface UnmatchedUser {
  attendanceId: string;
  name: string;
  department: string | null;
  /** Days (attendance) or records (leave) in the file for this id. */
  count: number;
}

export interface AttendanceImportPlan {
  range: DateSpan | null;
  matched: MatchedAttendance[];
  unmatched: UnmatchedUser[];
  writes: AttendanceWrite[];
  /** Employees whose DUMMY/STELLAR_CSV rows in `range` are deleted before the writes. */
  replaceEmployeeIds: string[];
  dummyLeaveIds: string[];
  totals: {
    rowsToWrite: number;
    replacedDummy: number;
    replacedCsv: number;
    keptApi: number;
    dummyLeavesDeleted: number;
    outsideEmployment: number;
    weekendDays: number;
    unmatchedIds: number;
  };
}

export function planAttendanceImport(args: {
  parse: StellarAttendanceParse;
  employees: ImportEmployee[];
  existing: ExistingAttendance[];
  leaves: ExistingLeave[];
}): AttendanceImportPlan {
  const { parse } = args;
  const range = parse.range;
  const employees = byAttendanceId(args.employees);
  const users = new Map(parse.users.map((u) => [u.attendanceId, u]));
  const matched = new Map<string, MatchedAttendance>();
  const unmatched = new Map<string, UnmatchedUser>();
  const writes: AttendanceWrite[] = [];
  const apiDays = new Set(
    args.existing
      .filter((r) => r.source === 'STELLAR_API')
      .map((r) => `${r.employeeId}|${r.date}`),
  );

  for (const day of parse.days) {
    const user = users.get(day.attendanceId);
    const emp = employees.get(day.attendanceId);
    if (!emp) {
      const u = unmatched.get(day.attendanceId) ?? {
        attendanceId: day.attendanceId,
        name: user?.name ?? '',
        department: user?.department ?? null,
        count: 0,
      };
      u.count++;
      unmatched.set(day.attendanceId, u);
      continue;
    }
    let m = matched.get(day.attendanceId);
    if (!m) {
      m = {
        attendanceId: day.attendanceId,
        employeeId: emp.id,
        fullName: emp.fullName,
        stellarName: user?.name ?? '',
        department: user?.department ?? null,
        days: 0,
        presentDays: 0,
        noPunchDays: 0,
        weekendDays: 0,
        outsideEmployment: 0,
        replacedDummy: 0,
        replacedCsv: 0,
        keptApi: 0,
        dummyLeavesDeleted: 0,
      };
      matched.set(day.attendanceId, m);
    }
    const business = isBusinessDay(day.date);
    // A weekend with nobody in is not a day at all.
    if (!business && day.sessions === 0) continue;
    if (!employed(emp, day.date, day.date)) {
      m.outsideEmployment++;
      continue;
    }
    if (apiDays.has(`${emp.id}|${day.date}`)) {
      m.keptApi++;
      continue;
    }
    if (!business) m.weekendDays++;
    else if (day.sessions > 0) m.presentDays++;
    else m.noPunchDays++;
    m.days++;
    writes.push({
      employeeId: emp.id,
      date: day.date,
      firstIn: day.firstIn,
      lastOut: day.lastOut,
      minutesInOffice: minutesBetween(day.firstIn, day.lastOut),
      sessions: day.sessions,
      workedMinutes: day.workedMinutes,
      missingOut: day.missingOut,
      note: day.note,
    });
  }

  const dummyLeaveIds: string[] = [];
  if (range) {
    for (const m of matched.values()) {
      for (const r of args.existing) {
        if (r.employeeId !== m.employeeId) continue;
        if (r.date < range.from || r.date > range.to) continue;
        if (r.source === 'DUMMY') m.replacedDummy++;
        if (r.source === 'STELLAR_CSV') m.replacedCsv++;
      }
      const dummy = dummyLeavesOf(args.leaves, m.employeeId, range);
      m.dummyLeavesDeleted = dummy.length;
      dummyLeaveIds.push(...dummy.map((l) => l.id));
    }
  }

  const matchedList = [...matched.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
  const unmatchedList = [...unmatched.values()].sort((a, b) =>
    a.attendanceId.localeCompare(b.attendanceId, undefined, { numeric: true }),
  );
  const sum = (k: keyof MatchedAttendance) =>
    matchedList.reduce((n, m) => n + (m[k] as number), 0);
  return {
    range,
    matched: matchedList,
    unmatched: unmatchedList,
    writes,
    replaceEmployeeIds: range ? matchedList.map((m) => m.employeeId) : [],
    dummyLeaveIds,
    totals: {
      rowsToWrite: writes.length,
      replacedDummy: sum('replacedDummy'),
      replacedCsv: sum('replacedCsv'),
      keptApi: sum('keptApi'),
      dummyLeavesDeleted: dummyLeaveIds.length,
      outsideEmployment: sum('outsideEmployment'),
      weekendDays: sum('weekendDays'),
      unmatchedIds: unmatchedList.length,
    },
  };
}

// ---------------------------------------------------------------- leave

export interface LeaveInsert {
  employeeId: string;
  type: LeaveTypeValue;
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveStatusValue;
  /** The export's description (sensitive: Owner/Admin only, never logged). */
  reason: string | null;
  source: typeof STELLAR_LEAVE_SOURCE;
  externalId: string;
}

export interface LeavePreviewRecord {
  type: LeaveTypeValue;
  rawType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveStatusValue;
  description: string | null;
}

export interface MatchedLeave {
  attendanceId: string;
  employeeId: string;
  fullName: string;
  stellarName: string;
  records: LeavePreviewRecord[];
  approvedDays: number;
  rejectedDays: number;
  /** Records outside the employee's employment: skipped. */
  outsideEmployment: number;
  /** Existing Stellar leave rows removed and replaced. */
  replacedStellar: number;
  /**
   * Existing Stellar leave kept as it is: decided in the app, or running past the file's dates.
   * File records that overlap one are skipped, so nothing is duplicated or cut short.
   */
  keptStellar: number;
  dummyLeavesDeleted: number;
}

export interface LeaveImportPlan {
  range: DateSpan | null;
  matched: MatchedLeave[];
  unmatched: UnmatchedUser[];
  inserts: LeaveInsert[];
  /** Existing `stellar` and `dummy` leave rows to delete (never manual ones). */
  deleteIds: string[];
  skipped: StellarLeaveFlag[];
  warnings: StellarLeaveFlag[];
  totals: {
    records: number;
    approvedDays: number;
    rejectedDays: number;
    replacedStellar: number;
    keptStellar: number;
    dummyLeavesDeleted: number;
    outsideEmployment: number;
    skippedRows: number;
    unmatchedIds: number;
  };
}

export function planLeaveImport(args: {
  parse: StellarLeaveParse;
  employees: ImportEmployee[];
  existing: ExistingLeave[];
}): LeaveImportPlan {
  const { parse } = args;
  const range = parse.range;
  const employees = byAttendanceId(args.employees);
  const matched = new Map<string, MatchedLeave>();
  const unmatched = new Map<string, UnmatchedUser>();
  const inserts: LeaveInsert[] = [];

  for (const r of parse.records) {
    const emp = employees.get(r.attendanceId);
    if (!emp) {
      const u = unmatched.get(r.attendanceId) ?? {
        attendanceId: r.attendanceId,
        name: r.name,
        department: null,
        count: 0,
      };
      u.count++;
      unmatched.set(r.attendanceId, u);
      continue;
    }
    let m = matched.get(r.attendanceId);
    if (!m) {
      m = {
        attendanceId: r.attendanceId,
        employeeId: emp.id,
        fullName: emp.fullName,
        stellarName: r.name,
        records: [],
        approvedDays: 0,
        rejectedDays: 0,
        outsideEmployment: 0,
        replacedStellar: 0,
        keptStellar: 0,
        dummyLeavesDeleted: 0,
      };
      matched.set(r.attendanceId, m);
    }
    if (!employed(emp, r.startDate, r.endDate)) {
      m.outsideEmployment++;
      continue;
    }
    if (r.status === 'APPROVED') m.approvedDays += r.days;
    if (r.status === 'REJECTED') m.rejectedDays += r.days;
    m.records.push({
      type: r.type,
      rawType: r.rawType,
      startDate: r.startDate,
      endDate: r.endDate,
      days: r.days,
      status: r.status,
      description: r.description,
    });
    inserts.push({
      employeeId: emp.id,
      type: r.type,
      startDate: r.startDate,
      endDate: r.endDate,
      days: r.days,
      status: r.status,
      // An unmapped type lands as OTHER; keep the export's wording visible.
      reason:
        r.type === 'OTHER' && r.rawType
          ? `[${r.rawType}]${r.description ? ` ${r.description}` : ''}`
          : r.description,
      source: STELLAR_LEAVE_SOURCE,
      externalId: r.externalId,
    });
  }

  // An earlier Stellar leave is replaced only when it lies wholly inside this file's dates and
  // nobody decided it in the app; otherwise it stays, and the file's overlapping records are
  // skipped (a shorter file must never cut a longer leave, nor undo an approval).
  const deleteIds: string[] = [];
  const kept: ExistingLeave[] = [];
  if (range) {
    for (const m of matched.values()) {
      for (const l of args.existing) {
        if (l.employeeId !== m.employeeId) continue;
        if (!overlaps(range, l.startDate, l.endDate)) continue;
        if (l.source === STELLAR_LEAVE_SOURCE) {
          const inside = l.startDate >= range.from && l.endDate <= range.to;
          if (inside && !l.decided) {
            m.replacedStellar++;
            deleteIds.push(l.id);
          } else {
            m.keptStellar++;
            kept.push(l);
          }
        } else if (l.source === DUMMY_LEAVE_SOURCE) {
          m.dummyLeavesDeleted++;
          deleteIds.push(l.id);
        }
      }
    }
  }
  const clashes = (i: LeaveInsert) =>
    kept.some(
      (l) =>
        l.employeeId === i.employeeId &&
        overlaps({ from: i.startDate, to: i.endDate }, l.startDate, l.endDate),
    );
  for (let i = inserts.length - 1; i >= 0; i--)
    if (clashes(inserts[i])) inserts.splice(i, 1);

  const matchedList = [...matched.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
  const unmatchedList = [...unmatched.values()].sort((a, b) =>
    a.attendanceId.localeCompare(b.attendanceId, undefined, { numeric: true }),
  );
  const sum = (k: keyof MatchedLeave) =>
    matchedList.reduce((n, m) => n + (m[k] as number), 0);
  return {
    range,
    matched: matchedList,
    unmatched: unmatchedList,
    inserts,
    deleteIds,
    skipped: parse.skipped,
    warnings: parse.warnings,
    totals: {
      records: inserts.length,
      approvedDays: sum('approvedDays'),
      rejectedDays: sum('rejectedDays'),
      replacedStellar: sum('replacedStellar'),
      keptStellar: sum('keptStellar'),
      dummyLeavesDeleted: sum('dummyLeavesDeleted'),
      outsideEmployment: sum('outsideEmployment'),
      skippedRows: parse.skipped.length,
      unmatchedIds: unmatchedList.length,
    },
  };
}

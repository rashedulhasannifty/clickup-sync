import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AttendanceRepository } from '../attendance.repository';
import { EmployeesRepository } from '../employees.repository';
import {
  detectStellarExport,
  StellarCsvError,
  type StellarExportKind,
} from './csv';
import { parseStellarAttendanceCsv } from './stellar-csv';
import {
  DUMMY_LEAVE_SOURCE,
  planAttendanceImport,
  planLeaveImport,
  type AttendanceImportPlan,
  type LeaveImportPlan,
} from './stellar-import-plan';
import {
  parseStellarLeavesCsv,
  STELLAR_LEAVE_SOURCE,
} from './stellar-leaves-csv';

/** 10 MB: a year of door punches for the whole office is well under 2 MB. */
export const MAX_STELLAR_CSV_BYTES = 10 * 1024 * 1024;

/** The parts of a multer memory-storage file this service reads. */
export interface UploadedCsv {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** What the dry run previews and the real run reports: the plan without the raw rows. */
export type AttendanceImportResult = Omit<
  AttendanceImportPlan,
  'writes' | 'replaceEmployeeIds' | 'dummyLeaveIds'
> & {
  kind: 'attendance';
  dryRun: boolean;
  file: { rowsRead: number; ignoredRows: number; invalidRows: number };
  /** Set when written: what the transaction actually did. */
  applied: { deleted: number; inserted: number; leavesDeleted: number } | null;
};

export type LeaveImportResult = Omit<LeaveImportPlan, 'inserts' | 'deleteIds'> & {
  kind: 'leaves';
  dryRun: boolean;
  file: { rowsRead: number };
  applied: { deleted: number; inserted: number } | null;
};

/**
 * Owner/Admin import of Stellar HRM CSV exports. Parsing and planning are pure
 * (`stellar-csv`, `stellar-leaves-csv`, `stellar-import-plan`); this loads the
 * plan's inputs and applies it in one transaction. A dry run never writes.
 * Logs carry counts only: never names, notes or leave descriptions.
 */
@Injectable()
export class StellarImportService {
  private readonly logger = new Logger(StellarImportService.name);

  constructor(
    private readonly employees: EmployeesRepository,
    private readonly attendance: AttendanceRepository,
  ) {}

  async importAttendance(
    orgId: string,
    file: UploadedCsv | undefined,
    dryRun: boolean,
  ): Promise<AttendanceImportResult> {
    const text = this.read(file, 'attendance');
    const parse = this.parsed(() => parseStellarAttendanceCsv(text));
    const employees = await this.employees.byAttendanceIds(
      orgId,
      parse.users.map((u) => u.attendanceId),
    );
    const ids = employees.map((e) => e.id);
    const range = parse.range;
    const [existing, leaves] = range
      ? await Promise.all([
          this.attendance.attendanceSourcesIn(ids, range.from, range.to),
          this.attendance.leavesOfSourcesIn(
            ids,
            [DUMMY_LEAVE_SOURCE],
            range.from,
            range.to,
          ),
        ])
      : [[], []];
    const plan = planAttendanceImport({ parse, employees, existing, leaves });
    const { writes, replaceEmployeeIds, dummyLeaveIds, ...summary } = plan;

    let applied: AttendanceImportResult['applied'] = null;
    if (!dryRun && range) {
      applied = await this.attendance.applyStellarAttendanceImport({
        employeeIds: replaceEmployeeIds,
        from: range.from,
        to: range.to,
        writes,
        dummyLeaveIds,
      });
      this.logger.log(
        `stellar attendance import ${range.from}..${range.to}: ${summary.matched.length} matched, ` +
          `${summary.unmatched.length} unmatched ids, -${applied.deleted} +${applied.inserted} rows, ` +
          `${applied.leavesDeleted} simulated leaves removed`,
      );
    }
    return {
      kind: 'attendance',
      dryRun,
      file: {
        rowsRead: parse.rowsRead,
        ignoredRows: parse.ignoredRows,
        invalidRows: parse.invalidRows,
      },
      ...summary,
      applied,
    };
  }

  async importLeaves(
    orgId: string,
    file: UploadedCsv | undefined,
    dryRun: boolean,
  ): Promise<LeaveImportResult> {
    const text = this.read(file, 'leaves');
    const parse = this.parsed(() => parseStellarLeavesCsv(text));
    const employees = await this.employees.byAttendanceIds(
      orgId,
      parse.users.map((u) => u.attendanceId),
    );
    const range = parse.range;
    const existing = range
      ? await this.attendance.leavesOfSourcesIn(
          employees.map((e) => e.id),
          [STELLAR_LEAVE_SOURCE, DUMMY_LEAVE_SOURCE],
          range.from,
          range.to,
        )
      : [];
    const plan = planLeaveImport({ parse, employees, existing });
    const { inserts, deleteIds, ...summary } = plan;

    let applied: LeaveImportResult['applied'] = null;
    if (!dryRun && range) {
      applied = await this.attendance.applyStellarLeaveImport({
        deleteIds,
        inserts,
      });
      this.logger.log(
        `stellar leave import ${range.from}..${range.to}: ${summary.matched.length} matched, ` +
          `${summary.unmatched.length} unmatched ids, -${applied.deleted} +${applied.inserted} leave records`,
      );
    }
    return {
      kind: 'leaves',
      dryRun,
      file: { rowsRead: parse.rowsRead },
      ...summary,
      applied,
    };
  }

  /** Size, encoding and kind checks; returns the text. Never trusts the mimetype or file name. */
  private read(file: UploadedCsv | undefined, want: StellarExportKind): string {
    if (!file || !file.buffer || file.size === 0)
      throw new BadRequestException('Attach the CSV export as `file`.');
    if (file.size > MAX_STELLAR_CSV_BYTES || file.buffer.length > MAX_STELLAR_CSV_BYTES)
      throw new PayloadTooLargeException('The CSV is larger than 10 MB.');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      throw new BadRequestException('The file is not UTF-8 text.');
    }
    const kind = detectStellarExport(text);
    if (kind !== want) {
      throw new BadRequestException(
        kind
          ? `This is a Stellar HRM ${kind === 'leaves' ? 'leave' : 'attendance'} export: use the ${kind === 'leaves' ? 'leave' : 'attendance'} import.`
          : `Not a Stellar HRM ${want === 'leaves' ? 'leave' : 'attendance'} export (unrecognised header).`,
      );
    }
    return text;
  }

  private parsed<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof StellarCsvError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}

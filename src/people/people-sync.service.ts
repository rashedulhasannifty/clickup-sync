import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queues/queue.service';
import { JOBS, QUEUES } from '../queues/queue.constants';
import { minutesBetween } from './attendance-math';
import {
  ATTENDANCE_PROVIDER,
  type AttendanceProvider,
} from './attendance-provider';
import {
  AttendanceRepository,
  type AttendanceUpsert,
  type LeaveUpsert,
} from './attendance.repository';
import { EmployeesRepository } from './employees.repository';
import {
  SYNC_CRON_LOOKBACK_DAYS,
  SYNC_INTRADAY_LOOKBACK_DAYS,
  SYNC_DEFAULT_LOOKBACK_DAYS,
} from './people.constants';
import { addDays, dateColumnToIso, dhakaDateOf } from './people-dates';
import type { AttendanceSyncResult, SyncEnqueued } from './people.types';

export interface PeopleSyncJobData {
  entity: 'attendance';
  lookbackDays: number;
  trigger: 'cron' | 'cron-intraday' | 'manual';
}

/**
 * Pulls attendance and leave from the configured provider into Postgres.
 * Idempotent: attendance upserts on (employee_id, date), leave on
 * (source, external_id), and a leave someone has already decided is left alone.
 */
@Injectable()
export class PeopleSyncService {
  private readonly logger = new Logger(PeopleSyncService.name);

  constructor(
    private readonly employees: EmployeesRepository,
    private readonly attendance: AttendanceRepository,
    private readonly queues: QueueService,
    @Inject(ATTENDANCE_PROVIDER) private readonly provider: AttendanceProvider,
  ) {}

  get source(): string {
    return this.provider.source;
  }

  async enqueue(
    lookbackDays = SYNC_DEFAULT_LOOKBACK_DAYS,
    trigger: PeopleSyncJobData['trigger'] = 'manual',
  ): Promise<SyncEnqueued> {
    if (!this.provider.canSync && this.provider.source !== 'none')
      throw new ConflictException(
        `The '${this.provider.source}' provider cannot sync yet: import its CSV export from the Attendance page`,
      );
    const data: PeopleSyncJobData = {
      entity: 'attendance',
      lookbackDays,
      trigger,
    };
    const job = await this.queues
      .get(QUEUES.PEOPLE_SYNC)
      .add(JOBS.SYNC_ATTENDANCE, data, this.queues.defaultJobOptions());
    return { queued: true, jobId: job.id ?? null, lookbackDays };
  }

  /** Nightly cron: the last 7 days, so yesterday's door log is complete. */
  enqueueDaily(): Promise<boolean> {
    return this.enqueueScheduled(SYNC_CRON_LOOKBACK_DAYS, 'cron');
  }

  /** Hourly office-hours cron: today only, so today's in/out shows up during the day. */
  enqueueIntraday(): Promise<boolean> {
    return this.enqueueScheduled(SYNC_INTRADAY_LOOKBACK_DAYS, 'cron-intraday');
  }

  /** Enqueue a scheduled window, unless a sync is already queued/running. */
  private async enqueueScheduled(
    lookbackDays: number,
    trigger: PeopleSyncJobData['trigger'],
  ): Promise<boolean> {
    if (!this.provider.canSync) {
      // `none`: nothing configured. `stellar`: no API client yet; rows come from the CSV import.
      if (this.provider.source !== 'none')
        this.logger.log(
          `Skipping scheduled ${JOBS.SYNC_ATTENDANCE}: provider '${this.provider.source}' cannot sync yet (use the CSV import)`,
        );
      return false;
    }
    const queue = this.queues.get(QUEUES.PEOPLE_SYNC);
    // Name-filtered busy check, as in XeroScheduler: jobId dedup cannot work for crons.
    const live = await queue.getJobs([
      'active',
      'waiting',
      'delayed',
      'prioritized',
    ]);
    if (live.some((j) => j?.name === JOBS.SYNC_ATTENDANCE)) {
      this.logger.warn(
        `Skipping ${JOBS.SYNC_ATTENDANCE}: the previous one is still in flight`,
      );
      return false;
    }
    await this.enqueue(lookbackDays, trigger);
    return true;
  }

  async run(lookbackDays: number): Promise<AttendanceSyncResult> {
    const to = dhakaDateOf(new Date());
    const from = addDays(to, -(lookbackDays - 1));
    const employees = await this.employees.listForSync(from, to);
    const result: AttendanceSyncResult = {
      source: this.provider.source,
      from,
      to,
      employees: employees.length,
      attendanceRows: 0,
      leavesCreated: 0,
      leavesUpdated: 0,
      leavesPreserved: 0,
    };
    if (employees.length === 0) return result;
    const attendanceSource = this.provider.attendanceSource;
    if (!this.provider.canSync || !attendanceSource) {
      this.logger.log(
        `attendance sync skipped: provider '${this.provider.source}' cannot sync yet`,
      );
      return result;
    }

    const idByEmail = new Map(
      employees.map((e) => [e.email.toLowerCase(), e.id]),
    );
    const fetched = await this.provider.fetch(
      employees.map((e) => ({
        email: e.email,
        joinDate: dateColumnToIso(e.joinDate),
        exitDate: e.exitDate ? dateColumnToIso(e.exitDate) : null,
      })),
      from,
      to,
    );

    // Last row wins per (employee, date): one INSERT cannot touch the same key twice.
    const attendance = new Map<string, AttendanceUpsert>();
    for (const row of fetched.attendance) {
      const employeeId = idByEmail.get(row.email.toLowerCase());
      if (!employeeId) continue;
      attendance.set(`${employeeId}|${row.date}`, {
        employeeId,
        date: row.date,
        firstIn: row.firstIn,
        lastOut: row.lastOut,
        minutesInOffice: minutesBetween(row.firstIn, row.lastOut),
        source: attendanceSource,
      });
    }
    result.attendanceRows = await this.attendance.upsertAttendance([
      ...attendance.values(),
    ]);

    // Simulated leave never lands on a day the door system has real data for:
    // an import already deleted those, and re-creating them would undo it.
    const real =
      attendanceSource === 'DUMMY'
        ? await this.attendance.realAttendanceKeys(
            [...idByEmail.values()],
            from,
            to,
          )
        : new Set<string>();
    const leaves = new Map<string, LeaveUpsert>();
    for (const row of fetched.leaves) {
      const employeeId = idByEmail.get(row.email.toLowerCase());
      if (!employeeId) continue;
      if (real.has(`${employeeId}|${row.startDate}`)) continue;
      const { email: _email, ...rest } = row;
      leaves.set(row.externalId, { ...rest, employeeId });
    }
    const leaveResult = await this.attendance.upsertProviderLeaves(
      this.provider.source,
      [...leaves.values()],
    );
    result.leavesCreated = leaveResult.created;
    result.leavesUpdated = leaveResult.updated;
    result.leavesPreserved = leaveResult.preserved;

    this.logger.log(
      `attendance sync (${result.source}) ${from}..${to}: ${result.employees} employees, ${result.attendanceRows} attendance rows, ` +
        `leave +${result.leavesCreated} ~${result.leavesUpdated} kept ${result.leavesPreserved}`,
    );
    return result;
  }
}

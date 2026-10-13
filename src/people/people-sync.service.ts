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
import {
  addDays,
  dateColumnToIso,
  dhakaDateOf,
  diffDays,
} from './people-dates';
import type { AttendanceSyncResult, SyncEnqueued } from './people.types';

export interface PeopleSyncJobData {
  entity: 'attendance';
  lookbackDays: number;
  trigger: 'cron' | 'cron-intraday' | 'manual';
  /**
   * An explicit window instead of the last `lookbackDays` days: set on the
   * follow-up job that fetches the older part of a window too long for one
   * provider call (`maxDaysPerFetch`).
   */
  from?: string;
  to?: string;
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

  /**
   * Default window of a manual sync: 90 days, or a week for a provider that can
   * only fetch a few days per rate-limited call (Stellar: 3 calls, ~11 minutes).
   */
  get defaultLookbackDays(): number {
    return this.provider.maxDaysPerFetch
      ? SYNC_CRON_LOOKBACK_DAYS
      : SYNC_DEFAULT_LOOKBACK_DAYS;
  }

  async enqueue(
    lookbackDays = this.defaultLookbackDays,
    trigger: PeopleSyncJobData['trigger'] = 'manual',
    window?: { from: string; to: string },
  ): Promise<SyncEnqueued> {
    if (!this.provider.canSync && this.provider.source !== 'none')
      throw new ConflictException(
        this.provider.source === 'stellar'
          ? 'Stellar HRM API credentials are not set (STELLAR_AUTH_USER, STELLAR_AUTH_CODE): import its CSV export from the Attendance page'
          : `The '${this.provider.source}' provider cannot sync yet: import its CSV export from the Attendance page`,
      );
    const data: PeopleSyncJobData = {
      entity: 'attendance',
      lookbackDays,
      trigger,
      ...(window ?? {}),
    };
    const job = await this.queues
      .get(QUEUES.PEOPLE_SYNC)
      .add(JOBS.SYNC_ATTENDANCE, data, this.queues.defaultJobOptions());
    return { queued: true, jobId: job.id ?? null, lookbackDays };
  }

  /** Nightly cron: the last 7 days, so yesterday's door log is complete. */
  /**
   * Nightly: the days up to and including yesterday, so yesterday is stored
   * complete and late punches of the days before are picked up. A week, or
   * for a provider limited per fetch (Stellar: 3 days) exactly one fetch.
   */
  enqueueDaily(): Promise<boolean> {
    const days = this.provider.maxDaysPerFetch ?? SYNC_CRON_LOOKBACK_DAYS;
    const to = addDays(dhakaDateOf(new Date()), -1);
    return this.enqueueScheduled(days, 'cron', {
      from: addDays(to, -(days - 1)),
      to,
    });
  }

  /** Hourly office-hours cron: today only, so today's in/out shows up during the day. */
  enqueueIntraday(): Promise<boolean> {
    return this.enqueueScheduled(SYNC_INTRADAY_LOOKBACK_DAYS, 'cron-intraday');
  }

  /** Enqueue a scheduled window, unless a sync is already queued/running. */
  private async enqueueScheduled(
    lookbackDays: number,
    trigger: PeopleSyncJobData['trigger'],
    window?: { from: string; to: string },
  ): Promise<boolean> {
    if (!this.provider.canSync) {
      // `none`: nothing configured. `stellar` without API credentials: rows come from the CSV import.
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
    await this.enqueue(lookbackDays, trigger, window);
    return true;
  }

  /**
   * Sync the last `lookbackDays` days, or `window` when given. A provider with
   * `maxDaysPerFetch` gets only the newest part of a longer window (so today
   * lands first); `remaining` is the older part, for a follow-up job.
   */
  async run(
    lookbackDays: number,
    window?: { from: string; to: string },
  ): Promise<AttendanceSyncResult> {
    const to = window?.to ?? dhakaDateOf(new Date());
    const requestedFrom = window?.from ?? addDays(to, -(lookbackDays - 1));
    const max = this.provider.maxDaysPerFetch;
    const from =
      max && diffDays(requestedFrom, to) + 1 > max
        ? addDays(to, -(max - 1))
        : requestedFrom;
    const remaining =
      from > requestedFrom
        ? { from: requestedFrom, to: addDays(from, -1) }
        : null;
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
      remaining,
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
        attendanceId: e.attendanceId,
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
        sessions: row.sessions,
        workedMinutes: row.workedMinutes,
        missingOut: row.missingOut,
        note: row.note,
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

    const unmatched = fetched.unmatchedIds?.length
      ? `, ${fetched.unmatchedIds.length} door id(s) matching no employee: ${fetched.unmatchedIds.join(', ')}`
      : '';
    this.logger.log(
      `attendance sync (${result.source}) ${from}..${to}: ${result.employees} employees, ${result.attendanceRows} attendance rows, ` +
        `leave +${result.leavesCreated} ~${result.leavesUpdated} kept ${result.leavesPreserved}${unmatched}` +
        (remaining ? `; ${remaining.from}..${remaining.to} follows` : ''),
    );
    return result;
  }
}

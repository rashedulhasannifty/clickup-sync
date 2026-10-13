import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PeopleSyncService } from './people-sync.service';

/** Team-local time, like XeroScheduler. Containers run UTC. */
const DHAKA = 'Asia/Dhaka';

/**
 * Crons only enqueue. Registered only in the worker role (ScheduleModule loads
 * there alone), so blue/green web instances never double-fire.
 */
@Injectable()
export class PeopleScheduler {
  constructor(private readonly sync: PeopleSyncService) {}

  /**
   * 01:00 Dhaka every day (weekends too: weekend work is recorded): yesterday's
   * door log is complete, and the office is closed. See `enqueueDaily`.
   */
  @Cron('0 0 1 * * *', { name: 'people-attendance-sync', timeZone: DHAKA })
  dailyAttendanceSync() {
    return this.sync.enqueueDaily();
  }

  /**
   * Every 15 minutes 09:00-23:45 Dhaka (the office runs until ~23:00), Mon-Fri:
   * re-sync today only, so the door log and "late today" are live instead of
   * appearing the next morning. One day is one Stellar call, well inside its
   * one-call-per-5-minutes limit; a run that finds the slot taken waits for it.
   */
  @Cron('0 */15 9-23 * * 1-5', { name: 'people-attendance-intraday', timeZone: DHAKA })
  intradayAttendanceSync() {
    return this.sync.enqueueIntraday();
  }
}

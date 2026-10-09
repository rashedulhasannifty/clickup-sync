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

  /** 00:30 Dhaka: yesterday's door log is complete, and it is inside the closed-office window. */
  @Cron('0 30 0 * * *', { name: 'people-attendance-sync', timeZone: DHAKA })
  dailyAttendanceSync() {
    return this.sync.enqueueDaily();
  }

  /**
   * :05 past each hour 09:00-20:00 Dhaka, Mon-Fri: re-sync today only, so the
   * door log and "late today" are live instead of appearing the next morning.
   * One day of rows is cheap enough for office hours.
   */
  @Cron('0 5 9-20 * * 1-5', { name: 'people-attendance-intraday', timeZone: DHAKA })
  intradayAttendanceSync() {
    return this.sync.enqueueIntraday();
  }
}

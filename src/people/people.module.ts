import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module';
import {
  resolveAttendanceProvider,
  type AttendanceProviderName,
} from '../config/env.validation';
import { isWorker } from '../config/role';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { QueuesModule } from '../queues/queues.module';
import { ATTENDANCE_PROVIDER } from './attendance-provider';
import { AttendanceRepository } from './attendance.repository';
import { DummyAttendanceProvider } from './dummy-attendance.provider';
import { EmployeesRepository } from './employees.repository';
import { EmployeesService } from './employees.service';
import { NoneAttendanceProvider } from './none-attendance.provider';
import { PeopleAttendanceController } from './people-attendance.controller';
import { PeopleAttendanceService } from './people-attendance.service';
import { PeopleEmployeesController } from './people-employees.controller';
import { PeopleMetricsRepository } from './people-metrics.repository';
import { PeopleSummaryService } from './people-summary.service';
import { PeopleSyncProcessor } from './people-sync.processor';
import { PeopleScheduler } from './people-sync.scheduler';
import { PeopleSyncService } from './people-sync.service';

@Module({
  // AuditLogInterceptor/AuditLogRepository come from AdminModule (see its exports).
  imports: [DatabaseModule, QueuesModule, JobsModule, AdminModule],
  controllers: [PeopleEmployeesController, PeopleAttendanceController],
  providers: [
    EmployeesRepository,
    AttendanceRepository,
    PeopleMetricsRepository,
    EmployeesService,
    PeopleSummaryService,
    PeopleAttendanceService,
    PeopleSyncService,
    {
      // The provider is chosen by env, not by code: ATTENDANCE_PROVIDER=dummy|none.
      // The real office-entry API becomes a third branch here; the tables do not change.
      provide: ATTENDANCE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const name = resolveAttendanceProvider(
          config.get<AttendanceProviderName>('ATTENDANCE_PROVIDER'),
          config.get<string>('NODE_ENV') ?? 'development',
        );
        return name === 'dummy'
          ? new DummyAttendanceProvider()
          : new NoneAttendanceProvider();
      },
    },
    // Consumers and crons run only in the worker role, like XeroModule / SyncModule:
    // a plain provider here would make the web process consume jobs and double-fire the cron.
    ...(isWorker() ? [PeopleSyncProcessor, PeopleScheduler] : []),
  ],
  exports: [EmployeesService],
})
export class PeopleModule {}

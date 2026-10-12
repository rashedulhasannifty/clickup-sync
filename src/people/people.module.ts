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
import { createAttendanceProvider } from './attendance-provider.factory';
import { AttendanceRepository } from './attendance.repository';
import { EmployeesRepository } from './employees.repository';
import { EmployeesService } from './employees.service';
import { OnboardingRepository } from './onboarding.repository';
import { OnboardingService } from './onboarding.service';
import { PeopleAttendanceController } from './people-attendance.controller';
import { PeopleAttendanceService } from './people-attendance.service';
import { PeopleEmployeesController } from './people-employees.controller';
import { PeopleOnboardingController } from './people-onboarding.controller';
import { PeopleMetricsRepository } from './people-metrics.repository';
import { PeopleSummaryService } from './people-summary.service';
import { PeopleSyncProcessor } from './people-sync.processor';
import { PeopleScheduler } from './people-sync.scheduler';
import { PeopleSyncService } from './people-sync.service';
import { PeopleShiftsController } from './people-shifts.controller';
import { ShiftsRepository } from './shifts.repository';
import { ShiftsService } from './shifts.service';
import { StellarImportService } from './stellar/stellar-import.service';

@Module({
  // AuditLogInterceptor/AuditLogRepository come from AdminModule (see its exports).
  imports: [DatabaseModule, QueuesModule, JobsModule, AdminModule],
  controllers: [
    PeopleEmployeesController,
    PeopleAttendanceController,
    PeopleOnboardingController,
    PeopleShiftsController,
  ],
  providers: [
    EmployeesRepository,
    AttendanceRepository,
    PeopleMetricsRepository,
    OnboardingRepository,
    OnboardingService,
    EmployeesService,
    PeopleSummaryService,
    PeopleAttendanceService,
    PeopleSyncService,
    ShiftsRepository,
    ShiftsService,
    StellarImportService,
    {
      // The provider is chosen by env, not by code: ATTENDANCE_PROVIDER=dummy|none|stellar.
      provide: ATTENDANCE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const name = resolveAttendanceProvider(
          config.get<AttendanceProviderName>('ATTENDANCE_PROVIDER'),
          config.get<string>('NODE_ENV') ?? 'development',
        );
        return createAttendanceProvider(name);
      },
    },
    // Consumers and crons run only in the worker role, like XeroModule / SyncModule:
    // a plain provider here would make the web process consume jobs and double-fire the cron.
    ...(isWorker() ? [PeopleSyncProcessor, PeopleScheduler] : []),
  ],
  // OnboardingService: the exit flow reads `issuedEquipment` to pre-fill what to collect back.
  exports: [EmployeesService, PeopleSummaryService, OnboardingService],
})
export class PeopleModule {}

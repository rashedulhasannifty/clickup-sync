import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { DatabaseModule } from '../database/database.module';
import { PeopleModule } from '../people/people.module';
import { AppraisalsController } from './appraisals.controller';
import { AppraisalsRepository } from './appraisals.repository';
import { AppraisalsService } from './appraisals.service';

@Module({
  // AuditLogInterceptor/AuditLogRepository come from AdminModule (see its exports).
  // EmployeesService (sign-off events) and PeopleSummaryService (KPI snapshots) come from PeopleModule.
  imports: [DatabaseModule, AdminModule, PeopleModule],
  controllers: [AppraisalsController],
  providers: [AppraisalsRepository, AppraisalsService],
})
export class AppraisalsModule {}

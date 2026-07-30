import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { BudgetsModule } from '../budgets/budgets.module';
import { TasksReportService } from './tasks-report.service';
import { TimeEntriesReportService } from './time-entries-report.service';
import { CostTrendReportService } from './cost-trend-report.service';
import { CycleTimeReportService } from './cycle-time-report.service';
import { AnomalyReportService } from './anomaly-report.service';
import { OpsReportService } from './ops-report.service';
import { SprintsReportService } from './sprints-report.service';

@Module({
  imports: [BudgetsModule],
  providers: [
    TasksReportService,
    TimeEntriesReportService,
    CostTrendReportService,
    CycleTimeReportService,
    AnomalyReportService,
    OpsReportService,
    SprintsReportService,
  ],
  controllers: [ReportsController],
})
export class ReportsModule {}

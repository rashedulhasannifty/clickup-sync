import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { QueuesModule } from '../queues/queues.module';
import { TasksModule } from '../tasks/tasks.module';
import { TimeEntriesRepository } from './time-entries.repository';
import { TimeEntryReplacementsRepository } from './time-entry-replacements.repository';
import { TagAssigneeMapRepository } from './tag-assignee-map.repository';
import { CostCalculatorService } from './cost-calculator.service';
import { CostRecalculationService } from './cost-recalculation.service';
import { TimeEntriesService } from './time-entries.service';
import { AssigneeReplacementService } from './assignee-replacement.service';
import { TaskReconciliationService } from './task-reconciliation.service';

@Module({
  imports: [ClickupModule, QueuesModule, TasksModule],
  providers: [TimeEntriesRepository, TimeEntryReplacementsRepository, TagAssigneeMapRepository, CostCalculatorService, CostRecalculationService, TimeEntriesService, AssigneeReplacementService, TaskReconciliationService],
  exports: [TimeEntriesService, TimeEntriesRepository, TimeEntryReplacementsRepository, TagAssigneeMapRepository, CostCalculatorService, CostRecalculationService, AssigneeReplacementService, TaskReconciliationService],
})
export class TimeEntriesModule {}

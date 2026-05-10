import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { QueuesModule } from '../queues/queues.module';
import { TimeEntriesRepository } from './time-entries.repository';
import { TimeEntryReplacementsRepository } from './time-entry-replacements.repository';
import { TagAssigneeMapRepository } from './tag-assignee-map.repository';
import { CostCalculatorService } from './cost-calculator.service';
import { TimeEntriesService } from './time-entries.service';
import { AssigneeReplacementService } from './assignee-replacement.service';

@Module({
  imports: [ClickupModule, QueuesModule],
  providers: [TimeEntriesRepository, TimeEntryReplacementsRepository, TagAssigneeMapRepository, CostCalculatorService, TimeEntriesService, AssigneeReplacementService],
  exports: [TimeEntriesService, TimeEntriesRepository, TimeEntryReplacementsRepository, TagAssigneeMapRepository, CostCalculatorService, AssigneeReplacementService],
})
export class TimeEntriesModule {}

import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { TimeEntriesRepository } from './time-entries.repository';
import { CostCalculatorService } from './cost-calculator.service';
import { TimeEntriesService } from './time-entries.service';

@Module({ imports: [ClickupModule], providers: [TimeEntriesRepository, CostCalculatorService, TimeEntriesService], exports: [TimeEntriesService, TimeEntriesRepository, CostCalculatorService] })
export class TimeEntriesModule {}

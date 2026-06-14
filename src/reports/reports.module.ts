import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { BudgetsModule } from '../budgets/budgets.module';

@Module({
  imports: [BudgetsModule],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}

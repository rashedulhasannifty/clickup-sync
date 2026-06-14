import { Module } from '@nestjs/common';
import { BudgetsRepository } from './budgets.repository';
import { BudgetsService } from './budgets.service';

@Module({
  providers: [BudgetsRepository, BudgetsService],
  exports: [BudgetsService, BudgetsRepository],
})
export class BudgetsModule {}

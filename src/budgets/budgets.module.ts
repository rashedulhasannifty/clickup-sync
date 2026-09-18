import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { BudgetsRepository } from './budgets.repository';
import { BudgetsService } from './budgets.service';

@Module({
  imports: [ClientsModule],
  providers: [BudgetsRepository, BudgetsService],
  exports: [BudgetsService, BudgetsRepository],
})
export class BudgetsModule {}

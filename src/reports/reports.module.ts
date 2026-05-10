import { Module } from '@nestjs/common';
import { AdminApiKeyGuard } from '../admin/admin-api-key.guard';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  providers: [AdminApiKeyGuard, ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}

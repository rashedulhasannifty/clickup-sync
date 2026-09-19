import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { AccessScopeService } from './access-scope.service';
import { AccessScopeGuard } from './access-scope.guard';
import { ChargeabilityAccessService } from './chargeability-access.service';

@Global()
@Module({
  imports: [DatabaseModule, SettingsModule],
  providers: [AccessScopeService, AccessScopeGuard, ChargeabilityAccessService],
  exports: [AccessScopeService, AccessScopeGuard, ChargeabilityAccessService],
})
export class AccessModule {}

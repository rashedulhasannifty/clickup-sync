import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { AccessScopeService } from './access-scope.service';
import { AccessScopeGuard } from './access-scope.guard';

@Global()
@Module({
  imports: [DatabaseModule, SettingsModule],
  providers: [AccessScopeService, AccessScopeGuard],
  exports: [AccessScopeService, AccessScopeGuard],
})
export class AccessModule {}

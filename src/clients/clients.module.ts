import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { ClientOptionsRepository } from './client-options.repository';
import { ClientOptionsService } from './client-options.service';
import { ClientNameResolver } from './client-name.resolver';

@Module({
  imports: [ClickupModule, DatabaseModule, SettingsModule],
  providers: [ClientOptionsRepository, ClientOptionsService, ClientNameResolver],
  exports: [ClientOptionsRepository, ClientOptionsService, ClientNameResolver],
})
export class ClientsModule {}

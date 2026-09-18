import { Module } from '@nestjs/common';
import { ClickupModule } from '../clickup/clickup.module';
import { DatabaseModule } from '../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { ClientOptionsRepository } from './client-options.repository';
import { ClientOptionsService } from './client-options.service';

@Module({
  imports: [ClickupModule, DatabaseModule, SettingsModule],
  providers: [ClientOptionsRepository, ClientOptionsService],
  exports: [ClientOptionsRepository, ClientOptionsService],
})
export class ClientsModule {}

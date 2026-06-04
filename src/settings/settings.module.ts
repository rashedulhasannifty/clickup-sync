import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [CryptoService, SettingsRepository, SettingsService],
  exports: [CryptoService, SettingsService],
})
export class SettingsModule {}

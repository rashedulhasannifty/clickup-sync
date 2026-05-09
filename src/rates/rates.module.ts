import { Module } from '@nestjs/common';
import { RatesRepository } from './rates.repository';
import { GoogleSheetsRatesService } from './google-sheets-rates.service';
import { RatesService } from './rates.service';

@Module({ providers: [RatesRepository, GoogleSheetsRatesService, RatesService], exports: [RatesService, RatesRepository] })
export class RatesModule {}

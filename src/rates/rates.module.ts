import { Module } from '@nestjs/common';
import { RatesRepository } from './rates.repository';
import { RatesService } from './rates.service';

@Module({ providers: [RatesRepository, RatesService], exports: [RatesService, RatesRepository] })
export class RatesModule {}

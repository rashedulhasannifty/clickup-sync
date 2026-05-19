import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { RatesRepository } from './rates.repository';
import { RatesService } from './rates.service';

@Module({ imports: [QueuesModule], providers: [RatesRepository, RatesService], exports: [RatesService, RatesRepository] })
export class RatesModule {}

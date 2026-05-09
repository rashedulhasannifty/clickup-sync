import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { QUEUES } from '../queues/queue.constants';
import { RatesService } from '../rates/rates.service';

@Injectable()
@Processor(QUEUES.ASSIGNEE_RATES)
export class RatesSyncProcessor extends WorkerHost {
  constructor(private readonly rates: RatesService) { super(); }
  async process() { return this.rates.syncRates(); }
}

import { Injectable, Logger } from '@nestjs/common';
import { RatesRepository } from './rates.repository';

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  constructor(private readonly repo: RatesRepository) {}

  syncRates() {
    this.logger.log('Google Sheets rate sync removed — manage rates via /admin/rates API');
    return 0;
  }
}

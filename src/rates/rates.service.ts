import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsRatesService, SheetRateRow } from './google-sheets-rates.service';
import { RatesRepository } from './rates.repository';

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  constructor(private readonly sheets: GoogleSheetsRatesService, private readonly repo: RatesRepository) {}

  async syncRates() {
    const rows = await this.sheets.readRates();
    let count = 0;
    for (const row of rows) {
      const normalized = this.normalize(row);
      if (!normalized) continue;
      await this.repo.upsert(normalized);
      count += 1;
    }
    this.logger.log(`Synced ${count} assignee rates`);
    return count;
  }

  private normalize(row: SheetRateRow) {
    if (!row.assignee_id || !row.valid_from) return null;
    const hourlyRateCents = BigInt(Number.parseInt(row.hourly_rate_cents, 10));
    if (hourlyRateCents < 0n) return null;
    const validFrom = this.parseDate(row.valid_from);
    if (!validFrom) return null;
    const validTo = row.valid_to ? this.parseDate(row.valid_to) : null;
    return { assigneeId: String(row.assignee_id).trim(), assigneeName: row.assignee_name?.trim(), assigneeEmail: row.assignee_email?.trim(), currency: row.currency?.trim() || 'AUD', hourlyRateCents, validFrom, validTo };
  }
  private parseDate(value: string) { const d = new Date(`${String(value).slice(0,10)}T00:00:00.000Z`); return Number.isNaN(d.getTime()) ? null : d; }
}

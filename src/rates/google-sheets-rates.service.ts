import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';

export interface SheetRateRow { assignee_id: string; assignee_name?: string; assignee_email?: string; currency?: string; hourly_rate_cents: string; valid_from: string; valid_to?: string; }

@Injectable()
export class GoogleSheetsRatesService {
  private readonly logger = new Logger(GoogleSheetsRatesService.name);
  async readRates(): Promise<SheetRateRow[]> {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const spreadsheetId = process.env.GOOGLE_RATES_SHEET_ID;
    if (!email || !key || !spreadsheetId) {
      this.logger.warn('Google Sheets credentials not configured; skipping rate sync');
      return [];
    }
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const sheets = google.sheets({ version: 'v4', auth });
    const range = `${process.env.GOOGLE_RATES_SHEET_NAME || 'rates'}!A:G`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values || [];
    const [header, ...data] = rows;
    if (!header) return [];
    return data.map((row) => Object.fromEntries(header.map((key, i) => [key, row[i] || '']))) as SheetRateRow[];
  }
}

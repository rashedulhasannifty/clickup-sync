import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class SummaryQuery {
  @ApiPropertyOptional({
    example: '2026-07-10',
    description: 'Default: 89 days before `to` (a 90-day period).',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-07',
    description: 'Default: today (Dhaka).',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  to?: string;
}

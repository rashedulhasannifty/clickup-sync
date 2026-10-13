import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  SYNC_DEFAULT_LOOKBACK_DAYS,
  SYNC_MAX_LOOKBACK_DAYS,
} from '../people.constants';

export class SyncAttendanceDto {
  @ApiPropertyOptional({
    description: `Default ${SYNC_DEFAULT_LOOKBACK_DAYS}; 7 for Stellar HRM (a few days per rate-limited call).`,
    maximum: SYNC_MAX_LOOKBACK_DAYS,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SYNC_MAX_LOOKBACK_DAYS)
  lookbackDays?: number;
}

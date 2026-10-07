import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  SYNC_DEFAULT_LOOKBACK_DAYS,
  SYNC_MAX_LOOKBACK_DAYS,
} from '../people.constants';

export class SyncAttendanceDto {
  @ApiPropertyOptional({
    default: SYNC_DEFAULT_LOOKBACK_DAYS,
    maximum: SYNC_MAX_LOOKBACK_DAYS,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SYNC_MAX_LOOKBACK_DAYS)
  lookbackDays?: number;
}

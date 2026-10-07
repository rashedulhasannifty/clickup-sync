import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class ListLeavesQuery {
  @ApiPropertyOptional({
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Leaves that end on or after this date.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Leaves that start on or before this date.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() employeeId?: string;
}

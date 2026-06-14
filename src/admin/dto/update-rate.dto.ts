import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRateDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  assigneeName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  assigneeEmail?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: 'Hourly rate in cents' })
  @IsInt()
  @Min(0)
  @IsOptional()
  hourlyRateCents?: number;

  @ApiPropertyOptional({ description: 'Effective from date (ISO 8601)' })
  @IsISO8601()
  @IsOptional()
  validFrom?: string;

  @ApiPropertyOptional({ description: 'Effective until date (ISO 8601). Send null to make open-ended.' })
  @IsISO8601()
  @IsOptional()
  validTo?: string | null;
}

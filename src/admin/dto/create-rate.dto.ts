import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { IsDateOnOrAfter } from './is-date-on-or-after.validator';

export class CreateRateDto {
  @ApiProperty({ description: 'ClickUp user ID of the assignee' })
  @IsString()
  @IsNotEmpty()
  assigneeId!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  assigneeName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  assigneeEmail?: string;

  @ApiProperty({ default: 'USD' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({ description: 'Hourly rate in cents, e.g. 15000 = $150.00/hr', example: 15000 })
  @IsInt()
  @Min(0)
  hourlyRateCents!: number;

  @ApiProperty({ description: 'Effective from date (ISO 8601 date)', example: '2024-01-01' })
  @IsISO8601()
  validFrom!: string;

  @ApiPropertyOptional({ description: 'Effective until date (ISO 8601). Omit for open-ended.', example: '2024-12-31' })
  @IsISO8601()
  @IsOptional()
  @IsDateOnOrAfter('validFrom')
  validTo?: string;
}

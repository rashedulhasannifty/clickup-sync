import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional, IsString, Min } from 'class-validator';

export class UpdateClientBudgetDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  client?: string;

  @ApiPropertyOptional({ description: 'Monthly budget in cents' })
  @IsInt()
  @Min(0)
  @IsOptional()
  monthlyAmountCents?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: 'Effective from date (ISO 8601)' })
  @IsISO8601()
  @IsOptional()
  validFrom?: string;

  @ApiPropertyOptional({ description: 'Effective until date (ISO 8601). Send null to make open-ended.' })
  @IsISO8601()
  @IsOptional()
  validTo?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string | null;
}

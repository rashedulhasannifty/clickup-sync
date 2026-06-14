import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateClientBudgetDto {
  @ApiProperty({ description: 'Client name (matches clickup_tasks.client)' })
  @IsString()
  @IsNotEmpty()
  client!: string;

  @ApiProperty({ description: 'Monthly budget in cents, e.g. 2000000 = $20,000.00', example: 2000000 })
  @IsInt()
  @Min(0)
  monthlyAmountCents!: number;

  @ApiProperty({ default: 'USD' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({ description: 'Effective from date (ISO 8601 date)', example: '2026-01-01' })
  @IsISO8601()
  validFrom!: string;

  @ApiPropertyOptional({ description: 'Effective until date (ISO 8601). Omit for open-ended.', example: '2026-12-31' })
  @IsISO8601()
  @IsOptional()
  validTo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}

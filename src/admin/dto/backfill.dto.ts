import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class BackfillDto {
  @ApiProperty({ example: '3577824', description: 'ClickUp space ID' })
  @IsString()
  @MinLength(1)
  spaceId!: string;

  @ApiPropertyOptional({ example: 90, minimum: 1, maximum: 365, description: 'Defaults to the configured lookback for the space (or 30 days for unknown spaces)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  lookbackDays?: number;

  @ApiPropertyOptional({ example: true, description: 'Allow backfill of space IDs not in the configured spaces list (useful for testing)' })
  @IsOptional()
  @IsBoolean()
  allowUnknownSpaces?: boolean;
}

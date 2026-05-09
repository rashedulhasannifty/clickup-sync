import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class BackfillDto {
  @ApiProperty({ example: '3577824', description: 'ClickUp space ID — must be one of the configured spaces' })
  @IsString()
  @MinLength(1)
  spaceId!: string;

  @ApiPropertyOptional({ example: 90, minimum: 1, maximum: 365, description: 'Defaults to the configured lookback for the space' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @Type(() => Number)
  lookbackDays?: number;
}

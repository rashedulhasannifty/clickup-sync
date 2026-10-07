import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CompetencyDto {
  @ApiProperty({ example: 'technical_skill' })
  @IsString()
  @MaxLength(40)
  key!: string;

  @ApiProperty({ example: 'Technical skill' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;
}

export class CreateCycleDto {
  @ApiProperty({ example: 'H2 2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '2026-07-01' })
  @Matches(DATE_ONLY, { message: 'periodStart must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  periodStart!: string;

  @ApiProperty({ example: '2026-12-31' })
  @Matches(DATE_ONLY, { message: 'periodEnd must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  periodEnd!: string;

  @ApiPropertyOptional({
    default: 70,
    description: 'Percent of the final score that comes from the KPIs.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kpiWeight?: number;

  @ApiPropertyOptional({ type: [CompetencyDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CompetencyDto)
  competencies?: CompetencyDto[];
}

export class UpdateCycleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'periodStart must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  periodStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'periodEnd must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  periodEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kpiWeight?: number;

  @ApiPropertyOptional({ type: [CompetencyDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CompetencyDto)
  competencies?: CompetencyDto[];

  @ApiPropertyOptional({ enum: ['DRAFT', 'OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'OPEN', 'CLOSED'])
  status?: 'DRAFT' | 'OPEN' | 'CLOSED';
}

export class LaunchCycleDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Default: every non-EXITED employee who joined on or before the period end.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  employeeIds?: string[];
}

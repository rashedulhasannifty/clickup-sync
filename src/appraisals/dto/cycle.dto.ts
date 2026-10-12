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

  @ApiPropertyOptional({
    description: 'What the criterion measures (shown beside the rating).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export const APPRAISAL_TYPES = [
  'HALF_YEARLY',
  'CONFIRMATION',
  'YEARLY',
] as const;
export const SCORING_MODES = ['FORM_100', 'KPI_BLEND'] as const;

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

  @ApiPropertyOptional({ enum: APPRAISAL_TYPES, default: 'YEARLY' })
  @IsOptional()
  @IsIn(APPRAISAL_TYPES)
  type?: (typeof APPRAISAL_TYPES)[number];

  @ApiPropertyOptional({
    enum: SCORING_MODES,
    default: 'FORM_100',
    description:
      'FORM_100: the paper form (10 criteria x 10 marks, A-F grade; KPIs shown as a reference). KPI_BLEND: the legacy 0-5 blend.',
  })
  @IsOptional()
  @IsIn(SCORING_MODES)
  scoringMode?: (typeof SCORING_MODES)[number];

  @ApiPropertyOptional({
    default: 70,
    description: 'Percent of the final score that comes from the KPIs.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kpiWeight?: number;

  @ApiPropertyOptional({
    type: [CompetencyDto],
    description:
      'Default: the paper form 10 criteria (FORM_100) or the four legacy competencies (KPI_BLEND).',
  })
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

  @ApiPropertyOptional({
    enum: APPRAISAL_TYPES,
    description: 'Locked once appraisals have been launched.',
  })
  @IsOptional()
  @IsIn(APPRAISAL_TYPES)
  type?: (typeof APPRAISAL_TYPES)[number];

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

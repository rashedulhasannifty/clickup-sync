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
  'INTERNSHIP',
] as const;
export const SCORING_MODES = ['FORM_100', 'KPI_BLEND'] as const;
export const PERIOD_BASES = ['JOIN_DATE', 'CALENDAR'] as const;

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
    enum: APPRAISAL_TYPES,
    default: 'YEARLY',
    description:
      'INTERNSHIP: interns only, due at the internship end; needs scoringMode FORM_100 and periodBasis JOIN_DATE.',
  })
  @IsOptional()
  @IsIn(APPRAISAL_TYPES)
  type?: (typeof APPRAISAL_TYPES)[number];

  @ApiPropertyOptional({
    enum: PERIOD_BASES,
    default: 'JOIN_DATE',
    description:
      'JOIN_DATE: appraisals are counted from each employee’s join date and periodStart/periodEnd mean "due between"; each appraisal gets its own review period. CALENDAR: the period is everyone’s review period.',
  })
  @IsOptional()
  @IsIn(PERIOD_BASES)
  periodBasis?: (typeof PERIOD_BASES)[number];

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
      'Default: the six internship criteria (INTERNSHIP), the paper form 10 criteria (FORM_100) or the four legacy competencies (KPI_BLEND).',
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

  @ApiPropertyOptional({
    enum: PERIOD_BASES,
    description: 'Locked once appraisals have been launched.',
  })
  @IsOptional()
  @IsIn(PERIOD_BASES)
  periodBasis?: (typeof PERIOD_BASES)[number];

  @ApiPropertyOptional({ enum: ['DRAFT', 'OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'OPEN', 'CLOSED'])
  status?: 'DRAFT' | 'OPEN' | 'CLOSED';
}

export class LaunchCycleDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Default: calendar cycles, every non-EXITED employee who joined on or before the period end; join-date cycles, everyone due in the window. An explicit selection on a join-date cycle uses each employee’s latest due date on or before the period end; anyone with none is reported in notDue.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  employeeIds?: string[];
}

/** `GET /people/appraisal-cycles/due`: who is due a `type` appraisal between `from` and `to`. */
export class DueQuery {
  @ApiProperty({ enum: APPRAISAL_TYPES })
  @IsIn(APPRAISAL_TYPES)
  type!: (typeof APPRAISAL_TYPES)[number];

  @ApiProperty({ example: '2026-10-01' })
  @Matches(DATE_ONLY, { message: 'from must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-10-31' })
  @Matches(DATE_ONLY, { message: 'to must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  to!: string;
}

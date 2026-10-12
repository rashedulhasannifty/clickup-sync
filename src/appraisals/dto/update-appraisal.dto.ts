import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const RECOMMENDATIONS = [
  'PROMOTE',
  'RAISE',
  'NO_CHANGE',
  'IMPROVEMENT_PLAN',
] as const;

export const APPRAISAL_ACTIONS = [
  'CONFIRM',
  'INCREMENT',
  'PROMOTION',
  'TERMINATION',
  'DISMISSAL',
  'TRAINING_TRANSFER',
] as const;

export const APPROVAL_DECISIONS = ['APPROVED', 'NOT_APPROVED'] as const;

export const EFFECTIVE_DATE_MODES = [
  'DUE_DATE',
  'APPROVAL_DATE',
  'CUSTOM',
] as const;

export const INTERNSHIP_OUTCOMES = [
  'MOVE_TO_PROBATION',
  'EXTEND_INTERNSHIP',
  'END_INTERNSHIP',
] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const TEXT = 5000;

/**
 * Step fields. Which of them the current step accepts is decided by the
 * service (`editableFields`), not here; a field outside the step is a 400.
 * `null` clears a nullable field; an absent field is left alone.
 */
export class UpdateAppraisalDto {
  @ApiPropertyOptional({
    description:
      '`{ [competencyKey]: rating }` (1-5, or 2/4/6/8/10 on the paper form); replaces the whole map.',
  })
  @IsOptional()
  @IsObject()
  selfRatings?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  selfComment?: string | null;

  @ApiPropertyOptional({
    description:
      '`{ [competencyKey]: rating }` (1-5, or 2/4/6/8/10 on the paper form); replaces the whole map.',
  })
  @IsOptional()
  @IsObject()
  leadRatings?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  leadComment?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  strengths?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  improvements?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  goals?: string | null;

  @ApiPropertyOptional({ enum: RECOMMENDATIONS, nullable: true })
  @IsOptional()
  @IsIn(RECOMMENDATIONS)
  recommendation?: (typeof RECOMMENDATIONS)[number] | null;

  @ApiPropertyOptional({ description: 'Required for PROMOTE.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  newDesignation?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  calibrationNote?: string | null;

  @ApiPropertyOptional({ description: '0-5; replaces the computed score.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(5)
  calibratedScore?: number | null;

  // --- FORM_100 ---

  @ApiPropertyOptional({
    enum: APPRAISAL_ACTIONS,
    isArray: true,
    description:
      'Recommendations by supervisor / department head; replaces the whole list. PROMOTION needs newDesignation, INCREMENT needs incrementPercent.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(APPRAISAL_ACTIONS.length)
  @ArrayUnique()
  @IsIn(APPRAISAL_ACTIONS, { each: true })
  actions?: (typeof APPRAISAL_ACTIONS)[number][];

  @ApiPropertyOptional({
    description: 'Proposed increment, percent (0-100, up to 2 decimals).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  incrementPercent?: number | null;

  @ApiPropertyOptional({ description: 'Training need / development plan.' })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  trainingPlan?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  deptHeadComment?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  hrComment?: string | null;

  @ApiPropertyOptional({ enum: APPROVAL_DECISIONS, nullable: true })
  @IsOptional()
  @IsIn(APPROVAL_DECISIONS)
  approvalDecision?: (typeof APPROVAL_DECISIONS)[number] | null;

  @ApiPropertyOptional({ description: 'Approval & comments by CTO/COO.' })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT)
  approvalComment?: string | null;

  @ApiPropertyOptional({
    enum: EFFECTIVE_DATE_MODES,
    nullable: true,
    description:
      'Final approval: from when an approved outcome takes effect. Null = the default (DUE_DATE when the appraisal is late, else APPROVAL_DATE). CUSTOM needs effectiveDate.',
  })
  @IsOptional()
  @IsIn(EFFECTIVE_DATE_MODES)
  effectiveDateMode?: (typeof EFFECTIVE_DATE_MODES)[number] | null;

  @ApiPropertyOptional({
    example: '2026-01-15',
    nullable: true,
    description:
      'CUSTOM only: the effective date, on or after the review period start.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'effectiveDate must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  effectiveDate?: string | null;

  // --- INTERNSHIP reviews ---

  @ApiPropertyOptional({
    enum: INTERNSHIP_OUTCOMES,
    nullable: true,
    description:
      'Internship reviews only, at LEAD_REVIEW: exactly one recommendation. Choosing MOVE_TO_PROBATION defaults proposedProbationStart to the day after the due date.',
  })
  @IsOptional()
  @IsIn(INTERNSHIP_OUTCOMES)
  internshipOutcome?: (typeof INTERNSHIP_OUTCOMES)[number] | null;

  @ApiPropertyOptional({
    example: '2026-04-01',
    nullable: true,
    description:
      'MOVE_TO_PROBATION only: when probation starts (not before the join date).',
  })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'proposedProbationStart must be a YYYY-MM-DD date',
  })
  @IsISO8601({ strict: true })
  proposedProbationStart?: string | null;

  @ApiPropertyOptional({
    example: '2026-05-31',
    nullable: true,
    description:
      'EXTEND_INTERNSHIP only: the new internship end, later than the current one.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'proposedInternshipEnd must be a YYYY-MM-DD date',
  })
  @IsISO8601({ strict: true })
  proposedInternshipEnd?: string | null;

  // --- the appraisal's own dates (any step before sign-off) ---

  @ApiPropertyOptional({
    example: '2026-01-15',
    description:
      'Adjust the due date (an early or late appraisal). Never before joining; the review period must end on or before it.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dueDate must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  dueDate?: string;

  @ApiPropertyOptional({
    example: '2025-07-15',
    description:
      'Adjust the review period start: not before joining, not after periodEnd. The KPI snapshot is recomputed when the period changes.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'periodStart must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  periodStart?: string;

  @ApiPropertyOptional({
    example: '2026-01-14',
    description: 'Adjust the review period end: on or before the due date.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'periodEnd must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  periodEnd?: string;
}

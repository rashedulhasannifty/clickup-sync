import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
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
}

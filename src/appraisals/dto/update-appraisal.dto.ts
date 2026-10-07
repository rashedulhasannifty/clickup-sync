import { ApiPropertyOptional } from '@nestjs/swagger';
import {
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

const TEXT = 5000;

/**
 * Step fields. Which of them the current step accepts is decided by the
 * service (`editableFields`), not here; a field outside the step is a 400.
 * `null` clears a nullable field; an absent field is left alone.
 */
export class UpdateAppraisalDto {
  @ApiPropertyOptional({
    description: '`{ [competencyKey]: 1-5 }`; replaces the whole map.',
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
    description: '`{ [competencyKey]: 1-5 }`; replaces the whole map.',
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
}

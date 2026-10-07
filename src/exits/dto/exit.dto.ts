import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EXIT_TYPES, type ExitTypeValue } from '../exit-status';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a YYYY-MM-DD date';

export const INTERVIEW_REASONS = [
  'CAREER_GROWTH',
  'COMPENSATION',
  'MANAGEMENT',
  'WORK_LIFE_BALANCE',
  'RELOCATION',
  'STUDIES',
  'OTHER',
] as const;
export const EXIT_ANSWERS = ['YES', 'MAYBE', 'NO'] as const;
export const LETTER_KINDS = ['experience', 'release'] as const;
export const EXIT_LIST_STATUSES = [
  'active',
  'NOTICE',
  'INTERVIEW',
  'CLEARANCE',
  'COMPLETED',
  'CANCELLED',
] as const;

export class StartExitDto {
  @ApiProperty({ enum: EXIT_TYPES })
  @IsIn(EXIT_TYPES)
  type!: ExitTypeValue;

  @ApiProperty({ example: '2026-10-01', description: 'When notice was given.' })
  @Matches(DATE_RE, { message: `noticeDate ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  noticeDate!: string;

  @ApiProperty({ example: '2026-10-31' })
  @Matches(DATE_RE, { message: `lastWorkingDay ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  lastWorkingDay!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class UpdateExitDto {
  @ApiPropertyOptional({ enum: EXIT_TYPES })
  @IsOptional()
  @IsIn(EXIT_TYPES)
  type?: ExitTypeValue;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_RE, { message: `noticeDate ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  noticeDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_RE, { message: `lastWorkingDay ${DATE_MESSAGE}` })
  @IsISO8601({ strict: true })
  lastWorkingDay?: string;

  @ApiPropertyOptional({ description: '`null` clears the reason.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string | null;
}

export class SaveInterviewDto {
  @ApiPropertyOptional({ enum: INTERVIEW_REASONS })
  @IsOptional()
  @IsIn(INTERVIEW_REASONS)
  primaryReason?: (typeof INTERVIEW_REASONS)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'Your role and work.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ratingRole?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'Team lead.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ratingTeamLead?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ratingCompensation?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ratingGrowth?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ratingEnvironment?: number;

  @ApiPropertyOptional({ description: 'What could we have done to keep you?' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  couldHaveDone?: string;

  @ApiPropertyOptional({ enum: EXIT_ANSWERS })
  @IsOptional()
  @IsIn(EXIT_ANSWERS)
  wouldRecommend?: (typeof EXIT_ANSWERS)[number];

  @ApiPropertyOptional({ enum: EXIT_ANSWERS })
  @IsOptional()
  @IsIn(EXIT_ANSWERS)
  wouldRejoin?: (typeof EXIT_ANSWERS)[number];

  @ApiPropertyOptional({ description: 'Interviewer notes. HR only.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class AddClearanceItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;
}

export class UpdateClearanceItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ description: '`null` clears the note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class CompleteExitDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Disable the linked login and revoke its sessions. No effect when no login is linked.',
  })
  @IsOptional()
  @IsBoolean()
  disableLogin?: boolean;

  @ApiPropertyOptional({
    description: 'Required to complete while clearance items are still open; kept on the exit.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  overrideNote?: string;
}

export class CancelExitDto {
  @ApiProperty({ description: 'Why the offboarding was cancelled; goes on the NOTE event.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note!: string;
}

export class ListExitsQuery {
  @ApiPropertyOptional({
    enum: EXIT_LIST_STATUSES,
    description: '`active` = NOTICE, INTERVIEW and CLEARANCE. Omit for all.',
  })
  @IsOptional()
  @IsIn(EXIT_LIST_STATUSES)
  status?: (typeof EXIT_LIST_STATUSES)[number];
}

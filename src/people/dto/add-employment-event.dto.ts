import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * JOINED is written by creating the employee; NOTICE_GIVEN and EXITED by the offboarding flow
 * (`EmployeesService.recordExitEvent`). None of them can be added by hand.
 */
export const MANUAL_EVENT_TYPES = [
  'CONFIRMED',
  'PROMOTED',
  'DESIGNATION_CHANGED',
  'TRANSFERRED',
  'NOTE',
  'PROBATION_STARTED',
  'INTERNSHIP_EXTENDED',
] as const;

export type ManualEventType = (typeof MANUAL_EVENT_TYPES)[number];

export class AddEmploymentEventDto {
  @ApiProperty({ enum: MANUAL_EVENT_TYPES })
  @IsIn(MANUAL_EVENT_TYPES, {
    message: `type must be one of: ${MANUAL_EVENT_TYPES.join(', ')}. To give notice or record an exit, use Start offboarding on the employee page.`,
  })
  type!: ManualEventType;

  @ApiProperty({ example: '2026-04-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'effectiveDate must be a YYYY-MM-DD date',
  })
  @IsISO8601({ strict: true })
  effectiveDate!: string;

  @ApiPropertyOptional({
    description:
      'Defaults to the current designation / team id for the events that change them.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fromValue?: string;

  @ApiPropertyOptional({
    description:
      'New designation (PROMOTED, DESIGNATION_CHANGED), team id (TRANSFERRED) or the new internship end date YYYY-MM-DD (INTERNSHIP_EXTENDED). PROBATION_STARTED takes none: the effective date is the probation start.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  toValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

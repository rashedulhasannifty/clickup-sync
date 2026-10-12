import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Profile fields only. Status, confirmation and exit dates move through
 * employment events, so they are deliberately absent (`whitelist` drops them).
 * For the nullable fields, `null` clears the value and omitting leaves it alone.
 */
export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employeeCode?: string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  designation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) grade?:
    | string
    | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) department?:
    | string
    | null;
  @ApiPropertyOptional() @IsOptional() @IsString() teamId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() managerId?: string | null;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'joinDate must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  joinDate?: string;

  @ApiPropertyOptional({
    example: '2026-01-15',
    description:
      'Not for an INTERN (use the "Moved to probation" event). Correcting it moves the confirmation and yearly schedule. Not before the join date; `null` resets it to the join date.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'probationStartDate must be a YYYY-MM-DD date',
  })
  @IsISO8601({ strict: true })
  probationStartDate?: string | null;

  @ApiPropertyOptional({
    example: '2026-04-15',
    description:
      'INTERN only: correct the expected internship end (an extension is better recorded as an "Internship extended" event). After the join date; `null` resets it to join + 3 months.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'internshipEndDate must be a YYYY-MM-DD date',
  })
  @IsISO8601({ strict: true })
  internshipEndDate?: string | null;

  @ApiPropertyOptional({ description: 'ClickUp user id; null unlinks.' })
  @IsOptional()
  @Matches(/^\d+$/, {
    message: 'clickupUserId must be a numeric ClickUp user id',
  })
  clickupUserId?: string | null;

  @ApiPropertyOptional({
    description: 'Company within the group (the form field "Concern name").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  concernName?: string | null;

  @ApiPropertyOptional({ example: 'BSc in CSE' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  academicQualification?: string | null;

  @ApiPropertyOptional({
    description:
      'Months of experience before joining; total experience = this + tenure. `null` clears.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  experienceBeforeJoiningMonths?: number | null;

  @ApiPropertyOptional({
    description: 'Whole taka (BDT). Sensitive. `null` clears.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  startingSalary?: number | null;

  @ApiPropertyOptional({
    description:
      'Present gross salary, whole taka (BDT). An approved appraisal increment moves it. Sensitive. `null` clears.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  grossSalary?: number | null;
}

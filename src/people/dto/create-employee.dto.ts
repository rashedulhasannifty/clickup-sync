import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The statuses an employee can start in; NOTICE and EXITED come from the offboarding flow. */
export const STARTING_STATUSES = ['INTERN', 'PROBATION', 'ACTIVE'] as const;

export class CreateEmployeeDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) fullName!: string;

  @ApiProperty({
    description:
      'Work email. Stored lower-cased; links the employee to a login of the same email.',
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employeeCode?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) designation!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  grade?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() managerId?: string;

  @ApiProperty({ example: '2026-01-15' })
  @Matches(DATE_ONLY, { message: 'joinDate must be a YYYY-MM-DD date' })
  @IsISO8601({ strict: true })
  joinDate!: string;

  @ApiPropertyOptional({
    enum: STARTING_STATUSES,
    default: 'PROBATION',
    description:
      'INTERN: before probation, only the internship review applies. Later moves go through employment events.',
  })
  @IsOptional()
  @IsIn(STARTING_STATUSES)
  status?: (typeof STARTING_STATUSES)[number];

  @ApiPropertyOptional({
    example: '2026-01-15',
    description:
      'PROBATION/ACTIVE: when probation started, the anchor of the confirmation and yearly schedule. Default: the join date. Not for an INTERN.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'probationStartDate must be a YYYY-MM-DD date',
  })
  @IsISO8601({ strict: true })
  probationStartDate?: string;

  @ApiPropertyOptional({
    example: '2026-04-15',
    description:
      'INTERN only: the expected internship end (when the internship review falls due). Default: join + 3 months; must be after the join date.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'internshipEndDate must be a YYYY-MM-DD date',
  })
  @IsISO8601({ strict: true })
  internshipEndDate?: string;

  @ApiPropertyOptional({
    description:
      'ClickUp user id. Defaults to the linked login’s ClickUp id when there is one.',
  })
  @IsOptional()
  @Matches(/^\d+$/, {
    message: 'clickupUserId must be a numeric ClickUp user id',
  })
  clickupUserId?: string;

  @ApiPropertyOptional({
    description:
      'Stellar HRM User ID (the office door / attendance system). Attendance and leave imports match on it.',
  })
  @IsOptional()
  @Matches(/^\d{1,20}$/, {
    message: 'attendanceId must be a numeric Stellar HRM user id',
  })
  attendanceId?: string;

  @ApiPropertyOptional({
    description: 'Working shift id. Unset: the 09:30 office default.',
  })
  @IsOptional()
  @IsString()
  shiftId?: string;

  @ApiPropertyOptional({
    description: 'Company within the group (the form field "Concern name").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  concernName?: string;

  @ApiPropertyOptional({ example: 'BSc in CSE' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  academicQualification?: string;

  @ApiPropertyOptional({
    description:
      'Months of experience before joining; total experience = this + tenure.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  experienceBeforeJoiningMonths?: number;

  @ApiPropertyOptional({ description: 'Whole taka (BDT). Sensitive.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  startingSalary?: number;

  @ApiPropertyOptional({
    description:
      'Present gross salary, whole taka (BDT). An approved appraisal increment moves it. Sensitive.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  grossSalary?: number;
}

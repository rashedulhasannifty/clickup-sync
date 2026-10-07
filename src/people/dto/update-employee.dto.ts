import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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

  @ApiPropertyOptional({ description: 'ClickUp user id; null unlinks.' })
  @IsOptional()
  @Matches(/^\d+$/, {
    message: 'clickupUserId must be a numeric ClickUp user id',
  })
  clickupUserId?: string | null;
}

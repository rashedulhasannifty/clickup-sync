import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateShiftDto {
  @ApiProperty({ example: 'Evening' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ description: 'Minutes after Dhaka midnight (0-1439).', example: 840 })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinutes!: number;

  @ApiProperty({
    description: 'Minutes after Dhaka midnight (0-1439). Before the start = crosses midnight.',
    example: 1380,
  })
  @IsInt()
  @Min(0)
  @Max(1439)
  endMinutes!: number;

  @ApiPropertyOptional({ description: 'Late = first-in after start + grace.', default: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  graceMinutes?: number;

  @ApiPropertyOptional({
    description: 'False: punctuality does not apply (irregular hours).',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  trackPunctuality?: boolean;
}

export class UpdateShiftDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1439) startMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1439) endMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(240) graceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trackPunctuality?: boolean;
}

export class ShiftAssignmentDto {
  @ApiProperty() @IsString() @IsNotEmpty() employeeId!: string;
  @ApiProperty({ nullable: true, description: 'null = the 09:30 office default.' })
  @IsOptional()
  @IsString()
  // An empty id is not "no shift" (that is null): refuse it here rather than at the foreign key.
  @IsNotEmpty()
  shiftId!: string | null;
}

export class AssignShiftsDto {
  @ApiProperty({ type: [ShiftAssignmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ShiftAssignmentDto)
  assignments!: ShiftAssignmentDto[];
}

export class ShiftSuggestionsQuery {
  @ApiPropertyOptional({ example: '2026-07-01', description: 'Default: 90 days before `to`.' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be a YYYY-MM-DD date' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-12', description: 'Default: today (Dhaka).' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be a YYYY-MM-DD date' })
  to?: string;
}

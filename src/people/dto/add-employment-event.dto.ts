import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

/** JOINED is written by creating the employee, never added by hand. */
export const MANUAL_EVENT_TYPES = [
  "CONFIRMED",
  "PROMOTED",
  "DESIGNATION_CHANGED",
  "TRANSFERRED",
  "NOTICE_GIVEN",
  "EXITED",
  "NOTE",
] as const;

export type ManualEventType = (typeof MANUAL_EVENT_TYPES)[number];

export class AddEmploymentEventDto {
  @ApiProperty({ enum: MANUAL_EVENT_TYPES })
  @IsIn(MANUAL_EVENT_TYPES)
  type!: ManualEventType;

  @ApiProperty({ example: "2026-04-01" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "effectiveDate must be a YYYY-MM-DD date",
  })
  @IsISO8601({ strict: true })
  effectiveDate!: string;

  @ApiPropertyOptional({
    description:
      "Defaults to the current designation / team id for the events that change them.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fromValue?: string;

  @ApiPropertyOptional({
    description:
      "New designation (PROMOTED, DESIGNATION_CHANGED) or team id (TRANSFERRED).",
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

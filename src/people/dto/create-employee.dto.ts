import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateEmployeeDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) fullName!: string;

  @ApiProperty({
    description:
      "Work email. Stored lower-cased; links the employee to a login of the same email.",
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

  @ApiProperty({ example: "2026-01-15" })
  @Matches(DATE_ONLY, { message: "joinDate must be a YYYY-MM-DD date" })
  @IsISO8601({ strict: true })
  joinDate!: string;

  @ApiPropertyOptional({
    description:
      "ClickUp user id. Defaults to the linked login’s ClickUp id when there is one.",
  })
  @IsOptional()
  @Matches(/^\d+$/, {
    message: "clickupUserId must be a numeric ClickUp user id",
  })
  clickupUserId?: string;
}

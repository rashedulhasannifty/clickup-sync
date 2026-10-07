import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ListEmployeesQuery {
  @ApiPropertyOptional({
    description:
      "Matches name, email, employee code or designation (case-insensitive).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ["PROBATION", "ACTIVE", "NOTICE", "EXITED"] })
  @IsOptional()
  @IsIn(["PROBATION", "ACTIVE", "NOTICE", "EXITED"])
  status?: "PROBATION" | "ACTIVE" | "NOTICE" | "EXITED";

  @ApiPropertyOptional() @IsOptional() @IsString() teamId?: string;
}

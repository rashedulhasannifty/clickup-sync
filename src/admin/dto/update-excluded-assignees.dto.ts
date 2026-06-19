import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ExcludedAssigneeDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  email?: string | null;
}

export class UpdateExcludedAssigneesDto {
  @ApiProperty({ type: [ExcludedAssigneeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExcludedAssigneeDto)
  assignees!: ExcludedAssigneeDto[];
}

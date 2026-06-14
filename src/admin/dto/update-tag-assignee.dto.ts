import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateTagAssigneeDto {
  @ApiPropertyOptional({ description: 'Rename the tag (must stay unique).' })
  @IsString()
  @IsOptional()
  tagName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  clickupUserId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  clickupUserName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  clickupEmail?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

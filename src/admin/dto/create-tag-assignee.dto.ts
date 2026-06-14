import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTagAssigneeDto {
  @ApiProperty({ description: 'Tag name as it appears in ClickUp (e.g. "ahmad")' })
  @IsString()
  @IsNotEmpty()
  tagName!: string;

  @ApiProperty({ description: 'ClickUp user ID for this tag' })
  @IsString()
  @IsNotEmpty()
  clickupUserId!: string;

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

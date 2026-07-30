import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class SyncListsDto {
  @ApiPropertyOptional({ example: '3577824', description: 'ClickUp space ID to sync the list catalog for. Omit to sync every configured space.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  spaceId?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SyncTaskDto {
  @ApiProperty({ example: '86abc123', description: 'ClickUp task ID' })
  @IsString()
  @MinLength(1)
  taskId: string;
}

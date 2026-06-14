import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class NotifySpikeDto {
  @ApiProperty({ example: '12345678', description: 'ClickUp user id from the spike watchlist row' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;

  @ApiProperty({ example: '2026-06-10', description: 'Flagged local (Asia/Dhaka) day, YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({ enum: ['absolute', 'relative', 'both'] })
  @IsOptional()
  @IsIn(['absolute', 'relative', 'both'])
  rule?: 'absolute' | 'relative' | 'both';

  @ApiPropertyOptional({ example: 6.0, description: "The member's median daily hours, for email wording" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  median?: number;

  @ApiPropertyOptional({ example: 'Please double-check Tuesday\'s entries.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

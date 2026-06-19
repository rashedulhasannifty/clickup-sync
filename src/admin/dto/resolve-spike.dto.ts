import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ResolveSpikeDto {
  @ApiProperty({ example: '12345678', description: 'ClickUp user id from the spike watchlist row' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;

  @ApiProperty({ example: '2026-06-10', description: 'Flagged local (Asia/Dhaka) day, YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({ example: 'Ann Smith', description: 'Member name, copied from the watchlist row' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  userName?: string;

  @ApiPropertyOptional({ example: 'Legit crunch day, confirmed with PM.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class UnresolveSpikeDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;

  @ApiProperty({ example: '2026-06-10', description: 'Flagged local (Asia/Dhaka) day, YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

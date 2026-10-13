import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class HolidayYearQuery {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

export class CreateHolidayDto {
  @ApiProperty({ example: 'Eid-ul-Fitr' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: '2026-03-18' })
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @ApiProperty({ description: 'Inclusive; same as `from` for one day.', example: '2026-03-23' })
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to!: string;

  @ApiPropertyOptional({ description: 'The date still needs confirming (moon-dependent).', default: false })
  @IsOptional()
  @IsBoolean()
  tentative?: boolean;
}

export class HolidayIdsDto {
  @ApiProperty({ description: 'The dates of one holiday (see `ids` on the list).', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @IsString({ each: true })
  ids!: string[];
}

export class UpdateHolidayDto extends HolidayIdsDto {
  @ApiPropertyOptional({ example: 'Eid-ul-Adha' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tentative?: boolean;
}

export class PrefillHolidaysDto {
  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

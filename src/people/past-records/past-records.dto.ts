import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsStringOrNumber } from './string-or-number.validator';

/** The most rows one import may carry. */
export const MAX_IMPORT_ROWS = 2000;

/**
 * One past record as the client sends it. Deliberately loose (string or number,
 * length-capped): the real checking is `normalizeRow`, so a bad cell becomes a
 * per-row error in the preview instead of a 400 for the whole file.
 */
export class PastRecordFieldsDto {
  @ApiPropertyOptional({
    example: 'Promotion',
    description:
      'Joined, Joined as intern, Moved to probation, Confirmed, Promotion, Designation change, Transfer, Increment or Appraisal (case-insensitive)',
  })
  @IsOptional()
  @IsStringOrNumber(200)
  record?: string;

  @ApiPropertyOptional({ example: '2024-01-15', description: 'YYYY-MM-DD, DD/MM/YYYY or an Excel serial day' })
  @IsOptional()
  @IsStringOrNumber(40)
  date?: string | number;

  @ApiPropertyOptional({ description: 'Old designation / team name / gross (Increment)' })
  @IsOptional()
  @IsStringOrNumber(200)
  from?: string | number;

  @ApiPropertyOptional({ description: 'New designation / team name / gross (Increment)' })
  @IsOptional()
  @IsStringOrNumber(200)
  to?: string | number;

  @ApiPropertyOptional({ description: 'Increment %: "12%" or 12' })
  @IsOptional()
  @IsStringOrNumber(40)
  amount?: string | number;

  @ApiPropertyOptional({ description: 'Appraisal: A-F' })
  @IsOptional()
  @IsStringOrNumber(10)
  grade?: string;

  @ApiPropertyOptional({ description: 'Appraisal: 0-100' })
  @IsOptional()
  @IsStringOrNumber(20)
  marks?: string | number;

  @ApiPropertyOptional({ description: 'Yearly (default), Half-yearly, Confirmation, Internship review' })
  @IsOptional()
  @IsStringOrNumber(40)
  appraisalType?: string;

  @ApiPropertyOptional({ description: 'Appraisal: "Increment, Promotion"' })
  @IsOptional()
  @IsStringOrNumber(300)
  actions?: string;

  @ApiPropertyOptional({ description: 'Appraisal: the due date it was for' })
  @IsOptional()
  @IsStringOrNumber(40)
  dueDate?: string | number;

  @ApiPropertyOptional({ description: 'Appraisal: the outcome in a few words' })
  @IsOptional()
  @IsStringOrNumber(2000)
  outcome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsStringOrNumber(2000)
  notes?: string;
}

export class PastRecordRowDto extends PastRecordFieldsDto {
  @ApiPropertyOptional({ description: 'The sheet row number, for messages' })
  @IsOptional()
  @IsInt()
  @Min(1)
  row?: number;

  @ApiPropertyOptional({ description: 'Email or employee code' })
  @IsOptional()
  @IsStringOrNumber(320)
  employee?: string;
}

export class PastRecordsImportDto {
  @ApiProperty({ type: [PastRecordRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => PastRecordRowDto)
  rows!: PastRecordRowDto[];
}

/** The per-employee editor: one record, plus an optional scanned form for an appraisal. */
export class PastRecordDto extends PastRecordFieldsDto {
  @ApiPropertyOptional({
    description: 'Appraisal: an employee document (the scanned form); null unlinks',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  documentId?: string | null;
}

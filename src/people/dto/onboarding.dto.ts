import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  ONBOARDING_GROUPS,
  type OnboardingGroupValue,
} from '../onboarding-checklist';

export class AddOnboardingItemDto {
  @ApiProperty({ enum: ONBOARDING_GROUPS })
  @IsIn(ONBOARDING_GROUPS)
  group!: OnboardingGroupValue;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;
}

export class UpdateOnboardingItemDto {
  @ApiPropertyOptional({
    description: 'Ticking done clears N/A; unticking drops a linked document.',
  })
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({
    description: 'N/A clears done and drops a linked document.',
  })
  @IsOptional()
  @IsBoolean()
  notApplicable?: boolean;

  @ApiPropertyOptional({ description: '`null` clears the note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({
    description:
      'Free text such as a laptop serial, SIM number or email address. `null` clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string | null;

  @ApiPropertyOptional({
    description:
      'A current, non-deleted document of the same employee; linking marks the item done. `null` unlinks.',
  })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  documentId?: string | null;
}

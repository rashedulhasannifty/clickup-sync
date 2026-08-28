import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class SetAssigneeChargeableDto {
  @ApiProperty({ description: 'ClickUp user id, as stored on clickup_time_entries.user_id' })
  @IsString()
  userId!: string;

  @ApiProperty({
    nullable: true,
    description: 'true = chargeable, false = non-chargeable, null = clear the rule and fall back to the task flag',
  })
  // `@IsOptional()` would also let the field be omitted entirely (it skips
  // validation for undefined too), silently sending `chargeable: undefined`
  // to the repository. `chargeable` is required; only `null` is a valid way
  // to opt out of a value, so only skip `@IsBoolean()` for `null`.
  @ValidateIf((o: SetAssigneeChargeableDto) => o.chargeable !== null)
  @IsBoolean()
  chargeable!: boolean | null;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

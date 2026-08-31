import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsString, ValidateIf } from 'class-validator';
import { MAX_CHARGEABLE_TIME_ENTRY_IDS } from '../../tasks/task-chargeability.constants';

export class SetEntryChargeableOverrideDto {
  @ApiProperty({ type: [String], description: 'ClickUp time entry ids to override' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_CHARGEABLE_TIME_ENTRY_IDS)
  @IsString({ each: true })
  timeEntryIds!: string[];

  @ApiProperty({
    nullable: true,
    description: 'true = chargeable, false = non-chargeable, null = clear the override and fall back to the (task, assignee) rule or the task flag',
  })
  // Same shape as SetAssigneeChargeableDto: `@IsOptional()` would also allow
  // the field to be omitted entirely, silently sending `undefined`. Only
  // `null` is a valid way to opt out of a value.
  @ValidateIf((o: SetEntryChargeableOverrideDto) => o.chargeable !== null)
  @IsBoolean()
  chargeable!: boolean | null;
}

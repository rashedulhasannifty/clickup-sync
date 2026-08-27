import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsString } from 'class-validator';
import { MAX_CHARGEABLE_TASK_IDS } from '../../tasks/task-chargeability.constants';

export class SetTaskChargeableDto {
  @ApiProperty({ type: [String], maxItems: MAX_CHARGEABLE_TASK_IDS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_CHARGEABLE_TASK_IDS)
  @IsString({ each: true })
  taskIds!: string[];

  @ApiProperty({ description: 'true = Chargeable, false = Non-chargeable' })
  @IsBoolean()
  chargeable!: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsString } from 'class-validator';

/** Cap matches the preview endpoint: a comma-separated id list in a query
 *  string is bounded by URL length, and 500 is far above any hand-built
 *  selection the UI can produce. */
export const MAX_CHARGEABLE_TASK_IDS = 500;

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

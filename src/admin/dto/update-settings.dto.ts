import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ description: 'ClickUp API token (write-only; stored encrypted). Omit to leave unchanged.' })
  @IsOptional()
  @IsString()
  apiToken?: string;

  @ApiPropertyOptional({ description: 'ClickUp Team/Workspace ID.' })
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({ description: 'Public webhook endpoint URL registered with ClickUp.' })
  @IsOptional()
  @IsString()
  webhookEndpoint?: string;

  @ApiPropertyOptional({ description: 'Comma-separated list of subscribed webhook event types.' })
  @IsOptional()
  @IsString()
  webhookEvents?: string;

  @ApiPropertyOptional({ description: 'Webhook signing secret (write-only; stored encrypted). Usually set automatically by Register webhook.' })
  @IsOptional()
  @IsString()
  webhookSecret?: string;
}

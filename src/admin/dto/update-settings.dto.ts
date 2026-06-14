import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Absolute daily-hours cap for spike detection (1–24). Default 12.', minimum: 1, maximum: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  spikeHoursCap?: number;

  @ApiPropertyOptional({ description: 'Non-secret UI preferences (notifications, sync rules, per-space enable map). Deep-merged.' })
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles, CurrentUser } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth.types';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { NotifySpikeDto } from './dto/notify-spike.dto';
import { ResolveSpikeDto, UnresolveSpikeDto } from './dto/resolve-spike.dto';
import { SpikeNotificationService } from './spike-notification.service';
import { SpikeResolutionService } from './spike-resolution.service';
import { actorLabel } from './admin.util';

/** Per-user hour-spike notice preview/send + resolution actions under `/admin`. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminSpikesController {
  constructor(
    private readonly spikeNotifications: SpikeNotificationService,
    private readonly spikeResolutions: SpikeResolutionService,
  ) {}

  @Get('hour-spikes/:userId/:date/preview')
  @ApiOperation({ summary: "Preview a spike notice: the member's per-task breakdown for that Dhaka-local day, recipient email, and whether they've already been notified." })
  previewSpikeNotice(@Param('userId') userId: string, @Param('date') date: string) {
    return this.spikeNotifications.preview(userId, date);
  }

  // 200, not 201: this is an action endpoint (send the notice) like the other
  // action POSTs in this controller (sync/backfill/retry); the recorded row is
  // a side-effect, not the returned resource.
  @Post('hour-spikes/notify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email a flagged member their spike-day task breakdown (+ optional note) and record the send. 409 if already notified for that day.' })
  notifySpike(@Body() dto: NotifySpikeDto, @CurrentUser() user: AuthPrincipal) {
    return this.spikeNotifications.notify({
      userId: dto.userId,
      date: dto.date,
      rule: dto.rule,
      median: dto.median,
      note: dto.note,
      sentBy: actorLabel(user),
    });
  }

  @Post('hour-spikes/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a flagged spike day as resolved so it drops out of the watchlist. Idempotent.' })
  resolveSpike(@Body() dto: ResolveSpikeDto, @CurrentUser() user: AuthPrincipal) {
    return this.spikeResolutions.resolve({
      userId: dto.userId,
      date: dto.date,
      userName: dto.userName,
      note: dto.note,
      resolvedBy: actorLabel(user),
    });
  }

  @Delete('hour-spikes/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Un-resolve a spike day so it reappears in the watchlist. No-op if not resolved.' })
  unresolveSpike(@Body() dto: UnresolveSpikeDto) {
    return this.spikeResolutions.unresolve({ userId: dto.userId, date: dto.date });
  }
}

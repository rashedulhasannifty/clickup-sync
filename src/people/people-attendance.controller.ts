import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { AuthPrincipal, Role } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { DecideLeaveDto } from './dto/decide-leave.dto';
import { ListLeavesQuery } from './dto/list-leaves.query';
import { SyncAttendanceDto } from './dto/sync-attendance.dto';
import { PeopleAttendanceService } from './people-attendance.service';
import { PeopleSyncService } from './people-sync.service';
import { SYNC_DEFAULT_LOOKBACK_DAYS } from './people.constants';
import type {
  LeaveRecordView,
  SyncEnqueued,
  TodayAttendance,
} from './people.types';

/** Attendance board, leave requests and the attendance sync trigger. Owner/Admin only; writes are audited. */
@ApiTags('people')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('people')
export class PeopleAttendanceController {
  constructor(
    private readonly attendance: PeopleAttendanceService,
    private readonly sync: PeopleSyncService,
  ) {}

  @Get('attendance/today')
  @ApiOperation({
    summary:
      'Today’s door log with in-office / late / on-leave / pending counts',
  })
  today(@CurrentUser() user: AuthPrincipal): Promise<TodayAttendance> {
    return this.attendance.today(user.orgId);
  }

  @Post('attendance/sync')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Enqueue an attendance/leave sync from the configured provider',
  })
  enqueueSync(@Body() dto: SyncAttendanceDto): Promise<SyncEnqueued> {
    return this.sync.enqueue(
      dto.lookbackDays ?? SYNC_DEFAULT_LOOKBACK_DAYS,
      'manual',
    );
  }

  @Get('leaves')
  @ApiOperation({ summary: 'Leave records' })
  leaves(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: ListLeavesQuery,
  ): Promise<LeaveRecordView[]> {
    return this.attendance.listLeaves(user.orgId, q);
  }

  @Patch('leaves/:id')
  @ApiOperation({ summary: 'Approve or reject a PENDING leave request' })
  decide(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: DecideLeaveDto,
  ): Promise<LeaveRecordView> {
    return this.attendance.decide(user, id, dto.status);
  }
}

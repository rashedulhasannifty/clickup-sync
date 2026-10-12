import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { AuthPrincipal, Role } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { DecideLeaveDto } from './dto/decide-leave.dto';
import { ListLeavesQuery } from './dto/list-leaves.query';
import { SyncAttendanceDto } from './dto/sync-attendance.dto';
import { PeopleAttendanceService } from './people-attendance.service';
import { PeopleSyncService } from './people-sync.service';
import { SYNC_DEFAULT_LOOKBACK_DAYS } from './people.constants';
import {
  MAX_STELLAR_CSV_BYTES,
  StellarImportService,
  type AttendanceImportResult,
  type LeaveImportResult,
  type UploadedCsv,
} from './stellar/stellar-import.service';

/** Multer memory storage, hard-capped like the documents upload. Exceeding the cap is a 413. */
const csvInterceptor = () =>
  FileInterceptor('file', {
    limits: { fileSize: MAX_STELLAR_CSV_BYTES, files: 1, fields: 5 },
  });

/** `?dryRun=true` (or `1`) previews; anything else writes. A raw 'false' string must not be truthy. */
const isDryRun = (v: string | undefined) => v === 'true' || v === '1';
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
    private readonly stellar: StellarImportService,
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

  @Post('attendance/import/stellar')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'dryRun', required: false, enum: ['true', 'false'] })
  @UseInterceptors(csvInterceptor())
  @ApiOperation({
    summary:
      'Import a Stellar HRM attendance CSV (multipart `file`, max 10 MB). dryRun=true previews: range, matched/unmatched Stellar ids, per-employee days, rows replaced. Otherwise replaces simulated and earlier CSV rows (never Stellar API rows) over the file range.',
  })
  importStellarAttendance(
    @CurrentUser() user: AuthPrincipal,
    @UploadedFile() file: UploadedCsv | undefined,
    @Query('dryRun') dryRun?: string,
  ): Promise<AttendanceImportResult> {
    return this.stellar.importAttendance(user.orgId, file, isDryRun(dryRun));
  }

  @Post('attendance/import/stellar-leaves')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'dryRun', required: false, enum: ['true', 'false'] })
  @UseInterceptors(csvInterceptor())
  @ApiOperation({
    summary:
      'Import a Stellar HRM leave CSV (multipart `file`, max 10 MB). Consecutive days merge into one record; weekend rows are skipped. Replaces Stellar-sourced and simulated leave in the file range, never manual leave. dryRun=true previews.',
  })
  importStellarLeaves(
    @CurrentUser() user: AuthPrincipal,
    @UploadedFile() file: UploadedCsv | undefined,
    @Query('dryRun') dryRun?: string,
  ): Promise<LeaveImportResult> {
    return this.stellar.importLeaves(user.orgId, file, isDryRun(dryRun));
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

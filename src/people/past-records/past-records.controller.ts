import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuditLogInterceptor } from '../../admin/audit-log.interceptor';
import { AuthPrincipal, Role } from '../../auth/auth.types';
import { CurrentUser, Roles } from '../../auth/decorators';
import { PastRecordDto, PastRecordsImportDto } from './past-records.dto';
import { PastRecordsService } from './past-records.service';
import type {
  EmployeePastRecords,
  PastRecordsApplyResult,
  PastRecordsPreview,
} from './past-records.types';

/**
 * Past records (0035): employees' history from before the system. Owner/Admin
 * only; writes are audited, with the salary-bearing fields (from, to, amount)
 * redacted by the interceptor on these routes. Nothing here runs an appraisal
 * outcome, generates a document or sends anything.
 */
@ApiTags('people')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('people')
export class PeoplePastRecordsController {
  constructor(private readonly pastRecords: PastRecordsService) {}

  @Post('past-records/preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Check an import: per-row errors, rows already recorded, and each employee before -> after',
  })
  preview(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: PastRecordsImportDto,
  ): Promise<PastRecordsPreview> {
    return this.pastRecords.preview(user.orgId, dto.rows);
  }

  @Post('past-records/apply')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Apply an import in one transaction (refused while any row has an error; rows already recorded are skipped)',
  })
  apply(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: PastRecordsImportDto,
  ): Promise<PastRecordsApplyResult> {
    return this.pastRecords.apply(user, dto.rows);
  }

  @Get('employees/:id/past-records')
  @ApiOperation({ summary: 'An employee’s past records: events from records and past appraisals' })
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<EmployeePastRecords> {
    return this.pastRecords.list(user.orgId, id);
  }

  @Post('employees/:id/past-records')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add one past record; the employee is re-derived from their whole history' })
  add(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: PastRecordDto,
  ): Promise<EmployeePastRecords> {
    return this.pastRecords.add(user, id, dto);
  }

  @Patch('employees/:id/past-records/:recordId')
  @ApiOperation({ summary: 'Edit one past record or timeline entry (`event:<id>` or `appraisal:<id>`)' })
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() dto: PastRecordDto,
  ): Promise<EmployeePastRecords> {
    return this.pastRecords.update(user, id, recordId, dto);
  }

  @Delete('employees/:id/past-records/:recordId')
  @ApiOperation({ summary: 'Delete one past record or timeline entry (offboarding, appraisal outcomes, notes and the app join stay)' })
  remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
  ): Promise<EmployeePastRecords> {
    return this.pastRecords.remove(user, id, recordId);
  }
}

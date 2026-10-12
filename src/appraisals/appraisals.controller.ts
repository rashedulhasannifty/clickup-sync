import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { attachmentDelivery } from '../xero/xero-attachment-delivery';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { AuthPrincipal, Role } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AppraisalsService } from './appraisals.service';
import type {
  AppraisalListRow,
  AppraisalView,
  CycleView,
  EmployeeAppraisalRow,
  LaunchResult,
} from './appraisals.types';
import {
  CreateCycleDto,
  LaunchCycleDto,
  UpdateCycleDto,
} from './dto/cycle.dto';
import { UpdateAppraisalDto } from './dto/update-appraisal.dto';

/** Appraisal cycles and the review workflow. Owner/Admin only; writes are audited. */
@ApiTags('people')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('people')
export class AppraisalsController {
  constructor(private readonly appraisals: AppraisalsService) {}

  @Get('appraisal-cycles')
  @ApiOperation({ summary: 'Appraisal cycles with progress by status' })
  listCycles(@CurrentUser() user: AuthPrincipal): Promise<CycleView[]> {
    return this.appraisals.listCycles(user.orgId);
  }

  @Post('appraisal-cycles')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a cycle (DRAFT until launched)' })
  createCycle(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: CreateCycleDto,
  ): Promise<CycleView> {
    return this.appraisals.createCycle(user, dto);
  }

  @Get('appraisal-cycles/:id')
  @ApiOperation({ summary: 'One cycle' })
  getCycle(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<CycleView> {
    return this.appraisals.getCycle(user.orgId, id);
  }

  @Patch('appraisal-cycles/:id')
  @ApiOperation({
    summary:
      'Rename, close or reopen a cycle; period, weight and competencies lock once appraisals exist',
  })
  updateCycle(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateCycleDto,
  ): Promise<CycleView> {
    return this.appraisals.updateCycle(user.orgId, id, dto);
  }

  @Post('appraisal-cycles/:id/launch')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Create one appraisal per selected employee (default: everyone not exited who joined by the period end) and open the cycle',
  })
  launch(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: LaunchCycleDto,
  ): Promise<LaunchResult> {
    return this.appraisals.launch(user.orgId, id, dto);
  }

  @Get('appraisal-cycles/:id/appraisals')
  @ApiOperation({ summary: 'The appraisals in a cycle' })
  listAppraisals(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<AppraisalListRow[]> {
    return this.appraisals.listAppraisals(user.orgId, id);
  }

  @Get('appraisals/:id')
  @ApiOperation({ summary: 'One appraisal: the form, score and history' })
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<AppraisalView> {
    return this.appraisals.getAppraisal(user.orgId, id);
  }

  @Patch('appraisals/:id')
  @ApiOperation({
    summary:
      'Save the fields of the current step (other steps’ fields are refused)',
  })
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateAppraisalDto,
  ): Promise<AppraisalView> {
    return this.appraisals.update(user.orgId, id, dto);
  }

  @Post('appraisals/:id/advance')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Move one step forward. Entering lead review snapshots the KPIs; signing off applies the outcome once',
  })
  advance(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<AppraisalView> {
    return this.appraisals.advance(user, id);
  }

  @Post('appraisals/:id/send-back')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move one step back for corrections (not after sign-off)',
  })
  sendBack(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<AppraisalView> {
    return this.appraisals.sendBack(user.orgId, id);
  }

  @Post('appraisals/:id/refresh-kpis')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recompute the KPI snapshot (frozen after sign-off)',
  })
  refreshKpis(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<AppraisalView> {
    return this.appraisals.refreshKpis(user.orgId, id);
  }

  @Get('appraisals/:id/form-pdf')
  @ApiOperation({
    summary:
      'The filled paper form as a PDF (FORM_100 only). Before sign-off a preview that is not stored; after sign-off rendered from the frozen result. download=1 forces a download',
  })
  async formPdf(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await this.appraisals.formPdf(user.orgId, id);
    const { headers } = attachmentDelivery(
      pdf.fileName,
      'application/pdf',
      download === '1' || download === 'true',
    );
    res.set({ ...headers, 'Content-Length': String(pdf.buffer.length) });
    return new StreamableFile(pdf.buffer);
  }

  @Get('employees/:id/appraisals')
  @ApiOperation({ summary: 'An employee’s appraisal history, newest first' })
  forEmployee(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<EmployeeAppraisalRow[]> {
    return this.appraisals.employeeAppraisals(user.orgId, id);
  }
}

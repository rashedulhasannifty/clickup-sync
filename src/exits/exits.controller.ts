import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { AuthPrincipal, Role } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import {
  AddClearanceItemDto,
  CancelExitDto,
  CompleteExitDto,
  ListExitsQuery,
  SaveInterviewDto,
  StartExitDto,
  UpdateClearanceItemDto,
  UpdateExitDto,
} from './dto/exit.dto';
import { ExitsService } from './exits.service';
import type {
  EmployeeExitResponse,
  ExitDocumentView,
  ExitListRow,
  ExitView,
} from './exits.types';

/** Offboarding (People slice 4). Owner/Admin only; writes are audited. */
@ApiTags('people')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('people')
export class ExitsController {
  constructor(private readonly exits: ExitsService) {}

  @Post('employees/:id/exit')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Start offboarding: records the exit, seeds the clearance list and writes NOTICE_GIVEN',
  })
  start(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: StartExitDto,
  ): Promise<ExitView> {
    return this.exits.start(user, id, dto);
  }

  @Get('employees/:id/exit')
  @ApiOperation({
    summary: 'The employee’s active offboarding, else their latest; { exit: null } if none',
  })
  forEmployee(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<EmployeeExitResponse> {
    return this.exits.forEmployee(user.orgId, id);
  }

  @Get('exits')
  @ApiOperation({ summary: 'Offboardings, newest first; status=active|NOTICE|…' })
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: ListExitsQuery,
  ): Promise<ExitListRow[]> {
    return this.exits.list(user.orgId, q);
  }

  @Patch('exits/:id')
  @ApiOperation({ summary: 'Edit type, dates or reason while the exit is active' })
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateExitDto,
  ): Promise<ExitView> {
    return this.exits.update(user.orgId, id, dto);
  }

  @Put('exits/:id/interview')
  @ApiOperation({ summary: 'Save (replace) the exit interview' })
  saveInterview(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: SaveInterviewDto,
  ): Promise<ExitView> {
    return this.exits.saveInterview(user, id, dto);
  }

  @Post('exits/:id/clearance-items')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a custom clearance item' })
  addItem(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: AddClearanceItemDto,
  ): Promise<ExitView> {
    return this.exits.addClearanceItem(user.orgId, id, dto.label);
  }

  @Patch('exits/:id/clearance-items/:itemId')
  @ApiOperation({ summary: 'Tick or untick an item, or edit its label or note' })
  updateItem(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateClearanceItemDto,
  ): Promise<ExitView> {
    return this.exits.updateClearanceItem(user, id, itemId, dto);
  }

  @Delete('exits/:id/clearance-items/:itemId')
  @ApiOperation({ summary: 'Remove a clearance item' })
  removeItem(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<ExitView> {
    return this.exits.removeClearanceItem(user.orgId, id, itemId);
  }

  @Post('exits/:id/letters/:kind')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Generate the experience or release letter as a PDF and store it as an EXIT document; regenerating replaces it (new version)',
  })
  generateLetter(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('kind') kind: string,
  ): Promise<ExitDocumentView> {
    return this.exits.generateLetter(user, id, kind);
  }

  @Post('exits/:id/advance')
  @HttpCode(200)
  @ApiOperation({ summary: 'NOTICE -> INTERVIEW -> CLEARANCE' })
  advance(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<ExitView> {
    return this.exits.advance(user.orgId, id);
  }

  @Post('exits/:id/complete')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Complete from CLEARANCE: needs every item done (or an override note); writes EXITED and, by default, disables the linked login',
  })
  complete(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: CompleteExitDto,
  ): Promise<ExitView> {
    return this.exits.complete(user, id, dto);
  }

  @Post('exits/:id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Cancel an active offboarding: restores the employee’s previous status with a NOTE event',
  })
  cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: CancelExitDto,
  ): Promise<ExitView> {
    return this.exits.cancel(user, id, dto);
  }
}

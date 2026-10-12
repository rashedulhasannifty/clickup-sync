import {
  Body,
  Controller,
  Delete,
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
import {
  AssignShiftsDto,
  CreateShiftDto,
  ShiftSuggestionsQuery,
  UpdateShiftDto,
} from './dto/shift.dto';
import {
  ShiftsService,
  type ShiftSuggestions,
  type ShiftView,
} from './shifts.service';

/** Work shifts: lateness and expected hours per employee. Owner/Admin only; writes are audited. */
@ApiTags('people')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('people/shifts')
export class PeopleShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  @ApiOperation({ summary: 'Work shifts with how many employees are on each' })
  list(@CurrentUser() user: AuthPrincipal): Promise<ShiftView[]> {
    return this.shifts.list(user.orgId);
  }

  @Get('suggestions')
  @ApiOperation({
    summary:
      'Suggest a shift per employee from imported attendance (median first-in vs. the nearest shift start). Never applies anything.',
  })
  suggestions(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: ShiftSuggestionsQuery,
  ): Promise<ShiftSuggestions> {
    return this.shifts.suggestions(user.orgId, q);
  }

  @Post()
  @ApiOperation({ summary: 'Create a shift' })
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: CreateShiftDto,
  ): Promise<ShiftView> {
    return this.shifts.create(user.orgId, dto);
  }

  @Post('assign')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set the shift of several employees at once (accept suggestions)',
  })
  assign(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: AssignShiftsDto,
  ): Promise<{ updated: number }> {
    return this.shifts.assign(user.orgId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a shift' })
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
  ): Promise<ShiftView> {
    return this.shifts.update(user.orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a shift; its employees fall back to the 09:30 default',
  })
  async remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    await this.shifts.remove(user.orgId, id);
  }
}

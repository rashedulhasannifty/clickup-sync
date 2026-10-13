import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  CreateHolidayDto,
  HolidayIdsDto,
  HolidayYearQuery,
  PrefillHolidaysDto,
  UpdateHolidayDto,
} from './dto/holiday.dto';
import { HolidaysService, type HolidayYear } from './holidays.service';

/**
 * Office holidays: a Mon-Fri holiday is not a working day for attendance,
 * lateness, utilisation or leave. Owner/Admin only, like the rest of People;
 * writes are audited.
 */
@ApiTags('people')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('people/holidays')
export class PeopleHolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  @ApiOperation({
    summary:
      'Holidays in a year, consecutive same-name dates grouped, plus how many preset Bangladesh dates are missing',
  })
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query() q: HolidayYearQuery,
  ): Promise<HolidayYear> {
    return this.holidays.year(user.orgId, q.year);
  }

  @Post()
  @ApiOperation({
    summary:
      'Add a holiday over one or more days; refused when it overlaps an existing holiday',
  })
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: CreateHolidayDto,
  ): Promise<{ added: number }> {
    return this.holidays.create(user.orgId, dto, actor(user));
  }

  @Post('prefill')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Add the Bangladesh government holidays for a year; dates already listed are kept as they are',
  })
  prefill(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: PrefillHolidaysDto,
  ): Promise<{ added: number; skipped: number }> {
    return this.holidays.prefill(user.orgId, dto.year, actor(user));
  }

  @Patch()
  @ApiOperation({ summary: 'Rename a holiday or mark it confirmed/tentative (all its dates)' })
  update(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: UpdateHolidayDto,
  ): Promise<{ updated: number }> {
    return this.holidays.update(user.orgId, dto.ids, {
      name: dto.name,
      tentative: dto.tentative,
    });
  }

  @Post('delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a holiday (all its dates)' })
  remove(
    @CurrentUser() user: AuthPrincipal,
    @Body() dto: HolidayIdsDto,
  ): Promise<{ deleted: number }> {
    return this.holidays.remove(user.orgId, dto.ids);
  }
}

const actor = (user: AuthPrincipal): string | null =>
  user.isMachine ? null : user.userId;

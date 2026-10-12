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
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { AuthPrincipal, Role } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import {
  AddOnboardingItemDto,
  UpdateOnboardingItemDto,
} from './dto/onboarding.dto';
import { OnboardingService } from './onboarding.service';
import type { OnboardingView } from './onboarding.types';

/** The joining checklist. Owner/Admin only; writes are audited; an exited employee is read-only. */
@ApiTags('people')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('people/employees/:id/onboarding')
export class PeopleOnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @ApiOperation({
    summary: 'The joining checklist, grouped, with progress per group',
  })
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<OnboardingView> {
    return this.onboarding.get(user.orgId, id);
  }

  @Post('start')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Seed the default checklist for an employee who has none (idempotent)',
  })
  start(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
  ): Promise<OnboardingView> {
    return this.onboarding.start(user, id);
  }

  @Post('items')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a custom checklist item to a group' })
  addItem(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: AddOnboardingItemDto,
  ): Promise<OnboardingView> {
    return this.onboarding.addItem(user, id, dto);
  }

  @Patch('items/:itemId')
  @ApiOperation({
    summary:
      'Tick done / not applicable, edit the note or detail, or link a document (which marks it done)',
  })
  updateItem(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateOnboardingItemDto,
  ): Promise<OnboardingView> {
    return this.onboarding.updateItem(user, id, itemId, dto);
  }

  @Delete('items/:itemId')
  @ApiOperation({
    summary:
      'Remove a custom item (standard items can only be marked not applicable)',
  })
  removeItem(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<OnboardingView> {
    return this.onboarding.removeItem(user, id, itemId);
  }
}

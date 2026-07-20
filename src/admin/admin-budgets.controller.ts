import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { CreateClientBudgetDto } from './dto/create-client-budget.dto';
import { UpdateClientBudgetDto } from './dto/update-client-budget.dto';
import { BudgetsRepository } from '../budgets/budgets.repository';
import { parseId } from './admin.util';

/** Per-client monthly budget CRUD under `/admin`. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminBudgetsController {
  constructor(private readonly budgetsRepo: BudgetsRepository) {}

  @Get('budgets')
  @ApiOperation({ summary: 'List all client budgets (paginated)' })
  listBudgets(@Query('page') page = 1, @Query('limit') limit = 50) {
    return this.budgetsRepo.findAll(Number(page) || 1, Number(limit) || 50);
  }

  @Post('budgets')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a client budget' })
  createBudget(@Body() dto: CreateClientBudgetDto) {
    const validFrom = new Date(`${dto.validFrom.slice(0, 10)}T00:00:00.000Z`);
    const validTo = dto.validTo ? new Date(`${dto.validTo.slice(0, 10)}T00:00:00.000Z`) : null;
    return this.budgetsRepo.create({
      client: dto.client,
      monthlyAmountCents: dto.monthlyAmountCents,
      currency: dto.currency ?? 'USD',
      validFrom,
      validTo,
      notes: dto.notes ?? null,
    });
  }

  @Patch('budgets/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a client budget' })
  updateBudget(@Param('id') id: string, @Body() dto: UpdateClientBudgetDto) {
    const data: Parameters<BudgetsRepository['update']>[1] = {};
    if (dto.client !== undefined) data.client = dto.client;
    if (dto.monthlyAmountCents !== undefined) data.monthlyAmountCents = dto.monthlyAmountCents;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.validFrom !== undefined) data.validFrom = new Date(`${dto.validFrom.slice(0, 10)}T00:00:00.000Z`);
    if ('validTo' in dto) data.validTo = dto.validTo ? new Date(`${dto.validTo!.slice(0, 10)}T00:00:00.000Z`) : null;
    if ('notes' in dto) data.notes = dto.notes ?? null;
    return this.budgetsRepo.update(parseId(id), data);
  }

  @Delete('budgets/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a client budget' })
  deleteBudget(@Param('id') id: string) {
    return this.budgetsRepo.remove(parseId(id));
  }
}

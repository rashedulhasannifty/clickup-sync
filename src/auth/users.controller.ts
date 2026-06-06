import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { ChangeRoleDto } from './dto/change-role.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { Roles, CurrentUser } from './decorators';
import { AuthPrincipal } from './auth.types';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';

@ApiTags('users')
@UseInterceptors(AuditLogInterceptor)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(Role.OWNER, Role.ADMIN)
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.users.list(user.orgId);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch(':id/role')
  changeRole(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() dto: ChangeRoleDto) {
    return this.users.changeRole(user, id, dto.role as Role);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch(':id/status')
  setStatus(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.users.setStatus(user, id, dto.status);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.users.remove(user, id);
  }

  @Roles(Role.OWNER)
  @HttpCode(200)
  @Post('transfer-ownership')
  transfer(@CurrentUser() user: AuthPrincipal, @Body() dto: TransferOwnershipDto) {
    return this.users.transferOwnership(user, dto.targetUserId);
  }
}

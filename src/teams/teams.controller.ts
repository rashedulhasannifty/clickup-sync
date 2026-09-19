import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ClientOptionsRepository } from '../clients/client-options.repository';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { SetMemberRoleDto } from './dto/set-member-role.dto';
import { SetTeamClientsDto } from './dto/set-team-clients.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamsService } from './teams.service';

/** Owner/Admin team management: CRUD, client assignment, membership. */
@ApiTags('teams')
@UseInterceptors(AuditLogInterceptor)
@Roles(Role.OWNER, Role.ADMIN)
@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly clientOptions: ClientOptionsRepository,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.teams.list(user.orgId);
  }

  // Static paths declared before the :id routes below.
  @Get('client-options')
  async listClientOptions() {
    const options = await this.clientOptions.list();
    return this.teams.withTeamNames(options);
  }

  @Get('readiness')
  readiness(@CurrentUser() user: AuthPrincipal) {
    return this.teams.readiness(user.orgId);
  }

  @Post()
  create(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateTeamDto) {
    return this.teams.create(user, dto.name, dto.optionIds);
  }

  @Patch(':id')
  rename(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teams.rename(user.orgId, id, dto.name);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.teams.deleteTeam(user.orgId, id);
  }

  @Put(':id/clients')
  setClients(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() dto: SetTeamClientsDto) {
    return this.teams.setClients(user, id, dto.optionIds, dto.move ?? false);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Body() dto: AddTeamMemberDto) {
    return this.teams.addMember(user, id, dto.userId, dto.role ?? 'MEMBER');
  }

  @Patch(':id/members/:userId')
  setMemberRole(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: SetMemberRoleDto,
  ) {
    return this.teams.setMemberRole(user.orgId, id, userId, dto.role);
  }

  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() user: AuthPrincipal, @Param('id') id: string, @Param('userId') userId: string) {
    return this.teams.removeMember(user.orgId, id, userId);
  }
}

import { Body, Controller, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AccessScope } from '../access/access-scope';
import { Scope } from '../access/scope.decorator';
import { AuditLogInterceptor } from '../admin/audit-log.interceptor';
import { AuthPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { TeamsService } from './teams.service';

/** Any signed-in user: their own team memberships, and (for leads) adding a member. */
@ApiTags('my-teams')
@UseInterceptors(AuditLogInterceptor)
@Controller('my-teams')
export class MyTeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  mine(@CurrentUser() user: AuthPrincipal, @Scope() scope: AccessScope) {
    return this.teams.myTeams(user, scope);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: AuthPrincipal,
    @Scope() scope: AccessScope,
    @Param('id') id: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teams.leadAddMember(scope, user, id, dto.userId);
  }
}
